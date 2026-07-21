import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import type { EvidenceAnalysisProvider, EvidenceDocumentAnalysisInput } from './evidence-analysis.types';

export class SmartReaderEvidenceAnalysisAdapter implements EvidenceAnalysisProvider {
  readonly provider = 'smartreader' as const;

  async analyze(_input: EvidenceDocumentAnalysisInput): Promise<never> {
    throw new AppError(
      501,
      ErrorCodes.NOT_IMPLEMENTED,
      'SmartReader evidence analysis is handled by the legacy SmartReader processor path',
    );
  }
}
