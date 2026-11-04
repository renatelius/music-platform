import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';

export function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? error.name : undefined;
  if (name === 'NotFound' || name === 'NoSuchKey') return true;
  const meta = '$metadata' in error ? error.$metadata : undefined;
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'httpStatusCode' in meta &&
    meta.httpStatusCode === 404
  );
}

/** Streams a local file to S3 and returns its size. */
export async function uploadFile(
  s3: S3Client,
  bucket: string,
  key: string,
  file: string,
  contentType: string,
): Promise<number> {
  const { size } = await stat(file);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: contentType,
    }),
  );
  return size;
}

export async function downloadFile(
  s3: S3Client,
  bucket: string,
  key: string,
  file: string,
): Promise<void> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body: unknown = response.Body;
  if (!(body instanceof Readable)) throw new Error(`S3 returned no stream for ${key}`);
  await pipeline(body, createWriteStream(file));
}

/** Size of an object, or null when it does not exist. */
export async function objectSize(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<number | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Deletes every object under a prefix (tests and the setup smoke test clean up with it). */
export async function deletePrefix(s3: S3Client, bucket: string, prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    const keys = (page.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => key !== undefined);
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      deleted += keys.length;
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return deleted;
}
