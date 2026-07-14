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
  MobiriseSiteBuilder,
  S3ArtifactStore,
  createAwsS3ObjectClient,
  createBasicFtpDeployClient,
  createCpanelUapiSubdomain,
  createSsh2SftpDeployClient,
} from '@digimaestro/adapters';
import { parsePublishUrlMode } from '@digimaestro/shared';
import type { ArtifactStorePort, DeployPort, SubdomainPort } from '@digimaestro/shared';
import type { ConnectionOptions } from 'bullmq';
import type { PublishDeps } from './publish.js';

export interface PublishEnv {
  // P2: root folder template Mobirise (folder yang sama dilayani editor-web). Diisi →
  // builder mobirise terpasang; kosong → revisi mobirise-v1 gagal dengan pesan jelas.
  readonly TEMPLATES_DIR?: string;
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
  // 'path' → situs tayang di https://<domain>/<slug>/ (tanpa subdomain & UAPI).
  readonly PUBLISH_URL_MODE?: string;
  // Subdomain cPanel UAPI (FR-PUB-004b). Bila HOST+USER+(TOKEN|PASSWORD) → SubdomainPort.
  readonly CPANEL_UAPI_HOST?: string;
  readonly CPANEL_UAPI_PORT?: string;
  readonly CPANEL_UAPI_USER?: string;
  readonly CPANEL_UAPI_TOKEN?: string;
  readonly CPANEL_UAPI_PASSWORD?: string;
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
  const urlMode = parsePublishUrlMode(env.PUBLISH_URL_MODE);

  if (env.CPANEL_SFTP_HOST && env.CPANEL_SFTP_USER) {
    const client = createSsh2SftpDeployClient({
      host: env.CPANEL_SFTP_HOST,
      port: env.CPANEL_SFTP_PORT ? Number(env.CPANEL_SFTP_PORT) : undefined,
      username: env.CPANEL_SFTP_USER,
      password: env.CPANEL_SFTP_PASSWORD,
      privateKey: env.CPANEL_SFTP_KEY_PATH ? readFileSync(env.CPANEL_SFTP_KEY_PATH) : undefined,
      passphrase: env.CPANEL_SFTP_PASSPHRASE,
    });
    return new CpanelSftpDeploy(client, { baseDomain, docrootTemplate, urlMode });
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
    return new CpanelFtpDeploy(client, { baseDomain, docrootTemplate, urlMode });
  }

  return new LocalFilesystemDeploy({
    docrootBase: env.PUBLISH_DOCROOT_BASE ?? DEFAULTS.docrootBase,
    baseDomain,
  });
}

// Verifikasi HTTP 200 pasca-deploy (FR-PUB-004) via fetch global (Node 20+).
//
// SABAR, bukan sekali tembak: subdomain yang baru dibuat butuh waktu untuk propagasi DNS
// dan penerbitan AutoSSL. Sekali-tembak akan melaporkan GAGAL padahal situsnya sebenarnya
// terbit — dan pengguna menerima kabar kegagalan yang keliru. Jadi coba berulang dengan
// jeda sampai batas waktu; error jaringan/TLS diperlakukan sebagai "belum siap", bukan
// kegagalan final.
export interface HttpVerifyOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_VERIFY_ATTEMPTS = 6;
export const DEFAULT_VERIFY_DELAY_MS = 15_000; // ±75 dtk total sebelum menyerah

export function createHttpVerify(
  fetchImpl: typeof fetch = fetch,
  options: HttpVerifyOptions = {},
): (url: string) => Promise<boolean> {
  const attempts = options.attempts ?? DEFAULT_VERIFY_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_VERIFY_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return async (url: string) => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await fetchImpl(url, { method: 'GET' });
        if (res.ok) return true;
      } catch {
        // DNS belum menyebar / sertifikat AutoSSL belum terbit → coba lagi.
      }
      if (attempt < attempts) await sleep(delayMs);
    }
    return false;
  };
}

// Subdomain UAPI bila CPANEL_UAPI_HOST+USER+(TOKEN|PASSWORD) diisi (FR-PUB-004b); else
// undefined (dilewati oleh publishSite — mis. dev lokal-FS tanpa cPanel).
export function createSubdomain(env: PublishEnv): SubdomainPort | undefined {
  if (env.CPANEL_UAPI_HOST && env.CPANEL_UAPI_USER && (env.CPANEL_UAPI_TOKEN || env.CPANEL_UAPI_PASSWORD)) {
    return createCpanelUapiSubdomain({
      host: env.CPANEL_UAPI_HOST,
      port: env.CPANEL_UAPI_PORT ? Number(env.CPANEL_UAPI_PORT) : undefined,
      username: env.CPANEL_UAPI_USER,
      apiToken: env.CPANEL_UAPI_TOKEN,
      password: env.CPANEL_UAPI_PASSWORD,
    });
  }
  return undefined;
}

export function createPublishDeps(env: PublishEnv = process.env): PublishDeps {
  return {
    artifacts: createArtifactStore(env),
    deploy: createDeploy(env),
    verify: createHttpVerify(),
    subdomain: createSubdomain(env),
    // P2: perakit revisi 'mobirise-v1' (engine Mobirise + aset template dari disk).
    ...(env.TEMPLATES_DIR
      ? { mobirise: new MobiriseSiteBuilder({ templatesDir: env.TEMPLATES_DIR }) }
      : {}),
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
