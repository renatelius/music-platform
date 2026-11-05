// OpenAPI 3.1 description of the API, built from the zod contracts (ADR-018).
// Every route of the API is listed here; test/docs.test.ts fails when one is missing.
import {
  AddPlaylistItemsRequest,
  AddPlaylistItemsResult,
  ArtistDetail,
  AuthResponse,
  CatalogHome,
  CreatePlaylistRequest,
  EmailTokenRequest,
  FollowedArtistsPage,
  ForgotPasswordRequest,
  HealthResponse,
  Id,
  LibraryChange,
  LibraryContains,
  LibraryContainsRequest,
  LikedTracksPage,
  LoginRequest,
  MovePlaylistItemRequest,
  PageQuery,
  PlaylistItemsPage,
  PlaylistItemsQuery,
  PlaylistList,
  PlaylistMutation,
  PlaylistSummary,
  ProblemDetails,
  RefreshRequest,
  RegisterRequest,
  ReleaseDetail,
  ResetPasswordRequest,
  SavedReleasesPage,
  SearchQuery,
  SearchResults,
  SessionList,
  SuggestQuery,
  SuggestResults,
  TrackDto,
  TrackStream,
  UpdatePlaylistRequest,
  UpdateProfileRequest,
  UserDto,
} from '@mp/contracts';
import { z } from 'zod';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Operation {
  readonly method: Method;
  /** OpenAPI path template, e.g. /catalog/releases/{id}. */
  readonly path: string;
  readonly tag: string;
  readonly summary: string;
  readonly auth: boolean;
  readonly body?: z.ZodType;
  readonly query?: z.ZodObject;
  readonly params?: Readonly<Record<string, z.ZodType>>;
  /** Success responses; error responses are added from the shape of the operation. */
  readonly responses: Readonly<Record<number, { description: string; schema?: z.ZodType }>>;
}

const LiveResponse = z.object({ status: z.literal('ok') });
const idParam = { id: Id };
const itemParams = { id: Id, itemId: Id };
const IDEMPOTENT = ' Send an `Idempotency-Key` (uuid) header to retry safely.';
const savedKinds = [
  {
    path: 'tracks',
    what: 'track',
    verb: 'Like',
    done: 'Liked',
    undo: 'Unlike',
    page: LikedTracksPage,
  },
  {
    path: 'releases',
    what: 'release',
    verb: 'Save',
    done: 'Saved',
    undo: 'Unsave',
    page: SavedReleasesPage,
  },
  {
    path: 'artists',
    what: 'artist',
    verb: 'Follow',
    done: 'Followed',
    undo: 'Unfollow',
    page: FollowedArtistsPage,
  },
] as const;

const LIBRARY_OPERATIONS: Operation[] = savedKinds.flatMap((kind): Operation[] => [
  {
    method: 'get',
    path: `/library/${kind.path}`,
    tag: 'library',
    summary: `${kind.done} ${kind.what}s, newest first (unavailable ones stay, marked)`,
    auth: true,
    query: PageQuery,
    responses: { 200: { description: 'Page', schema: kind.page } },
  },
  {
    method: 'put',
    path: `/library/${kind.path}/{id}`,
    tag: 'library',
    summary: `${kind.verb} a ${kind.what} (repeating it changes nothing)`,
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Library version', schema: LibraryChange } },
  },
  {
    method: 'delete',
    path: `/library/${kind.path}/{id}`,
    tag: 'library',
    summary: `${kind.undo} a ${kind.what}`,
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Library version', schema: LibraryChange } },
  },
]);
const tokenParam = { token: z.string().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/) };

