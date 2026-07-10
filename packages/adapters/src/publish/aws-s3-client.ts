// Klien konkret S3ObjectClient di atas @aws-sdk/client-s3 (T-063, FR-PUB-009).
// SATU-SATUNYA file yang mengimpor vendor SDK S3 (SOLID-D: vendor hanya di adapters).
// Mendukung S3 asli maupun MinIO self-host (ADR-8, residensi data di VPS) via `endpoint`
// + `forcePathStyle` (MinIO butuh path-style). S3ArtifactStore bergantung pada interface,
// bukan file ini → tetap offline-testable.

import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3ObjectClient } from './s3-artifact-store.js';

export interface AwsS3ClientConfig {
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  // MinIO self-host: 'http://minio:9000'. Kosong = endpoint AWS default per region.
  readonly endpoint?: string;
  // Default 'us-east-1' (MinIO abaikan region, tetap wajib diisi SDK).
  readonly region?: string;
  // MinIO wajib true (path-style: <endpoint>/<bucket>/<key>). AWS S3 boleh false.
  readonly forcePathStyle?: boolean;
}

// True bila error menandakan objek tak ada (NoSuchKey / HTTP 404) → getObject balas null.
function isNotFound(e: unknown): boolean {
  if (e instanceof NoSuchKey) return true;
  const meta = (e as { $metadata?: { httpStatusCode?: number }; name?: string });
  return meta?.name === 'NoSuchKey' || meta?.$metadata?.httpStatusCode === 404;
}

// Bangun S3ObjectClient siap-pakai. `endpoint`+`forcePathStyle` mengarahkan ke MinIO self-host.
export function createAwsS3ObjectClient(config: AwsS3ClientConfig): S3ObjectClient {
  const s3 = new S3Client({
    region: config.region ?? 'us-east-1',
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    bucket: config.bucket,
    async putObject(input) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    },
    async getObject(input) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: input.key }));
        if (!res.Body) return null;
        return await res.Body.transformToString('utf-8');
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
  };
}
