// Adapter: DeployPort ke shared hosting cPanel via SFTP/SSH (T-063, FR-PUB-004/009; SRS §1.3).
// Orkestrasi MURNI di atas interface sempit `SftpDeployClient` (bukan ssh2 langsung) →
// offline-testable dgn fake; kontrak Port identik `LocalFilesystemDeploy`. Deploy bersih
// (mirror ala rsync --delete): upload semua file rilis baru + hapus file lama yang tak ada
// lagi. Klien konkret (ssh2-sftp-client) di ssh2-sftp-client.ts.

import { err, ok } from '@digimaestro/shared';
import type { DeployPort, DeployResult, DeployTarget, DeployableFile, PublishError, Result } from '@digimaestro/shared';

// Interface sempit ke SFTP: hanya operasi yang dipakai adapter. Path remote pakai '/' (POSIX).
export interface SftpDeployClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  // Buat direktori (rekursif); no-op bila sudah ada.
  mkdirp(dir: string): Promise<void>;
  // Tulis isi file ke path remote (parent dir dijamin ada oleh pemanggil).
  writeFile(path: string, contents: string): Promise<void>;
  // Daftar path file (rekursif) relatif terhadap `dir`; [] bila dir belum ada.
  listAllFiles(dir: string): Promise<string[]>;
  deleteFile(path: string): Promise<void>;
}

export interface CpanelSftpDeployOptions {
  // Domain dasar utk URL hasil (mis. 'digimaestro.id' → https://<slug>.digimaestro.id).
  readonly baseDomain: string;
  // Template docroot remote per slug; '{slug}' diganti slug. Default 'public_html/{slug}'.
  readonly docrootTemplate?: string;
}

const DEFAULT_DOCROOT_TEMPLATE = 'public_html/{slug}';

// Gabung segmen path remote dgn '/' (POSIX), buang '/' ganda/ekor.
function joinRemote(...parts: string[]): string {
  return parts
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '' : path.slice(0, i);
}

export class CpanelSftpDeploy implements DeployPort {
  constructor(
    private readonly client: SftpDeployClient,
    private readonly options: CpanelSftpDeployOptions,
  ) {}

  private docrootFor(target: DeployTarget): string {
    if (target.docroot) return target.docroot;
    const template = this.options.docrootTemplate ?? DEFAULT_DOCROOT_TEMPLATE;
    return template.replace('{slug}', target.slug);
  }

  async deploy(input: { readonly target: DeployTarget; readonly files: readonly DeployableFile[] }): Promise<Result<DeployResult, PublishError>> {
    const docroot = this.docrootFor(input.target);
    let connected = false;
    try {
      await this.client.connect();
      connected = true;
      await this.client.mkdirp(docroot);

      // File lama (sebelum rilis) → utk hapus yang menjadi usang (mirror --delete).
      const existing = new Set(await this.client.listAllFiles(docroot));

      // Upload rilis baru; jamin parent dir tiap file.
      const mkdirpDone = new Set<string>();
      for (const file of input.files) {
        const remote = joinRemote(docroot, file.path);
        const dir = parentDir(remote);
        if (dir && !mkdirpDone.has(dir)) {
          await this.client.mkdirp(dir);
          mkdirpDone.add(dir);
        }
        await this.client.writeFile(remote, file.contents);
      }

      // Hapus file lama yang tak ada di rilis baru.
      const fresh = new Set(input.files.map((f) => f.path));
      for (const stale of existing) {
        if (!fresh.has(stale)) {
          await this.client.deleteFile(joinRemote(docroot, stale));
        }
      }

      await this.client.end();
      connected = false;
      return ok({ url: `https://${input.target.slug}.${this.options.baseDomain}`, fileCount: input.files.length });
    } catch (e) {
      if (connected) {
        try {
          await this.client.end();
        } catch {
          // abaikan error saat menutup koneksi pada jalur error.
        }
      }
      return err({ code: 'DEPLOY', message: `gagal deploy SFTP cPanel: ${(e as Error).message}` });
    }
  }
}
