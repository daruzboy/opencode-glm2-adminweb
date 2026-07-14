// Adapter: ArtifactStorePort di object storage S3-compatible (T-063, FR-PUB-009; SRS §8).
// Menyimpan artifact per key sebagai objek `<key>/<file.path>` + `<key>/_manifest.json`
// agar bisa di-retrieve utuh untuk rollback (FR-PUB-005) tanpa build ulang.
//
// Bergantung pada interface sempit `S3ObjectClient` (bukan `@aws-sdk` langsung) → offline-
// testable dengan fake in-memory + kontrak Port sama dgn LocalArtifactStore. Klien konkret
// (@aws-sdk, incl. MinIO self-host) dibuat via `createAwsS3ObjectClient` di aws-s3-client.ts.

import { err, ok } from '@digimaestro/shared';
import type { ArtifactRef, ArtifactStorePort, DeployableFile, PublishError, Result } from '@digimaestro/shared';

// Interface sempit ke object storage: hanya operasi yang dipakai store (put/get by key).
// Bucket terikat di dalam klien; store hanya berurusan dengan key relatif.
export interface S3ObjectClient {
  readonly bucket: string;
  putObject(input: {
    readonly key: string;
    readonly body: string | Uint8Array;
    readonly contentType: string;
  }): Promise<void>;
  // Mengembalikan isi objek sebagai string, atau null bila objek tak ada (NoSuchKey/404).
  // CATATAN (P2): jalur retrieve masih string-only → artifact BINER (aset template mobirise)
  // belum bisa di-rollback lewat store S3; produksi memakai LocalArtifactStore yang sudah
  // biner-utuh. Dilengkapi saat S3 benar-benar dipakai.
  getObject(input: { readonly key: string }): Promise<string | null>;
}

interface ManifestEntry {
  readonly path: string;
  readonly contentType: string;
}

const MANIFEST = '_manifest.json';
const MANIFEST_CONTENT_TYPE = 'application/json; charset=utf-8';

// Gabung key artifact + path file jadi object key (selalu pakai '/' — separator S3, bukan OS).
function objectKey(key: string, path: string): string {
  return `${key}/${path}`;
}

export class S3ArtifactStore implements ArtifactStorePort {
  constructor(private readonly client: S3ObjectClient) {}

  async store(input: { readonly key: string; readonly files: readonly DeployableFile[] }): Promise<Result<ArtifactRef, PublishError>> {
    try {
      for (const file of input.files) {
        await this.client.putObject({
          key: objectKey(input.key, file.path),
          body: file.contents,
          contentType: file.contentType,
        });
      }
      const manifest: ManifestEntry[] = input.files.map((f) => ({ path: f.path, contentType: f.contentType }));
      await this.client.putObject({
        key: objectKey(input.key, MANIFEST),
        body: JSON.stringify(manifest),
        contentType: MANIFEST_CONTENT_TYPE,
      });
      return ok({
        key: input.key,
        location: `s3://${this.client.bucket}/${input.key}`,
        fileCount: input.files.length,
      });
    } catch (e) {
      return err({ code: 'STORE', message: `gagal menyimpan artifact ke S3: ${(e as Error).message}` });
    }
  }

  async retrieve(key: string): Promise<Result<readonly DeployableFile[] | null, PublishError>> {
    let manifest: ManifestEntry[];
    try {
      const raw = await this.client.getObject({ key: objectKey(key, MANIFEST) });
      if (raw === null) return ok(null); // key/artifact tak ada
      manifest = JSON.parse(raw) as ManifestEntry[];
    } catch (e) {
      return err({ code: 'STORE', message: `gagal membaca manifest artifact dari S3: ${(e as Error).message}` });
    }
    try {
      const files: DeployableFile[] = [];
      for (const entry of manifest) {
        const contents = await this.client.getObject({ key: objectKey(key, entry.path) });
        if (contents === null) {
          return err({ code: 'STORE', message: `artifact rusak: objek hilang '${entry.path}' utk key '${key}'` });
        }
        files.push({ path: entry.path, contents, contentType: entry.contentType });
      }
      return ok(files);
    } catch (e) {
      return err({ code: 'STORE', message: `gagal membaca artifact dari S3: ${(e as Error).message}` });
    }
  }
}
