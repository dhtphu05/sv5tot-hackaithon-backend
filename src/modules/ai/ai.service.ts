// Owns AI chat, RAG, evidence-card generation, and confidence scoring boundaries.
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export class AiService {
  executePlaceholder(): never {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'Ai module is not implemented yet');
  }
}
