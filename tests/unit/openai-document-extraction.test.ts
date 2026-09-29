import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mapOpenAiRuntimeError: vi.fn(),
  buildOpenAiSafetyIdentifier: vi.fn(),
}));

vi.mock('../../src/modules/ai/openai-client', () => mocks);

import { extractStructuredDocument } from '../../src/modules/ai/openai-document-extraction';

const outputSchema = {
  type: 'object',
  properties: { rows: { type: 'array', items: { type: 'string' } } },
  required: ['rows'],
  additionalProperties: false,
};
const resultSchema = z.object({ rows: z.array(z.string()) }).strict();

function input(overrides: Record<string, unknown> = {}) {
  return {
    useCase: 'award_roster',
    model: 'gpt-6-luna',
    promptVersion: 'award-roster-v1',
    instructions: 'Extract the visible roster table without inferring values.',
    schemaName: 'award_roster',
    outputSchema,
    validate: (value: unknown) => resultSchema.parse(value),
    content: [{ type: 'input_text' as const, text: 'synthetic fixture' }],
    timeoutMs: 3000,
    maxRetries: 1,
    entity: { type: 'award_decision', id: 'private-entity-id' },
    ...overrides,
  };
}

describe('OpenAI structured document extraction core', () => {
  it('uses strict Responses output, validates the result, and reports safe usage metadata', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp_1',
      _request_id: 'req_1',
      output_text: JSON.stringify({ rows: ['00123456'] }),
      usage: { input_tokens: 120, output_tokens: 24, total_tokens: 144 },
    });
    const client = { responses: { create } };

    const result = await extractStructuredDocument(input(), client as never);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-6-luna',
        store: false,
        text: { format: { type: 'json_schema', name: 'award_roster', strict: true, schema: outputSchema } },
        metadata: expect.objectContaining({ use_case: 'award_roster', prompt_version: 'award-roster-v1' }),
      }),
      { timeout: 3000, maxRetries: 0 },
    );
    expect(create.mock.calls[0][0].metadata).not.toHaveProperty('entityId');
    expect(result).toMatchObject({
      data: { rows: ['00123456'] },
      telemetry: {
        provider: 'openai',
        useCase: 'award_roster',
        model: 'gpt-6-luna',
        promptVersion: 'award-roster-v1',
        requestId: 'req_1',
        inputTokens: 120,
        outputTokens: 24,
        totalTokens: 144,
        attempts: 1,
        outcome: 'success',
      },
    });
  });

  it('does not return a refusal as extracted data', async () => {
    const client = {
      responses: {
        create: vi.fn().mockResolvedValue({
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refused' }] }],
        }),
      },
    };

    await expect(extractStructuredDocument(input(), client as never)).rejects.toMatchObject({
      code: 'OPENAI_REFUSED',
      statusCode: 422,
      details: expect.objectContaining({
        telemetry: expect.objectContaining({ outcome: 'failure', errorCode: 'OPENAI_REFUSED', attempts: 1 }),
      }),
    });
  });

  it('rejects structured output that fails server validation', async () => {
    const client = {
      responses: {
        create: vi.fn().mockResolvedValue({ output_text: JSON.stringify({ rows: [4] }) }),
      },
    };

    await expect(extractStructuredDocument(input(), client as never)).rejects.toMatchObject({
      code: 'OPENAI_INVALID_OUTPUT',
      statusCode: 502,
    });
  });

  it('uses the bounded explicit retry policy for a retryable provider failure', async () => {
    vi.useFakeTimers();
    mocks.mapOpenAiRuntimeError.mockReturnValue('OPENAI_TIMEOUT');
    const create = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' }))
      .mockResolvedValueOnce({ output_text: JSON.stringify({ rows: ['00123456'] }) });
    const pending = extractStructuredDocument(input({ maxRetries: 1 }), { responses: { create } } as never);

    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.telemetry).toMatchObject({ attempts: 2, retries: 1, outcome: 'success' });
    vi.useRealTimers();
  });
});
