import { Criterion } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiEvidenceAnalysisAdapter } from '../../src/modules/ai/evidence-analysis/openai-evidence-analysis.adapter';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

const validOutput = {
  documentType: 'certificate',
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
