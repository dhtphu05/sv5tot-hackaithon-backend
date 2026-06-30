// Owns AI chat, RAG, evidence-card generation, and confidence scoring boundaries.
import type { Request, Response } from 'express';
import { AiService } from './ai.service';

const service = new AiService();

export async function aiPlaceholder(_req: Request, _res: Response): Promise<void> {
  service.executePlaceholder();
}
