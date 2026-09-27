import { Criterion } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiEvidenceAnalysisAdapter } from '../../src/modules/ai/evidence-analysis/openai-evidence-analysis.adapter';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

const validOutput = {
  documentType: 'certificate',
  documentFacts: {
    documentTitle: 'Giấy chứng nhận tình nguyện',
    identity: { studentName: 'Nguyen Van A', studentCode: '102220001', schoolName: null },
    activity: { eventName: 'Mua he xanh', programName: null, location: null, activityDate: '2026-07-01' },
    organization: { issuerName: 'Hoi Sinh vien', issuerLevel: 'school' },
    conductEntries: [],
    fitness: { title: null, resultLevel: null, sportName: null },
    language: { certificateType: null, score: null, frameworkLevel: null },
    award: { title: null, rank: null, level: null },
    academic: { gpa: null, gpaScale: null, hasFGrade: null },
  },
  fields: {
    student_name: { value: 'Nguyen Van A', confidence: 0.91, source: 'openai' },
    student_code: { value: '102220001', confidence: 0.9, source: 'openai' },
    class_name: { value: '', confidence: 0.2, source: 'openai' },
    faculty: { value: null, confidence: 0, source: 'openai' },
    event_name: { value: 'Mua he xanh', confidence: 0.88, source: 'openai' },
    organizer: { value: 'Hoi Sinh vien', confidence: 0.84, source: 'openai' },
    organizer_level: { value: 'school', confidence: 0.7, source: 'openai' },
    issue_date: { value: '2026-07-01', confidence: 0.72, source: 'openai' },
    activity_date: { value: null, confidence: 0, source: 'openai' },
    award_level: { value: null, confidence: 0, source: 'openai' },
    volunteer_days: { value: 3, confidence: 0.8, source: 'openai' },
    certificate_type: { value: 'certificate', confidence: 0.75, source: 'openai' },
    language_score: { value: null, confidence: 0, source: 'openai' },
    gpa: { value: null, confidence: 0, source: 'openai' },
    conduct_score: { value: null, confidence: 0, source: 'openai' },
  },
  suggestedCriteria: [{ criterion: 'volunteer', confidence: 0.78, reason: 'Volunteer certificate' }],
  documentPrecheck: {
    identifiedAs: {
      documentLabel: 'Giấy chứng nhận tình nguyện',
      shortDescription: 'Tài liệu xác nhận hoạt động tình nguyện của sinh viên.',
    },
    completeness: {
      score: 0.86,
      availableFields: ['student_name', 'student_code', 'event_name', 'organizer', 'issue_date'],
      missingImportantFields: [],
    },
    quality: { level: 'clear', issues: [] },
    relevance: [
      {
        criterion: 'volunteer',
        level: 'strong',
        explanation: 'Nội dung thể hiện số ngày tham gia hoạt động tình nguyện.',
      },
    ],
  },
  warnings: [],
  summary: 'Certificate for Mua he xanh.',
  overallConfidence: 0.86,
  requiresHumanConfirmation: true,
};

function adapterWithCreate(create: (params: unknown, options: unknown) => Promise<unknown>) {
  return new OpenAiEvidenceAnalysisAdapter(
    {
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 1234,
      maxRetries: 0,
      storeResponses: false,
      promptVersion: 'evidence-card-v1',
    },
    { responses: { create } },
  );
}

