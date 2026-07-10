// Port: publish pipeline (T-063, FR-PUB-004/005/009; SRS §8/§9.1).
// Build statis → simpan artifact (object storage) → deploy (shared hosting via DeployPort).
// Adapter konkret di packages/adapters: lokal-FS (dev/staging) sekarang; S3 + rsync/SSH
// cPanel menyusul (butuh kredensial EPIC-00). Menambah target deploy = adapter baru,
// pipeline tak berubah (FR-PUB-009, open/closed).

import type { Result } from '../index.js';

// File statis siap-deploy (kompatibel struktural dgn StaticFile sites-kit).
export interface DeployableFile {
  readonly path: string;
  readonly contents: string;
  readonly contentType: string;
}

export type PublishErrorCode = 'BUILD' | 'STORE' | 'DEPLOY' | 'VERIFY' | 'NOT_FOUND' | 'SUBDOMAIN' | 'QUEUE';

export interface PublishError {
  readonly code: PublishErrorCode;
  readonly message: string;
}

// Referensi artifact tersimpan (untuk rollback tanpa build ulang — FR-PUB-005).
export interface ArtifactRef {
  readonly key: string;
  readonly location: string;
  readonly fileCount: number;
}

export interface ArtifactStorePort {
  store(input: { readonly key: string; readonly files: readonly DeployableFile[] }): Promise<Result<ArtifactRef, PublishError>>;
  // Ambil kembali artifact tersimpan (rollback = redeploy). null bila key tak ada.
  retrieve(key: string): Promise<Result<readonly DeployableFile[] | null, PublishError>>;
}

// Target deploy per tenant (FR-PUB-009). docroot opsional (default per adapter).
export interface DeployTarget {
  readonly slug: string;
  readonly docroot?: string;
}

export interface DeployResult {
  readonly url: string;
  readonly fileCount: number;
}

export interface DeployPort {
  deploy(input: { readonly target: DeployTarget; readonly files: readonly DeployableFile[] }): Promise<Result<DeployResult, PublishError>>;
}

// Provisioning subdomain shared hosting (FR-PUB-004b): buat `<slug>.<rootDomain>` sebelum
// deploy. Adapter cPanel UAPI di packages/adapters. Idempoten: subdomain sudah ada = ok.
export interface SubdomainProvision {
  readonly slug: string; // mis. 'toko' → subdomain toko.<rootDomain>
  readonly rootDomain: string; // mis. 'digimaestro.id' (harus domain di akun cPanel)
  readonly docroot: string; // docroot subdomain (mis. 'public_html/toko')
}

export interface SubdomainResult {
  readonly subdomain: string; // FQDN penuh, mis. 'toko.digimaestro.id'
  readonly created: boolean; // false bila sudah ada sebelumnya (idempoten)
}

export interface SubdomainPort {
  ensureSubdomain(input: SubdomainProvision): Promise<Result<SubdomainResult, PublishError>>;
}
