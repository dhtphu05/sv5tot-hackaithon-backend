import 'dotenv/config';
import { Prisma, PrismaClient, WorkspaceType } from '@prisma/client';

const expectedProjectRef = 'gvoccbqxackcacwhnoiz';
const expectedConfirmation = 'FIX_13_CITY_CRITERION_ASSIGNMENTS';
const expectedCityCode = 'DANANG_CITY';
const expectedSchoolCode = 'DHBK-DHDN';
const expectedSchoolYear = '2025-2026';
const auditAction = 'DATA_MIGRATION_ASSIGN_TASK_TO_CRITERION_REVIEWER';
const officerByCriterion = [
  { criterion: 'academic', email: 'sv5tot_hoctap@gmail.com' },
  { criterion: 'ethics', email: 'sv5tot_daoduc@gmail.com' },
  { criterion: 'integration', email: 'sv5tot_hoinhap@gmail.com' },
  { criterion: 'physical', email: 'sv5tot_theluc@gmail.com' },
  { criterion: 'volunteer', email: 'sv5tot_tinhnguyen@gmail.com' },
] as const;

if (process.env.APPLY_CITY_TASK_ASSIGNMENT_CLEANUP !== expectedConfirmation) {
  throw new Error(`Set APPLY_CITY_TASK_ASSIGNMENT_CLEANUP=${expectedConfirmation} to apply this one-time cleanup.`);
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
    const [school, city, applications] = await Promise.all([
      tx.workspace.findUnique({ where: { code: expectedSchoolCode }, select: { id: true, isActive: true, type: true } }),
      tx.workspace.findUnique({ where: { code: expectedCityCode }, select: { id: true, isActive: true, type: true } }),
      tx.application.findMany({
        where: { workspace: { is: { code: expectedSchoolCode, type: WorkspaceType.SCHOOL, isActive: true } },
          applicationType: 'individual', targetLevel: 'city', schoolYear: expectedSchoolYear,
          submittedAt: { not: null }, cancelledAt: null, archivedAt: null },
        select: { id: true, workspaceId: true },
      }),
    ]);
    if (!school?.isActive || school.type !== WorkspaceType.SCHOOL || !city?.isActive || city.type !== WorkspaceType.CITY || applications.length !== 30) {
      throw new Error('Expected current City season workspaces/applications not found; rolled back.');
    }
    const applicationIds = applications.map(({ id }) => id);
    const expectedOfficers = await tx.user.findMany({
      where: { email: { in: officerByCriterion.map(({ email }) => email) } },
      select: { id: true, email: true, isActive: true, role: true, workspaceId: true,
        officerSpecializations: { where: { isActive: true }, select: { criterion: true } } },
    });
    if (expectedOfficers.length !== 5 || expectedOfficers.some((user) => !user.isActive || user.role !== 'city_officer' ||
        user.workspaceId !== city.id || user.officerSpecializations.length !== 1 ||
        !officerByCriterion.some(({ email, criterion }) => email === user.email && user.officerSpecializations[0].criterion === criterion))) {
      throw new Error('Criterion City Officer roster changed; rolled back.');
    }

    const idsSql = (ids: string[]) => Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Application" WHERE "id" IN (${idsSql(applicationIds)}) ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ReviewTask" WHERE "applicationId" IN (${idsSql(applicationIds)}) ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" IN (${idsSql(expectedOfficers.map(({ id }) => id))}) ORDER BY "id" FOR UPDATE`);

    const tasks = await tx.reviewTask.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { id: true, workspaceId: true, applicationId: true, criterion: true, assignedOfficerId: true, status: true, decision: true,
        application: { select: { workspaceId: true, targetLevel: true, schoolYear: true, cancelledAt: true, archivedAt: true } },
        assignedOfficer: { select: { email: true, role: true, isActive: true, workspaceId: true,
          officerSpecializations: { where: { isActive: true }, select: { criterion: true } } } } },
      orderBy: [{ applicationId: 'asc' }, { criterion: 'asc' }, { id: 'asc' }],
    });
    if (tasks.length !== 150 || tasks.some((task) => task.application?.workspaceId !== school.id ||
        task.application.targetLevel !== 'city' || task.application.schoolYear !== expectedSchoolYear ||
        task.application.cancelledAt !== null || task.application.archivedAt !== null)) {
      throw new Error('Expected 150 active City tasks in the current season; rolled back.');
    }
    const openTasks = tasks.filter(({ status }) => ['waiting', 'reviewing', 'supplement_required'].includes(status));
    if (openTasks.length !== 90 || openTasks.some((task) => !task.assignedOfficer || task.assignedOfficer.role !== 'city_officer' ||
        !task.assignedOfficer.isActive || task.assignedOfficer.workspaceId !== city.id ||
        !task.assignedOfficer.officerSpecializations.some(({ criterion }) => criterion === task.criterion))) {
      throw new Error('Open tasks are no longer correctly assigned; rolled back.');
    }
    const mismatches = tasks.filter((task) => !task.assignedOfficer ||
      !task.assignedOfficer.officerSpecializations.some(({ criterion }) => criterion === task.criterion));
    if (mismatches.length !== 13 || mismatches.some((task) => task.status !== 'accepted' || task.decision !== 'accepted')) {
      throw new Error(`Expected only 13 previously accepted mismatched tasks; found ${mismatches.length}. Rolled back.`);
    }
    const alreadyAudited = await tx.auditLog.count({ where: { action: auditAction,
      targetType: 'review_task', targetId: { in: mismatches.map(({ id }) => id) } } });
    if (alreadyAudited !== 0) throw new Error('Assignment cleanup audit already exists; refusing to repeat.');

    const officersByCriterion = new Map<string, (typeof expectedOfficers)[number]>(expectedOfficers.map((user) => [
      user.officerSpecializations[0].criterion, user,
    ]));
    for (const task of mismatches) {
      const nextOfficer = officersByCriterion.get(task.criterion);
      if (!nextOfficer) throw new Error(`No City Officer is specialized for ${task.criterion}; rolled back.`);
      const changed = await tx.reviewTask.updateMany({
        where: { id: task.id, assignedOfficerId: task.assignedOfficerId, status: 'accepted', decision: 'accepted' },
        data: { assignedOfficerId: nextOfficer.id },
      });
      if (changed.count !== 1) throw new Error(`Conditional assignment update failed for task ${task.id}; rolled back.`);
      await tx.auditLog.create({
        data: {
          workspaceId: task.workspaceId,
          applicationId: task.applicationId,
          action: auditAction,
          targetType: 'review_task',
          targetId: task.id,
          beforeStateJson: { assignedOfficerId: task.assignedOfficerId, assignedOfficerEmail: task.assignedOfficer?.email,
            criterion: task.criterion, status: task.status, decision: task.decision },
          afterStateJson: { assignedOfficerId: nextOfficer.id, assignedOfficerEmail: nextOfficer.email,
            criterion: task.criterion, status: task.status, decision: task.decision },
          note: 'Align the current task owner with the criterion specialization for City pilot operations; preserve the existing review decision and status.',
        },
      });
    }

    const updatedTasks = await tx.reviewTask.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { id: true, applicationId: true, criterion: true, assignedOfficerId: true, status: true, decision: true,
        assignedOfficer: { select: { email: true, role: true, isActive: true, workspaceId: true,
          officerSpecializations: { where: { isActive: true }, select: { criterion: true } } } } },
    });
    const invalid = updatedTasks.filter((task) => !task.assignedOfficer || task.assignedOfficer.role !== 'city_officer' ||
      !task.assignedOfficer.isActive || task.assignedOfficer.workspaceId !== city.id ||
      !task.assignedOfficer.officerSpecializations.some(({ criterion }) => criterion === task.criterion));
    const changedIds = mismatches.map(({ id }) => id);
    if (updatedTasks.length !== 150 || invalid.length !== 0 || updatedTasks.some((task) => {
      const before = tasks.find(({ id }) => id === task.id)!;
      const shouldChange = changedIds.includes(task.id);
      return (shouldChange ? before.assignedOfficerId === task.assignedOfficerId : before.assignedOfficerId !== task.assignedOfficerId) ||
        before.status !== task.status || before.decision !== task.decision;
    })) throw new Error('Post-update task verification failed; rolled back.');

    const mappingCounts = mismatches.reduce<Record<string, number>>((counts, task) => {
      counts[task.criterion] = (counts[task.criterion] ?? 0) + 1;
      return counts;
    }, {});
    return { outcome: 'APPLIED', projectRef: expectedProjectRef, changedAssignments: mismatches.length,
      assignmentsByCriterion: mappingCounts, totalTasksVerified: updatedTasks.length,
      allTasksNowAssignedToActiveMatchingCityOfficers: true,
      taskStatusesAndDecisionsPreserved: true, auditRowsAdded: mismatches.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'City task assignment cleanup failed.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