describe('OpenAiEvidenceAnalysisAdapter', () => {
  it('sends image evidence as input_image data URL with store disabled', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(validOutput), usage: { total_tokens: 42 } }) as (params: unknown, options: unknown) => Promise<unknown>;
    const adapter = adapterWithCreate(create);

    const result = await adapter.analyze({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      filename: 'certificate.webp',
      mimeType: 'image/webp',
      fileBuffer: Buffer.from('image-bytes'),
      evidenceName: 'Mua he xanh',
      selectedCriterion: Criterion.volunteer,
      studentContext: { fullName: 'Nguyen Van A', studentCode: '102220001' },
    });

    expect(result.provider).toBe('openai');
    expect(result.fields.class_name.value).toBeNull();
    expect(result.usage?.totalTokens).toBe(42);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        store: false,
        max_output_tokens: 4000,
        reasoning: { effort: 'minimal' },
        safety_identifier: expect.stringMatching(/^evidence_[a-f0-9]{32}$/),
        input: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'input_image',
                image_url: 'data:image/webp;base64,aW1hZ2UtYnl0ZXM=',
              }),
            ]),
          }),
        ]),
      }),
      expect.objectContaining({ timeout: 1234, maxRetries: 0 }),
    );
  });

  it('sends PDF evidence as input_file with filename and base64 data', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(validOutput) }) as (params: unknown, options: unknown) => Promise<unknown>;
    const adapter = adapterWithCreate(create);

    await adapter.analyze({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      filename: 'certificate.pdf',
      mimeType: 'application/pdf',
      fileBuffer: Buffer.from('pdf-bytes'),
      evidenceName: 'Mua he xanh',
      selectedCriterion: Criterion.volunteer,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'input_file',
                filename: 'certificate.pdf',
                file_data: 'data:application/pdf;base64,cGRmLWJ5dGVz',
              }),
            ]),
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it('builds an OpenAI strict schema without optional warning fields', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(validOutput) });
    const adapter = adapterWithCreate(create);

    await adapter.analyze({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      filename: 'certificate.pdf',
      mimeType: 'application/pdf',
      fileBuffer: Buffer.from('pdf-bytes'),
      evidenceName: 'Mua he xanh',
      selectedCriterion: Criterion.volunteer,
    });

    const params = create.mock.calls[0]?.[0] as {
      text?: { format?: { schema?: { properties?: Record<string, unknown> } } };
    };
    const warningsSchema = (params.text?.format?.schema?.properties?.warnings as {
      items?: { required?: string[]; properties?: Record<string, unknown> };
    }).items;
    const fieldsSchema = params.text?.format?.schema?.properties?.fields as {
      properties?: Record<string, { properties?: Record<string, unknown> }>;
    };
    expect(fieldsSchema.properties?.student_name.properties?.confidence).toEqual(
      expect.objectContaining({ type: ['number', 'null'] }),
    );
    expect(warningsSchema?.required).toEqual(['code', 'severity', 'field', 'message']);
    expect(warningsSchema?.properties?.field).toEqual(
      expect.objectContaining({ type: ['string', 'null'] }),
    );
  });

  it('accepts conduct-result output with document-specific facts', async () => {
    const output = {
      ...validOutput,
      documentType: 'conduct_result',
      documentFacts: {
        ...validOutput.documentFacts,
        documentTitle: 'Kết quả rèn luyện',
        conductEntries: [
          { semester: '1', schoolYear: '2024-2025', score: 91, classification: 'Xuất sắc' },
        ],
      },
      fields: {
        ...validOutput.fields,
        event_name: { value: null, confidence: 0, source: 'openai' },
        volunteer_days: { value: null, confidence: 0, source: 'openai' },
        conduct_score: { value: 91, confidence: 0.9, source: 'openai' },
      },
      suggestedCriteria: [{ criterion: 'ethics', confidence: 0.9, reason: 'Conduct score sheet' }],
      warnings: [{ code: 'needs_student_review', severity: 'info', field: null, message: 'Review before confirming.' }],
    };
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(output) }) as (params: unknown, options: unknown) => Promise<unknown>;
    const adapter = adapterWithCreate(create);

    const result = await adapter.analyze({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      filename: 'conduct.png',
      mimeType: 'image/png',
      fileBuffer: Buffer.from('image-bytes'),
      evidenceName: 'Ket qua ren luyen',
      selectedCriterion: Criterion.ethics,
    });

    expect(result.documentType).toBe('conduct_result');
    expect(result.documentFacts.conductEntries[0]?.score).toBe(91);
    expect(result.warnings[0]).not.toHaveProperty('field');
  });

  it('accepts nullable field confidence and document identity/activity facts', async () => {
    const output = {
      ...validOutput,
      documentType: 'student_healthy_certificate',
      documentFacts: {
        ...validOutput.documentFacts,
        documentTitle: 'Chứng nhận Sinh viên khỏe',
        identity: { studentName: 'Nguyen Van A', studentCode: null, schoolName: 'Trường Đại học Bách khoa' },
        activity: {
          eventName: 'Sinh viên khỏe',
          programName: 'Unitour',
          location: 'Đà Nẵng',
          activityDate: '2026-06-15',
        },
        organization: { issuerName: 'Hội Sinh viên', issuerLevel: null },
        fitness: { title: 'Sinh viên khỏe', resultLevel: 'Đạt', sportName: null },
      },
      fields: {
        ...validOutput.fields,
        student_code: { value: null, confidence: null, source: 'openai' },
        organizer_level: { value: null, confidence: null, source: 'openai' },
        certificate_type: { value: null, confidence: null, source: 'openai' },
      },
      suggestedCriteria: [{ criterion: 'physical', confidence: 0.86, reason: 'Student Healthy certificate' }],
    };
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(output) }) as (params: unknown, options: unknown) => Promise<unknown>;
    const adapter = adapterWithCreate(create);

    const result = await adapter.analyze({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      filename: 'healthy.png',
      mimeType: 'image/png',
      fileBuffer: Buffer.from('image-bytes'),
      evidenceName: 'Chung nhan Sinh vien khoe',
      selectedCriterion: Criterion.physical,
    });

    expect(result.documentType).toBe('student_healthy_certificate');
    expect(result.fields.student_code.confidence).toBeNull();
    expect(result.documentFacts.activity.programName).toBe('Unitour');
  });

  it('rejects invalid structured output before persistence', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        ...validOutput,
        fields: {
          ...validOutput.fields,
          gpa: { value: 4.8, confidence: 1.4, source: 'openai' },
        },
      }),
    }) as (params: unknown, options: unknown) => Promise<unknown>;
    const adapter = adapterWithCreate(create);

    await expect(
      adapter.analyze({
        evidenceId: 'evidence-1',
        evidenceFileId: 'evidence-file-1',
        fileId: 'file-1',
        filename: 'certificate.pdf',
        mimeType: 'application/pdf',
        fileBuffer: Buffer.from('pdf-bytes'),
        evidenceName: 'Mua he xanh',
        selectedCriterion: Criterion.volunteer,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.OPENAI_INVALID_OUTPUT });
  });

  it('maps timeout, rate limit, and refusal to stable app errors', async () => {
    await expectOpenAiError({ name: 'AbortError', message: 'timeout' }, ErrorCodes.OPENAI_TIMEOUT);
    await expectOpenAiError({ status: 429, message: 'rate limited' }, ErrorCodes.OPENAI_RATE_LIMITED);
    await expectOpenAiError({ output_text: '', output: [{ type: 'refusal' }] }, ErrorCodes.OPENAI_REFUSED, true);
  });
});

async function expectOpenAiError(errorOrResponse: unknown, code: string, resolved = false) {
  const create = (resolved ? vi.fn().mockResolvedValue(errorOrResponse) : vi.fn().mockRejectedValue(errorOrResponse)) as (params: unknown, options: unknown) => Promise<unknown>;
  const adapter = adapterWithCreate(create);
  await expect(
    adapter.analyze({
      evidenceId: 'evidence-1',
      evidenceFileId: 'evidence-file-1',
      fileId: 'file-1',
      filename: 'certificate.pdf',
      mimeType: 'application/pdf',
      fileBuffer: Buffer.from('pdf-bytes'),
      evidenceName: 'Mua he xanh',
      selectedCriterion: Criterion.volunteer,
    }),
  ).rejects.toSatisfy((error: unknown) => error instanceof AppError && error.code === code);
}
