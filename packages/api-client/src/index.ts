import {
  type AddPlaylistItemsRequest,
  AddPlaylistItemsResult,
  ArtistDetail,
  AuthResponse,
  CatalogHome,
  CLIENT_TYPE_HEADER,
  CreatePlaylistRequest as CreatePlaylistRequestInput,
  type ErrorCode,
  FollowedArtistsPage,
  IDEMPOTENCY_KEY_HEADER,
  LibraryChange,
  LibraryContains,
  type LibraryContainsRequest,
  LikedTracksPage,
  type LoginRequest,
  PlaylistItemsPage,
  PlaylistList,
  PlaylistMutation,
  PlaylistSummary,
  ProblemDetails,
  type RegisterRequest,
  ReleaseDetail,
  SavedReleasesPage,
  SearchResults,
  type SessionDto,
  SessionList,
  SuggestResults,
  TrackDto,
  TrackStream,
  type UpdatePlaylistRequest,
  type UpdateProfileRequest,
  UserDto,
} from '@mp/contracts';
import { z } from 'zod';

export interface Session {
  accessToken: string;
  accessTokenExpiresAt: Date;
  user: UserDto;
}

/** The server could not be reached at all. */
export class NetworkError extends Error {
  override name = 'NetworkError';

  constructor(cause: unknown) {
    super('Network request failed', { cause });
  }
}

