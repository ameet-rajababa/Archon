import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock logger before importing transport
const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(function (this: unknown) {
    return this;
  }),
  bindings: mock(() => ({ module: 'test' })),
  isLevelEnabled: mock(() => true),
  level: 'info',
};

mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

import { SSETransport, DASHBOARD_STREAM, type SSEWriter } from './transport';

function createMockStream(overrides?: Partial<SSEWriter>): SSEWriter {
  return {
    writeSSE: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    closed: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockLogger.warn.mockClear();
  mockLogger.info.mockClear();
  mockLogger.debug.mockClear();
});

describe('SSETransport', () => {
  describe('registerStream', () => {
    test('registers a stream for a conversation', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);

      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('a second subscriber does not evict the first', () => {
      const transport = new SSETransport();
      const first = createMockStream();
      const second = createMockStream();

      transport.registerStream('conv-1', first);
      transport.registerStream('conv-1', second);

      expect(first.close).not.toHaveBeenCalled();
      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('cancels pending cleanup timer on reconnection', () => {
      const cleanup = mock((_id: string) => undefined);
      const transport = new SSETransport(cleanup, 1);
      const stream1 = createMockStream();
      const stream2 = createMockStream();

      transport.registerStream('conv-1', stream1);
      transport.removeStream('conv-1', stream1);

      // Re-register before grace period expires — cleanup should be cancelled
      transport.registerStream('conv-1', stream2);

      // Wait longer than the grace period
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(cleanup).not.toHaveBeenCalled();
          resolve();
        }, 50);
      });
    }, 1_000);
  });

  describe('removeStream', () => {
    test('removes a stream', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      transport.removeStream('conv-1', stream);

      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });

    test('retires only the named stream, leaving the other subscriber connected', () => {
      const transport = new SSETransport();
      const stream1 = createMockStream();
      const stream2 = createMockStream();

      transport.registerStream('conv-1', stream1);
      transport.registerStream('conv-1', stream2);
      transport.removeStream('conv-1', stream1);

      expect(transport.hasActiveStream('conv-1')).toBe(true);
      transport.emitWorkflowEvent('conv-1', '{"type":"workflow_status"}');
      expect(stream1.writeSSE).not.toHaveBeenCalled();
      expect(stream2.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
    });

    test('calls onCleanup after grace period if stream not re-registered', () => {
      const cleanup = mock((_id: string) => undefined);
      const transport = new SSETransport(cleanup, 1);
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      transport.removeStream('conv-1', stream);

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(cleanup).toHaveBeenCalledWith('conv-1');
          resolve();
        }, 50);
      });
    }, 1_000);
  });

  describe('emit', () => {
    test('writes to active stream', async () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      await transport.emit('conv-1', '{"type":"text"}');

      expect(stream.writeSSE).toHaveBeenCalledWith({ data: '{"type":"text"}' });
    });

    test('no-ops when no stream exists (no buffering)', async () => {
      const transport = new SSETransport();

      // Should not throw
      await transport.emit('conv-1', '{"type":"text"}');
    });

    test('no-ops when stream is closed', async () => {
      const transport = new SSETransport();
      const stream = createMockStream({ closed: true });

      transport.registerStream('conv-1', stream);
      await transport.emit('conv-1', '{"type":"text"}');

      expect(stream.writeSSE).not.toHaveBeenCalled();
    });

    test('removes stream on write failure', async () => {
      const transport = new SSETransport();
      const stream = createMockStream({
        writeSSE: mock(() => Promise.reject(new Error('write failed'))),
      });

      transport.registerStream('conv-1', stream);
      await transport.emit('conv-1', '{"type":"text"}');

      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });
  });

  describe('emitWorkflowEvent', () => {
    test('writes to active stream', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.registerStream('conv-1', stream);
      transport.emitWorkflowEvent('conv-1', '{"type":"workflow_status"}');

      expect(stream.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
    });

    test('no-ops when no stream exists (consistent with emit)', () => {
      const transport = new SSETransport();

      // Should not throw
      transport.emitWorkflowEvent('conv-1', '{"type":"workflow_status"}');
    });
  });

  describe('fan-out to every subscriber', () => {
    // The dashboard feed is one stream id shared by every console window. When
    // it held a single writer, a second tab closed the first, the first
    // reconnected and closed the second, and events landed on whichever
    // connection happened to be current — so the rail's counts stopped
    // updating. Both delivery paths must reach all of them.
    test('emit reaches every subscriber on the dashboard stream', async () => {
      const transport = new SSETransport();
      const tabA = createMockStream();
      const tabB = createMockStream();

      transport.registerStream(DASHBOARD_STREAM, tabA);
      transport.registerStream(DASHBOARD_STREAM, tabB);
      await transport.emit(DASHBOARD_STREAM, '{"type":"conversation_changed"}');

      expect(tabA.writeSSE).toHaveBeenCalledWith({ data: '{"type":"conversation_changed"}' });
      expect(tabB.writeSSE).toHaveBeenCalledWith({ data: '{"type":"conversation_changed"}' });
    });

    test('emitWorkflowEvent reaches every subscriber', () => {
      const transport = new SSETransport();
      const tabA = createMockStream();
      const tabB = createMockStream();

      transport.registerStream(DASHBOARD_STREAM, tabA);
      transport.registerStream(DASHBOARD_STREAM, tabB);
      transport.emitWorkflowEvent(DASHBOARD_STREAM, '{"type":"workflow_status"}');

      expect(tabA.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
      expect(tabB.writeSSE).toHaveBeenCalledWith({ data: '{"type":"workflow_status"}' });
    });

    test('one failing subscriber does not deny the others the event', async () => {
      const transport = new SSETransport();
      const broken = createMockStream({
        writeSSE: mock(() => Promise.reject(new Error('write failed'))),
      });
      const healthy = createMockStream();

      transport.registerStream('conv-1', broken);
      transport.registerStream('conv-1', healthy);
      await transport.emit('conv-1', '{"type":"text"}');

      expect(healthy.writeSSE).toHaveBeenCalledWith({ data: '{"type":"text"}' });
      // The broken one is retired and closed so its client reconnects.
      expect(broken.close).toHaveBeenCalledTimes(1);
      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('onCleanup waits for the LAST subscriber to leave', () => {
      const cleanup = mock((_id: string) => undefined);
      const transport = new SSETransport(cleanup, 1);
      const stream1 = createMockStream();
      const stream2 = createMockStream();

      transport.registerStream('conv-1', stream1);
      transport.registerStream('conv-1', stream2);
      transport.removeStream('conv-1', stream1);

      return new Promise<void>(resolve => {
        setTimeout(() => {
          // stream2 is still watching — flushing persistence now would strand it.
          expect(cleanup).not.toHaveBeenCalled();
          transport.removeStream('conv-1', stream2);
          setTimeout(() => {
            expect(cleanup).toHaveBeenCalledWith('conv-1');
            resolve();
          }, 50);
        }, 50);
      });
    }, 1_000);
  });

  describe('hasActiveStream', () => {
    test('returns false when no stream registered', () => {
      const transport = new SSETransport();
      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });

    test('returns true for active stream', () => {
      const transport = new SSETransport();
      transport.registerStream('conv-1', createMockStream());
      expect(transport.hasActiveStream('conv-1')).toBe(true);
    });

    test('returns false for closed stream', () => {
      const transport = new SSETransport();
      transport.registerStream('conv-1', createMockStream({ closed: true }));
      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });
  });

  describe('buffer eviction warn throttle', () => {
    test('throttles repeated eviction warns to one per conversation per window', () => {
      // EVENT_BUFFER_MAX is 500; push 600 events into a conversation with no
      // active stream so all overflow events trigger an eviction. Even though
      // ~100 evictions happen, we should see exactly one warn (throttled).
      const transport = new SSETransport();
      mockLogger.warn.mockClear();

      for (let i = 0; i < 600; i++) {
        // emit() with no registered stream falls through to bufferEvent()
        void transport.emit('conv-throttle', `{"i":${i}}`);
      }

      const evictionWarns = mockLogger.warn.mock.calls.filter(
        (call: unknown[]) => call[1] === 'transport.buffer_evicted_oldest'
      );
      expect(evictionWarns.length).toBe(1);

      transport.stop();
    });
  });

  describe('start/stop', () => {
    test('start logs adapter_ready', () => {
      const transport = new SSETransport();
      transport.start();
      expect(mockLogger.info).toHaveBeenCalledWith('web.adapter_ready');
      transport.stop();
    });

    test('stop logs adapter_stopped', () => {
      const transport = new SSETransport();
      transport.start();
      mockLogger.info.mockClear();
      transport.stop();
      expect(mockLogger.info).toHaveBeenCalledWith('web.adapter_stopped');
    });

    test('stop closes all streams and clears state', () => {
      const transport = new SSETransport();
      const stream = createMockStream();

      transport.start();
      transport.registerStream('conv-1', stream);
      transport.stop();

      expect(stream.close).toHaveBeenCalledTimes(1);
      expect(transport.hasActiveStream('conv-1')).toBe(false);
    });

    test('stop cancels cleanup timers', () => {
      const cleanup = mock((_id: string) => undefined);
      const transport = new SSETransport(cleanup, 1);
      const stream = createMockStream();

      transport.start();
      transport.registerStream('conv-1', stream);
      transport.removeStream('conv-1', stream);
      transport.stop();

      // Wait longer than grace period — cleanup should NOT fire (timer was cleared)
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(cleanup).not.toHaveBeenCalled();
          resolve();
        }, 50);
      });
    }, 1_000);
  });
});
