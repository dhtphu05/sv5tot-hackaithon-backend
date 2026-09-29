import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { MockSmartbotClient } from '../../infrastructure/vnpt/mock-smartbot.client';
import { AppError } from '../../shared/errors/app-error';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { buildContextualActions } from './chatbot-action.builder';
import { listAvailableReadTools } from './chatbot-action.registry';
import {
  buildSafeChatbotContext,
  buildSmartbotPrompts,
  toSmartbotButtonVariables,
} from './chatbot-context.builder';
import type { ChatbotMessageResponseDto } from './chatbot.dto';
import { applySmartbotGuardrails, redactUnsafeSmartbotClaims } from './chatbot.guardrails';
import {
  NoopChatbotActionRepository,
  NoopChatbotConversationRepository,
  NoopChatbotHandoffRepository,
  PrismaChatbotActionRepository,
  PrismaChatbotConversationRepository,
  PrismaChatbotHandoffRepository,
  type ChatbotActionRepository,
  type ChatbotConversationRepository,
  type ChatbotHandoffRepository,
} from './chatbot.repository';
import type {
  ChatbotAction,
  NormalizedSmartbotMessage,
  NormalizedSmartbotResponse,
  SafeChatbotContext,
  SmartbotClient,
  SmartbotConversationRequest,
  SmartbotStreamClient,
} from './chatbot.types';
import type { ChatbotMessageInput } from './chatbot.validation';
import { chatbotFallbackText } from './chatbot-fallback';
import {
  createSchoolDemoHandoff,
  draftReviewerSupplementRequest,
  getPostUploadEvidenceSummary,
  getSchoolDemoEvidenceSummary,
  getSchoolDemoGapAnalysis,
  summarizeReviewerEvidence,
  searchSchoolDemoMatchingHub,
  type SchoolDemoToolResult,
} from './chatbot-school-demo.tools';
import { OpenAiChatbotClient } from './openai-chatbot.client';
import { normalizeSmartbotResponse } from './smartbot-card.normalizer';
import { callChatbotTool } from './tools/chatbot-tool.registry';
import type { ChatbotToolResult, ChatbotToolRole } from './tools/chatbot-tool.types';

export class ChatbotService {
  constructor(
    private readonly smartbotClient: SmartbotClient =
      env.NODE_ENV === 'test' ? new MockSmartbotClient() : new OpenAiChatbotClient(),
    private readonly conversationRepository: ChatbotConversationRepository =
      new PrismaChatbotConversationRepository(),
    private readonly actionRepository: ChatbotActionRepository = new PrismaChatbotActionRepository(),
    private readonly handoffRepository: ChatbotHandoffRepository = new PrismaChatbotHandoffRepository(),
    private readonly smartbotStreamClient: SmartbotStreamClient = new OpenAiChatbotClient(),
  ) {}

  async sendMessage(
    user: AuthenticatedUser,
    input: ChatbotMessageInput,
  ): Promise<ChatbotMessageResponseDto> {
    const prepared = await this.prepareMessage(user, input);
    if (hasLocalToolResponse(prepared)) {
      return this.finalizeResponse(prepared, emptyNormalizedResponse(prepared.sessionId));
    }

    const raw = prepared.intent === 'criteria_rag'
      ? criteriaFallbackResponse(prepared.sessionId)
      : await this.safeSendSmartbotMessage(prepared);
    const normalized = normalizeSmartbotResponse({
      raw,
      sessionId: prepared.sessionId,
      fallbackText,
    });
    return this.finalizeResponse(prepared, normalized);
  }

