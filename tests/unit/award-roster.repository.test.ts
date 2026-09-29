import {
  AwardDecisionStatus,
  AwardLevel,
  AwardRecipientMatchStatus,
  JobStatus,
  JobType,
  Role,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AwardRosterRepository } from '../../src/modules/award-decisions/award-roster.repository';

const workspaceId = '11111111-1111-4111-8111-111111111111';

function buildTransaction(options: {
  duplicate?: boolean;
  failRecipientInsert?: boolean;
  rowCorrections?: Record<string, Record<string, unknown>>;
} = {}) {
  const state = {
    status: AwardDecisionStatus.DRAFT as AwardDecisionStatus,
    recipients: [] as Array<Record<string, unknown>>,
    auditRows: [] as Array<Record<string, unknown>>,
  };
  const decision = () => ({
    id: 'decision-1',
    issuerWorkspaceId: workspaceId,
    awardLevel: AwardLevel.SCHOOL,
    rosterFileId: 'file-1',
    status: state.status,
    rosterFile: { id: 'file-1', workspaceId },
  });
  const job: Record<string, unknown> = {
    id: 'internal-job-id',
    targetId: 'decision-1',
    workspaceId,
    jobType: JobType.award_roster_ingestion,
    status: JobStatus.completed,
    inputJson: { rosterFileId: 'file-1' },
    resultJson: {
      rosterFileId: 'file-1',
      columns: ['MSSV', 'Họ và tên'],
      sourceRows: options.duplicate
        ? [['00000001', 'Nguyễn An'], ['00000001', 'Nguyễn An']]
        : [['00000001', 'Nguyễn An']],
      suggestedMapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' },
      ...(options.rowCorrections ? { rowCorrections: options.rowCorrections } : {}),
    },
  };
  const tx = {
    awardDecision: {
      findFirst: vi.fn(async () => decision()),
      findUnique: vi.fn(async () => ({ id: 'decision-1' })),
      updateMany: vi.fn(async ({ where, data }: { where: { status: AwardDecisionStatus }; data: { status: AwardDecisionStatus } }) => {
        if (state.status !== where.status) return { count: 0 };
        state.status = data.status;
        return { count: 1 };
      }),
    },
    indexingJob: {
      findFirst: vi.fn().mockResolvedValue(job),
      updateMany: vi.fn(async ({ data }: { data: { resultJson: unknown } }) => {
        job.resultJson = data.resultJson;
        return { count: 1 };
      }),
    },
    workspace: {
      findUnique: vi.fn().mockResolvedValue({
        id: workspaceId,
        code: 'DUT',
        name: 'DUT',
        shortName: 'DUT',
        workspaceAbbreviations: [],
      }),
      findMany: vi.fn(),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    awardRecipient: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if (options.failRecipientInsert) throw new Error('insert failed');
        state.recipients.push(...data);
        return { count: data.length };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.auditRows.push(data);
        return data;
      }),
    },
  };
  const db = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const previousStatus = state.status;
      const previousRecipients = [...state.recipients];
      const previousAudits = [...state.auditRows];
      try {
        return await callback(tx);
      } catch (error) {
        state.status = previousStatus;
        state.recipients = previousRecipients;
        state.auditRows = previousAudits;
        throw error;
      }
    }),
  };
  return { repository: new AwardRosterRepository(db as never), state, tx };
}

const actor = {
  id: 'uploader-1',
  role: Role.data_uploader,
} as never;

