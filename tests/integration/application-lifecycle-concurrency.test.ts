import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  FinalStatus,
  Level,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma';
import { ApplicationLifecycleService } from '../../src/modules/applications/application-lifecycle.service';
import { ManagerService } from '../../src/modules/manager/manager.service';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const prefix = `p3c-${Date.now()}-${randomUUID().slice(0, 8)}`;
const applicationIds: string[] = [];
const userIds: string[] = [];
const workspaceIds: string[] = [];
const lifecycle = new ApplicationLifecycleService();
const manager = new ManagerService();
const criteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
];

let cityManager: AuthenticatedUser;
let admin: AuthenticatedUser;
let schoolWorkspaceId: string;
let fixtureNumber = 0;

type FixtureApplication = { id: string; studentId: string };
beforeAll(async () => {
  const city = await prisma.workspace.create({
    data: { code: `${prefix}-city`, name: `${prefix} City`, type: WorkspaceType.CITY },
  });
  workspaceIds.push(city.id);
  const school = await prisma.workspace.create({
    data: {
      code: `${prefix}-school`,
      name: `${prefix} School`,
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: city.id,
    },
  });
  workspaceIds.push(school.id);
  schoolWorkspaceId = school.id;

  const cityUser = await prisma.user.create({
    data: {
      workspaceId: city.id,
      fullName: `${prefix} City Manager`,
      email: `${prefix}.city-manager@example.test`,
      passwordHash: 'integration-only',
      role: Role.city_manager,
    },
  });
  userIds.push(cityUser.id);
  const adminUser = await prisma.user.create({
    data: {
      workspaceId: null,
      fullName: `${prefix} Admin`,
      email: `${prefix}.admin@example.test`,
      passwordHash: 'integration-only',
      role: Role.admin,
    },
  });
  userIds.push(adminUser.id);

  cityManager = {
    id: cityUser.id,
    workspaceId: city.id,
    email: cityUser.email,
    role: cityUser.role,
    fullName: cityUser.fullName,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspace: {
      id: city.id,
      code: city.code,
      type: WorkspaceType.CITY,
      name: city.name,
      shortName: city.shortName,
    },
  };
  admin = {
    id: adminUser.id,
    workspaceId: null,
    email: adminUser.email,
    role: adminUser.role,
    fullName: adminUser.fullName,
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspace: null,
  };
});

