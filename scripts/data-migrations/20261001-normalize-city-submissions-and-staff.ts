import 'dotenv/config';
import { Prisma, PrismaClient, WorkspaceType } from '@prisma/client';

const expectedProjectRef = 'gvoccbqxackcacwhnoiz';
const expectedSchoolYear = '2025-2026';
const expectedSchoolCode = 'DHBK-DHDN';
const expectedCityCode = 'DANANG_CITY';
const expectedConfirmation = 'NORMALIZE_30_APPS_AND_5_OFFICERS';
const applicationAuditAction = 'DATA_MIGRATION_NORMALIZE_CITY_SUBMISSION_DATE';
const promotionAuditAction = 'DATA_MIGRATION_PROMOTE_CITY_OFFICER';
const deactivationAuditAction = 'DATA_MIGRATION_DEACTIVATE_SCHOOL_REVIEW_STAFF';

const expectedOfficers = [
  { email: 'officer.academic@dut.udn.vn', criterion: 'academic' },
  { email: 'officer.ethics@dut.udn.vn', criterion: 'ethics' },
  { email: 'officer.integration@dut.udn.vn', criterion: 'integration' },
  { email: 'officer.physical@dut.udn.vn', criterion: 'physical' },
  { email: 'officer.volunteer@dut.udn.vn', criterion: 'volunteer' },
] as const;
const expectedSchoolLeads = [
  { email: 'manager@dut.udn.vn', role: 'manager' },
  { email: 'committee@dut.udn.vn', role: 'committee' },
] as const;
const openTaskStatuses = ['waiting', 'reviewing', 'supplement_required'] as const;
const expectedCriteria = ['ethics', 'academic', 'physical', 'volunteer', 'integration'] as const;

if (process.env.APPLY_CITY_PILOT_NORMALIZATION !== expectedConfirmation) {
  throw new Error(`Set APPLY_CITY_PILOT_NORMALIZATION=${expectedConfirmation} to apply this one-time data change.`);
}

