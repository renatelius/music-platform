import type { ServerResponse } from 'node:http';

import { Controller, Get, Inject, Res } from '@nestjs/common';

import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../infra/tokens.js';
import { buildOpenApi, OPERATIONS } from './openapi.js';

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const METHOD_COLOR: Readonly<Record<string, string>> = {
  get: '#2e7d32',
  post: '#1565c0',
  patch: '#8e24aa',
  delete: '#c62828',
};

/** The page has no scripts and no external resources: a strict CSP of its own. */
const DOCS_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function renderDocs(document: Record<string, unknown>, version: string): string {
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  const sections = OPERATIONS.map((op) => {
    const operation = paths[op.path]?.[op.method] ?? {};
    const json = escape(JSON.stringify(operation, null, 2));
    return `<details><summary><b style="color:${METHOD_COLOR[op.method] ?? '#000'}">${op.method.toUpperCase()}</b> <code>${escape(op.path)}</code> ${op.auth ? '🔒 ' : ''}${escape(op.summary)}</summary><pre>${json}</pre></details>`;
  }).join('\n');
  const title = escape(`ReMusic API ${version}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1d1d1f}
details{border:1px solid #ddd;border-radius:8px;margin:.4rem 0;padding:.4rem .8rem}summary{cursor:pointer}
pre{background:#f6f6f8;padding:.8rem;border-radius:6px;overflow:auto;font-size:12px}code{font-size:14px}</style></head>
<body><h1>${title}</h1><p>OpenAPI 3.1: <a href="openapi.json">openapi.json</a> (generated from <code>@mp/contracts</code>). 🔒 = <code>Authorization: Bearer &lt;access token&gt;</code>. Errors: RFC 9457 Problem Details.</p>
${sections}</body></html>`;
}

/** API description, outside production by default (API_DOCS). Registered only when enabled. */
@Controller()
export class DocsController {
  private readonly document: Record<string, unknown>;
  private readonly html: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.document = buildOpenApi(config.version);
    this.html = renderDocs(this.document, config.version);
  }

  @Get('openapi.json')
  openapi(): Record<string, unknown> {
    return this.document;
  }

  @Get('docs')
  docs(@Res() res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-security-policy', DOCS_CSP);
    res.end(this.html);
  }
}