  async streamMessage(
    user: AuthenticatedUser,
    input: ChatbotMessageInput,
    callbacks: ChatbotStreamEventCallbacks,
  ): Promise<void> {
    const prepared = await this.prepareMessage(user, input);
    await callbacks.onMeta({ sessionId: prepared.sessionId, mode: 'stream' });

    if (prepared.schoolDemoResult) {
      await this.streamSchoolDemoResult(prepared, callbacks);
      return;
    }

    if (hasLocalToolResponse(prepared)) {
      await this.streamLocalToolResult(prepared, callbacks);
      return;
    }

    if (env.NODE_ENV === 'test') {
      await this.streamMockResponse(prepared, callbacks);
      return;
    }

    if (prepared.intent === 'criteria_rag') {
      const response = await this.finalizeResponse(
        prepared,
        normalizeSmartbotResponse({
          raw: criteriaFallbackResponse(prepared.sessionId),
          sessionId: prepared.sessionId,
          fallbackText,
        }),
      );
      await streamResponse(response, callbacks);
      return;
    }

    try {
      await this.smartbotStreamClient.streamMessage(prepared.request, {
        onDelta: (text) => callbacks.onDelta({ text: redactUnsafeSmartbotClaims(text) }),
        onCard: (partial) => callbacks.onCard(stripTransientActions(partial)),
        onFinal: async (partial) => {
          const response = await this.finalizeResponse(prepared, partial);
          await callbacks.onFinal(response);
        },
      });
    } catch (error) {
      if (!(error instanceof AppError) || !isAssistantProviderError(error)) {
        throw error;
      }
      const raw = providerFallbackResponse(prepared.sessionId, false);
      const response = await this.finalizeResponse(
        prepared,
        normalizeSmartbotResponse({ raw, sessionId: prepared.sessionId, fallbackText }),
      );
      for (const chunk of splitForStreaming(response.answer)) {
        await callbacks.onDelta({ text: chunk });
        await delay(60);
      }
      await callbacks.onFinal(response);
    }
  }

  private async prepareMessage(
    user: AuthenticatedUser,
    input: ChatbotMessageInput,
  ): Promise<PreparedChatbotMessage> {
    const sessionId = input.sessionId ?? randomUUID();
    const context = await buildSafeChatbotContext({
      user,
      applicationId: input.applicationId,
      contextScope: input.contextScope,
      pageContext: input.pageContext,
    });
    const schoolDemoResult = inferSchoolDemoTool(input, context);
    const deterministicCriteriaRag = context.contextScope === 'student_helpdesk' && inferCriteriaRagIntent(input);
    const toolMatch = schoolDemoResult ? null : inferToolCall(user.role as ChatbotToolRole, input);
    const registryToolResult = toolMatch
      ? await callChatbotTool(
          {
            userId: user.id,
            workspaceId: user.workspaceId,
            role: user.role as ChatbotToolRole,
            studentCode: user.studentCode ?? undefined,
            sessionId,
            applicationId: input.applicationId,
            pageContext: input.pageContext,
            requestId: sessionId,
          },
          toolMatch.name,
          toolMatch.input,
        )
      : null;
    const toolResult = schoolDemoResult ?? registryToolResult;
    const intent = toolResult
      ? 'local_tool'
      : deterministicCriteriaRag
        ? 'criteria_rag'
        : 'assistant';
    const request = {
      bot_id: 'openai-assistant',
      sender_id: buildSenderId(user.id),
      text: input.text,
      input_channel: env.SMARTBOT_INPUT_CHANNEL,
      session_id: sessionId,
      metadata: {
        button_variables: [
          ...toSmartbotButtonVariables(context),
          { variableName: 'read_tools', value: listAvailableReadTools(user.role, context.contextScope).join(',') },
          ...(toolResult ? [{ variableName: 'tool_summary', value: toolResult.message.slice(0, 500) }] : []),
        ],
      },
      settings: buildSmartbotPrompts(context),
    };

    await this.conversationRepository.ensureSession({
      sessionId,
      userId: user.id,
      workspaceId: user.workspaceId,
      role: user.role,
      applicationId: input.applicationId,
      reviewTaskId: input.pageContext?.taskId,
      resolutionCaseId: input.pageContext?.resolutionCaseId,
      contextScope: context.contextScope,
    });

    return {
      user,
      input,
      sessionId,
      context,
      request,
      intent,
      schoolDemoResult,
      registryToolResult,
    };
  }

