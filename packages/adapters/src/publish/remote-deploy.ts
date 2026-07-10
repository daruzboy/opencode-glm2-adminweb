// Orkestrasi deploy remote bersama (T-063, FR-PUB-004/009) — dipakai adapter SFTP & FTP.
// MURNI atas interface sempit `RemoteDeployClient` (bukan vendor) → offline-testable.
// Deploy bersih ala rsync --delete: upload rilis baru + hapus file usang (incl. nested).

import { err, ok } from '@digimaestro/shared';
import type { DeployResult, DeployTarget, DeployableFile, PublishError, Result } from '@digimaestro/shared';

// Interface sempit ke transport remote (SFTP/FTP). Path remote pakai '/' (POSIX).
export interface RemoteDeployClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  // Buat direktori (rekursif); no-op bila sudah ada.
  mkdirp(dir: string): Promise<void>;
  // Tulis isi file ke path remote (parent dir dijamin ada oleh pemanggil).
  writeFile(path: string, contents: string): Promise<void>;
  // Daftar path file (rekursif) relatif terhadap `dir`; [] bila dir belum ada.
  listAllFiles(dir: string): Promise<string[]>;
  deleteFile(path: string): Promise<void>;
  // Hapus direktori beserta isinya (rekursif); no-op bila tak ada.
  removeDir(dir: string): Promise<void>;
}

export interface RemoteDeployOptions {
  // Domain dasar utk URL hasil (mis. 'digimaestro.id' → https://<slug>.digimaestro.id).
  readonly baseDomain: string;
  // Template docroot remote per slug; '{slug}' diganti slug. Default 'public_html/{slug}'.
  readonly docrootTemplate?: string;
}

const DEFAULT_DOCROOT_TEMPLATE = 'public_html/{slug}';

// Gabung segmen path remote dgn '/' (POSIX), buang '/' ganda/ekor.
export function joinRemote(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '' : path.slice(0, i);
}

export function resolveDocroot(target: DeployTarget, docrootTemplate?: string): string {
  if (target.docroot) return target.docroot;
  return (docrootTemplate ?? DEFAULT_DOCROOT_TEMPLATE).replace('{slug}', target.slug);
}

export async function deployToRemote(
  client: RemoteDeployClient,
  input: { readonly target: DeployTarget; readonly files: readonly DeployableFile[] },
  options: RemoteDeployOptions,
): Promise<Result<DeployResult, PublishError>> {
  const docroot = resolveDocroot(input.target, options.docrootTemplate);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.mkdirp(docroot);

    // File lama (sebelum rilis) → utk hapus yang menjadi usang (mirror --delete).
    const existing = new Set(await client.listAllFiles(docroot));

    // Upload rilis baru; jamin parent dir tiap file.
    const mkdirpDone = new Set<string>();
    for (const file of input.files) {
      const remote = joinRemote(docroot, file.path);
      const dir = parentDir(remote);
      if (dir && !mkdirpDone.has(dir)) {
        await client.mkdirp(dir);
        mkdirpDone.add(dir);
      }
      await client.writeFile(remote, file.contents);
    }

    // Hapus file lama yang tak ada di rilis baru.
    const fresh = new Set(input.files.map((f) => f.path));
    for (const stale of existing) {
      if (!fresh.has(stale)) {
        await client.deleteFile(joinRemote(docroot, stale));
      }
    }

    // Hapus direktori yang menjadi usang (tak lagi menampung file rilis baru) — mirror penuh.
    const freshDirs = new Set<string>();
    for (const file of input.files) {
      for (let d = parentDir(file.path); d; d = parentDir(d)) freshDirs.add(d);
    }
    const staleDirs = new Set<string>();
    for (const stale of existing) {
      if (fresh.has(stale)) continue;
      for (let d = parentDir(stale); d; d = parentDir(d)) {
        if (!freshDirs.has(d)) staleDirs.add(d);
      }
    }
    // Terdalam dulu agar induk kosong setelah anak terhapus (removeDir rekursif juga aman).
    for (const dir of [...staleDirs].sort((a, b) => b.length - a.length)) {
      await client.removeDir(joinRemote(docroot, dir));
    }

    await client.end();
    connected = false;
    return ok({ url: `https://${input.target.slug}.${options.baseDomain}`, fileCount: input.files.length });
  } catch (e) {
    if (connected) {
      try {
        await client.end();
      } catch {
        // abaikan error saat menutup koneksi pada jalur error.
      }
    }
    return err({ code: 'DEPLOY', message: `gagal deploy remote: ${(e as Error).message}` });
  }
}
