import { Criterion } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../../config/env';
import { GeminiClient } from '../../../infrastructure/gemini/gemini.client';
import { logger } from '../../../config/logger';
import type { ChatbotLlmIntent, ChatbotLlmIntentInput } from './chatbot-llm.types';
import { sanitizeTextForLlm, safeContextForLlm } from './llm-safety';

const intentSchema = z.object({
  intent: z.enum([
    'get_gap_analysis',
    'get_evidence_summary',
    'search_matching_hub',
    'open_evidence_upload',
    'create_handoff',
    'criteria_rag',
    'unknown',
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  tool: z
    .enum([
      'getGapAnalysis',
      'getEvidenceSummary',
      'searchMatchingHub',
      'openEvidenceUpload',
      'createHandoff',
      'callVnptRag',
    ])
    .nullable(),
  args: z.object({
    criterion: z.nativeEnum(Criterion).nullable(),
    targetLevel: z.literal('school').default('school'),
  }),
  needsHuman: z.boolean(),
  reason: z.string().max(500).default(''),
});

export class GeminiIntentService {
  constructor(private readonly client = new GeminiClient()) {}

  async classify(input: ChatbotLlmIntentInput): Promise<ChatbotLlmIntent | null> {
    if (!env.GEMINI_ENABLED) return null;

    try {
      const raw = await this.client.generateJson(buildIntentPrompt(input), {
        systemInstruction:
          'You classify 5TOT workflow intent. Return JSON only. Do not decide pass/fail. Do not request personal data.',
        responseMimeType: 'application/json',
        temperature: 0,
      });
      return intentSchema.parse(raw);
    } catch (error) {
      logger.warn(
        {
          errorCode: error instanceof Error ? error.message : 'GEMINI_INTENT_FAILED',
          timeout: error instanceof Error && error.message.includes('TIMEOUT'),
        },
        'Gemini intent classification failed; falling back to deterministic routing',
      );
      return null;
    }
  }
}

function buildIntentPrompt(input: ChatbotLlmIntentInput): string {
  return [
    'Classify the user request into one 5TOT chatbot intent.',
    'Use deterministic backend tools only; you do not execute tools.',
    'Available tools: ' + input.availableTools.join(', '),
    'Return exactly this JSON shape:',
    JSON.stringify({
      intent: 'get_gap_analysis | get_evidence_summary | search_matching_hub | open_evidence_upload | create_handoff | criteria_rag | unknown',
      confidence: 'high | medium | low',
      tool: 'getGapAnalysis | getEvidenceSummary | searchMatchingHub | openEvidenceUpload | createHandoff | callVnptRag | null',
      args: { criterion: 'ethics | academic | physical | volunteer | integration | null', targetLevel: 'school' },
      needsHuman: false,
      reason: 'short safe reason',
    }),
    'Intent examples:',
    '- "hồ sơ em còn thiếu gì" => get_gap_analysis/getGapAnalysis',
    '- "em đang có minh chứng gì" => get_evidence_summary/getEvidenceSummary',
    '- "tìm Matching Hub" => search_matching_hub/searchMatchingHub',
    '- "upload minh chứng thể lực" => open_evidence_upload/openEvidenceUpload with criterion physical',
    '- "hỏi cán bộ" => create_handoff/createHandoff',
    '- criteria/rules questions => criteria_rag/callVnptRag',
    'Safe context:',
    JSON.stringify(safeContextForLlm(input.context)),
    'User text with PII redacted:',
    sanitizeTextForLlm(input.text),
  ].join('\n');
}
