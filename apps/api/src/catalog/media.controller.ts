import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';

import { ApiError } from '../common/api-error.js';
import type { HttpRequest } from '../common/request-context.js';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG, S3 } from '../infra/tokens.js';
import { isNotFound } from '../worker/storage.js';
import { MediaTokens, parseRange } from './media-token.js';

/**
 * Media files by signed link (ADR-019): GET with Range, as <audio> and fetch() expect.
 * No session check here: the link was issued to a signed-in user and expires.
 */
@Controller('media')
export class MediaController {
  constructor(
    @Inject(S3) private readonly s3: S3Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MediaTokens) private readonly tokens: MediaTokens,
  ) {}

  @Get(':token')
  async media(
    @Param('token') token: string,
    @Req() req: HttpRequest,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const grant = this.tokens.verify(token);
    if (grant === null) {
      throw new ApiError('FORBIDDEN', { detail: 'The media link is invalid or has expired.' });
    }
    const size = grant.sizeBytes;
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.statusCode = 416;
      res.setHeader('content-range', `bytes */${String(size)}`);
      res.end();
      return;
    }

    let body: unknown;
    try {
      const object = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.s3.buckets.media,
          Key: grant.key,
          ...(range === null ? {} : { Range: `bytes=${String(range.start)}-${String(range.end)}` }),
        }),
      );
      body = object.Body;
    } catch (error) {
      if (isNotFound(error)) throw new ApiError('NOT_FOUND', { detail: 'Media not found.' });
      throw error;
    }
    if (!(body instanceof Readable)) throw new Error('S3 returned no stream');

    const maxAge = Math.max(0, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000));
    res.statusCode = range === null ? 200 : 206;
    res.setHeader('content-type', grant.contentType);
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-length', String(range === null ? size : range.end - range.start + 1));
    if (range !== null) {
      res.setHeader(
        'content-range',
        `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
      );
    }
    // The link is personal and expires: browsers may keep it, shared caches must not.
    res.setHeader('cache-control', `private, max-age=${String(maxAge)}`);
    try {
      await pipeline(body, res);
    } catch {
      // The player went away (seek, skip, closed tab): nothing to answer any more.
      body.destroy();
    }
  }
}
