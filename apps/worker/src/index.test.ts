import { describe, it, expect } from 'vitest';
import { startWorker } from './index.js';

describe('worker', () => {
  it('starts and reports running', () => {
    const w = startWorker();
    expect(w.running).toBe(true);
  });
});
