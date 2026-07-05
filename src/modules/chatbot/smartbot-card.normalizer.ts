import { ChatbotHandoffService } from './chatbot-handoff.service';
import type {
  NormalizedSmartbotMessage,
  NormalizedSmartbotResponse,
  SmartbotButton,
} from './chatbot.types';

const handoffService = new ChatbotHandoffService();

export function normalizeSmartbotResponse(input: {
  raw: unknown;
  sessionId: string;
  fallbackText: string;
}): NormalizedSmartbotResponse {
  const root = asRecord(input.raw);
  const object = asRecord(root?.object);
  const sb = asRecord(object?.sb) ?? asRecord(root?.sb) ?? root;
  const rawCards = asArray(sb?.card_data);
  const cardInfo = asRecord(sb?.card_data_info);
  const messages = rawCards.length
    ? rawCards.map(normalizeCard)
    : [{ type: 'text' as const, text: pickText(sb) ?? input.fallbackText }];
  const handoffRequired = messages.some((message) => message.type === 'handoff');
  const handoffAction = handoffRequired ? [handoffService.buildHandoffAction()] : [];
  const actions = [...messages.flatMap((message) => message.buttons ?? []), ...handoffAction];
  const answer = buildAnswer(messages, input.fallbackText);

  return {
    sessionId: String(sb?.session_id ?? root?.session_id ?? input.sessionId),
    answer,
    messages,
    cards: messages,
    actions,
    suggestedQuestions: extractSuggestedQuestions(messages),
    handoffRequired,
    smartbot: {
      intentName: stringOrUndefined(sb?.intent_name ?? sb?.intentName),
      status: numberOrUndefined(cardInfo?.status),
      rawType: String(object?.type ?? sb?.type ?? root?.type ?? 'normal'),
    },
  };
}

function normalizeCard(card: unknown): NormalizedSmartbotMessage {
  const item = asRecord(card);
  const rawType = String(item?.type ?? item?.card_type ?? item?.cardType ?? 'unknown').toLowerCase();
  if (rawType === 'chuyen_gdv') {
    return {
      type: 'handoff',
      title: 'Cần cán bộ hỗ trợ',
      text: pickText(item) ?? 'Mình sẽ chuyển yêu cầu này để cán bộ phụ trách hỗ trợ.',
    };
  }

  if (rawType === 'text') return { type: 'text', text: pickText(item) };
  if (rawType === 'quickreply') {
    return {
      type: 'quickreply',
      text: pickText(item),
      buttons: normalizeButtons(asArray(item?.buttons ?? item?.quick_replies ?? item?.quickReplies)),
    };
  }
  if (rawType === 'image') {
    return {
      type: 'image',
      title: stringOrUndefined(item?.title),
      subtitle: stringOrUndefined(item?.subtitle),
      text: pickText(item),
      url: stringOrUndefined(item?.url ?? item?.image_url ?? item?.imageUrl),
      buttons: normalizeButtons(asArray(item?.buttons)),
    };
  }
  if (rawType === 'carousel') {
    return {
      type: 'carousel',
      text: pickText(item),
      items: asArray(item?.items ?? item?.elements).map(normalizeCarouselItem),
      buttons: normalizeButtons(asArray(item?.buttons)),
    };
  }

  return {
    type: 'unknown',
    title: stringOrUndefined(item?.title),
    subtitle: stringOrUndefined(item?.subtitle),
    text: pickText(item),
    buttons: normalizeButtons(asArray(item?.buttons)),
  };
}

function normalizeCarouselItem(value: unknown): NormalizedSmartbotMessage {
  const item = asRecord(value);
  return {
    type: 'carousel',
    title: stringOrUndefined(item?.title),
    subtitle: stringOrUndefined(item?.subtitle),
    text: pickText(item),
    url: stringOrUndefined(item?.url ?? item?.image_url ?? item?.imageUrl),
    buttons: normalizeButtons(asArray(item?.buttons)),
  };
}

function normalizeButtons(buttons: unknown[]): SmartbotButton[] {
  return buttons.map(normalizeButton).filter((button): button is SmartbotButton => Boolean(button));
}

function normalizeButton(value: unknown): SmartbotButton | null {
  const button = asRecord(value);
  if (!button) return null;
  const label = String(button.title ?? button.label ?? button.text ?? 'Thao tác');
  const payload = stringOrUndefined(button.payload ?? button.value ?? button.url);
  const rawType = String(button.type ?? button.button_type ?? button.buttonType ?? 'postback').toLowerCase();
  const actionType = payload?.startsWith('fivetot://action/')
    ? 'internal_action'
    : rawType === 'web_url'
      ? 'web_url'
      : rawType === 'phone_number'
        ? 'phone_number'
        : 'postback';

  if (actionType === 'web_url') {
    return {
      id: `act_web_${safeId(label)}`,
      label,
      type: 'navigate',
      actionType,
      url: payload,
      requiresConfirmation: false,
    };
  }

  if (actionType === 'phone_number') {
    return {
      id: `act_phone_${safeId(label)}`,
      label,
      type: 'postback',
      actionType,
      phoneNumber: payload,
      requiresConfirmation: false,
    };
  }

  return {
    id: `act_postback_${safeId(payload ?? label)}`,
    label,
    type: 'postback',
    actionType,
    payload,
    requiresConfirmation: false,
  };
}

function buildAnswer(messages: NormalizedSmartbotMessage[], fallbackText: string): string {
  const text = messages
    .map((message) => message.text ?? message.title)
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || fallbackText;
}

function extractSuggestedQuestions(messages: NormalizedSmartbotMessage[]): string[] {
  return messages
    .flatMap((message) => message.buttons ?? [])
    .filter((button) => button.type === 'postback')
    .map((button) => button.label)
    .slice(0, 6);
}

function pickText(value?: Record<string, unknown>): string | undefined {
  return stringOrUndefined(value?.text ?? value?.content ?? value?.message ?? value?.description);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 48) || 'action';
}