/** The server answered with an error status. `problem` is set for RFC 9457 responses. */
export class ApiRequestError extends Error {
  override name = 'ApiRequestError';

  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${String(status)}`);
  }

  get code(): ErrorCode | null {
    return this.problem?.code ?? null;
  }
}

/** Where native apps keep the refresh token (Keychain, Keystore, Credential Manager). */
export interface RefreshTokenStore {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

/** Runs `run` exclusively across tabs/processes (Web Locks in browsers). */
export type LockFn = <T>(name: string, run: () => Promise<T>) => Promise<T>;

export interface ApiClientOptions {
  /** e.g. `/api` in the web app (same-origin proxy) or `https://api.example` for native apps. */
  baseUrl: string;
  fetch?: typeof fetch;
  lock?: LockFn;
  /** Native mode: refresh token in the body instead of an HttpOnly cookie. */
  refreshTokenStore?: RefreshTokenStore;
  now?: () => number;
  /** Delay before retrying a refresh that raced with another tab. */
  retryDelayMs?: number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** What the library keeps: liked tracks, saved releases, followed artists. */
export type LibraryKind = 'tracks' | 'releases' | 'artists';

interface RequestOptions {
  body?: unknown;
  /** Idempotency-Key: the same on every retry of this call, so the server applies it once. */
  key?: string;
}
type Listener = (session: Session | null) => void;

const NoContent = z.undefined();
/** Refresh slightly before expiry so requests never carry an expired token. */
const REFRESH_LEEWAY_MS = 30_000;
const REFRESH_LOCK = 'remusic-auth-refresh';

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function queryString(q: string, limit: number | undefined): string {
  const params = new URLSearchParams({ q });
  if (limit !== undefined) params.set('limit', String(limit));
  return params.toString();
}

function pageQuery(cursor: string | undefined, limit: number | undefined): string {
  const params = new URLSearchParams();
  if (cursor !== undefined) params.set('cursor', cursor);
  if (limit !== undefined) params.set('limit', String(limit));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

const newKey = (): string => globalThis.crypto.randomUUID();
const seg = (id: string) => encodeURIComponent(id);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export class ApiClient {
  private session: Session | null = null;
  private refreshing: Promise<Session | null> | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  get currentSession(): Session | null {
    return this.session;
  }

  /** Called on sign-in, sign-out, token refresh and profile changes. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ------------------------------------------------------------ sign-in

  async register(input: RegisterRequest): Promise<Session> {
    return this.acceptAuth(
      await this.send('POST', '/auth/register', { body: input }, AuthResponse),
    );
  }

  async login(input: LoginRequest): Promise<Session> {
    return this.acceptAuth(await this.send('POST', '/auth/login', { body: input }, AuthResponse));
  }

  /** Restores the session after a reload. Resolves to null when signed out. */
  restore(): Promise<Session | null> {
    return this.refresh();
  }

  /** Always ends the local session, even if the server cannot be reached. */
  async logout(): Promise<void> {
    const accessToken = this.session?.accessToken;
    try {
      const refreshToken = await this.storedRefreshToken();
      await this.send(
        'POST',
        '/auth/logout',
        { body: refreshToken !== null ? { refreshToken } : {}, token: accessToken },
        NoContent,
      );
    } catch {
      // Local sign-out still happens below.
    }
    await this.endSession();
  }

  async logoutAll(): Promise<void> {
    await this.authed('POST', '/auth/logout-all', {}, NoContent);
    await this.endSession();
  }

  // ------------------------------------------------------------ account

  async me(): Promise<UserDto> {
    const user = await this.authed('GET', '/me', {}, UserDto);
    this.updateUser(user);
    return user;
  }

  async updateProfile(input: UpdateProfileRequest): Promise<UserDto> {
    const user = await this.authed('PATCH', '/me', { body: input }, UserDto);
    this.updateUser(user);
    return user;
  }

  async sessions(): Promise<SessionDto[]> {
    return (await this.authed('GET', '/auth/sessions', {}, SessionList)).items;
  }

  async revokeSession(id: string): Promise<void> {
    await this.authed('DELETE', `/auth/sessions/${encodeURIComponent(id)}`, {}, NoContent);
  }

  async verifyEmail(token: string): Promise<UserDto> {
    const user = await this.send('POST', '/auth/email/verify', { body: { token } }, UserDto);
    if (this.session?.user.id === user.id) this.updateUser(user);
    return user;
  }

  async resendVerification(): Promise<void> {
    await this.authed('POST', '/auth/email/resend', {}, NoContent);
  }

  async forgotPassword(email: string): Promise<void> {
    await this.send('POST', '/auth/password/forgot', { body: { email } }, NoContent);
  }

  /** The server signs out every device after a reset, so the local session ends too. */
  async resetPassword(token: string, password: string): Promise<void> {
    await this.send('POST', '/auth/password/reset', { body: { token, password } }, NoContent);
    await this.endSession();
  }

  // ------------------------------------------------------------ catalog

  catalogHome(): Promise<CatalogHome> {
    return this.authed('GET', '/catalog/home', {}, CatalogHome);
  }

  release(id: string): Promise<ReleaseDetail> {
    return this.authed('GET', `/catalog/releases/${encodeURIComponent(id)}`, {}, ReleaseDetail);
  }

  artist(id: string): Promise<ArtistDetail> {
    return this.authed('GET', `/catalog/artists/${encodeURIComponent(id)}`, {}, ArtistDetail);
  }

  track(id: string): Promise<TrackDto> {
    return this.authed('GET', `/catalog/tracks/${encodeURIComponent(id)}`, {}, TrackDto);
  }

  search(q: string, limit?: number): Promise<SearchResults> {
    return this.authed('GET', `/catalog/search?${queryString(q, limit)}`, {}, SearchResults);
  }

  /** Signed links to the renditions of a track (valid until `expiresAt`) and its loudness. */
  trackStream(id: string): Promise<TrackStream> {
    return this.authed('GET', `/catalog/tracks/${encodeURIComponent(id)}/stream`, {}, TrackStream);
  }

  /** Absolute URL of a `/media/...` path from `trackStream`, for <audio> and fetch(). */
  mediaUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** Suggestions while typing. */
  suggest(q: string, limit?: number): Promise<SuggestResults> {
    return this.authed(
      'GET',
      `/catalog/search/suggest?${queryString(q, limit)}`,
      {},
      SuggestResults,
    );
  }

  // ------------------------------------------------------------ library (I7a)

  likedTracks(cursor?: string, limit?: number): Promise<LikedTracksPage> {
    return this.authed('GET', `/library/tracks${pageQuery(cursor, limit)}`, {}, LikedTracksPage);
  }

  savedReleases(cursor?: string, limit?: number): Promise<SavedReleasesPage> {
    return this.authed(
      'GET',
      `/library/releases${pageQuery(cursor, limit)}`,
      {},
      SavedReleasesPage,
    );
  }

  followedArtists(cursor?: string, limit?: number): Promise<FollowedArtistsPage> {
    return this.authed(
      'GET',
      `/library/artists${pageQuery(cursor, limit)}`,
      {},
      FollowedArtistsPage,
    );
  }

  /** Like / save / follow (`saved: true`) or undo it. Repeating either changes nothing. */
  async setInLibrary(kind: LibraryKind, id: string, saved: boolean): Promise<number> {
    const change = await this.authed(
      saved ? 'PUT' : 'DELETE',
      `/library/${kind}/${seg(id)}`,
      {},
      LibraryChange,
    );
    return change.seq;
  }

  /** Which of these are in the library: hearts and "Saved" for one screen. */
  libraryContains(ids: Partial<LibraryContainsRequest>): Promise<LibraryContains> {
    return this.authed('POST', '/library/contains', { body: ids }, LibraryContains);
  }

  async playlists(): Promise<PlaylistSummary[]> {
    return (await this.authed('GET', '/playlists', {}, PlaylistList)).items;
  }

  playlist(id: string): Promise<PlaylistSummary> {
    return this.authed('GET', `/playlists/${seg(id)}`, {}, PlaylistSummary);
  }

  playlistItems(id: string, cursor?: string, limit?: number): Promise<PlaylistItemsPage> {
    return this.authed(
      'GET',
      `/playlists/${seg(id)}/items${pageQuery(cursor, limit)}`,
      {},
      PlaylistItemsPage,
    );
  }

  createPlaylist(input: z.input<typeof CreatePlaylistRequestInput>): Promise<PlaylistMutation> {
    return this.authed('POST', '/playlists', { body: input, key: newKey() }, PlaylistMutation);
  }

  updatePlaylist(id: string, input: UpdatePlaylistRequest): Promise<PlaylistMutation> {
    return this.authed('PATCH', `/playlists/${seg(id)}`, { body: input }, PlaylistMutation);
  }

  async deletePlaylist(id: string): Promise<number> {
    return (await this.authed('DELETE', `/playlists/${seg(id)}`, {}, LibraryChange)).seq;
  }

  /**
   * Adds tracks (at the end unless `after`). A track already there fails with code
   * DUPLICATE_TRACKS: ask the user, then call again with `allowDuplicates: true`.
   */
  addToPlaylist(
    id: string,
    input: Pick<AddPlaylistItemsRequest, 'trackIds'> & Partial<AddPlaylistItemsRequest>,
  ): Promise<AddPlaylistItemsResult> {
    return this.authed(
      'POST',
      `/playlists/${seg(id)}/items`,
      { body: input, key: newKey() },
      AddPlaylistItemsResult,
    );
  }

  /** Moves an item after another one; `after: null` = to the start. */
  async movePlaylistItem(id: string, itemId: string, after: string | null): Promise<number> {
    const change = await this.authed(
      'PATCH',
      `/playlists/${seg(id)}/items/${seg(itemId)}`,
      { body: { after } },
      LibraryChange,
    );
    return change.seq;
  }

  async removePlaylistItem(id: string, itemId: string): Promise<number> {
    const change = await this.authed(
      'DELETE',
      `/playlists/${seg(id)}/items/${seg(itemId)}`,
      {},
      LibraryChange,
    );
    return change.seq;
  }

  // ------------------------------------------------------------ internals

  /** One refresh at a time per client, and per browser when a lock is provided. */
  private refresh(): Promise<Session | null> {
    this.refreshing ??= this.withLock(() => this.doRefresh(true)).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private withLock<T>(run: () => Promise<T>): Promise<T> {
    return this.options.lock ? this.options.lock(REFRESH_LOCK, run) : run();
  }

  private async doRefresh(mayRetry: boolean): Promise<Session | null> {
    const stored = await this.storedRefreshToken();
    if (this.options.refreshTokenStore !== undefined && stored === null) {
      this.setSession(null);
      return null;
    }
    try {
      const auth = await this.send(
        'POST',
        '/auth/refresh',
        { body: stored !== null ? { refreshToken: stored } : {} },
        AuthResponse,
      );
      return await this.acceptAuth(auth);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        // 409: another tab rotated the token a moment ago; the newest token is already stored.
        if (error.status === 409 && mayRetry) {
          await delay(this.options.retryDelayMs ?? 300);
          return this.doRefresh(false);
        }
        if (error.status === 401 || error.status === 409) {
          await this.endSession();
          return null;
        }
      }
      throw error;
    }
  }

  private async authed<T>(
    method: Method,
    path: string,
    options: RequestOptions,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let session = this.session;
    if (
      session === null ||
      session.accessTokenExpiresAt.getTime() - this.now() < REFRESH_LEEWAY_MS
    ) {
      session = await this.refresh();
    }
    if (session === null) throw new ApiRequestError(401, null);
    try {
      return await this.send(method, path, { ...options, token: session.accessToken }, schema);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
      const renewed = await this.refresh();
      if (renewed === null) throw error;
      return this.send(method, path, { ...options, token: renewed.accessToken }, schema);
    }
  }

  private async send<T>(
    method: Method,
    path: string,
    options: RequestOptions & { token?: string | undefined },
    schema: z.ZodType<T>,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.key !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = options.key;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    if (this.options.refreshTokenStore !== undefined) headers[CLIENT_TYPE_HEADER] = 'native';

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: 'include',
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      text = await response.text();
    } catch (error) {
      throw new NetworkError(error);
    }
    const json = text === '' ? undefined : parseJson(text);
    if (!response.ok) {
      const problem = ProblemDetails.safeParse(json);
      throw new ApiRequestError(response.status, problem.success ? problem.data : null);
    }
    return schema.parse(json);
  }

  private async acceptAuth(auth: AuthResponse): Promise<Session> {
    if (this.options.refreshTokenStore !== undefined && auth.refreshToken !== undefined) {
      await this.options.refreshTokenStore.set(auth.refreshToken);
    }
    const session: Session = {
      accessToken: auth.accessToken,
      accessTokenExpiresAt: new Date(auth.accessTokenExpiresAt),
      user: auth.user,
    };
    this.setSession(session);
    return session;
  }

  private storedRefreshToken(): Promise<string | null> {
    return this.options.refreshTokenStore?.get() ?? Promise.resolve(null);
  }

  private async endSession(): Promise<void> {
    await this.options.refreshTokenStore?.set(null);
    this.setSession(null);
  }

  private updateUser(user: UserDto): void {
    if (this.session !== null) this.setSession({ ...this.session, user });
  }

  private setSession(session: Session | null): void {
    this.session = session;
    for (const listener of this.listeners) listener(session);
  }
}
