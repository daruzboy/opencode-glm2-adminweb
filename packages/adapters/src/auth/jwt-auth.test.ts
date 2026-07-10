import { describe, expect, it } from 'vitest';
import { tenantId } from '@digimaestro/shared';
import { JwtAuthPort, extractBearerToken } from './jwt-auth.js';

const SECRET = 'test-secret-not-for-prod';

describe('JwtAuthPort — issue + verify roundtrip', () => {
  it('issues token and verifies it back (happy)', async () => {
    const auth = new JwtAuthPort({ secret: SECRET });
    const issued = await auth.issueToken({
      tenantId: tenantId('warung-demo'),
      userId: 'user1',
      role: 'OWNER',
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const verified = await auth.verifyToken(issued.value);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.tenantId).toBe('warung-demo');
      expect(verified.value.userId).toBe('user1');
      expect(verified.value.role).toBe('OWNER');
    }
  });

  it('rejects token signed with different secret → INVALID_TOKEN', async () => {
    const authA = new JwtAuthPort({ secret: SECRET });
    const authB = new JwtAuthPort({ secret: 'different-secret' });

    const issued = await authA.issueToken({
      tenantId: tenantId('t1'),
      userId: 'u1',
      role: 'OWNER',
    });
    if (!issued.ok) return;

    const verified = await authB.verifyToken(issued.value);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects garbage string → INVALID_TOKEN', async () => {
    const auth = new JwtAuthPort({ secret: SECRET });
    const result = await auth.verifyToken('not.a.jwt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects expired token → EXPIRED', async () => {
    const auth = new JwtAuthPort({ secret: SECRET, expiresIn: '0s' });
    const issued = await auth.issueToken({
      tenantId: tenantId('t1'),
      userId: 'u1',
      role: 'OWNER',
    });
    if (!issued.ok) return;

    // Wait a tick so token is already expired (exp = now rounded down).
    await new Promise((r) => setTimeout(r, 1100));
    const result = await auth.verifyToken(issued.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EXPIRED');
  });
});

describe('extractBearerToken', () => {
  it('extracts token from "Bearer xxx"', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('handles lowercase bearer', () => {
    expect(extractBearerToken('bearer xyz')).toBe('xyz');
  });

  it('returns null for undefined', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for non-Bearer header', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
  });
});