  private async finalizeResponse(
    prepared: PreparedChatbotMessage,
    normalized: NormalizedSmartbotResponse,
    options: { answerOverride?: string } = {},
  ): Promise<ChatbotMessageResponseDto> {
    const guardrailedAnswer = applySmartbotGuardrails(
      options.answerOverride ?? prepared.schoolDemoResult?.message ?? normalized.answer,
      prepared.input.text,
    );
    const contextualActions = buildContextualActions({
      text: prepared.input.text,
      context: prepared.context,
      pageContext: prepared.input.pageContext,
    });
    const toolCards = prepared.schoolDemoResult
      ? schoolDemoResultToMessages(prepared.schoolDemoResult)
      : prepared.registryToolResult
        ? toolResultToMessages(prepared.registryToolResult)
        : [];
    const toolActions = prepared.schoolDemoResult
      ? prepared.schoolDemoResult.actions
      : prepared.registryToolResult
        ? toolResultToActions(prepared.registryToolResult, prepared.user.role)
        : [];
    const baseUnsavedResponse = {
      ...normalized,
      answer: guardrailedAnswer,
      messages: prepared.schoolDemoResult
        ? toolCards
        : [
            ...toolCards,
            ...normalized.messages.map((message, index) =>
              index === 0 && message.text
                ? { ...message, text: applySmartbotGuardrails(message.text, prepared.input.text) }
                : message,
            ),
          ],
      cards: prepared.schoolDemoResult ? toolCards : [...toolCards, ...normalized.cards],
      actions: mergeActions(
        prepared.schoolDemoResult ? toolActions : [...normalized.actions, ...toolActions],
        prepared.schoolDemoResult ? [] : contextualActions,
      ),
      handoffRequired: normalized.handoffRequired || Boolean(prepared.schoolDemoResult?.handoffRequired),
    };
    const unsavedResponse = applyResponseGuardrails(baseUnsavedResponse, prepared.input.text);

    const savedActions = await this.actionRepository.saveActions({
      sessionId: prepared.sessionId,
      userId: prepared.user.id,
      workspaceId: prepared.user.workspaceId,
      actions: unsavedResponse.actions,
    });
    const response = replaceEmbeddedActionReferences(
      { ...unsavedResponse, actions: savedActions },
      unsavedResponse.actions,
      savedActions,
    );
    if (response.handoffRequired) {
      await this.handoffRepository.createHandoff({
        sessionId: prepared.sessionId,
        userId: prepared.user.id,
        workspaceId: prepared.user.workspaceId,
        applicationId: prepared.input.applicationId,
        reviewTaskId: prepared.input.pageContext?.taskId,
        resolutionCaseId: prepared.input.pageContext?.resolutionCaseId,
        reason: prepared.input.text.slice(0, 500),
      });
    }
    await this.conversationRepository.saveMessage({
      sessionId: prepared.sessionId,
      userId: prepared.user.id,
      userText: prepared.input.text,
      response,
    });

    return response;
  }

  private async safeSendSmartbotMessage(prepared: PreparedChatbotMessage): Promise<unknown> {
    try {
      return await this.smartbotClient.sendMessage(prepared.request);
    } catch (error) {
      if (error instanceof AppError && !isAssistantProviderError(error)) {
        throw error;
      }
      if (prepared.intent === 'criteria_rag') {
        return criteriaFallbackResponse(prepared.sessionId);
      }
      return providerFallbackResponse(prepared.sessionId, false);
    }
  }

  private async streamSchoolDemoResult(
    prepared: PreparedChatbotMessage,
    callbacks: ChatbotStreamEventCallbacks,
  ): Promise<void> {
    await callbacks.onDelta({ text: 'Mình đang kiểm tra dữ liệu hồ sơ cấp Trường...' });
    await delay(80);
    await callbacks.onDelta({ text: stagedSchoolDemoDelta(prepared.schoolDemoResult) });
    const answer = await this.streamPreparedAnswer(prepared, callbacks);
    const response = await this.finalizeResponse(prepared, emptyNormalizedResponse(prepared.sessionId), {
      answerOverride: answer || undefined,
    });
    await callbacks.onCard({
      messages: response.messages,
      cards: response.cards,
      actions: response.actions,
    });
    await callbacks.onFinal(response);
  }

