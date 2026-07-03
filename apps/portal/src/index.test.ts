import { describe, it, expect } from 'vitest';
import { createPortal } from './index.js';

describe('portal', () => {
  it('defaults to Bahasa Indonesia', () => {
    expect(createPortal().locale).toBe('id');
  });
});