describe('AwardRosterRepository confirmation transaction', () => {
  it('creates unmatched recipients and confirms atomically without writing roster PII to audit', async () => {
    const { repository, state, tx } = buildTransaction();

    await expect(repository.confirm({ decisionId: 'decision-1', issuerWorkspaceId: workspaceId, actor }))
      .resolves.toEqual({ recipientCount: 1 });

    expect(state.status).toBe(AwardDecisionStatus.CONFIRMED);
    expect(state.recipients).toMatchObject([
      {
        studentCode: '00000001',
        fullName: 'Nguyễn An',
        institutionWorkspaceId: workspaceId,
        matchedUserId: null,
        matchStatus: AwardRecipientMatchStatus.UNMATCHED,
      },
    ]);
    expect(tx.awardDecision.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ rosterFileId: 'file-1', status: AwardDecisionStatus.DRAFT }),
    }));
    expect(JSON.stringify(state.auditRows)).not.toContain('00000001');
    expect(JSON.stringify(state.auditRows)).not.toContain('Nguyễn An');
  });

  it('rejects duplicates before changing decision state or inserting any recipients', async () => {
    const { repository, state, tx } = buildTransaction({ duplicate: true });

    await expect(repository.confirm({ decisionId: 'decision-1', issuerWorkspaceId: workspaceId, actor }))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(state.status).toBe(AwardDecisionStatus.DRAFT);
    expect(state.recipients).toHaveLength(0);
    expect(tx.awardDecision.updateMany).toHaveBeenCalledOnce();
    expect(tx.awardDecision.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: AwardDecisionStatus.DRAFT },
    }));
    expect(tx.awardRecipient.createMany).not.toHaveBeenCalled();
  });

  it('rolls back status and recipient writes when batch insertion fails', async () => {
    const { repository, state } = buildTransaction({ failRecipientInsert: true });

    await expect(repository.confirm({ decisionId: 'decision-1', issuerWorkspaceId: workspaceId, actor }))
      .rejects.toThrow('insert failed');

    expect(state.status).toBe(AwardDecisionStatus.DRAFT);
    expect(state.recipients).toHaveLength(0);
    expect(state.auditRows).toHaveLength(0);
  });

  it('prevents a second confirmation without creating duplicate recipients', async () => {
    const { repository, state } = buildTransaction();
    await repository.confirm({ decisionId: 'decision-1', issuerWorkspaceId: workspaceId, actor });

    await expect(repository.confirm({ decisionId: 'decision-1', issuerWorkspaceId: workspaceId, actor }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(state.recipients).toHaveLength(1);
  });

  it('locks the current draft decision before reading the mapping used for confirmation', async () => {
    const { repository, tx } = buildTransaction();

    await repository.confirm({ decisionId: 'decision-1', issuerWorkspaceId: workspaceId, actor });

    expect(tx.awardDecision.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.indexingJob.findFirst.mock.invocationCallOrder[0]!,
    );
  });

  it('does not save a mapping after the decision has left draft', async () => {
    const tx = {
      awardDecision: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      indexingJob: { updateMany: vi.fn() },
    };
    const db = { $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const repository = new AwardRosterRepository(db as never);

    await expect(repository.updatePreview({
      jobId: 'job-1',
      decisionId: 'decision-1',
      issuerWorkspaceId: workspaceId,
      rosterFileId: 'file-1',
      awardLevel: AwardLevel.SCHOOL,
      change: { type: 'mapping', mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' } },
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.indexingJob.updateMany).not.toHaveBeenCalled();
  });

  it('stores correction overlays without mutating raw rows and audits only the corrected row fields', async () => {
    const { repository, state } = buildTransaction({ duplicate: true });

    const updated = await repository.updatePreview({
      jobId: 'internal-job-id',
      decisionId: 'decision-1',
      issuerWorkspaceId: workspaceId,
      rosterFileId: 'file-1',
      awardLevel: AwardLevel.SCHOOL,
      change: {
        type: 'correct',
        sourceRow: 3,
        correction: { studentCode: '00000002', fullName: 'Trần Bình' },
        actor,
      },
    });

    expect(updated.sourceRows).toEqual([['00000001', 'Nguyễn An'], ['00000001', 'Nguyễn An']]);
    expect(updated.rowCorrections).toEqual({ '3': { studentCode: '00000002', fullName: 'Trần Bình' } });
    expect(updated.rows.map((row) => row.status)).toEqual(['VALID', 'VALID']);
    expect(updated.summary).toMatchObject({ valid: 2, duplicate: 0 });
    expect(state.auditRows).toHaveLength(1);
    expect(state.auditRows[0]).toMatchObject({
      action: 'AWARD_ROSTER_ROW_CORRECTED',
      targetType: 'award_decision',
      targetId: 'decision-1',
      beforeStateJson: { sourceRow: 3, fields: { studentCode: '00000001', fullName: 'Nguyễn An' } },
      afterStateJson: { sourceRow: 3, fields: { studentCode: '00000002', fullName: 'Trần Bình' } },
    });
    expect(JSON.stringify(state.auditRows)).not.toContain('sourceRows');
  });

  it('reverts a correction to raw effective values and records a bounded audit entry', async () => {
    const { repository, state } = buildTransaction({
      rowCorrections: { '2': { studentCode: '00000002', fullName: 'Nguyễn An sửa' } },
    });

    const updated = await repository.updatePreview({
      jobId: 'internal-job-id',
      decisionId: 'decision-1',
      issuerWorkspaceId: workspaceId,
      rosterFileId: 'file-1',
      awardLevel: AwardLevel.SCHOOL,
      change: { type: 'revert', sourceRow: 2, actor },
    });

    expect(updated.sourceRows).toEqual([['00000001', 'Nguyễn An']]);
    expect(updated.rowCorrections).toBeUndefined();
    expect(updated.rows[0]).toMatchObject({ studentCode: '00000001', fullName: 'Nguyễn An', isCorrected: false });
    expect(state.auditRows[0]).toMatchObject({
      action: 'AWARD_ROSTER_ROW_CORRECTION_REVERTED',
      beforeStateJson: { sourceRow: 2, fields: { studentCode: '00000002', fullName: 'Nguyễn An sửa' } },
      afterStateJson: { sourceRow: 2, fields: { studentCode: '00000001', fullName: 'Nguyễn An' } },
    });
  });

  it('uses corrected values to create official recipients at confirmation', async () => {
    const { repository, state } = buildTransaction({
      rowCorrections: { '2': { studentCode: '00000002', fullName: 'Nguyễn An sửa' } },
    });

    await repository.confirm({ decisionId: 'decision-1', issuerWorkspaceId: workspaceId, actor });

    expect(state.recipients).toMatchObject([{ studentCode: '00000002', fullName: 'Nguyễn An sửa' }]);
  });

  it('preserves row corrections when updating the column mapping', async () => {
    const { repository } = buildTransaction({
      rowCorrections: { '2': { studentCode: '00000002' } },
    });

    const updated = await repository.updatePreview({
      jobId: 'internal-job-id',
      decisionId: 'decision-1',
      issuerWorkspaceId: workspaceId,
      rosterFileId: 'file-1',
      awardLevel: AwardLevel.SCHOOL,
      change: { type: 'mapping', mapping: { studentCode: 'MSSV', fullName: 'Họ và tên' } },
    });

    expect(updated.rowCorrections).toEqual({ '2': { studentCode: '00000002' } });
    expect(updated.rows[0].studentCode).toBe('00000002');
  });
});
