import { describe, it, expect } from 'vitest';
import { buildServer, APP_NAME } from './index.js';

describe('api composition root', () => {
  it('builds a ready server handle', () => {
    const server = buildServer();
    expect(server.ready).toBe(true);
    expect(server.name).toBe(APP_NAME);
  });
});
