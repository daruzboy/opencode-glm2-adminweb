import { describe, it, expect } from 'vitest';
import { tenantId } from './index.js';

describe('core domain', () => {
  it('tenantId() returns the same string value', () => {
    const id = tenantId('t_123');
    expect(`${id}`).toBe('t_123');
  });
});
