import { describe, expect, it } from 'vitest';
import { redactUrlQuery, redactedRequestSerializer } from './log-redact.js';

describe('redactUrlQuery — token WS/preview tak boleh mampir di log (audit 2026-07-16)', () => {
  it('meredaksi ?token= (JWT WebSocket) tapi mempertahankan param lain', () => {
    expect(redactUrlQuery('/api/chat?tenantId=t1&token=eyJhbGciOi.abc.def')).toBe(
      '/api/chat?tenantId=t1&token=%5BREDACTED%5D',
    );
  });

  it('meredaksi ?t= (token preview draft)', () => {
    expect(redactUrlQuery('/api/preview/rev1?t=a1b2c3')).toBe('/api/preview/rev1?t=%5BREDACTED%5D');
  });

  it('URL tanpa query / tanpa param sensitif tak berubah', () => {
    expect(redactUrlQuery('/healthz')).toBe('/healthz');
    expect(redactUrlQuery('/api/usage?since=2026-07-01')).toBe('/api/usage?since=2026-07-01');
  });
});

describe('redactedRequestSerializer — bentuk field sama dgn serializer bawaan', () => {
  it('menyalin method/hostname/remote* dan meredaksi url', () => {
    const out = redactedRequestSerializer({
      method: 'GET',
      url: '/api/chat?token=rahasia',
      hostname: 'api.local',
      ip: '10.0.0.1',
      socket: { remotePort: 54321 },
    });
    expect(out).toEqual({
      method: 'GET',
      url: '/api/chat?token=%5BREDACTED%5D',
      hostname: 'api.local',
      remoteAddress: '10.0.0.1',
      remotePort: 54321,
    });
  });

  it('request kosong (WS upgrade tanpa socket) tidak melempar', () => {
    expect(() => redactedRequestSerializer({})).not.toThrow();
  });
});
