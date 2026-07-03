import { describe, it, expect } from 'vitest';
import {
  createDeepSeekJsonAdapter,
  createDeterministicLlmJsonAdapter,
  createGlmJsonAdapter,
  AuditLogPrisma,
  isKnownAdapter,
  KNOWN_ADAPTERS,
  LlmUsageLoggerPrisma,
} from './index.js';

describe('adapters registry', () => {
  it('knows vendor adapters', () => {
    expect(isKnownAdapter('glm')).toBe(true);
    expect(isKnownAdapter('deepseek')).toBe(true);
  });

  it('rejects unknown names', () => {
    expect(isKnownAdapter('not-a-vendor')).toBe(false);
  });

  it('includes deploy targets (NFR-12 portabilitas)', () => {
    expect(KNOWN_ADAPTERS).toContain('cpanel-ssh');
    expect(KNOWN_ADAPTERS).toContain('cf-pages');
  });

  it('exports LLM adapter factories', () => {
    expect(typeof createDeepSeekJsonAdapter).toBe('function');
    expect(typeof createDeterministicLlmJsonAdapter).toBe('function');
    expect(typeof createGlmJsonAdapter).toBe('function');
    expect(LlmUsageLoggerPrisma).toBeDefined();
    expect(AuditLogPrisma).toBeDefined();
  });
});