  private async streamLocalToolResult(
    prepared: PreparedChatbotMessage,
    callbacks: ChatbotStreamEventCallbacks,
  ): Promise<void> {
    await callbacks.onDelta({ text: 'Mình đang kiểm tra dữ liệu hồ sơ...' });
    await delay(80);
    await callbacks.onDelta({ text: 'Đã chuẩn bị thẻ thông tin phù hợp.' });
    const answer = await this.streamPreparedAnswer(prepared, callbacks);
    const response = await this.finalizeResponse(prepared, emptyNormalizedResponse(prepared.sessionId), {
      answerOverride: answer || undefined,
    });
    await callbacks.onCard({
      messages: response.messages,
      cards: response.cards,
      actions: response.actions,
    });
    await callbacks.onFinal(response);
  }

  private async streamPreparedAnswer(
    prepared: PreparedChatbotMessage,
    callbacks: ChatbotStreamEventCallbacks,
  ): Promise<string> {
    const baseAnswer = applySmartbotGuardrails(
      prepared.schoolDemoResult?.message ?? prepared.registryToolResult?.message ?? 'Mình đã chuẩn bị phản hồi phù hợp.',
      prepared.input.text,
    );
    for (const chunk of splitForStreaming(baseAnswer)) {
      await callbacks.onDelta({ text: chunk });
      await delay(60);
    }
    return baseAnswer;
  }


  private async streamMockResponse(
    prepared: PreparedChatbotMessage,
    callbacks: ChatbotStreamEventCallbacks,
  ): Promise<void> {
    const raw = prepared.intent === 'criteria_rag'
      ? criteriaFallbackResponse(prepared.sessionId)
      : await this.safeSendSmartbotMessage(prepared);
    const normalized = normalizeSmartbotResponse({ raw, sessionId: prepared.sessionId, fallbackText });
    const response = await this.finalizeResponse(prepared, normalized);
    for (const chunk of splitForStreaming(response.answer)) {
      await callbacks.onDelta({ text: chunk });
      await delay(60);
    }
    await callbacks.onFinal(response);
  }
}

async function streamResponse(
  response: ChatbotMessageResponseDto,
  callbacks: ChatbotStreamEventCallbacks,
): Promise<void> {
  for (const chunk of splitForStreaming(response.answer)) await callbacks.onDelta({ text: chunk });
  await callbacks.onCard({ messages: response.messages, cards: response.cards, actions: response.actions });
  await callbacks.onFinal(response);
}

export function buildNoopChatbotService(client: SmartbotClient): ChatbotService {
  return new ChatbotService(
    client,
    new NoopChatbotConversationRepository(),
    new NoopChatbotActionRepository(),
    new NoopChatbotHandoffRepository(),
    {
      async streamMessage(input, callbacks) {
        const raw = await client.sendMessage(input);
        const normalized = normalizeSmartbotResponse({ raw, sessionId: input.session_id, fallbackText });
        await callbacks.onFinal?.(normalized);
        return normalized;
      },
    },
  );
}

const fallbackText = chatbotFallbackText;

const schoolCriteriaFallbackText =
  'Điều kiện Sinh viên 5 tốt được cấu hình theo cấp xét duyệt và từng nhóm tiêu chí. Hãy xem danh mục tiêu chí và kết quả tiền kiểm trong hồ sơ để biết yêu cầu đang áp dụng. Hệ thống chỉ hỗ trợ tiền kiểm và giải thích; kết quả chính thức do cán bộ/Hội đồng xác nhận.';


export type ChatbotStreamEventCallbacks = {
  onMeta: (data: { sessionId: string; mode: 'stream' }) => Promise<void> | void;
  onDelta: (data: { text: string }) => Promise<void> | void;
  onCard: (data: {
    messages: NormalizedSmartbotMessage[];
    cards: NormalizedSmartbotMessage[];
    actions: ChatbotAction[];
  }) => Promise<void> | void;
  onFinal: (data: ChatbotMessageResponseDto) => Promise<void> | void;
};

