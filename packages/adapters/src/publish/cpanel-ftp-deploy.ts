// Adapter: DeployPort ke shared hosting cPanel via FTP/FTPS (T-063, FR-PUB-004/009; SRS §1.3
// "fallback FTP"). Untuk host yang tak mengekspos SSH/SFTP (mis. paket shared FTP-only).
// Orkestrasi deploy bersama di remote-deploy.ts (upload + clean-delete), MURNI atas interface
// sempit `RemoteDeployClient` → offline-testable. Klien konkret (basic-ftp) di basic-ftp-client.ts.

import type { DeployPort, DeployResult, DeployTarget, DeployableFile, PublishError, Result } from '@digimaestro/shared';
import { deployToRemote, type RemoteDeployClient, type RemoteDeployOptions } from './remote-deploy.js';

export type FtpDeployClient = RemoteDeployClient;
export type CpanelFtpDeployOptions = RemoteDeployOptions;

export class CpanelFtpDeploy implements DeployPort {
  constructor(
    private readonly client: FtpDeployClient,
    private readonly options: CpanelFtpDeployOptions,
  ) {}

  deploy(input: { readonly target: DeployTarget; readonly files: readonly DeployableFile[] }): Promise<Result<DeployResult, PublishError>> {
    return deployToRemote(this.client, input, this.options);
  }
}
