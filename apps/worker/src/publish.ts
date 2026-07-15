// Use case publish (T-063, FR-PUB-004/005; SRS §8). Orkestrasi murni berbasis Port →
// diuji dengan fake tanpa infra. Pipeline: validasi Site Document → build statis (sites-kit)
// → simpan artifact (object storage) → provisioning subdomain (opsional, FR-PUB-004b) →
// deploy (shared hosting) → verifikasi HTTP 200. Rollback = redeploy artifact lama tanpa build.

import { buildStaticSite, parseSiteDocument } from '@digimaestro/sites-kit';
import { err, ok } from '@digimaestro/shared';
import type {
  ArtifactRef,
  ArtifactStorePort,
  DeployableFile,
  DeployPort,
  PublishError,
  Result,
  SubdomainPort,
} from '@digimaestro/shared';

// P2: perakit berkas untuk revisi 'mobirise-v1' (engine Mobirise + aset template).
// Port sempit → use case ini tetap murni & teruji offline; implementasinya
// MobiriseSiteBuilder (adapters, baca TEMPLATES_DIR).
export interface MobiriseBuilderPort {
  build(siteDocument: unknown): Promise<Result<readonly DeployableFile[], PublishError>>;
}

// Docroot default per slug (selaras template adapter cPanel 'public_html/{slug}').
const DEFAULT_DOCROOT_TEMPLATE = 'public_html/{slug}';

export interface PublishDeps {
  readonly artifacts: ArtifactStorePort;
  readonly deploy: DeployPort;
  // Verifikasi HTTP 200 pasca-deploy (FR-PUB-004). Opsional; bila absen, verifikasi dilewati.
  readonly verify?: (url: string) => Promise<boolean>;
  // Provisioning subdomain sebelum deploy (FR-PUB-004b). Opsional; bila absen, dilewati
  // (mis. dev lokal-FS). Bila di-inject, `rootDomain` pada input wajib.
  readonly subdomain?: SubdomainPort;
  // P2: wajib di-inject bila ada revisi 'mobirise-v1'; tanpa ini revisi mobirise gagal
  // dengan pesan jelas (bukan render setengah-jadi lewat jalur sections).
  readonly mobirise?: MobiriseBuilderPort;
}

export interface PublishInput {
  readonly websiteId: string;
  readonly revisionNumber: number;
  readonly slug: string;
  readonly baseUrl: string;
  readonly siteDocument: unknown;
  // P2 dual-mode: 'sections-v1' (default — revisi & job lama tak punya field ini) |
  // 'mobirise-v1'. Menentukan perakit berkas, BUKAN pipeline (store/deploy/verify sama).
  readonly renderEngine?: string;
  readonly docroot?: string;
  // Domain induk subdomain (mis. 'digimaestro.id'). Wajib bila deps.subdomain di-inject.
  readonly rootDomain?: string;
  // Pratinjau publik: (1) semua halaman disuntik meta noindex — folder preview tak boleh
  // bersaing dgn situs live di mesin pencari; (2) artifact TIDAK disimpan — kunci artifact
  // (websiteId, revisionNumber) sama dgn milik live, dan artifact adalah SUMBER ROLLBACK:
  // menimpanya dengan versi ber-noindex akan meracuni rollback.
  readonly preview?: boolean;
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
  readonly rootDomain?: string;
}

function artifactKey(websiteId: string, revisionNumber: number): string {
  return `${websiteId}/rev-${revisionNumber}`;
}

function docrootFor(slug: string, docroot?: string): string {
  return docroot ?? DEFAULT_DOCROOT_TEMPLATE.replace('{slug}', slug);
}

async function verifyIfRequested(deps: PublishDeps, url: string): Promise<PublishError | null> {
  if (!deps.verify) return null;
  const okHttp = await deps.verify(url);
  return okHttp ? null : { code: 'VERIFY', message: `verifikasi HTTP gagal: ${url}` };
}