afterAll(async () => {
  if (applicationIds.length) {
    await prisma.applicationFinalDecisionHistory.deleteMany({
      where: { applicationId: { in: applicationIds } },
    });
    await prisma.application.deleteMany({ where: { id: { in: applicationIds } } });
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (workspaceIds.length)
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  expect(
    await prisma.application.count({ where: { id: { in: applicationIds } } }),
  ).toBe(0);
  expect(
    await prisma.applicationFinalDecisionHistory.count({
      where: { applicationId: { in: applicationIds } },
    }),
  ).toBe(0);
  expect(await prisma.user.count({ where: { id: { in: userIds } } })).toBe(0);
  expect(await prisma.workspace.count({ where: { id: { in: workspaceIds } } })).toBe(0);
});

describe('City application lifecycle row-lock races on PostgreSQL', () => {
  it('serializes cancel first and rejects a finalization waiting behind cancellation', async () => {
    const app = await createApplication();
    const race = await holdApplicationLockWhileStarting(
      app.id,
      async (tx) => {
        await tx.application.update({
          where: { id: app.id },
          data: {
            cancelledAt: new Date(),
            cancelledById: cityManager.id,
            cancelReason: 'Race: cancel first',
          },
        });
      },
      () => finalize(app.id),
    );

    expect(race.settledWhileLocked).toBe(false);
    const [finalized] = race.outcomes;
    expect(finalized.status).toBe('rejected');
    if (finalized.status === 'rejected') {
      expect(finalized.reason).toMatchObject({ statusCode: 409, code: 'APPLICATION_CANCELLED' });
    }

    const current = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(current.cancelledAt).not.toBeNull();
    expect(current.finalStatus).toBe(FinalStatus.pending);
    expect(current.finalizedAt).toBeNull();
    expect(await prisma.cascadeReview.count({ where: { applicationId: app.id } })).toBe(0);
  }, 30_000);

  it('serializes finalization first and cancellation snapshots that committed final', async () => {
    const app = await createApplication();
    const race = await holdApplicationLockWhileStarting(
      app.id,
      async (tx) => {
        await tx.application.update({
          where: { id: app.id },
          data: {
            status: ApplicationStatus.completed,
            finalStatus: FinalStatus.passed,
            finalLevel: Level.city,
            finalNote: 'Committed final before cancellation',
            finalizedAt: new Date(),
            finalizedById: admin.id,
          },
        });
      },
      () => lifecycle.cancel(cityManager, app.id, { reason: 'Race: cancel after final' }),
    );

    expect(race.settledWhileLocked).toBe(false);
    const [cancelled] = race.outcomes;
    expect(cancelled.status).toBe('fulfilled');

    const current = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(current.cancelledAt).not.toBeNull();
    expect(current.finalStatus).toBe(FinalStatus.pending);
    expect(current.finalizedAt).toBeNull();
    const history = await prisma.applicationFinalDecisionHistory.findMany({
      where: { applicationId: app.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      finalStatus: FinalStatus.passed,
      finalLevel: Level.city,
      supersedeReason: 'Race: cancel after final',
    });
  }, 30_000);

  it('allows only one concurrent cancellation and records one cancellation audit and notification', async () => {
    const app = await createApplication();
    const outcomes = await Promise.allSettled([
      lifecycle.cancel(cityManager, app.id, { reason: 'Race: first cancel' }),
      lifecycle.cancel(cityManager, app.id, { reason: 'Race: second cancel' }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { applicationId: app.id, action: 'APPLICATION_CANCELLED' },
      }),
    ).toBe(1);
    expect(await prisma.notification.count({ where: { applicationId: app.id } })).toBe(1);
  }, 30_000);

  it('serializes reopen then cancel without leaving partially reopened fields', async () => {
    const app = await createApplication();
    const taskSnapshot = await readReviewTaskSnapshot(app.id);
    expect(taskSnapshot).toHaveLength(5);
    await lifecycle.cancel(cityManager, app.id, { reason: 'Seed cancelled state' });
    const outcomes = await Promise.allSettled([
      lifecycle.reopenCancelled(cityManager, app.id, { reason: 'Race: reopen first' }),
      lifecycle.cancel(cityManager, app.id, { reason: 'Race: cancel again' }),
    ]);
    expect(outcomes[0].status).toBe('fulfilled');
    const current = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(current.archivedAt).toBeNull();
    if (outcomes[1].status === 'fulfilled') {
      expect(current.cancelledAt).not.toBeNull();
      expect(current.cancelReason).toBe('Race: cancel again');
    } else {
      expect(outcomes[1].reason).toMatchObject({ statusCode: 409 });
      expect(current.cancelledAt).toBeNull();
      expect(current.cancelReason).toBeNull();
    }
    expect(await readReviewTaskSnapshot(app.id)).toEqual(taskSnapshot);
  }, 30_000);

  it('serializes reopen-final and cancellation without duplicating final history', async () => {
    const app = await createApplication({ final: true });
    const taskSnapshot = await readReviewTaskSnapshot(app.id);
    expect(taskSnapshot).toHaveLength(5);
    const outcomes = await Promise.allSettled([
      manager.reopenFinal(cityManager, app.id, {
        status: ApplicationStatus.under_review,
        reason: 'Race: reopen final first',
      }),
      lifecycle.cancel(cityManager, app.id, { reason: 'Race: cancel after reopen' }),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    const current = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(current.cancelledAt).not.toBeNull();
    expect(current.finalStatus).toBe(FinalStatus.pending);
    expect(current.status).toBe(
      outcomes[0].status === 'fulfilled'
        ? ApplicationStatus.under_review
        : ApplicationStatus.completed,
    );
    expect(
      await prisma.applicationFinalDecisionHistory.count({ where: { applicationId: app.id } }),
    ).toBe(1);
    expect(await readReviewTaskSnapshot(app.id)).toEqual(taskSnapshot);
  }, 30_000);

  it('serializes archive before reopen and clears archive with cancellation', async () => {
    const app = await createApplication();
    await lifecycle.cancel(cityManager, app.id, { reason: 'Seed cancelled state' });
    const outcomes = await Promise.allSettled([
      lifecycle.archive(cityManager, app.id, { reason: 'Race: archive first' }),
      lifecycle.reopenCancelled(cityManager, app.id, { reason: 'Race: reopen archived' }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled').length).toBeGreaterThan(0);
    const current = await prisma.application.findUniqueOrThrow({ where: { id: app.id } });
    expect(current.cancelledAt).toBeNull();
    expect(current.archivedAt).toBeNull();
    expect(current.status).toBe(ApplicationStatus.under_review);
  }, 30_000);
});

async function createApplication(options: { final?: boolean } = {}): Promise<FixtureApplication> {
  fixtureNumber += 1;
  const suffix = `${prefix}-${fixtureNumber}`;
  const student = await prisma.user.create({
    data: {
      workspaceId: schoolWorkspaceId,
      fullName: `Student ${suffix}`,
      email: `${suffix}.student@example.test`,
      passwordHash: 'integration-only',
      role: Role.student,
      studentCode: `SV${suffix}`,
      className: '26A',
    },
  });
  userIds.push(student.id);
  const application = await prisma.application.create({
    data: {
      workspaceId: schoolWorkspaceId,
      studentId: student.id,
      schoolYear: '2026-2027',
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      status: options.final ? ApplicationStatus.completed : ApplicationStatus.under_review,
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      ...(options.final
        ? {
            finalStatus: FinalStatus.passed,
            finalLevel: Level.city,
            finalNote: 'Integration current final',
            finalizedAt: new Date('2026-09-10T00:00:00.000Z'),
            finalizedById: admin.id,
          }
        : {}),
    },
  });
  applicationIds.push(application.id);
  await prisma.reviewTask.createMany({
    data: criteria.map((criterion) => ({
      workspaceId: schoolWorkspaceId,
      applicationId: application.id,
      criterion,
      status: ReviewTaskStatus.accepted,
      decision: ReviewDecision.accepted,
      officerSuggestedLevel: Level.city,
    })),
  });
  return { id: application.id, studentId: student.id };
}

async function finalize(applicationId: string) {
  return manager.finalizeApplication(admin, applicationId, {
    finalStatus: FinalStatus.passed,
    finalLevel: Level.city,
    finalNote: 'Integration race finalization',
    overrideAggregation: true,
    notifyStudent: false,
  });
}

async function readReviewTaskSnapshot(applicationId: string) {
  return prisma.reviewTask.findMany({
    where: { applicationId },
    select: { id: true, criterion: true, status: true, decision: true },
    orderBy: { criterion: 'asc' },
  });
}

async function holdApplicationLockWhileStarting<T>(
  applicationId: string,
  commitTransition: (tx: Prisma.TransactionClient) => Promise<void>,
  startContender: () => Promise<T>,
): Promise<{ settledWhileLocked: boolean; outcomes: PromiseSettledResult<T>[] }> {
  let signalLocked!: () => void;
  let release!: () => void;
  let contenderSettled = false;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  const lockTransaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Application" WHERE "id" = ${applicationId}::uuid FOR UPDATE
      `;
      signalLocked();
      await hold;
      await commitTransition(tx);
    },
    { maxWait: 15_000, timeout: 30_000 },
  );

  let contender: Promise<T> | undefined;
  try {
    await Promise.race([
      locked,
      lockTransaction.then(() => {
        throw new Error('The application lock transaction ended before signaling the lock.');
      }),
    ]);
    contender = startContender();
    void contender.then(
      () => {
        contenderSettled = true;
      },
      () => {
        contenderSettled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const settledWhileLocked = contenderSettled;
    release();
    await lockTransaction;
    return { settledWhileLocked, outcomes: await Promise.allSettled([contender]) };
  } finally {
    release();
    await lockTransaction.catch(() => undefined);
    if (contender) await Promise.allSettled([contender]);
  }
}