export const OPERATIONS: readonly Operation[] = [
  {
    method: 'get',
    path: '/health',
    tag: 'health',
    summary: 'Readiness: PostgreSQL, Redis and S3 (503 when a critical one is down)',
    auth: false,
    responses: {
      200: { description: 'ok or degraded', schema: HealthResponse },
      503: { description: 'down', schema: HealthResponse },
    },
  },
  {
    method: 'get',
    path: '/health/live',
    tag: 'health',
    summary: 'Liveness: the process is up',
    auth: false,
    responses: { 200: { description: 'ok', schema: LiveResponse } },
  },
  {
    method: 'post',
    path: '/auth/register',
    tag: 'auth',
    summary: 'Create an account and sign in; a confirmation email is sent',
    auth: false,
    body: RegisterRequest,
    responses: {
      201: { description: 'Signed in', schema: AuthResponse },
      409: { description: 'Email already registered', schema: ProblemDetails },
    },
  },
  {
    method: 'post',
    path: '/auth/login',
    tag: 'auth',
    summary: 'Sign in (10 attempts per 15 minutes per email)',
    auth: false,
    body: LoginRequest,
    responses: { 200: { description: 'Signed in', schema: AuthResponse } },
  },
  {
    method: 'post',
    path: '/auth/refresh',
    tag: 'auth',
    summary: 'New access token; rotates the refresh token (cookie for browsers, body for native)',
    auth: false,
    body: RefreshRequest,
    responses: {
      200: { description: 'Refreshed', schema: AuthResponse },
      409: { description: 'Token was just rotated by another tab: retry', schema: ProblemDetails },
    },
  },
  {
    method: 'post',
    path: '/auth/logout',
    tag: 'auth',
    summary: 'Sign out of this device',
    auth: false,
    body: RefreshRequest,
    responses: { 204: { description: 'Signed out' } },
  },
  {
    method: 'post',
    path: '/auth/logout-all',
    tag: 'auth',
    summary: 'Sign out of every device',
    auth: true,
    responses: { 204: { description: 'Signed out everywhere' } },
  },
  {
    method: 'get',
    path: '/auth/sessions',
    tag: 'auth',
    summary: 'Active sessions (devices)',
    auth: true,
    responses: { 200: { description: 'Sessions', schema: SessionList } },
  },
  {
    method: 'delete',
    path: '/auth/sessions/{id}',
    tag: 'auth',
    summary: 'Revoke a session',
    auth: true,
    params: idParam,
    responses: { 204: { description: 'Revoked' } },
  },
  {
    method: 'post',
    path: '/auth/email/verify',
    tag: 'auth',
    summary: 'Confirm the email with the token from the link',
    auth: false,
    body: EmailTokenRequest,
    responses: { 200: { description: 'Confirmed', schema: UserDto } },
  },
  {
    method: 'post',
    path: '/auth/email/resend',
    tag: 'auth',
    summary: 'Send the confirmation email again (3 per hour)',
    auth: true,
    responses: { 202: { description: 'Sent if not confirmed yet' } },
  },
  {
    method: 'post',
    path: '/auth/password/forgot',
    tag: 'auth',
    summary: 'Email a password reset link (same answer for unknown emails)',
    auth: false,
    body: ForgotPasswordRequest,
    responses: { 202: { description: 'Accepted' } },
  },
  {
    method: 'post',
    path: '/auth/password/reset',
    tag: 'auth',
    summary: 'Set a new password with the emailed token; signs out everywhere',
    auth: false,
    body: ResetPasswordRequest,
    responses: { 204: { description: 'Password changed' } },
  },
  {
    method: 'get',
    path: '/me',
    tag: 'account',
    summary: 'Profile of the signed-in user',
    auth: true,
    responses: { 200: { description: 'Profile', schema: UserDto } },
  },
  {
    method: 'patch',
    path: '/me',
    tag: 'account',
    summary: 'Change name or language',
    auth: true,
    body: UpdateProfileRequest,
    responses: { 200: { description: 'Updated profile', schema: UserDto } },
  },
  {
    method: 'get',
    path: '/catalog/home',
    tag: 'catalog',
    summary: 'Home: catalog size, recently added releases, tracks of the day, artists',
    auth: true,
    responses: { 200: { description: 'Home', schema: CatalogHome } },
  },
  {
    method: 'get',
    path: '/catalog/releases/{id}',
    tag: 'catalog',
    summary: 'Release with its playable tracks',
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Release', schema: ReleaseDetail } },
  },
  {
    method: 'get',
    path: '/catalog/artists/{id}',
    tag: 'catalog',
    summary: 'Artist with releases and tracks',
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Artist', schema: ArtistDetail } },
  },
  {
    method: 'get',
    path: '/catalog/tracks/{id}',
    tag: 'catalog',
    summary: 'Track with license, attribution and best available quality',
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Track', schema: TrackDto } },
  },
  {
    method: 'get',
    path: '/catalog/tracks/{id}/stream',
    tag: 'catalog',
    summary: 'Signed links to the renditions of a track, with loudness for ReplayGain',
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Sources, best first', schema: TrackStream } },
  },
  {
    method: 'get',
    path: '/media/{token}',
    tag: 'catalog',
    summary: 'Audio file by signed link from /stream; supports Range (no Authorization header)',
    auth: false,
    params: tokenParam,
    responses: {
      200: { description: 'Whole file' },
      206: { description: 'Requested byte range' },
      403: { description: 'Link invalid or expired', schema: ProblemDetails },
      416: { description: 'Range outside the file' },
    },
  },
  {
    method: 'get',
    path: '/catalog/search',
    tag: 'catalog',
    summary: 'Search artists, releases and tracks (typos and accents tolerated)',
    auth: true,
    query: SearchQuery,
    responses: { 200: { description: 'Results by type', schema: SearchResults } },
  },
  {
    method: 'get',
    path: '/catalog/search/suggest',
    tag: 'catalog',
    summary: 'Suggestions while typing: best matches of any type',
    auth: true,
    query: SuggestQuery,
    responses: { 200: { description: 'Suggestions', schema: SuggestResults } },
  },
  ...LIBRARY_OPERATIONS,
  {
    method: 'post',
    path: '/library/contains',
    tag: 'library',
    summary: 'Which of these tracks, releases and artists are in my library (≤ 100 each)',
    auth: true,
    body: LibraryContainsRequest,
    responses: { 200: { description: 'The ids that are in the library', schema: LibraryContains } },
  },
  {
    method: 'get',
    path: '/playlists',
    tag: 'playlists',
    summary: 'My playlists, last changed first',
    auth: true,
    responses: { 200: { description: 'Playlists', schema: PlaylistList } },
  },
  {
    method: 'post',
    path: '/playlists',
    tag: 'playlists',
    summary: `Create a playlist (at most 1000).${IDEMPOTENT}`,
    auth: true,
    body: CreatePlaylistRequest,
    responses: {
      201: { description: 'Created', schema: PlaylistMutation },
      409: {
        description: 'LIMIT_EXCEEDED, or the key was used for another request',
        schema: ProblemDetails,
      },
    },
  },
  {
    method: 'get',
    path: '/playlists/{id}',
    tag: 'playlists',
    summary: 'A playlist of mine (someone else’s is 404)',
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Playlist', schema: PlaylistSummary } },
  },
  {
    method: 'patch',
    path: '/playlists/{id}',
    tag: 'playlists',
    summary: 'Rename or change the description',
    auth: true,
    params: idParam,
    body: UpdatePlaylistRequest,
    responses: { 200: { description: 'Updated', schema: PlaylistMutation } },
  },
  {
    method: 'delete',
    path: '/playlists/{id}',
    tag: 'playlists',
    summary: 'Delete a playlist',
    auth: true,
    params: idParam,
    responses: { 200: { description: 'Library version', schema: LibraryChange } },
  },
  {
    method: 'get',
    path: '/playlists/{id}/items',
    tag: 'playlists',
    summary: 'Tracks of a playlist in order (unavailable ones stay, marked)',
    auth: true,
    params: idParam,
    query: PlaylistItemsQuery,
    responses: { 200: { description: 'Page', schema: PlaylistItemsPage } },
  },
  {
    method: 'post',
    path: '/playlists/{id}/items',
    tag: 'playlists',
    summary:
      'Add tracks (end by default; `after` = item or null for the start). A track already ' +
      `there is 409 DUPLICATE_TRACKS unless \`allowDuplicates\`.${IDEMPOTENT}`,
    auth: true,
    params: idParam,
    body: AddPlaylistItemsRequest,
    responses: {
      201: { description: 'Added items', schema: AddPlaylistItemsResult },
      409: { description: 'DUPLICATE_TRACKS or LIMIT_EXCEEDED', schema: ProblemDetails },
    },
  },
  {
    method: 'patch',
    path: '/playlists/{id}/items/{itemId}',
    tag: 'playlists',
    summary: 'Move an item after another one (null = to the start)',
    auth: true,
    params: itemParams,
    body: MovePlaylistItemRequest,
    responses: { 200: { description: 'Library version', schema: LibraryChange } },
  },
  {
    method: 'delete',
    path: '/playlists/{id}/items/{itemId}',
    tag: 'playlists',
    summary: 'Remove an item',
    auth: true,
    params: itemParams,
    responses: { 200: { description: 'Library version', schema: LibraryChange } },
  },
];

