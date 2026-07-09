import { describe, it, expect } from 'vitest';
import { MVP_SECTION_TYPES } from './index.js';

describe('sites-kit', () => {
  it('ships at least 12 MVP section types (T-060 target met)', () => {
    expect(MVP_SECTION_TYPES.length).toBeGreaterThanOrEqual(12);
  });

  it('hero is present', () => {
    expect(MVP_SECTION_TYPES).toContain('hero');
  });
});
