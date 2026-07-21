import type OpenAI from 'openai';
import { env } from '../../../config/env';
import { getOpenAiClient } from '../../ai/openai-client';
import type { StudentAssistantContext } from './student-assistant.dto';

export type AssistantNarrativeDelta = {
  text: string;
};

export type AssistantNarrativeProvider = {
  stream(
    context: StudentAssistantContext,
    callbacks: {
      onDelta: (delta: AssistantNarrativeDelta) => void | Promise<void>;
      signal?: AbortSignal;
      safetyIdentifier?: string;
    },
  ): Promise<{ text: string; cached?: boolean; model?: string; totalTokens?: number }>;
};

export function createAssistantNarrativeProvider(): AssistantNarrativeProvider {
  if (env.ASSISTANT_NARRATIVE_PROVIDER === 'mock') {
    return new MockAssistantNarrativeProvider(env.ASSISTANT_MOCK_STREAM_DELAY_MS);
  }
  if (env.ASSISTANT_NARRATIVE_PROVIDER === 'openai' && env.OPENAI_API_KEY && env.OPENAI_ASSISTANT_MODEL) {
    return new OpenAiAssistantNarrativeProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_ASSISTANT_MODEL,
      timeoutMs: env.OPENAI_ASSISTANT_TIMEOUT_MS,
      maxRetries: env.OPENAI_ASSISTANT_MAX_RETRIES,
      promptVersion: env.OPENAI_ASSISTANT_PROMPT_VERSION,
    });
  }
  return new DisabledAssistantNarrativeProvider();
}

export class MockAssistantNarrativeProvider implements AssistantNarrativeProvider {
  constructor(private readonly delayMs = 35) {}

  async stream(
    context: StudentAssistantContext,
    callbacks: {
      onDelta: (delta: AssistantNarrativeDelta) => void | Promise<void>;
      signal?: AbortSignal;
      safetyIdentifier?: string;
    },
  ) {
    const text = context.narrative.fallbackText;
    for (const chunk of splitNarrative(text)) {
      if (callbacks.signal?.aborted) break;
      await callbacks.onDelta({ text: chunk });
      if (this.delayMs > 0) await delay(this.delayMs);
    }
    return { text, model: 'mock-dashboard-assistant' };
  }
}

export class DisabledAssistantNarrativeProvider implements AssistantNarrativeProvider {
  async stream(context: StudentAssistantContext) {
    return { text: context.narrative.fallbackText, model: 'disabled' };
  }
}

type OpenAiAssistantNarrativeConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  promptVersion: string;
};

type OpenAiStreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  response?: { usage?: { total_tokens?: number } };
};

export class OpenAiAssistantNarrativeProvider implements AssistantNarrativeProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAiAssistantNarrativeConfig, client?: OpenAI) {
    this.client = client ?? getOpenAiClient();
  }

  async stream(
    context: StudentAssistantContext,
    callbacks: {
      onDelta: (delta: AssistantNarrativeDelta) => void | Promise<void>;
      signal?: AbortSignal;
      safetyIdentifier?: string;
    },
  ) {
    let text = '';
    let totalTokens: number | undefined;
    const stream = await this.client.responses.create(
      {
        model: this.config.model,
        store: false,
        stream: true,
        max_output_tokens: 800,
        reasoning: { effort: 'minimal' },
        safety_identifier: callbacks.safetyIdentifier,
        input: [
          {
            role: 'developer',
            content: [
              {
                type: 'input_text',
                text: buildDashboardAssistantPrompt(this.config.promptVersion),
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify(buildSafeNarrativeInput(context)) }],
          },
        ],
      } as never,
      { timeout: this.config.timeoutMs, maxRetries: this.config.maxRetries, signal: callbacks.signal } as never,
    );

    for await (const event of stream as unknown as AsyncIterable<OpenAiStreamEvent>) {
      if (callbacks.signal?.aborted) break;
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta;
        const safeDelta = validateNarrativePartial(event.delta);
        if (safeDelta) await callbacks.onDelta({ text: safeDelta });
      }
      if (event.type === 'response.completed') {
        totalTokens = event.response?.usage?.total_tokens;
      }
    }

    return {
      text,
      model: this.config.model,
      totalTokens,
    };
  }
}

export function validateFinalNarrative(text: string, fallbackText: string) {
  const normalized = normalizeText(text);
  if (!normalized) return fallbackText;
  if (normalized.length > 420) return fallbackText;
  if (/(\||^#{1,6}\s|^\s*[-*]\s|\d+\.)/m.test(normalized)) return fallbackText;
  if (
    /(chắc chắn|đảm bảo|đã được duyệt|ai xác nhận|hồ sơ hoàn hảo|chắc chắn đạt|kết quả chính thức)/i.test(
      normalized,
    )
  ) {
    return fallbackText;
  }
  if (!/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(normalized)) {
    return fallbackText;
  }
  return normalized;
}

function validateNarrativePartial(text: string) {
  if (/(chắc chắn|đảm bảo|đã được duyệt|ai xác nhận|chắc chắn đạt)/i.test(text)) return '';
  return text;
}

function buildDashboardAssistantPrompt(promptVersion: string) {
  return [
    `Prompt version: ${promptVersion}.`,
    'Bạn viết một giải thích ngắn bằng tiếng Việt cho Dashboard Sinh viên 5 tốt.',
    'Chỉ giải thích ngữ cảnh và bước tiếp theo đã được backend chọn sẵn.',
    'Không thay đổi hành động, tiêu chí, deadline, điểm sẵn sàng, đích điều hướng hoặc kết luận đủ điều kiện.',
    'Không nói AI đã duyệt, không đảm bảo kết quả chính thức, không dùng bảng, không dùng emoji.',
    'Viết 1-2 câu, nghiêm túc, thân thiện, khoảng 20-55 từ.',
  ].join('\n');
}

function buildSafeNarrativeInput(context: StudentAssistantContext) {
  return {
    state: context.state,
    greeting: context.greeting.deterministicMessage,
    action: context.nextBestAction
      ? {
          type: context.nextBestAction.type,
          title: context.nextBestAction.title,
          reasonCode: context.nextBestAction.reasonCode,
          description: context.nextBestAction.deterministicDescription,
          criterion: context.nextBestAction.criterion,
          dueAt: context.nextBestAction.dueAt,
          urgency: context.nextBestAction.urgency,
        }
      : null,
    application: {
      status: context.application.status,
      targetLevel: context.application.targetLevel,
      readinessScore: context.application.readinessScore,
      precheckIsStale: context.application.precheckIsStale,
    },
    criterionSummary: context.criterionSummary,
  };
}

function splitNarrative(text: string) {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    current += word;
    if (current.length >= 18) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
