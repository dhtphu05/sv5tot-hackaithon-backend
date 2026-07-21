import { describe, expect, it } from 'vitest';
import { createEvidenceAnalysisProvider } from '../../src/modules/ai/evidence-analysis/evidence-analysis.factory';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

describe('createEvidenceAnalysisProvider', () => {
  it('selects OpenAI by default and requires OpenAI configuration', () => {
    expect(() =>
      createEvidenceAnalysisProvider({
        provider: undefined,
        openaiApiKey: '',
        openaiModel: '',
      }),
    ).toThrowError(AppError);

    try {
      createEvidenceAnalysisProvider({
        provider: undefined,
        openaiApiKey: '',
        openaiModel: '',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCodes.OPENAI_NOT_CONFIGURED });
    }
  });

  it('selects mock only when explicitly configured', () => {
    const provider = createEvidenceAnalysisProvider({
      provider: 'mock',
      openaiApiKey: '',
      openaiModel: '',
    });

    expect(provider.provider).toBe('mock');
  });

  it('selects SmartReader only when explicitly configured', () => {
    const provider = createEvidenceAnalysisProvider({
      provider: 'smartreader',
      openaiApiKey: '',
      openaiModel: '',
    });

    expect(provider.provider).toBe('smartreader');
  });
});
