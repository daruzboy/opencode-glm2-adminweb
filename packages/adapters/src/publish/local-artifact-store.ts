// Adapter: ArtifactStorePort di filesystem lokal (T-063, dev/staging).
// Menyimpan artifact per key di <rootDir>/<key>/ + `_manifest.json` (daftar path+contentType)
// agar bisa di-retrieve utuh untuk rollback (FR-PUB-005). Ganti dgn adapter S3-compatible
// (@aws-sdk) untuk produksi — kontrak Port sama, pipeline tak berubah.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, ok } from '@digimaestro/shared';
import type { ArtifactRef, ArtifactStorePort, DeployableFile, PublishError, Result } from '@digimaestro/shared';

interface ManifestEntry {
  readonly path: string;
  readonly contentType: string;
}

const MANIFEST = '_manifest.json';

export class LocalArtifactStore implements ArtifactStorePort {
  constructor(private readonly rootDir: string) {}

  async store(input: { readonly key: string; readonly files: readonly DeployableFile[] }): Promise<Result<ArtifactRef, PublishError>> {
    const base = join(this.rootDir, input.key);
    try {
      for (const file of input.files) {
        const target = join(base, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.contents, 'utf8');
      }
      const manifest: ManifestEntry[] = input.files.map((f) => ({ path: f.path, contentType: f.contentType }));
      await mkdir(base, { recursive: true });
      await writeFile(join(base, MANIFEST), JSON.stringify(manifest), 'utf8');
      return ok({ key: input.key, location: base, fileCount: input.files.length });
    } catch (e) {
      return err({ code: 'STORE', message: `gagal menyimpan artifact: ${(e as Error).message}` });
    }
  }

  async retrieve(key: string): Promise<Result<readonly DeployableFile[] | null, PublishError>> {
    const base = join(this.rootDir, key);
    let manifest: ManifestEntry[];
    try {
      manifest = JSON.parse(await readFile(join(base, MANIFEST), 'utf8')) as ManifestEntry[];
    } catch {
      return ok(null); // key/artifact tak ada
    }
    try {
      const files: DeployableFile[] = [];
      for (const entry of manifest) {
        const contents = await readFile(join(base, entry.path), 'utf8');
        files.push({ path: entry.path, contents, contentType: entry.contentType });
      }
      return ok(files);
    } catch (e) {
      return err({ code: 'STORE', message: `gagal membaca artifact: ${(e as Error).message}` });
    }
  }
}
