// Use case publish (T-063, FR-PUB-004/005; SRS §8). Orkestrasi murni berbasis Port →
// diuji dengan fake tanpa infra. Pipeline: validasi Site Document → build statis (sites-kit)
// → simpan artifact (object storage) → deploy (shared hosting) → verifikasi HTTP 200.
// Rollback = redeploy artifact revisi lama tanpa build ulang.

import { buildStaticSite, parseSiteDocument } from '@digimaestro/sites-kit';
import { err, ok } from '@digimaestro/shared';
import type {
  ArtifactRef,
  ArtifactStorePort,
  DeployPort,
  PublishError,
  Result,
} from '@digimaestro/shared';

export interface PublishDeps {
  readonly artifacts: ArtifactStorePort;
  readonly deploy: DeployPort;
  // Verifikasi HTTP 200 pasca-deploy (FR-PUB-004). Opsional; bila absen, verifikasi dilewati.
  readonly verify?: (url: string) => Promise<boolean>;
}

export interface PublishInput {
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  readonly baseUrl: string;
  readonly siteDocument: unknown;
  readonly docroot?: string;
}

export interface PublishResult {
  readonly url: string;
  readonly artifact: ArtifactRef;
  readonly fileCount: number;
}

export interface RollbackInput {
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  readonly docroot?: string;
}

function artifactKey(websiteId: string, revisionNumber: number): string {
  return `${websiteId}/rev-${revisionNumber}`;
}

async function verifyIfRequested(deps: PublishDeps, url: string): Promise<PublishError | null> {
  if (!deps.verify) return null;
  const okHttp = await deps.verify(url);
  return okHttp ? null : { code: 'VERIFY', message: `verifikasi HTTP gagal: ${url}` };
}

export async function publishSite(deps: PublishDeps, input: PublishInput): Promise<Result<PublishResult, PublishError>> {
  const parsed = parseSiteDocument(input.siteDocument);
  if (!parsed.ok) {
    return err({ code: 'BUILD', message: `site document tidak valid: ${parsed.issues[0] ?? 'unknown'}` });
  }

  const files = buildStaticSite(parsed.value, { baseUrl: input.baseUrl });

  const stored = await deps.artifacts.store({ key: artifactKey(input.websiteId, input.revisionNumber), files });
  if (!stored.ok) return stored;

  const deployed = await deps.deploy.deploy({ target: { slug: input.slug, docroot: input.docroot }, files });
  if (!deployed.ok) return deployed;

  const verifyErr = await verifyIfRequested(deps, deployed.value.url);
  if (verifyErr) return err(verifyErr);

  return ok({ url: deployed.value.url, artifact: stored.value, fileCount: deployed.value.fileCount });
}

export async function rollbackSite(deps: PublishDeps, input: RollbackInput): Promise<Result<PublishResult, PublishError>> {
  const key = artifactKey(input.websiteId, input.revisionNumber);
  const retrieved = await deps.artifacts.retrieve(key);
  if (!retrieved.ok) return retrieved;
  if (!retrieved.value) return err({ code: 'NOT_FOUND', message: `artifact revisi tak ditemukan: ${key}` });

  const files = retrieved.value;
  const deployed = await deps.deploy.deploy({ target: { slug: input.slug, docroot: input.docroot }, files });
  if (!deployed.ok) return deployed;

  const verifyErr = await verifyIfRequested(deps, deployed.value.url);
  if (verifyErr) return err(verifyErr);

  return ok({
    url: deployed.value.url,
    artifact: { key, location: key, fileCount: files.length },
    fileCount: deployed.value.fileCount,
  });
}
