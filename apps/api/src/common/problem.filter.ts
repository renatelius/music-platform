import type { ServerResponse } from 'node:http';
import { inspect } from 'node:util';

import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';

import { toProblem } from './problem-mapping.js';
import { writeProblem } from './problem-response.js';
import { getRequestId, type HttpRequest, pathOnly } from './request-context.js';

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<HttpRequest>();
    const res = http.getResponse<ServerResponse>();
    const problem = toProblem(exception, {
      requestId: getRequestId(req),
      instance: pathOnly(req.originalUrl ?? req.url),
    });
    if (problem.status >= 500) {
      this.logger.error(
        `Unhandled error on ${req.method ?? 'GET'} ${problem.instance ?? '/'}`,
        exception instanceof Error ? exception.stack : inspect(exception),
        { requestId: problem.requestId },
      );
    }
    writeProblem(res, problem);
  }
}
