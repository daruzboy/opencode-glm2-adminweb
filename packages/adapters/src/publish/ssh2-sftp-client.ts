// Klien konkret SftpDeployClient di atas ssh2-sftp-client (T-063, FR-PUB-009).
// SATU-SATUNYA file yang mengimpor vendor SDK SFTP (SOLID-D: vendor hanya di adapters).
// CpanelSftpDeploy bergantung pada interface `SftpDeployClient`, bukan file ini → tetap
// offline-testable. Koneksi lazy (dibuka via connect()); auth via password atau private key.

import SftpClient from 'ssh2-sftp-client';
import { Buffer } from 'node:buffer';
import type { SftpDeployClient } from './cpanel-sftp-deploy.js';

export interface Ssh2SftpConfig {
  readonly host: string;
  readonly port?: number;
  readonly username: string;
  readonly password?: string;
  // Isi private key (bukan path). Composition root membaca file key & meneruskannya.
  readonly privateKey?: string | Buffer;
  readonly passphrase?: string;
  // Timeout handshake ms (default 20000).
  readonly readyTimeout?: number;
}

interface SftpEntry {
  readonly name: string;
  readonly type: string; // 'd' dir, '-' file, 'l' symlink
}

async function listRecursive(sftp: SftpClient, base: string, rel = ''): Promise<string[]> {
  const dir = rel ? `${base}/${rel}` : base;
  let entries: SftpEntry[];
  try {
    entries = (await sftp.list(dir)) as unknown as SftpEntry[];
  } catch {
    return []; // dir belum ada
  }
  const out: string[] = [];
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.type === 'd') {
      out.push(...(await listRecursive(sftp, base, childRel)));
    } else {
      out.push(childRel);
    }
  }
  return out;
}

export function createSsh2SftpDeployClient(config: Ssh2SftpConfig): SftpDeployClient {
  const sftp = new SftpClient();
  return {
    async connect() {
      await sftp.connect({
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
        readyTimeout: config.readyTimeout ?? 20_000,
      });
    },
    async end() {
      await sftp.end();
    },
    async mkdirp(dir: string) {
      // recursive=true → no-op bila sudah ada.
      await sftp.mkdir(dir, true);
    },
    async writeFile(path: string, contents: string) {
      await sftp.put(Buffer.from(contents, 'utf8'), path);
    },
    async listAllFiles(dir: string) {
      return listRecursive(sftp, dir);
    },
    async deleteFile(path: string) {
      await sftp.delete(path);
    },
  };
}
