// Composition root worker (T-063, SOLID-D): pilih adapter konkret dari env & suntik ke
// use case publish. ArtifactStore = S3 bila S3_KEY/S3_SECRET diisi (incl. MinIO via
// S3_ENDPOINT), else lokal-FS (dev). Deploy = lokal-FS docroot sekarang; adapter rsync/SSH
// cPanel menyusul (kontrak DeployPort sama, FR-PUB-009). Verify = HTTP fetch (FR-PUB-004).

import {
  LocalArtifactStore,
  LocalFilesystemDeploy,
  S3ArtifactStore,
  createAwsS3ObjectClient,
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

// Deploy lokal-FS (analog rsync docroot). Adapter cPanel rsync/SSH menyusul (FR-PUB-009).
export function createDeploy(env: PublishEnv): DeployPort {
  return new LocalFilesystemDeploy({
    docrootBase: env.PUBLISH_DOCROOT_BASE ?? DEFAULTS.docrootBase,
    baseDomain: env.PUBLISH_BASE_DOMAIN ?? DEFAULTS.baseDomain,
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
