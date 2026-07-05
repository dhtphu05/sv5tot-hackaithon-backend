import { env } from '../src/config/env';

async function main(): Promise<void> {
  if (
    !env.SMARTBOT_BOT_ID ||
    !env.SMARTBOT_ACCESS_TOKEN ||
    !env.SMARTBOT_TOKEN_ID ||
    !env.SMARTBOT_TOKEN_KEY
  ) {
    throw new Error('Smartbot smoke requires SMARTBOT_BOT_ID, SMARTBOT_ACCESS_TOKEN, SMARTBOT_TOKEN_ID, and SMARTBOT_TOKEN_KEY');
  }

  const response = await fetch(`${env.SMARTBOT_BASE_URL}/v1/conversation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SMARTBOT_ACCESS_TOKEN}`,
      'Token-id': env.SMARTBOT_TOKEN_ID,
      'Token-key': env.SMARTBOT_TOKEN_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      bot_id: env.SMARTBOT_BOT_ID,
      sender_id: 'fivetot_smoke',
      text: 'tiêu chí sinh viên 5 tốt cấp trường',
      input_channel: env.SMARTBOT_INPUT_CHANNEL,
      session_id: `smoke-${Date.now()}`,
      metadata: { button_variables: [{ variableName: 'role', value: 'smoke' }] },
      settings: {
        system_prompt:
          'You are a 5TOT workflow copilot. Answer criteria questions without exposing sensitive data.',
        advance_prompt: 'Use safe demo context only.',
      },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const sb = asRecord(asRecord(body.object)?.sb) ?? {};
  const cards = Array.isArray(sb.card_data) ? sb.card_data : [];
  const info = asRecord(sb.card_data_info);
  const firstText = firstCardText(cards[0]);

  console.log({
    httpStatus: response.status,
    messageCode: body.code ?? body.message_code ?? null,
    cardDataCount: cards.length,
    cardTypes: cards.map((card) => asRecord(card)?.type ?? 'unknown'),
    firstTextPreview: firstText.slice(0, 200),
    status: info?.status ?? null,
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstCardText(card: unknown): string {
  const record = asRecord(card);
  const value = record?.text ?? record?.content ?? record?.message ?? record?.description ?? '';
  return typeof value === 'string' ? value : '';
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Smartbot smoke failed');
  process.exitCode = 1;
});
