export type StudentAssistantGenerationResult<T> = {
  value: T;
  fallback: boolean;
};

type ActiveEntry<T> = {
  identity: string;
  conversationKey: string;
  turnId: string;
  controller: AbortController;
  promise: Promise<StudentAssistantGenerationResult<T>>;
  expiresAt: number;
};

export class StudentAssistantGenerationRegistry<T> {
  private readonly active = new Map<string, ActiveEntry<T>>();
  private readonly completed = new Map<
    string,
    { result: StudentAssistantGenerationResult<T>; expiresAt: number }
  >();

  constructor(private readonly ttlMs = 60_000) {}

  run(input: {
    identity: string;
    conversationKey: string;
    turnId: string;
    signal?: AbortSignal;
    generate: (signal: AbortSignal) => Promise<StudentAssistantGenerationResult<T>>;
  }) {
    this.prune();
    const completed = this.completed.get(input.identity);
    if (completed && completed.expiresAt > Date.now()) return completed.result;

    const existing = this.active.get(input.identity);
    if (existing) return existing.promise;

    for (const entry of this.active.values()) {
      if (entry.conversationKey === input.conversationKey && entry.turnId !== input.turnId) {
        entry.controller.abort();
      }
    }

    const controller = new AbortController();
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    const promise = input.generate(controller.signal).then((value) => {
      this.completed.set(input.identity, { result: value, expiresAt: Date.now() + this.ttlMs });
      return value;
    }).finally(() => {
      this.active.delete(input.identity);
    });
    this.active.set(input.identity, {
      identity: input.identity,
      conversationKey: input.conversationKey,
      turnId: input.turnId,
      controller,
      promise,
      expiresAt: Date.now() + this.ttlMs,
    });
    return promise;
  }

  private prune() {
    const now = Date.now();
    for (const [key, entry] of this.active.entries()) {
      if (entry.expiresAt <= now) {
        entry.controller.abort();
        this.active.delete(key);
      }
    }
    for (const [key, entry] of this.completed.entries()) {
      if (entry.expiresAt <= now) this.completed.delete(key);
    }
  }
}