type JsonSchema = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const out = { ...z.toJSONSchema(schema, { io, unrepresentable: 'any' }) } as JsonSchema;
  delete out.$schema;
  return out;
}

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: jsonSchema(ProblemDetails, 'output') } },
});

function buildOperation(op: Operation): JsonSchema {
  const parameters: JsonSchema[] = [];
  for (const [name, schema] of Object.entries(op.params ?? {})) {
    parameters.push({ name, in: 'path', required: true, schema: jsonSchema(schema, 'input') });
  }
  for (const [name, field] of Object.entries(op.query?.shape ?? {})) {
    const schema = field as z.ZodType;
    parameters.push({
      name,
      in: 'query',
      required: !schema.safeParse(undefined).success,
      schema: jsonSchema(schema, 'input'),
    });
  }

  const responses: Record<string, unknown> = {};
  for (const [status, response] of Object.entries(op.responses)) {
    responses[status] =
      response.schema === undefined
        ? { description: response.description }
        : {
            description: response.description,
            content: {
              [Number(status) >= 400 ? 'application/problem+json' : 'application/json']: {
                schema: jsonSchema(response.schema, 'output'),
              },
            },
          };
  }
  if (op.auth) responses['401'] = problem('Missing, invalid or expired access token');
  if (op.params !== undefined) responses['404'] ??= problem('Not found');
  if (op.body !== undefined || op.query !== undefined || op.params !== undefined) {
    responses['422'] = problem('Validation failed: `errors` lists the fields');
  }
  responses['429'] = problem('Rate limit exceeded: see Retry-After');

  return {
    tags: [op.tag],
    summary: op.summary,
    operationId: `${op.method}${op.path.replace(/[{}]/g, '').replace(/[/-](\w)/g, (_, c: string) => c.toUpperCase())}`,
    ...(op.auth ? { security: [{ bearer: [] }] } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(op.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: jsonSchema(op.body, 'input') } },
          },
        }),
    responses,
  };
}

export function buildOpenApi(version: string): JsonSchema {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const entry = paths[op.path] ?? {};
    entry[op.method] = buildOperation(op);
    paths[op.path] = entry;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'ReMusic API',
      version,
      description:
        'Errors are RFC 9457 Problem Details with a stable `code`. Browsers get the refresh ' +
        'token as an HttpOnly cookie; native clients send `X-Client-Type: native` and get it ' +
        'in the body. Generated from @mp/contracts.',
    },
    tags: [
      { name: 'health' },
      { name: 'auth' },
      { name: 'account' },
      { name: 'catalog', description: 'Signed-in users only; only playable tracks are returned' },
      {
        name: 'library',
        description: 'Liked tracks, saved releases, followed artists. Mutations return `seq`',
      },
      { name: 'playlists', description: 'The user’s own playlists. Mutations return `seq`' },
    ],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    paths,
  };
}
