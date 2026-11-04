import type { ServerResponse } from 'node:http';

import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@mp/contracts';

export function writeProblem(res: ServerResponse, problem: ProblemDetails): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = problem.status;
  res.setHeader('content-type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`);
  res.end(JSON.stringify(problem));
}
