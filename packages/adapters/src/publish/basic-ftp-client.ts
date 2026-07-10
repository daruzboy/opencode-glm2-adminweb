// Klien konkret RemoteDeployClient di atas basic-ftp (T-063, FR-PUB-009; SRS §1.3 fallback FTP).
// SATU-SATUNYA file yang mengimpor vendor SDK FTP (SOLID-D: vendor hanya di adapters).
// Default FTPS eksplisit (AUTH TLS di port kontrol) → kredensial & data terenkripsi. Semua
// operasi memakai path ABSOLUT (home + relatif) agar bebas dari perubahan CWD basic-ftp.

import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { Client as FtpClient } from 'basic-ftp';
import type { RemoteDeployClient } from './remote-deploy.js';

export interface BasicFtpConfig {
  readonly host: string;
  readonly port?: number;
  readonly user: string;
  readonly password: string;
  // Default true = FTPS eksplisit (AUTH TLS). false = FTP polos (tak disarankan).
  readonly secure?: boolean;
  // Verifikasi sertifikat TLS. Shared hosting via IP kerap mismatch CN → set false bila perlu.
  readonly rejectUnauthorized?: boolean;
  readonly timeoutMs?: number;
}

interface FtpEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

async function listRecursive(client: FtpClient, base: string, rel = ''): Promise<string[]> {
  const dir = rel ? `${base}/${rel}` : base;
  let entries: FtpEntry[];
  try {
    entries = (await client.list(dir)) as unknown as FtpEntry[];
  } catch {
    return []; // dir belum ada
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      out.push(...(await listRecursive(client, base, childRel)));
    } else {
      out.push(childRel);
    }
  }
  return out;
}

export function createBasicFtpDeployClient(config: BasicFtpConfig): RemoteDeployClient {
  const client = new FtpClient(config.timeoutMs ?? 20_000);
  let home = '';
  const abs = (p: string): string => (p.startsWith('/') ? p : `${home}/${p}`.replace(/\/+/g, '/'));

  return {
    async connect() {
      await client.access({
        host: config.host,
        port: config.port ?? 21,
        user: config.user,
        password: config.password,
        secure: config.secure ?? true,
        secureOptions: { rejectUnauthorized: config.rejectUnauthorized ?? true },
      });
      home = await client.pwd(); // direktori home absolut sebagai basis path
    },
    async end() {
      client.close();
    },
    async mkdirp(dir: string) {
      // ensureDir membuat semua segmen; ia mengubah CWD → kembalikan ke home.
      await client.ensureDir(abs(dir));
      await client.cd(home);
    },
    async writeFile(path: string, contents: string) {
      await client.uploadFrom(Readable.from(Buffer.from(contents, 'utf8')), abs(path));
    },
    async listAllFiles(dir: string) {
      return listRecursive(client, abs(dir));
    },
    async deleteFile(path: string) {
      await client.remove(abs(path));
    },
    async removeDir(dir: string) {
      // removeDir menghapus direktori beserta seluruh isinya (rekursif).
      await client.removeDir(abs(dir));
    },
  };
}
