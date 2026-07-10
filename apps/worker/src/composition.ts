// Composition root worker (T-063, SOLID-D): pilih adapter konkret dari env & suntik ke
// use case publish. ArtifactStore = S3 bila S3_KEY/S3_SECRET diisi (incl. MinIO via
// S3_ENDPOINT), else lokal-FS (dev). Deploy: SFTP bila CPANEL_SFTP_HOST diisi → FTPS bila
// CPANEL_FTP_HOST diisi (host tanpa SSH) → else lokal-FS docroot (dev). Verify = HTTP fetch.

import { readFileSync } from 'node:fs';
import {
  CpanelFtpDeploy,
  CpanelSftpDeploy,
  LocalArtifactStore,
  LocalFilesystemDeploy,
  S3ArtifactStore,
  createAwsS3ObjectClient,
  createBasicFtpDeployClient,
  createSsh2SftpDeployClient,
} from '@digimaestro/adapters';
import type { ArtifactStorePort, DeployPort } from '@digimaestro/shared';
import type { ConnectionOptions } from 'bullmq';
import type { PublishDeps } from './publish.js';

export interface PublishEnv {
  readonly S3_ENDPOINT?: string;
  readonly S3_BUCKET?: string;
  readonly S3_KEY?: string;
  readonly S3_SECRET?: string;
  readonly S3_REGION?: string;
  readonly PUBLISH_ARTIFACT_DIR?: string;
  readonly PUBLISH_DOCROOT_BASE?: string;
  readonly PUBLISH_BASE_DOMAIN?: string;
  readonly REDIS_URL?: string;
  // Deploy cPanel SFTP (T-063). Bila HOST+USER diisi → CpanelSftpDeploy.
  readonly CPANEL_SFTP_HOST?: string;
  readonly CPANEL_SFTP_PORT?: string;
  readonly CPANEL_SFTP_USER?: string;
  readonly CPANEL_SFTP_PASSWORD?: string;
  readonly CPANEL_SFTP_KEY_PATH?: string;
  readonly CPANEL_SFTP_PASSPHRASE?: string;
  // Deploy cPanel FTP/FTPS (fallback host tanpa SSH). Bila HOST+USER diisi → CpanelFtpDeploy.
  readonly CPANEL_FTP_HOST?: string;
  readonly CPANEL_FTP_PORT?: string;
  readonly CPANEL_FTP_USER?: string;
  readonly CPANEL_FTP_PASSWORD?: string;
  readonly CPANEL_FTP_SECURE?: string;
  readonly CPANEL_FTP_REJECT_UNAUTHORIZED?: string;
  readonly CPANEL_DOCROOT_TEMPLATE?: string;
}

const DEFAULTS = {
  artifactDir: './data/artifacts',
  docrootBase: './data/www',
  baseDomain: 'digimaestro.id',
  bucket: 'digimaestro-artifacts',
} as const;

// S3 dipakai hanya bila kredensial lengkap; else lokal-FS (dev tanpa object storage).
export function createArtifactStore(env: PublishEnv): ArtifactStorePort {
  if (env.S3_KEY && env.S3_SECRET) {
    const client = createAwsS3ObjectClient({
      bucket: env.S3_BUCKET ?? DEFAULTS.bucket,
      accessKeyId: env.S3_KEY,
      secretAccessKey: env.S3_SECRET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
    });
    return new S3ArtifactStore(client);
  }
  return new LocalArtifactStore(env.PUBLISH_ARTIFACT_DIR ?? DEFAULTS.artifactDir);
}

// Deploy: SFTP bila CPANEL_SFTP_HOST+USER (produksi, aman); FTPS bila CPANEL_FTP_HOST+USER
// (fallback host tanpa SSH, mis. shared hosting); else lokal-FS docroot (dev/staging).
export function createDeploy(env: PublishEnv): DeployPort {
  const baseDomain = env.PUBLISH_BASE_DOMAIN ?? DEFAULTS.baseDomain;
  const docrootTemplate = env.CPANEL_DOCROOT_TEMPLATE;

  if (env.CPANEL_SFTP_HOST && env.CPANEL_SFTP_USER) {
    const client = createSsh2SftpDeployClient({
      host: env.CPANEL_SFTP_HOST,
      port: env.CPANEL_SFTP_PORT ? Number(env.CPANEL_SFTP_PORT) : undefined,
      username: env.CPANEL_SFTP_USER,
      password: env.CPANEL_SFTP_PASSWORD,
      privateKey: env.CPANEL_SFTP_KEY_PATH ? readFileSync(env.CPANEL_SFTP_KEY_PATH) : undefined,
      passphrase: env.CPANEL_SFTP_PASSPHRASE,
    });
    return new CpanelSftpDeploy(client, { baseDomain, docrootTemplate });
  }

  if (env.CPANEL_FTP_HOST && env.CPANEL_FTP_USER) {
    const client = createBasicFtpDeployClient({
      host: env.CPANEL_FTP_HOST,
      port: env.CPANEL_FTP_PORT ? Number(env.CPANEL_FTP_PORT) : undefined,
      user: env.CPANEL_FTP_USER,
      password: env.CPANEL_FTP_PASSWORD ?? '',
      secure: env.CPANEL_FTP_SECURE ? env.CPANEL_FTP_SECURE !== 'false' : undefined,
      rejectUnauthorized: env.CPANEL_FTP_REJECT_UNAUTHORIZED ? env.CPANEL_FTP_REJECT_UNAUTHORIZED !== 'false' : undefined,
    });
    return new CpanelFtpDeploy(client, { baseDomain, docrootTemplate });
  }

  return new LocalFilesystemDeploy({
    docrootBase: env.PUBLISH_DOCROOT_BASE ?? DEFAULTS.docrootBase,
    baseDomain,
  });
}

// Verifikasi HTTP 200 pasca-deploy (FR-PUB-004) via fetch global (Node 20+). Error jaringan
// → false (dianggap gagal verifikasi).
export function createHttpVerify(fetchImpl: typeof fetch = fetch): (url: string) => Promise<boolean> {
  return async (url: string) => {
    try {
      const res = await fetchImpl(url, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  };
}

export function createPublishDeps(env: PublishEnv = process.env): PublishDeps {
  return {
    artifacts: createArtifactStore(env),
    deploy: createDeploy(env),
    verify: createHttpVerify(),
  };
}

// Parse REDIS_URL → ConnectionOptions BullMQ (ioredis). Default localhost:6379.
export function createRedisConnection(env: PublishEnv = process.env): ConnectionOptions {
  const url = new URL(env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    // maxRetriesPerRequest null wajib utk BullMQ blocking connection.
    maxRetriesPerRequest: null,
  };
}