const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl) throw new Error('DATABASE_URL is required.');
const databaseUrl = new URL(rawDatabaseUrl);
if (!`${databaseUrl.hostname} ${decodeURIComponent(databaseUrl.username)}`.includes(expectedProjectRef)) {
  throw new Error('Refusing to change data outside the audited Supabase project.');
}

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const [season, school, city, databaseClock] = await Promise.all([
      tx.cityReviewSeason.findUnique({ where: { schoolYear: expectedSchoolYear } }),
      tx.workspace.findUnique({ where: { code: expectedSchoolCode } }),
      tx.workspace.findUnique({ where: { code: expectedCityCode } }),
      tx.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS now`,
    ]);
    if (!season?.submissionOpensAt || !season.submissionClosesAt || !school?.isActive || school.type !== WorkspaceType.SCHOOL ||
        !city?.isActive || city.type !== WorkspaceType.CITY) {
      throw new Error('Expected current-season or workspace configuration is missing; rolled back.');
    }

    const candidateIds = await tx.application.findMany({
      where: {
        workspaceId: school.id,
        applicationType: 'individual',
        targetLevel: 'city',
        schoolYear: expectedSchoolYear,
        submittedAt: { not: null },
        cancelledAt: null,
        archivedAt: null,
      },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (candidateIds.length !== 30) {
      throw new Error(`Expected exactly 30 active submitted City applications; found ${candidateIds.length}. Rolled back.`);
    }
    const applicationIds = candidateIds.map(({ id }) => id);
    const officerEmails = expectedOfficers.map(({ email }) => email);
    const schoolLeadEmails = expectedSchoolLeads.map(({ email }) => email);
    const staff = await tx.user.findMany({
      where: {
        role: { notIn: ['student', 'class_representative', 'admin'] },
        isActive: true,
        workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
      },
      select: { id: true, email: true, role: true, workspaceId: true, workspace: { select: { code: true } } },
    });
    const expectedStaffEmails = new Set<string>([...officerEmails, ...schoolLeadEmails]);
    if (staff.length !== 7 || staff.some(({ email }) => !expectedStaffEmails.has(email)) ||
        [...expectedStaffEmails].some((email) => !staff.some((user) => user.email === email))) {
      throw new Error('Active school staff roster differs from the reviewed seven accounts; rolled back.');
    }
    const staffIds = staff.map(({ id }) => id);

    const idsForLock = (ids: string[]) => Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Application"
      WHERE "id" IN (${idsForLock(applicationIds)})
      ORDER BY "id" FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ReviewTask"
      WHERE "applicationId" IN (${idsForLock(applicationIds)})
      ORDER BY "id" FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "User"
      WHERE "id" IN (${idsForLock(staffIds)})
      ORDER BY "id" FOR UPDATE
    `);

    const applications = await tx.application.findMany({
      where: { id: { in: applicationIds } },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true, workspaceId: true, studentId: true, schoolYear: true, applicationType: true,
        targetLevel: true, status: true, readinessScore: true, currentDraftVersion: true,
        submittedAt: true, finalLevel: true, finalStatus: true, finalNote: true, finalizedAt: true,
        finalizedById: true, cancelledAt: true, cancelledById: true, cancelReason: true,
        archivedAt: true, archivedById: true, archiveReason: true, createdAt: true,
        reviewTasks: { select: {
          id: true, workspaceId: true, criterion: true, assignedOfficerId: true, status: true, decision: true,
          assignedOfficer: { select: { id: true, email: true, role: true, isActive: true, workspaceId: true,
            officerSpecializations: { where: { isActive: true }, select: { criterion: true, facultyScope: true } } } },
        } },
      },
    });
    const officers = await tx.user.findMany({
      where: { email: { in: officerEmails } },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, workspaceId: true,
        studentCode: true, officerSpecializations: { where: { isActive: true }, select: { criterion: true, facultyScope: true } } },
    });
    const schoolLeads = await tx.user.findMany({
      where: { email: { in: schoolLeadEmails } },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, workspaceId: true,
        _count: { select: { assignedReviewTasks: true } } },
    });
    if (applications.length !== 30 || applications.some((app) => app.submittedAt === null ||
        app.workspaceId !== school.id || app.schoolYear !== expectedSchoolYear || app.applicationType !== 'individual' ||
        app.targetLevel !== 'city' || app.cancelledAt !== null || app.archivedAt !== null ||
        app.submittedAt >= season.submissionOpensAt!)) {
      throw new Error('Application scope/date/status changed since the read-only preflight; rolled back.');
    }
    if (officers.length !== 5 || officers.some((user) => user.role !== 'officer' || !user.isActive ||
        user.workspaceId !== school.id || user.studentCode !== null || user.officerSpecializations.length !== 1 ||
        user.officerSpecializations[0].facultyScope !== null ||
        !expectedOfficers.some(({ email, criterion }) => email === user.email && criterion === user.officerSpecializations[0].criterion))) {
      throw new Error('The five criterion officer accounts changed since preflight; rolled back.');
    }
    if (schoolLeads.length !== 2 || schoolLeads.some((user) => !user.isActive || user.workspaceId !== school.id ||
        user._count.assignedReviewTasks !== 0 ||
        !expectedSchoolLeads.some((expected) => expected.email === user.email && expected.role === user.role))) {
      throw new Error('The school manager/committee accounts changed since preflight; rolled back.');
    }

    const tasks = applications.flatMap(({ reviewTasks }) => reviewTasks);
    if (tasks.length !== 150 || applications.some(({ reviewTasks }) => reviewTasks.length !== 5 ||
        new Set(reviewTasks.map(({ criterion }) => criterion)).size !== 5 ||
        expectedCriteria.some((criterion) => !reviewTasks.some((task) => task.criterion === criterion)))) {
      throw new Error('Expected exactly five unique City criterion tasks per application; rolled back.');
    }
    const expectedOfficerByEmail = new Map<string, string>(expectedOfficers.map(({ email, criterion }) => [email, criterion]));
    const openTasks = tasks.filter(({ status }) => openTaskStatuses.some((openStatus) => status === openStatus));
    if (openTasks.length !== 90 || openTasks.some((task) => !task.assignedOfficer ||
        !expectedOfficerByEmail.has(task.assignedOfficer.email) || !task.assignedOfficer.isActive ||
        task.assignedOfficer.role !== 'officer' || task.assignedOfficer.workspaceId !== school.id ||
        !task.assignedOfficer.officerSpecializations.some(({ criterion }) => criterion === task.criterion))) {
      throw new Error('Open review tasks are not assigned to active matching criterion officers; rolled back.');
    }
    const historicalMismatches = tasks.filter((task) => task.assignedOfficer &&
      !task.assignedOfficer.officerSpecializations.some(({ criterion }) => criterion === task.criterion));
    if (historicalMismatches.length !== 13 || historicalMismatches.some(({ status, decision }) => status !== 'accepted' || decision !== 'accepted')) {
      throw new Error('Unexpected historical criterion assignment mismatch; rolled back.');
    }

    const allTargetIds = [...applicationIds, ...staffIds];
    const priorAuditCount = await tx.auditLog.count({
      where: {
        targetId: { in: allTargetIds },
        action: { in: [applicationAuditAction, promotionAuditAction, deactivationAuditAction] },
      },
    });
    if (priorAuditCount !== 0) throw new Error('A one-time normalization audit already exists; refusing to repeat.');

    const now = databaseClock[0]?.now;
    if (!now || now <= season.submissionOpensAt || now > season.submissionClosesAt) {
      throw new Error('Current database time is outside the open City season; rolled back.');
    }
    const windowDuration = now.getTime() - season.submissionOpensAt.getTime();
    const plannedSubmissions = applications.map((app, index) => ({
      ...app,
      newSubmittedAt: new Date(season.submissionOpensAt!.getTime() + Math.floor(windowDuration * (index + 1) / (applications.length + 1))),
    }));
    if (plannedSubmissions.some(({ newSubmittedAt }) => newSubmittedAt <= season.submissionOpensAt! ||
        newSubmittedAt > now || newSubmittedAt > season.submissionClosesAt!)) {
      throw new Error('Computed submission timestamps are outside the season; rolled back.');
    }

    for (const app of plannedSubmissions) {
      const changed = await tx.$executeRaw`
        UPDATE "Application" SET "submittedAt" = ${app.newSubmittedAt}
        WHERE "id" = ${app.id}::uuid AND "submittedAt" = ${app.submittedAt!}
      `;
      if (changed !== 1) throw new Error(`Conditional submission timestamp update failed for ${app.id}; rolled back.`);
    }
    const appAudits = await tx.auditLog.createMany({
      data: plannedSubmissions.map((app) => ({
        workspaceId: school.id,
        applicationId: app.id,
        action: applicationAuditAction,
        targetType: 'application',
        targetId: app.id,
        beforeStateJson: { submittedAt: app.submittedAt!.toISOString() },
        afterStateJson: { submittedAt: app.newSubmittedAt.toISOString(), reason: 'City pilot season testing normalization' },
        note: 'Normalize a legacy pre-season submission timestamp into the active 2025-2026 City season for pilot testing; original timestamp is recorded in beforeStateJson.',
      })),
    });
    if (appAudits.count !== 30) throw new Error('Could not write one normalization audit per application; rolled back.');

    const promoted: Array<{ id: string; email: string; fullName: string; criterion: string; revokedRefreshTokens: number }> = [];
    for (const user of officers) {
      const criterion = user.officerSpecializations[0].criterion;
      const changed = await tx.user.updateMany({
        where: { id: user.id, role: 'officer', isActive: true, workspaceId: school.id },
        data: { role: 'city_officer', workspaceId: city.id },
      });
      if (changed.count !== 1) throw new Error(`Conditional role promotion failed for ${user.email}; rolled back.`);
      const refresh = await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({
        data: {
          workspaceId: city.id, actorRole: null, action: promotionAuditAction, targetType: 'user', targetId: user.id,
          beforeStateJson: { role: 'officer', workspaceCode: expectedSchoolCode, active: true, specialization: criterion },
          afterStateJson: { role: 'city_officer', workspaceCode: expectedCityCode, active: true, specialization: criterion,
            revokedRefreshTokens: refresh.count },
          note: 'Promote the existing criterion reviewer to City scope for the City pilot; preserve password hash and specialization.',
        },
      });
      promoted.push({ id: user.id, email: user.email, fullName: user.fullName, criterion, revokedRefreshTokens: refresh.count });
    }

    const deactivated: Array<{ id: string; email: string; fullName: string; role: string; revokedRefreshTokens: number }> = [];
    for (const user of schoolLeads) {
      const changed = await tx.user.updateMany({
        where: { id: user.id, role: user.role, isActive: true, workspaceId: school.id },
        data: { isActive: false },
      });
      if (changed.count !== 1) throw new Error(`Conditional school staff deactivation failed for ${user.email}; rolled back.`);
      const refresh = await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({
        data: {
          workspaceId: school.id, actorRole: null, action: deactivationAuditAction, targetType: 'user', targetId: user.id,
          beforeStateJson: { role: user.role, workspaceCode: expectedSchoolCode, active: true },
          afterStateJson: { role: user.role, workspaceCode: expectedSchoolCode, active: false,
            revokedRefreshTokens: refresh.count },
          note: 'Deactivate school-level review access for the City-only pilot; retain the account and audit history.',
        },
      });
      deactivated.push({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, revokedRefreshTokens: refresh.count });
    }

    const [verifiedApplications, verifiedTasks, verifiedPromoted, remainingSchoolStaff, currentCityStaff] = await Promise.all([
      tx.application.findMany({ where: { id: { in: applicationIds } }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, submittedAt: true, status: true, finalStatus: true, targetLevel: true, createdAt: true } }),
      tx.reviewTask.findMany({ where: { applicationId: { in: applicationIds } },
        select: { id: true, applicationId: true, assignedOfficerId: true, criterion: true, status: true, decision: true,
          assignedOfficer: { select: { email: true, role: true, isActive: true, workspaceId: true,
            officerSpecializations: { where: { isActive: true }, select: { criterion: true } } } } } }),
      tx.user.findMany({ where: { id: { in: officers.map(({ id }) => id) } }, select: { id: true, email: true, role: true,
        isActive: true, workspaceId: true, officerSpecializations: { where: { isActive: true }, select: { criterion: true } } } }),
      tx.user.findMany({ where: { role: { notIn: ['student', 'class_representative', 'admin'] }, isActive: true,
        workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } }, select: { id: true, role: true, email: true } }),
      tx.user.findMany({ where: { isActive: true, workspaceId: city.id,
        role: { in: ['city_officer', 'city_manager', 'city_committee'] } },
        orderBy: [{ role: 'asc' }, { email: 'asc' }], select: { email: true, role: true,
          officerSpecializations: { where: { isActive: true }, select: { criterion: true } } } }),
    ]);
    if (verifiedApplications.length !== 30 || verifiedApplications.some((app, index) =>
        !app.submittedAt || app.submittedAt <= season.submissionOpensAt! || app.submittedAt > now ||
        app.status !== applications[index].status || app.finalStatus !== applications[index].finalStatus ||
        app.targetLevel !== applications[index].targetLevel || app.createdAt.getTime() !== applications[index].createdAt.getTime())) {
      throw new Error('Post-update application verification failed; transaction rolled back.');
    }
    if (remainingSchoolStaff.length !== 0 || verifiedPromoted.length !== 5 || verifiedPromoted.some((user) =>
        user.role !== 'city_officer' || !user.isActive || user.workspaceId !== city.id ||
        user.officerSpecializations.length !== 1 || !expectedOfficers.some(({ email, criterion }) =>
          email === user.email && user.officerSpecializations[0].criterion === criterion))) {
      throw new Error('Post-update account-role verification failed; transaction rolled back.');
    }
    if (verifiedTasks.length !== 150 || verifiedTasks.some((task) => {
      const prior = tasks.find(({ id }) => id === task.id);
      const currentMatchesExpected = expectedOfficerByEmail.get(task.assignedOfficer?.email ?? '') === task.criterion;
      const wasHistoricallyMismatched = historicalMismatches.some(({ id }) => id === task.id);
      return !prior || prior.assignedOfficerId !== task.assignedOfficerId || prior.status !== task.status || prior.decision !== task.decision ||
        task.assignedOfficer?.role !== 'city_officer' || !task.assignedOfficer.isActive || task.assignedOfficer.workspaceId !== city.id ||
        (!currentMatchesExpected && !wasHistoricallyMismatched);
    })) {
      throw new Error('Post-update task assignments/statuses changed or no longer resolve to City reviewers; rolled back.');
    }

    const statusCounts = verifiedTasks.reduce<Record<string, number>>((counts, task) => {
      counts[task.status] = (counts[task.status] ?? 0) + 1;
      return counts;
    }, {});
    return {
      outcome: 'APPLIED',
      projectRef: expectedProjectRef,
      schoolYear: expectedSchoolYear,
      seasonWindowUtc: { opensAt: season.submissionOpensAt, closesAt: season.submissionClosesAt },
      applications: {
        changedSubmittedAtCount: 30,
        firstSubmittedAt: verifiedApplications[0].submittedAt,
        lastSubmittedAt: verifiedApplications[verifiedApplications.length - 1].submittedAt,
        allInsideOpenSeasonThroughDatabaseNow: true,
        statusesAndFinalStatusesPreserved: true,
        originalAuditHistoryPreserved: true,
        normalizationAuditRows: appAudits.count,
      },
      promotedCityOfficers: promoted,
      deactivatedSchoolStaff: deactivated,
      reviewTasks: {
        total: verifiedTasks.length,
        taskIdsAssigneesCriteriaStatusesAndDecisionsPreserved: true,
        statusCounts,
        openTasksAssignedToMatchingSpecialization: openTasks.length,
        historicalAcceptedTasksWithPreexistingSpecializationMismatch: historicalMismatches.length,
      },
      activeCityStaff: currentCityStaff.map((user) => ({ email: user.email, role: user.role,
        specializations: user.officerSpecializations.map(({ criterion }) => criterion) })),
      activeSchoolStaffRemaining: remainingSchoolStaff.length,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'City pilot normalization failed.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
