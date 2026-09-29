import { DecisionImportStatus, JobType, Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findImport: vi.fn(),
  updateImport: vi.fn(),
  transaction: vi.fn(),
  upsertDocument: vi.fn(),
  auditLog: vi.fn(),
  getSignedReadUrl: vi.fn(),
  extractStructuredDocument: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    decisionImport: { findUnique: mocks.findImport, update: mocks.updateImport },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: class {
    log = mocks.auditLog;
  },
}));
vi.mock('../../src/modules/storage/storage.service', () => ({
  StorageService: class {
    getSignedReadUrl = mocks.getSignedReadUrl;
  },
}));
vi.mock('../../src/modules/ai/openai-document-extraction', () => ({
  extractStructuredDocument: mocks.extractStructuredDocument,
}));

import { processDecisionMetadataJob } from '../../src/modules/jobs/processors/decision-metadata.processor';

const importId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const sourceFileId = '33333333-3333-4333-8333-333333333333';

function decisionImport() {
  return {
    id: importId,
    workspaceId,
    sourceFileId,
    metadataJobId: 'job-1',
    rosterJobId: 'job-2',
    sourceFile: {
      id: sourceFileId,
      workspaceId,
      originalName: 'private-student-names.pdf',
      mimeType: 'application/pdf',
      storageType: 'r2',
      filePath: 'decision/import.pdf',
    },
    creator: { role: Role.manager },
    createdBy: 'staff-1',
    organizer: null,
    status: DecisionImportStatus.uploaded,
  };
}

function job() {
  return { id: 'job-1', targetId: importId, workspaceId, jobType: JobType.decision_metadata } as never;
}

describe('DecisionImport metadata OpenAI processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findImport.mockResolvedValue(decisionImport());
    mocks.updateImport.mockResolvedValue(undefined);
    mocks.upsertDocument.mockResolvedValue({ id: 'document-1' });
    mocks.getSignedReadUrl.mockResolvedValue('https://storage.test/source.pdf');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    }));
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        decisionImport: { findUnique: mocks.findImport, update: mocks.updateImport },
        decisionDocument: { upsert: mocks.upsertDocument },
      }),
    );
    mocks.extractStructuredDocument.mockResolvedValue({
      data: {
        documentNo: 'QD-123',
        documentType: 'Quyết định khen thưởng',
        issuer: 'Đại học Đà Nẵng',
        issueDate: '2026-01-20',
        signer: 'Người ký',
        summary: 'Khen thưởng sinh viên.',
      },
      telemetry: { provider: 'openai', useCase: 'decision_metadata', requestId: 'req-1' },
    });
  });

  it('extracts metadata from the stored source file without VNPT hashes or provider upload', async () => {
    const result = await processDecisionMetadataJob(job());

    expect(mocks.extractStructuredDocument).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'decision_metadata',
      model: 'gpt-6-luna',
      schemaName: 'decision_metadata',
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'input_file', filename: 'decision-document.pdf' }),
      ]),
    }));
    expect(mocks.upsertDocument).toHaveBeenCalledWith(expect.objectContaining({
      where: { decisionImportId: importId },
      create: expect.objectContaining({ documentNo: 'QD-123', issuer: 'Đại học Đà Nẵng' }),
    }));
    expect(result).toMatchObject({ documentNo: 'QD-123', issuer: 'Đại học Đà Nẵng' });
    expect(JSON.stringify(mocks.extractStructuredDocument.mock.calls[0]?.[0])).not.toContain('private-student-names.pdf');
  });

  it('does not persist metadata when OpenAI extraction fails', async () => {
    mocks.extractStructuredDocument.mockRejectedValueOnce(new Error('provider failed'));

    await expect(processDecisionMetadataJob(job())).rejects.toThrow('provider failed');
    expect(mocks.upsertDocument).not.toHaveBeenCalled();
    expect(mocks.updateImport).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: DecisionImportStatus.preview_ready }),
    }));
  });

  it('uses image input for image source files', async () => {
    mocks.findImport.mockResolvedValue({
      ...decisionImport(),
      sourceFile: { ...decisionImport().sourceFile, mimeType: 'image/png', originalName: 'private-roster.png' },
    });

    await processDecisionMetadataJob(job());

    expect(mocks.extractStructuredDocument).toHaveBeenCalledWith(expect.objectContaining({
      content: [expect.objectContaining({ type: 'input_image', detail: 'auto' })],
    }));
    expect(JSON.stringify(mocks.extractStructuredDocument.mock.calls[0]?.[0])).not.toContain('private-roster.png');
  });

  it('rejects a source file attached to a different workspace before calling OpenAI', async () => {
    mocks.findImport.mockResolvedValue({
      ...decisionImport(),
      sourceFile: { ...decisionImport().sourceFile, workspaceId: 'other-workspace' },
    });

    await expect(processDecisionMetadataJob(job())).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.extractStructuredDocument).not.toHaveBeenCalled();
    expect(mocks.upsertDocument).not.toHaveBeenCalled();
  });
});
