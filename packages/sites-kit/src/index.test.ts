import { describe, it, expect } from 'vitest';
import { MVP_SECTION_TYPES } from './index.js';

describe('sites-kit', () => {
  it('ships at least 6 MVP section types (T-060 target: 12)', () => {
    expect(MVP_SECTION_TYPES.length).toBeGreaterThanOrEqual(6);
  });

  it('hero is present', () => {
    expect(MVP_SECTION_TYPES).toContain('hero');
  });
});
