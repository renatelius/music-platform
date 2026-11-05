import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { ApiClient, ApiRequestError, NetworkError, type RefreshTokenStore } from './index.js';

// A real HTTP server (not a mocked fetch) that behaves like the ReMusic API for the tested paths.
type Handler = (req: IncomingMessage, body: unknown, res: ServerResponse) => void;

let server: Server | undefined;

async function serve(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      handler(req, raw === '' ? undefined : (JSON.parse(raw) as unknown), res);
    });
  });
  const started = server;
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((started.address() as AddressInfo).port)}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
  server = undefined;
});

const user = {
  id: randomUUID(),
  email: 'a@b.test',
  displayName: 'Ann',
  locale: 'en',
  emailVerified: false,
  createdAt: new Date().toISOString(),
};

function auth(accessToken: string, refreshToken?: string) {
  return {
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user,
  };
}

function json(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader('content-type', status >= 400 ? 'application/problem+json' : 'application/json');
  res.end(JSON.stringify(body));
}

const problem = (status: number, code: string) => ({
  type: '/problems/x',
  title: 'x',
  status,
  code,
});

describe('ApiClient', () => {
  it('deduplicates concurrent refreshes into one request', async () => {
    let calls = 0;
    const url = await serve((req, _body, res) => {
      if (req.url === '/auth/refresh') {
        calls++;
        setTimeout(() => {
          json(res, 200, auth('a1'));
        }, 50);
      }
    });
    const client = new ApiClient({ baseUrl: url });
    const [a, b] = await Promise.all([client.restore(), client.restore()]);
    expect(calls).toBe(1);
    expect(a?.accessToken).toBe('a1');
    expect(b).toBe(a);
  });

  it('resolves to null and notifies listeners when signed out', async () => {
    const url = await serve((_req, _body, res) => {
      json(res, 401, problem(401, 'UNAUTHENTICATED'));
    });
    const client = new ApiClient({ baseUrl: url });
    const events: unknown[] = [];
    client.subscribe((s) => events.push(s));
    expect(await client.restore()).toBeNull();
    expect(events).toEqual([null]);
  });

  it('refreshes and retries once when the access token is rejected', async () => {
    let refreshes = 0;
    const url = await serve((req, _body, res) => {
      if (req.url === '/auth/login') json(res, 200, auth('old'));
      else if (req.url === '/auth/refresh') {
        refreshes++;
        json(res, 200, auth('new'));
      } else if (req.url === '/me') {
        if (req.headers.authorization === 'Bearer new')
          json(res, 200, { ...user, displayName: 'Fresh' });
        else json(res, 401, problem(401, 'UNAUTHENTICATED'));
      }
    });
    const client = new ApiClient({ baseUrl: url });
    await client.login({ email: 'a@b.test', password: 'secret-value' });
    const me = await client.me();
    expect(refreshes).toBe(1);
    expect(me.displayName).toBe('Fresh');
    expect(client.currentSession?.user.displayName).toBe('Fresh');
  });

  it('retries a refresh that raced with another tab (409)', async () => {
    let calls = 0;
    const url = await serve((_req, _body, res) => {
      calls++;
      if (calls === 1) json(res, 409, problem(409, 'CONFLICT'));
      else json(res, 200, auth('after-race'));
    });
    const client = new ApiClient({ baseUrl: url, retryDelayMs: 1 });
    expect((await client.restore())?.accessToken).toBe('after-race');
    expect(calls).toBe(2);
  });

  it('native mode sends and stores the refresh token itself', async () => {
    const seen: unknown[] = [];
    const url = await serve((req, body, res) => {
      expect(req.headers['x-client-type']).toBe('native');
      seen.push(body);
      json(res, 200, auth('a', 'rt-2'));
    });
    let stored: string | null = 'rt-1';
    const store: RefreshTokenStore = {
      get: () => Promise.resolve(stored),
      set: (token) => {
        stored = token;
        return Promise.resolve();
      },
    };
    const client = new ApiClient({ baseUrl: url, refreshTokenStore: store });
    await client.restore();
    expect(seen).toEqual([{ refreshToken: 'rt-1' }]);
    expect(stored).toBe('rt-2');
  });

  it('turns problem responses into typed errors', async () => {
    const url = await serve((_req, _body, res) => {
      json(res, 401, { ...problem(401, 'UNAUTHENTICATED'), detail: 'Invalid email or password.' });
    });
    const client = new ApiClient({ baseUrl: url });
    const error = await client
      .login({ email: 'a@b.test', password: 'wrong-value' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe('UNAUTHENTICATED');
    expect((error as ApiRequestError).message).toBe('Invalid email or password.');
  });

  it('reports network failures and still signs out locally', async () => {
    const url = await serve((_req, _body, res) => {
      json(res, 200, auth('a'));
    });
    const client = new ApiClient({ baseUrl: url });
    await client.login({ email: 'a@b.test', password: 'secret-value' });
    await new Promise<void>((resolve) => {
      server?.close(() => {
        resolve();
      });
      server?.closeAllConnections();
    });
    server = undefined;
    await expect(client.me()).rejects.toBeInstanceOf(NetworkError);
    await expect(client.forgotPassword('a@b.test')).rejects.toBeInstanceOf(NetworkError);
    await client.logout();
    expect(client.currentSession).toBeNull();
  });

  it('calls the catalog with the access token and an encoded query', async () => {
    const seen: { url: string | undefined; authorization: string | undefined }[] = [];
    const id = randomUUID();
    const url = await serve((req, _body, res) => {
      if (req.url === '/auth/refresh') {
        json(res, 200, auth('a1'));
        return;
      }
      seen.push({ url: req.url, authorization: req.headers.authorization });
      if (req.url?.startsWith('/catalog/search/suggest') === true) {
        json(res, 200, { query: 'x', items: [] });
      } else if (req.url?.startsWith('/catalog/search') === true) {
        json(res, 200, { query: 'x', tracks: [], releases: [], artists: [] });
      } else {
        json(res, 404, problem(404, 'NOT_FOUND'));
      }
    });
    const client = new ApiClient({ baseUrl: url });
    await client.restore();
    await client.search('kai & engel', 5);
    await client.suggest('ё?');
    const missing = await client.release(id).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ApiRequestError);
    expect((missing as ApiRequestError).status).toBe(404);
    expect(seen).toEqual([
      { url: '/catalog/search?q=kai+%26+engel&limit=5', authorization: 'Bearer a1' },
      { url: '/catalog/search/suggest?q=%D1%91%3F', authorization: 'Bearer a1' },
      { url: `/catalog/releases/${id}`, authorization: 'Bearer a1' },
    ]);
  });

  it('resolves media paths against the base URL', () => {
    expect(new ApiClient({ baseUrl: '/api/' }).mediaUrl('/media/a.b')).toBe('/api/media/a.b');
    expect(new ApiClient({ baseUrl: 'https://api.example' }).mediaUrl('/media/a.b')).toBe(
      'https://api.example/media/a.b',
    );
  });
});
