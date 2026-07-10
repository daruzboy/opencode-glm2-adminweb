// Adapter: DeployPort ke shared hosting cPanel via SFTP/SSH (T-063, FR-PUB-004/009; SRS §1.3).
// Orkestrasi deploy bersama di remote-deploy.ts (upload + clean-delete), MURNI atas interface
// sempit `RemoteDeployClient` → offline-testable. Klien konkret (ssh2-sftp-client) di
// ssh2-sftp-client.ts. Untuk host tanpa SSH (mis. shared hosting FTP-only) lihat CpanelFtpDeploy.

import type { DeployPort, DeployResult, DeployTarget, DeployableFile, PublishError, Result } from '@digimaestro/shared';
import { deployToRemote, type RemoteDeployClient, type RemoteDeployOptions } from './remote-deploy.js';

// Interface klien SFTP = interface remote generik (alias, back-compat).
export type SftpDeployClient = RemoteDeployClient;
export type CpanelSftpDeployOptions = RemoteDeployOptions;

export class CpanelSftpDeploy implements DeployPort {
  constructor(
    private readonly client: SftpDeployClient,
    private readonly options: CpanelSftpDeployOptions,
  ) {}

  deploy(input: { readonly target: DeployTarget; readonly files: readonly DeployableFile[] }): Promise<Result<DeployResult, PublishError>> {
    return deployToRemote(this.client, input, this.options);
  }
}