type PreparedChatbotMessage = {
  user: AuthenticatedUser;
  input: ChatbotMessageInput;
  sessionId: string;
  context: SafeChatbotContext;
  request: SmartbotConversationRequest;
  intent: 'local_tool' | 'criteria_rag' | 'assistant';
  schoolDemoResult: SchoolDemoToolResult | null;
  registryToolResult: ChatbotToolResult | null;
};

function buildSenderId(userId: string): string {
  return `fivetot_${userId}`;
}

function emptyNormalizedResponse(sessionId: string): NormalizedSmartbotResponse {
  return {
    sessionId,
    answer: '',
    messages: [],
    cards: [],
    actions: [],
    suggestedQuestions: [],
    handoffRequired: false,
    smartbot: {
      status: 0,
      rawType: 'local_tool',
    },
  };
}

function stagedSchoolDemoDelta(result: SchoolDemoToolResult | null): string {
  if (!result) return 'Mình đã chuẩn bị phản hồi phù hợp.';
  if (result.title === 'Hồ sơ cấp Trường còn thiếu') {
    return 'Đã tìm thấy 2 điểm cần xử lý.';
  }
  if (result.title === 'Minh chứng hiện có trong hồ sơ cấp Trường') {
    return 'Đã tìm thấy các minh chứng hiện có và các điểm cần bổ sung.';
  }
  if (result.title.includes('Matching Hub')) {
    return 'Đã tìm thấy minh chứng phù hợp.';
  }
  return 'Mình đã chuẩn bị thẻ thao tác phù hợp.';
}

function applyResponseGuardrails(
  response: NormalizedSmartbotResponse,
  question: string,
): NormalizedSmartbotResponse {
  return {
    ...response,
    answer: applySmartbotGuardrails(response.answer, question),
    messages: response.messages.map((message, index) =>
      index === 0 && message.text
        ? { ...message, text: applySmartbotGuardrails(message.text, question) }
        : message,
    ),
    cards: response.cards.map((message, index) =>
      index === 0 && message.text
        ? { ...message, text: applySmartbotGuardrails(message.text, question) }
        : message,
    ),
  };
}

function hasLocalToolResponse(prepared: PreparedChatbotMessage): boolean {
  if (prepared.schoolDemoResult) return true;
  const result = prepared.registryToolResult;
  return Boolean(result && ((result.cards?.length ?? 0) > 0 || (result.actions?.length ?? 0) > 0));
}

function isAssistantProviderError(error: AppError): boolean {
  return error.code.startsWith('OPENAI_');
}

function providerFallbackResponse(sessionId: string, criteria: boolean) {
  if (criteria) return criteriaFallbackResponse(sessionId);
  return {
    object: {
      sb: {
        session_id: sessionId,
        intent_name: 'openai_fallback',
        card_data: [{ type: 'text', text: fallbackText }],
        card_data_info: { status: 0 },
      },
    },
  };
}

function splitForStreaming(text: string): string[] {
  const words = text.split(/(\s+)/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    current += word;
    if (current.length >= 48 && chunks.length < 4) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 5);
}

function stripTransientActions(response: NormalizedSmartbotResponse): {
  messages: NormalizedSmartbotMessage[];
  cards: NormalizedSmartbotMessage[];
  actions: ChatbotAction[];
} {
  return {
    messages: response.messages.map(stripMessageButtons),
    cards: response.cards.map(stripMessageButtons),
    actions: [],
  };
}

