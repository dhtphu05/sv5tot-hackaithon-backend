import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { MockSmartbotClient } from '../../infrastructure/vnpt/mock-smartbot.client';
import { fallbackResponse, VnptSmartBotClient } from '../../infrastructure/vnpt/vnpt-smartbot.client';
import { smartbotFallbackText } from '../../infrastructure/vnpt/vnpt-smartbot.diagnostics';
import { VnptSmartBotStreamClient } from '../../infrastructure/vnpt/vnpt-smartbot-stream.client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
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
import { normalizeSmartbotResponse } from './smartbot-card.normalizer';
import { callChatbotTool } from './tools/chatbot-tool.registry';
import type { ChatbotToolResult, ChatbotToolRole } from './tools/chatbot-tool.types';

export class ChatbotService {
  constructor(
    private readonly smartbotClient: SmartbotClient =
      env.SMARTBOT_MODE === 'mock' ? new MockSmartbotClient() : new VnptSmartBotClient(),
    private readonly conversationRepository: ChatbotConversationRepository =
      new PrismaChatbotConversationRepository(),
    private readonly actionRepository: ChatbotActionRepository = new PrismaChatbotActionRepository(),
    private readonly handoffRepository: ChatbotHandoffRepository = new PrismaChatbotHandoffRepository(),
    private readonly smartbotStreamClient: SmartbotStreamClient = new VnptSmartBotStreamClient(),
  ) {}

  async sendMessage(
    user: AuthenticatedUser,
    input: ChatbotMessageInput,
  ): Promise<ChatbotMessageResponseDto> {
    const prepared = await this.prepareMessage(user, input);
    if (hasLocalToolResponse(prepared)) {
      return this.finalizeResponse(prepared, emptyNormalizedResponse(prepared.sessionId));
    }

    const raw = await this.safeSendSmartbotMessage(prepared);
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

    if (env.SMARTBOT_MODE === 'mock') {
      await this.streamMockResponse(prepared, callbacks);
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
      if (prepared.intent !== 'criteria_rag' || (error instanceof AppError && !isSmartbotProviderError(error))) {
        throw error;
      }
      const response = await this.finalizeResponse(
        prepared,
        normalizeSmartbotResponse({
          raw: criteriaFallbackResponse(prepared.sessionId),
          sessionId: prepared.sessionId,
          fallbackText,
        }),
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
    const prompts = env.SMARTBOT_USE_DYNAMIC_PROMPT ? buildSmartbotPrompts(context) : undefined;
    const schoolDemoResult = inferSchoolDemoTool(input, context);
    const toolMatch = schoolDemoResult ? null : inferToolCall(user.role as ChatbotToolRole, input);
    const registryToolResult = toolMatch
      ? await callChatbotTool(
          {
            userId: user.id,
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
      : context.contextScope === 'student_helpdesk' && inferCriteriaRagIntent(input)
        ? 'criteria_rag'
        : 'smartbot';
    const request = {
      bot_id: env.SMARTBOT_MODE === 'mock' ? 'mock-smartbot' : env.SMARTBOT_BOT_ID,
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
      settings: prompts,
    };

    await this.conversationRepository.ensureSession({
      sessionId,
      userId: user.id,
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
  ): Promise<ChatbotMessageResponseDto> {
    const guardrailedAnswer = applySmartbotGuardrails(
      prepared.schoolDemoResult?.message ?? normalized.answer,
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
    const unsavedResponse = {
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

    const savedActions = await this.actionRepository.saveActions({
      sessionId: prepared.sessionId,
      userId: prepared.user.id,
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
      if (error instanceof AppError && !isSmartbotProviderError(error)) {
        throw error;
      }
      if (prepared.intent === 'criteria_rag') {
        return criteriaFallbackResponse(prepared.sessionId);
      }
      return fallbackResponse(prepared.sessionId);
    }
  }

  private async streamSchoolDemoResult(
    prepared: PreparedChatbotMessage,
    callbacks: ChatbotStreamEventCallbacks,
  ): Promise<void> {
    await callbacks.onDelta({ text: 'Mình đang kiểm tra dữ liệu hồ sơ cấp Trường...' });
    await delay(80);
    await callbacks.onDelta({ text: stagedSchoolDemoDelta(prepared.schoolDemoResult) });
    const response = await this.finalizeResponse(prepared, emptyNormalizedResponse(prepared.sessionId));
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
    const response = await this.finalizeResponse(prepared, emptyNormalizedResponse(prepared.sessionId));
    await callbacks.onCard({
      messages: response.messages,
      cards: response.cards,
      actions: response.actions,
    });
    await callbacks.onFinal(response);
  }


  private async streamMockResponse(
    prepared: PreparedChatbotMessage,
    callbacks: ChatbotStreamEventCallbacks,
  ): Promise<void> {
    const raw = await this.safeSendSmartbotMessage(prepared);
    const normalized = normalizeSmartbotResponse({ raw, sessionId: prepared.sessionId, fallbackText });
    const response = await this.finalizeResponse(prepared, normalized);
    for (const chunk of splitForStreaming(response.answer)) {
      await callbacks.onDelta({ text: chunk });
      await delay(60);
    }
    await callbacks.onFinal(response);
  }
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

const fallbackText = smartbotFallbackText;

const schoolCriteriaFallbackText =
  'Trong bản demo cấp Trường, hồ sơ Sinh viên 5 tốt cần đáp ứng 5 nhóm tiêu chí: Đạo đức tốt, Học tập tốt, Thể lực tốt, Tình nguyện tốt và Hội nhập tốt. Một số mốc chính gồm điểm rèn luyện từ 82 điểm trở lên, điểm học tập từ 3.0/4.0 trở lên và không có điểm F, tình nguyện có thể xét theo các minh chứng như hoạt động tình nguyện, hiến máu hoặc giấy chứng nhận phù hợp, và hội nhập có thể xét theo hoạt động hội nhập hoặc chứng chỉ ngoại ngữ phù hợp. Hệ thống chỉ hỗ trợ tiền kiểm và giải thích. Kết quả chính thức do cán bộ/Hội đồng xác nhận.';

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
  intent: 'local_tool' | 'criteria_rag' | 'smartbot';
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
    return 'Đã tìm thấy minh chứng demo phù hợp.';
  }
  return 'Mình đã chuẩn bị thẻ thao tác phù hợp.';
}

function hasLocalToolResponse(prepared: PreparedChatbotMessage): boolean {
  if (prepared.schoolDemoResult) return true;
  const result = prepared.registryToolResult;
  return Boolean(result && ((result.cards?.length ?? 0) > 0 || (result.actions?.length ?? 0) > 0));
}

function isSmartbotProviderError(error: AppError): boolean {
  switch (error.code) {
    case ErrorCodes.SMARTBOT_AUTH_FAILED:
    case ErrorCodes.SMARTBOT_ENV_MISSING:
    case ErrorCodes.SMARTBOT_HTTP_ERROR:
    case ErrorCodes.SMARTBOT_TIMEOUT:
    case ErrorCodes.SMARTBOT_PARSE_FAILED:
    case ErrorCodes.SMARTBOT_EMPTY_CARD_DATA:
    case ErrorCodes.SMARTBOT_NETWORK_ERROR:
    case ErrorCodes.SMARTBOT_RESPONSE_INVALID:
    case ErrorCodes.SMARTBOT_REQUEST_FAILED:
      return true;
    default:
      return false;
  }
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
