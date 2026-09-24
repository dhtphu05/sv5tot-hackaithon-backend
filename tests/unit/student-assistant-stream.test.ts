import { describe, expect, it } from 'vitest';
import { createStudentAssistantStreamLifecycle } from '../../src/modules/student-assistant/student-assistant-stream';

describe('student assistant stream lifecycle', () => {
  it('emits exactly one terminal event and ignores later events', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const stream = createStudentAssistantStreamLifecycle({
      requestId: 'req-1',
      callbacks: {
        onMeta: (data) => {
          events.push({ event: 'meta', data });
        },
        onComplete: (data) => {
          events.push({ event: 'complete', data });
        },
        onError: (data) => {
          events.push({ event: 'error', data });
        },
        onDelta: (data) => {
          events.push({ event: 'delta', data });
        },
      },
    });

    await stream.meta({ contextType: 'evidence_card', contextId: 'evidence-1', contextVersion: 'ctx-1' });
    await stream.complete({ finalText: 'Hoàn tất', contextVersion: 'ctx-1' });
    await stream.error({ code: 'FAILED', recoverable: true });
    await stream.delta({ text: 'late' });

    expect(events.map((event) => event.event)).toEqual(['meta', 'complete']);
    expect(events[0].data).toMatchObject({ requestId: 'req-1', sequence: 1 });
    expect(events[1].data).toMatchObject({ requestId: 'req-1', sequence: 2 });
  });

  it('does not emit after abort', async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const stream = createStudentAssistantStreamLifecycle({
      requestId: 'req-1',
      signal: controller.signal,
      callbacks: {
        onDelta: () => {
          events.push('delta');
        },
      },
    });

    controller.abort();
    await stream.delta({ text: 'late' });

    expect(events).toEqual([]);
  });
});
