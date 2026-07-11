import { describe, it, expect, vi } from 'vitest';
import { CpanelFtpDeploy, CpanelSftpDeploy, LocalArtifactStore, LocalFilesystemDeploy, S3ArtifactStore } from '@digimaestro/adapters';
import {
  createArtifactStore,
  createDeploy,
  createHttpVerify,
  createPublishDeps,
  createRedisConnection,
  createSubdomain,
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

  it('tanpa env cPanel → LocalFilesystemDeploy (dev)', () => {
    expect(createDeploy({})).toBeInstanceOf(LocalFilesystemDeploy);
  });

  it('CPANEL_SFTP_HOST+USER diisi (password auth) → CpanelSftpDeploy', () => {
    const deploy = createDeploy({ CPANEL_SFTP_HOST: 'srv.host', CPANEL_SFTP_USER: 'u', CPANEL_SFTP_PASSWORD: 'p' });
    expect(deploy).toBeInstanceOf(CpanelSftpDeploy);
  });

  it('CPANEL_FTP_HOST+USER diisi (tanpa SFTP) → CpanelFtpDeploy (fallback FTPS)', () => {
    const deploy = createDeploy({ CPANEL_FTP_HOST: 'ftp.host', CPANEL_FTP_USER: 'u', CPANEL_FTP_PASSWORD: 'p' });
    expect(deploy).toBeInstanceOf(CpanelFtpDeploy);
  });

  it('SFTP diprioritaskan di atas FTP bila keduanya diisi', () => {
    const deploy = createDeploy({
      CPANEL_SFTP_HOST: 'srv',
      CPANEL_SFTP_USER: 'u',
      CPANEL_SFTP_PASSWORD: 'p',
      CPANEL_FTP_HOST: 'ftp',
      CPANEL_FTP_USER: 'u',
    });
    expect(deploy).toBeInstanceOf(CpanelSftpDeploy);
  });

  it('createHttpVerify: res.ok → true, res tidak ok → false, error jaringan → false', async () => {
    // attempts:1 → perilaku sekali-tembak (verify kini SABAR & mengulang; lihat suite
    // "menunggu DNS/AutoSSL siap" di bawah untuk perilaku retry-nya).
    const once = { attempts: 1 };
    const okVerify = createHttpVerify((async () => ({ ok: true })) as unknown as typeof fetch, once);
    const notOk = createHttpVerify((async () => ({ ok: false })) as unknown as typeof fetch, once);
    const boom = createHttpVerify((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch, once);
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

  it('createSubdomain: UAPI env lengkap (password) → SubdomainPort; kurang → undefined', () => {
    expect(createSubdomain({ CPANEL_UAPI_HOST: 'h', CPANEL_UAPI_USER: 'u', CPANEL_UAPI_PASSWORD: 'p' })).toBeDefined();
    expect(createSubdomain({ CPANEL_UAPI_HOST: 'h', CPANEL_UAPI_USER: 'u', CPANEL_UAPI_TOKEN: 't' })).toBeDefined();
    expect(createSubdomain({ CPANEL_UAPI_HOST: 'h', CPANEL_UAPI_USER: 'u' })).toBeUndefined(); // tanpa token/pass
    expect(createSubdomain({})).toBeUndefined();
  });

  it('createPublishDeps: tanpa env cPanel → subdomain undefined (dilewati)', () => {
    expect(createPublishDeps({}).subdomain).toBeUndefined();
  });
});

// T-063v: verify harus SABAR. Subdomain baru butuh waktu (DNS + AutoSSL). Sekali-tembak
// melaporkan GAGAL padahal situs sebenarnya terbit → pengguna dapat notifikasi keliru.
describe('createHttpVerify — menunggu DNS/AutoSSL siap', () => {
  const noSleep = async (): Promise<void> => {};

  it('siap di percobaan pertama → true, tanpa menunggu', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    const verify = createHttpVerify(fetchImpl as never, { attempts: 3, sleep: noSleep });

    expect(await verify('https://x.id')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Kasus nyata: beberapa detik pertama DNS belum menyebar / sertifikat belum terbit.
  it('gagal dulu lalu siap → true (tidak menyerah terlalu cepat)', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n < 3) throw new Error('ENOTFOUND');
      return { ok: true } as Response;
    });
    const verify = createHttpVerify(fetchImpl as never, { attempts: 5, sleep: noSleep });

    expect(await verify('https://x.id')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('tak pernah siap → false setelah semua percobaan habis', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
    const verify = createHttpVerify(fetchImpl as never, { attempts: 4, sleep: noSleep });

    expect(await verify('https://x.id')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('error TLS/jaringan diperlakukan "belum siap", bukan crash', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('unable to verify the first certificate');
    });
    const verify = createHttpVerify(fetchImpl as never, { attempts: 2, sleep: noSleep });

    expect(await verify('https://x.id')).toBe(false);
  });
});
