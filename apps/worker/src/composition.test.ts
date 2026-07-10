import { describe, it, expect } from 'vitest';
import { LocalArtifactStore, S3ArtifactStore } from '@digimaestro/adapters';
import {
  createArtifactStore,
  createDeploy,
  createHttpVerify,
  createRedisConnection,
  type PublishEnv,
} from './composition.js';

describe('worker composition (pilih adapter dari env)', () => {
  it('S3_KEY+S3_SECRET diisi → S3ArtifactStore', () => {
    const env: PublishEnv = { S3_KEY: 'ak', S3_SECRET: 'sk', S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'b' };
    expect(createArtifactStore(env)).toBeInstanceOf(S3ArtifactStore);
  });

  it('tanpa kredensial S3 → LocalArtifactStore (dev)', () => {
    expect(createArtifactStore({})).toBeInstanceOf(LocalArtifactStore);
  });

  it('createDeploy → DeployPort (lokal-FS) dgn method deploy', () => {
    expect(typeof createDeploy({}).deploy).toBe('function');
  });

  it('createHttpVerify: res.ok → true, res tidak ok → false, error jaringan → false', async () => {
    const okVerify = createHttpVerify((async () => ({ ok: true })) as unknown as typeof fetch);
    const notOk = createHttpVerify((async () => ({ ok: false })) as unknown as typeof fetch);
    const boom = createHttpVerify((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    expect(await okVerify('https://x')).toBe(true);
    expect(await notOk('https://x')).toBe(false);
    expect(await boom('https://x')).toBe(false);
  });

  it('createRedisConnection: parse REDIS_URL → host/port/password + maxRetriesPerRequest null', () => {
    const conn = createRedisConnection({ REDIS_URL: 'redis://:secret@redis:6380' }) as {
      host: string;
      port: number;
      password?: string;
      maxRetriesPerRequest: number | null;
    };
    expect(conn.host).toBe('redis');
    expect(conn.port).toBe(6380);
    expect(conn.password).toBe('secret');
    expect(conn.maxRetriesPerRequest).toBeNull();
  });

  it('createRedisConnection default → localhost:6379', () => {
    const conn = createRedisConnection({}) as { host: string; port: number };
    expect(conn.host).toBe('localhost');
    expect(conn.port).toBe(6379);
  });
});
