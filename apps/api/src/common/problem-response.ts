import type { ServerResponse } from 'node:http';

import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@mp/contracts';

export function writeProblem(
  res: ServerResponse,
  problem: ProblemDetails,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = problem.status;
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('content-type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`);
  res.end(JSON.stringify(problem));
}