// Pastikan subdomain ada sebelum deploy (idempoten). No-op bila subdomain tak di-inject.
// Docroot subdomain diselaraskan dgn docroot deploy agar file mendarat di lokasi yang benar.
async function ensureSubdomainIfConfigured(
  deps: PublishDeps,
  input: { readonly slug: string; readonly docroot?: string; readonly rootDomain?: string },
): Promise<PublishError | null> {
  if (!deps.subdomain) return null;
  if (!input.rootDomain) {
    return { code: 'SUBDOMAIN', message: 'rootDomain wajib saat provisioning subdomain aktif' };
  }
  const res = await deps.subdomain.ensureSubdomain({
    slug: input.slug,
    rootDomain: input.rootDomain,
    docroot: docrootFor(input.slug, input.docroot),
  });
  return res.ok ? null : res.error;
}

// Rakit berkas sesuai engine revisi. Kegagalan parse/rakit = BUILD error (bukan crash).
async function buildFiles(
  deps: PublishDeps,
  input: PublishInput,
): Promise<Result<readonly DeployableFile[], PublishError>> {
  if (input.renderEngine === 'mobirise-v1') {
    if (!deps.mobirise) {
      return err({
        code: 'BUILD',
        message: 'revisi mobirise-v1 tapi builder mobirise tak terpasang (TEMPLATES_DIR belum diset?)',
      });
    }
    return deps.mobirise.build(input.siteDocument);
  }

  const parsed = parseSiteDocument(input.siteDocument);
  if (!parsed.ok) {
    return err({ code: 'BUILD', message: `site document tidak valid: ${parsed.issues[0] ?? 'unknown'}` });
  }
  return ok(buildStaticSite(parsed.value, { baseUrl: input.baseUrl }));
}

// Suntik <meta name="robots" content="noindex"> ke tiap halaman HTML (pratinjau).
export function withNoindex(files: readonly DeployableFile[]): readonly DeployableFile[] {
  const META = '<meta name="robots" content="noindex">';
  return files.map((f) => {
    if (typeof f.contents !== 'string' || !f.path.endsWith('.html') || f.contents.includes(META)) {
      return f;
    }
    const i = f.contents.search(/<head[^>]*>/i);
    if (i === -1) return { ...f, contents: `${META}\n${f.contents}` };
    const headEnd = f.contents.indexOf('>', i) + 1;
    return { ...f, contents: `${f.contents.slice(0, headEnd)}\n${META}${f.contents.slice(headEnd)}` };
  });
}

export async function publishSite(deps: PublishDeps, input: PublishInput): Promise<Result<PublishResult, PublishError>> {
  const built = await buildFiles(deps, input);
  if (!built.ok) return built;
  const files = input.preview ? withNoindex(built.value) : built.value;

  // Pratinjau tak menyimpan artifact (lihat komentar PublishInput.preview).
  let artifact: ArtifactRef = { key: '', location: '', fileCount: files.length };
  if (!input.preview) {
    const stored = await deps.artifacts.store({ key: artifactKey(input.websiteId, input.revisionNumber), files });
    if (!stored.ok) return stored;
    artifact = stored.value;
  }

  // Pratinjau selalu path-mode di domain utama → tak pernah butuh provisioning subdomain.
  const subErr = input.preview ? null : await ensureSubdomainIfConfigured(deps, input);
  if (subErr) return err(subErr);

  const deployed = await deps.deploy.deploy({ target: { slug: input.slug, docroot: input.docroot }, files });
  if (!deployed.ok) return deployed;

  const verifyErr = await verifyIfRequested(deps, deployed.value.url);
  if (verifyErr) return err(verifyErr);

  return ok({ url: deployed.value.url, artifact, fileCount: deployed.value.fileCount });
}

export async function rollbackSite(deps: PublishDeps, input: RollbackInput): Promise<Result<PublishResult, PublishError>> {
  const key = artifactKey(input.websiteId, input.revisionNumber);
  const retrieved = await deps.artifacts.retrieve(key);
  if (!retrieved.ok) return retrieved;
  if (!retrieved.value) return err({ code: 'NOT_FOUND', message: `artifact revisi tak ditemukan: ${key}` });

  const files = retrieved.value;

  const subErr = await ensureSubdomainIfConfigured(deps, input);
  if (subErr) return err(subErr);

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