function stripMessageButtons(message: NormalizedSmartbotMessage): NormalizedSmartbotMessage {
  return {
    ...message,
    buttons: undefined,
    items: message.items?.map(stripMessageButtons),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeActions<T extends { id: string }>(left: T[], right: T[]): T[] {
  const seen = new Set<string>();
  return [...left, ...right].filter((action) => {
    const record = action as T & { type?: string; route?: string; payload?: string };
    const key = [record.id, record.type, record.route ?? '', record.payload ?? ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function replaceEmbeddedActionReferences(
  response: ChatbotMessageResponseDto,
  originalActions: ChatbotAction[],
  savedActions: ChatbotAction[],
): ChatbotMessageResponseDto {
  const savedByOriginalKey = new Map(
    originalActions.map((action, index) => [embeddedActionKey(action), savedActions[index] ?? action]),
  );
  return {
    ...response,
    messages: response.messages.map((message) => replaceMessageActions(message, savedByOriginalKey)),
    cards: response.cards.map((message) => replaceMessageActions(message, savedByOriginalKey)),
  };
}

function replaceMessageActions(
  message: NormalizedSmartbotMessage,
  savedByOriginalKey: Map<string, ChatbotAction>,
): NormalizedSmartbotMessage {
  return {
    ...message,
    buttons: message.buttons?.map((button) => savedByOriginalKey.get(embeddedActionKey(button)) ?? button),
    items: message.items?.map((item) => replaceMessageActions(item, savedByOriginalKey)),
  };
}

function embeddedActionKey(action: ChatbotAction): string {
  return [
    action.id,
    action.type,
    action.label,
    action.route ?? '',
    action.payload ?? '',
    action.url ?? '',
    action.phoneNumber ?? '',
  ].join('|');
}

function inferToolCall(role: ChatbotToolRole, input: ChatbotMessageInput): { name: string; input: unknown } | null {
  const text = input.text.toLowerCase();
  if (text.includes('thiếu') || text.includes('gap') || text.includes('còn thiếu')) {
    return { name: 'getGapAnalysis', input: { applicationId: input.applicationId } };
  }
  if (text.includes('trạng thái') || text.includes('đang ở đâu') || text.includes('nộp thành công')) {
    return { name: 'getCurrentApplication', input: { applicationId: input.applicationId } };
  }
  if (text.includes('hạn') || text.includes('deadline') || text.includes('bổ sung khi nào')) {
    return { name: 'getDeadline', input: { applicationId: input.applicationId } };
  }
  if (role === 'officer' && input.pageContext?.taskId && text.includes('soạn yêu cầu bổ sung')) {
    return { name: 'draftSupplementRequest', input: { taskId: input.pageContext?.taskId, reason: input.text } };
  }
  if (role === 'officer' && (text.includes('task') || text.includes('xử lý hôm nay'))) {
    return { name: 'getOfficerTasks', input: {} };
  }
  if ((role === 'manager' || role === 'admin') && (text.includes('nghẽn') || text.includes('bottleneck'))) {
    return { name: 'getBottlenecks', input: {} };
  }
  if ((role === 'committee' || role === 'admin') && input.pageContext?.resolutionCaseId && (text.includes('case') || text.includes('resolution'))) {
    return { name: 'getResolutionCaseDetail', input: { caseId: input.pageContext.resolutionCaseId } };
  }
  return null;
}

function inferCriteriaRagIntent(input: ChatbotMessageInput): boolean {
  const text = input.text.toLowerCase();
  return [
    'tiêu chí',
    'sinh viên 5 tốt',
    'cấp trường',
    'điểm rèn luyện',
    'gpa',
    'học tập',
    'tình nguyện',
    'thể lực',
    'hội nhập',
    'đạo đức',
  ].some((phrase) => text.includes(phrase));
}

function inferSchoolDemoTool(
  input: ChatbotMessageInput,
  context: Awaited<ReturnType<typeof buildSafeChatbotContext>>,
): SchoolDemoToolResult | null {
  const text = input.text.toLowerCase();
  if (context.contextScope === 'reviewer_copilot') {
    if (text.includes('soạn yêu cầu bổ sung') || text.includes('draft supplement')) {
      return draftReviewerSupplementRequest(context);
    }
    if (
      text.includes('tóm tắt minh chứng') ||
      text.includes('minh chứng còn thiếu') ||
      text.includes('tìm case tương tự') ||
      text.includes('case tương tự') ||
      text.includes('chuyển resolution hub')
    ) {
      return summarizeReviewerEvidence(context);
    }
    return null;
  }

  if (context.contextScope !== 'student_helpdesk') return null;
  if (
    text.includes('minh chứng gì rồi') ||
    text.includes('đang có minh chứng gì') ||
    text.includes('em đã nộp gì') ||
    text.includes('danh sách minh chứng') ||
    text.includes('minh chứng của em') ||
    text.includes('hiện tại em có gì') ||
    text.includes('tìm minh chứng đã có')
  ) {
    return getSchoolDemoEvidenceSummary(context);
  }
  if (
    text.includes('sau upload') ||
    text.includes('vừa upload') ||
    text.includes('minh chứng này') ||
    text.includes('đã upload') ||
    text.includes('nộp minh chứng này')
  ) {
    return getPostUploadEvidenceSummary(context);
  }
  if (text.includes('thiếu gì') || text.includes('còn thiếu') || text.includes('gap') || text.includes('bổ sung gì')) {
    return getSchoolDemoGapAnalysis(context);
  }
  if (
    text.includes('matching') ||
    text.includes('tìm minh chứng') ||
    text.includes('kho sự kiện') ||
    text.includes('mùa hè xanh') ||
    text.includes('hiến máu')
  ) {
    return searchSchoolDemoMatchingHub(context);
  }
  if (text.includes('hỏi cán bộ') || text.includes('chuyển cán bộ') || text.includes('cần hỗ trợ')) {
    return createSchoolDemoHandoff(context);
  }
  if (text.includes('upload') || text.includes('tải minh chứng thể lực')) {
    return {
      type: 'action_cards',
      title: 'Upload minh chứng Thể lực tốt',
      message: 'Bạn có thể upload minh chứng Thể lực tốt tại workspace Minh chứng.',
      subtitle: 'Mở trang Minh chứng và chọn tiêu chí Thể lực tốt để tải file phù hợp.',
      cards: [
        {
          type: 'gap_item',
          title: 'Thể lực tốt',
          status: 'Chưa có minh chứng',
          description: 'Mở trang Minh chứng và chọn tiêu chí Thể lực tốt để tải file phù hợp.',
        },
      ],
      actions: [
        {
          id: 'act_school_nav_upload_physical',
          label: 'Upload minh chứng thể lực',
          type: 'navigate',
          route: '/app/evidence',
          query: { criterion: 'physical', action: 'upload' },
          requiresConfirmation: false,
        },
      ],
    };
  }
  return null;
}

function criteriaFallbackResponse(sessionId: string) {
  return {
    object: {
      sb: {
        session_id: sessionId,
        intent_name: 'criteria_rag',
        card_data: [
          {
            type: 'text',
            text: schoolCriteriaFallbackText,
          },
        ],
        card_data_info: { status: 0 },
      },
    },
  };
}

function schoolDemoResultToMessages(result: SchoolDemoToolResult): NormalizedSmartbotMessage[] {
  return [
    {
      type: 'action_cards',
      title: result.title,
      subtitle: result.subtitle,
      items: result.cards,
      buttons: result.actions,
    },
  ];
}

function toolResultToMessages(result: ChatbotToolResult): NormalizedSmartbotMessage[] {
  if (!result.cards?.length) {
    return [{ type: result.type === 'handoff' ? 'handoff' : 'text', text: result.message }];
  }
  return [
    { type: 'text', text: result.message },
    ...result.cards.map((card) => {
      const record = card && typeof card === 'object' ? (card as Record<string, unknown>) : {};
      return {
        type: 'text' as const,
        title: typeof record.title === 'string' ? record.title : undefined,
        text: typeof record.text === 'string' ? record.text : JSON.stringify(card),
      };
    }),
  ];
}

function toolResultToActions(result: ChatbotToolResult, role: ChatbotAction['requiredRole']): ChatbotAction[] {
  return (result.actions ?? []).map((action, index) => {
    const record = action && typeof action === 'object' ? (action as Record<string, unknown>) : {};
    const type = record.type === 'navigation' ? 'navigate' : 'postback';
    return {
      id: `act_tool_${index}_${String(record.label ?? 'action').replace(/[^a-zA-Z0-9]+/g, '_')}`,
      label: String(record.label ?? 'Mở thao tác'),
      type,
      route: typeof record.route === 'string' ? record.route : undefined,
      payload: typeof record.payload === 'string' ? record.payload : undefined,
      toolName: undefined,
      requiredRole: role,
      requiresConfirmation: false,
    };
  });
}
