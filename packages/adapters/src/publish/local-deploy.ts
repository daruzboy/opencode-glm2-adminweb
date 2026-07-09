// Adapter: DeployPort ke docroot filesystem lokal (T-063, dev/staging) — analog rsync ke
// shared hosting (FR-PUB-004). Menulis file ke <docrootBase>/<slug>/ (atau target.docroot).
// Ganti dgn adapter rsync/SSH cPanel (ssh2) untuk produksi — kontrak Port sama (FR-PUB-009).

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, ok } from '@digimaestro/shared';
import type { DeployPort, DeployResult, DeployTarget, DeployableFile, PublishError, Result } from '@digimaestro/shared';

export interface LocalDeployOptions {
  readonly docrootBase: string;
  // Domain dasar utk URL hasil (mis. 'digimaestro.id' → https://<slug>.digimaestro.id).
  readonly baseDomain: string;
}

export class LocalFilesystemDeploy implements DeployPort {
  constructor(private readonly options: LocalDeployOptions) {}

  async deploy(input: { readonly target: DeployTarget; readonly files: readonly DeployableFile[] }): Promise<Result<DeployResult, PublishError>> {
    const docroot = input.target.docroot ?? join(this.options.docrootBase, input.target.slug);
    try {
      // Deploy bersih: ganti isi docroot (rsync --delete analog) agar file lama tak tertinggal.
      await rm(docroot, { recursive: true, force: true });
      for (const file of input.files) {
        const target = join(docroot, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.contents, 'utf8');
      }
      const url = `https://${input.target.slug}.${this.options.baseDomain}`;
      return ok({ url, fileCount: input.files.length });
    } catch (e) {
      return err({ code: 'DEPLOY', message: `gagal deploy ke docroot: ${(e as Error).message}` });
    }
  }
}
