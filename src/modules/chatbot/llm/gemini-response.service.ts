import { z } from 'zod';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { GeminiClient } from '../../../infrastructure/gemini/gemini.client';
import type { ChatbotAction, NormalizedSmartbotMessage, NormalizedSmartbotResponse } from '../chatbot.types';
import { officialResultCaveat } from '../chatbot.guardrails';
import type {
  ChatbotLlmResponseCard,
  ChatbotLlmResponseInput,
  ChatbotLlmStreamAnswerInput,
  ChatbotLlmStructuredResponse,
} from './chatbot-llm.types';
import { safeContextForLlm, sanitizeTextForLlm } from './llm-safety';

const structuredResponseSchema = z.object({
  answer: z.string().min(1).max(2000),
  title: z.string().max(160).default(''),
  cards: z
    .array(
      z.object({
        type: z.enum(['gap_item', 'matching_event', 'evidence_item', 'handoff', 'summary']),
        title: z.string().max(160),
        status: z.string().max(120),
        description: z.string().max(500),
      }),
    )
    .default([]),
  actions: z
    .array(
      z.object({
        label: z.string().max(120),
        type: z.enum(['navigate', 'postback', 'execute']),
        route: z.string().nullable(),
        payload: z.record(z.unknown()).default({}),
        requiresConfirmation: z.boolean().default(false),
      }),
    )
    .default([]),
  guardrailNote: z.string().max(300).default(officialResultCaveat),
});

export class GeminiResponseService {
  constructor(private readonly client = new GeminiClient()) {}

  async polishResponse(input: ChatbotLlmResponseInput): Promise<NormalizedSmartbotResponse> {
    if (!env.GEMINI_ENABLED || !shouldPolish(input.response)) return input.response;

    try {
      const raw = await this.client.generateJson(buildResponsePrompt(input), {
        systemInstruction:
          'You improve Vietnamese chatbot UX for 5TOT. Return JSON only. Never decide official pass/fail.',
        responseMimeType: 'application/json',
        temperature: 0.2,
      });
      const structured = structuredResponseSchema.parse(raw);
      return applyStructuredResponse(input.response, structured);
    } catch (error) {
      logger.warn(
        { errorCode: error instanceof Error ? error.message : 'GEMINI_RESPONSE_FAILED' },
        'Gemini response smoothing failed; using backend response',
      );
      return input.response;
    }
  }

  async streamAnswer(
    input: ChatbotLlmStreamAnswerInput,
    callbacks: { onDelta: (text: string) => Promise<void> | void },
  ): Promise<string> {
    if (!env.GEMINI_ENABLED || !input.answer.trim()) return '';

    try {
      return await this.client.streamText(buildStreamPrompt(input), callbacks, {
        systemInstruction:
          'You rewrite a short Vietnamese chatbot answer for 5TOT. Output natural text only, no JSON, no markdown table.',
        responseMimeType: 'text/plain',
        temperature: 0.25,
      });
    } catch (error) {
      logger.warn(
        { errorCode: error instanceof Error ? error.message : 'GEMINI_STREAM_FAILED' },
        'Gemini answer streaming failed; using backend streaming fallback',
      );
      return '';
    }
  }
}

function shouldPolish(response: NormalizedSmartbotResponse): boolean {
  return Boolean(response.answer.trim() || response.messages.length || response.cards.length);
}

function buildResponsePrompt(input: ChatbotLlmResponseInput): string {
  return [
    'Polish this 5TOT chatbot response for Vietnamese UX.',
    'Preserve facts from backend cards/actions. Do not invent pass/fail results.',
    'Do not expose confidence or internal provider names.',
    `Always include guardrailNote exactly: ${officialResultCaveat}`,
    'Return JSON with answer, title, cards, actions, guardrailNote.',
    'Safe context:',
    JSON.stringify(safeContextForLlm(input.context)),
    'User text with PII redacted:',
    sanitizeTextForLlm(input.text),
    'Backend answer/cards/actions:',
    JSON.stringify({
      answer: input.response.answer,
      cards: cardSummaries(input.response.cards.length ? input.response.cards : input.response.messages),
      actions: input.response.actions.map((action) => ({
        label: action.label,
        type: action.type,
        route: action.route ?? null,
        requiresConfirmation: action.requiresConfirmation,
      })),
    }),
  ].join('\n');
}

function buildStreamPrompt(input: ChatbotLlmStreamAnswerInput): string {
  return [
    'Rewrite the backend answer as a concise, natural Vietnamese assistant response.',
    'Keep all facts. Do not add official pass/fail conclusion.',
    `If the answer concerns gap/evidence/result, include once: ${officialResultCaveat}`,
    'Safe context:',
    JSON.stringify(safeContextForLlm(input.context)),
    'User text with PII redacted:',
    sanitizeTextForLlm(input.text),
    'Backend answer:',
    input.answer.slice(0, 2000),
    'Cards:',
    JSON.stringify(cardSummaries(input.cards)),
    'Actions:',
    JSON.stringify(input.actions.map((action) => action.label)),
  ].join('\n');
}

function applyStructuredResponse(
  response: NormalizedSmartbotResponse,
  structured: ChatbotLlmStructuredResponse,
): NormalizedSmartbotResponse {
  const sourceCards = response.cards.length ? response.cards : response.messages;
  const polishedCards = mergePolishedCards(sourceCards, structured.cards);

  return {
    ...response,
    answer: structured.answer,
    messages: response.messages.length ? mergePolishedCards(response.messages, structured.cards) : response.messages,
    cards: response.cards.length ? polishedCards : response.cards,
    actions: response.actions.length ? response.actions : structured.actions.map(toSafeAction),
  };
}

function mergePolishedCards(
  cards: NormalizedSmartbotMessage[],
  polished: ChatbotLlmResponseCard[],
): NormalizedSmartbotMessage[] {
  if (!cards.length || !polished.length) return cards;
  return cards.map((card, index) => {
    const next = polished[index];
    if (!next) return card;
    return {
      ...card,
      title: next.title || card.title,
      status: next.status || card.status,
      description: next.description || card.description,
      items: card.items ? mergePolishedCards(card.items, polished) : card.items,
    };
  });
}

function toSafeAction(action: ChatbotLlmStructuredResponse['actions'][number], index: number): ChatbotAction {
  const route = action.route && action.route.startsWith('/app/') ? action.route : undefined;
  return {
    id: `act_gemini_${index}_${slug(action.label)}`,
    label: action.label,
    type: action.type,
    route,
    payload: action.type === 'postback' ? JSON.stringify(action.payload ?? {}) : undefined,
    requiresConfirmation: action.requiresConfirmation,
  };
}

function cardSummaries(cards: NormalizedSmartbotMessage[]): Array<Record<string, unknown>> {
  return cards.slice(0, 8).map((card) => ({
    type: card.type,
    title: card.title,
    status: card.status,
    description: card.description,
    text: card.text,
    items: card.items?.slice(0, 5).map((item) => ({
      type: item.type,
      title: item.title,
      status: item.status,
      description: item.description,
      text: item.text,
    })),
  }));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}
