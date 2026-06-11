import { describe, it, expect } from 'bun:test';

describe('Logger (OBS-01)', () => {
  describe('OBS-01: Structured logging with context', () => {
    it.todo('emits JSON with timestamp, level, and message');
    it.todo('injects tenantId from LogContext into all log lines');
    it.todo('injects brainId from LogContext into all log lines');
    it.todo('reads LOG_LEVEL from env (defaults to info)');
    it.todo('includes env (NODE_ENV) in base field');
  });
});
