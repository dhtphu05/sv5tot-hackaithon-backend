import type { StudentAssistantContext } from './student-assistant.dto';

type CacheEntry = {
  context: StudentAssistantContext;
  narrative?: string;
  expiresAt: number;
};

export class StudentAssistantContextCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  get(key: string): CacheEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  setContext(key: string, context: StudentAssistantContext) {
    this.entries.set(key, { context, expiresAt: Date.now() + this.ttlMs });
    this.prune();
  }

  setNarrative(key: string, narrative: string) {
    const entry = this.get(key);
    if (!entry) return;
    this.entries.set(key, { ...entry, narrative, expiresAt: Date.now() + this.ttlMs });
    this.prune();
  }

  private prune() {
    while (this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next().value;
      if (!first) return;
      this.entries.delete(first);
    }
  }
}
