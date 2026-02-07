import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs';

function getS3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET environment variable not set');
  return bucket;
}

export async function uploadFile(
  key: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const client = getS3Client();
  const bucket = getBucket();

  const body = fs.createReadStream(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getPresignedUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const client = getS3Client();
  const bucket = getBucket();

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
}

export async function deleteSessionFiles(sessionId: string): Promise<void> {
  const client = getS3Client();
  const bucket = getBucket();
  const prefix = `sessions/${sessionId}/`;

  const listResult = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    }),
  );

  if (!listResult.Contents || listResult.Contents.length === 0) return;

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: listResult.Contents.map((obj) => ({ Key: obj.Key })),
      },
    }),
  );
}

export function getS3Key(
  sessionId: string,
  filename: string,
): string {
  return `sessions/${sessionId}/${filename}`;
}
