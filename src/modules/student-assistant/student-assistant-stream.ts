export type StudentAssistantStreamEnvelope = {
  requestId: string;
  sequence: number;
};

type StreamCallbacks = {
  onMeta?: (data: Record<string, unknown>) => void | Promise<void>;
  onStatus?: (data: Record<string, unknown>) => void | Promise<void>;
  onDelta?: (data: Record<string, unknown>) => void | Promise<void>;
  onSources?: (data: Record<string, unknown>) => void | Promise<void>;
  onAction?: (data: Record<string, unknown>) => void | Promise<void>;
  onNavigation?: (data: Record<string, unknown>) => void | Promise<void>;
  onComplete?: (data: Record<string, unknown>) => void | Promise<void>;
  onError?: (data: Record<string, unknown>) => void | Promise<void>;
};

export function createStudentAssistantStreamLifecycle(input: {
  requestId: string;
  callbacks: StreamCallbacks;
  signal?: AbortSignal;
}) {
  let sequence = 0;
  let terminal = false;
  let aborted = Boolean(input.signal?.aborted);
  input.signal?.addEventListener('abort', () => {
    aborted = true;
  }, { once: true });

  async function emit(
    event: keyof StreamCallbacks,
    data: Record<string, unknown>,
    options: { terminal?: boolean } = {},
  ) {
    if (terminal || aborted) return false;
    const callback = input.callbacks[event];
    const payload = {
      ...data,
      requestId: input.requestId,
      sequence: ++sequence,
    };
    if (options.terminal) terminal = true;
    if (callback) await callback(payload);
    return true;
  }

  return {
    get terminal() {
      return terminal;
    },
    get aborted() {
      return aborted;
    },
    meta: (data: Record<string, unknown>) => emit('onMeta', data),
    status: (data: Record<string, unknown>) => emit('onStatus', data),
    delta: (data: Record<string, unknown>) => emit('onDelta', data),
    sources: (data: Record<string, unknown>) => emit('onSources', data),
    action: (data: Record<string, unknown>) => emit('onAction', data),
    navigation: (data: Record<string, unknown>) => emit('onNavigation', data),
    complete: (data: Record<string, unknown>) => emit('onComplete', data, { terminal: true }),
    error: (data: Record<string, unknown>) => emit('onError', data, { terminal: true }),
  };
}
