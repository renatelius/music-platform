import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LoggerService } from '@nestjs/common';

import { getRequestId, type HttpRequest, type NextFn, pathOnly } from './request-context.js';

/** One structured line per request: method, path (no query), status, duration, request id. */
export function requestLogMiddleware(logger: LoggerService) {
  return (req: IncomingMessage, res: ServerResponse, next: NextFn): void => {
    const started = performance.now();
    res.on('finish', () => {
      const request = req as HttpRequest;
      const ms = Math.round(performance.now() - started);
      logger.log(
        `${req.method ?? 'GET'} ${pathOnly(request.originalUrl ?? request.url)} ${String(res.statusCode)} ${String(ms)}ms`,
        { requestId: getRequestId(req) },
      );
    });
    next();
  };
}
