import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with Node's built-in Argon2id (Node >= 24.7), no native addons.
 * Parameters follow the OWASP recommendation: m=19 MiB, t=2, p=1.
 * Stored in the standard PHC format so hashes stay portable.
 */
export interface Argon2Params {
  memoryKiB: number;
  passes: number;
  parallelism: number;
}

export const DEFAULT_ARGON2: Argon2Params = { memoryKiB: 19_456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const PHC =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{11,})\$([A-Za-z0-9+/]{16,})$/;

function derive(
  password: string,
  salt: Buffer,
  params: Argon2Params,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password.normalize('NFKC'),
        nonce: salt,
        parallelism: params.parallelism,
        tagLength: length,
        memory: params.memoryKiB,
        passes: params.passes,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string, params = DEFAULT_ARGON2): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, params, HASH_BYTES);
  return `$argon2id$v=19$m=${String(params.memoryKiB)},t=${String(params.passes)},p=${String(params.parallelism)}$${b64(salt)}$${b64(hash)}`;
}

interface ParsedHash {
  params: Argon2Params;
  salt: Buffer;
  hash: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const m = PHC.exec(stored);
  if (!m) return null;
  const [, mem, passes, par, salt, hash] = m;
  if (
    mem === undefined ||
    passes === undefined ||
    par === undefined ||
    salt === undefined ||
    hash === undefined
  ) {
    return null;
  }
  return {
    params: { memoryKiB: Number(mem), passes: Number(passes), parallelism: Number(par) },
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  };
}

/** Constant-time comparison. Malformed hashes never match. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/** True when the hash was made with different (older) parameters and should be upgraded. */
export function needsRehash(stored: string, params = DEFAULT_ARGON2): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return (
    parsed.params.memoryKiB !== params.memoryKiB ||
    parsed.params.passes !== params.passes ||
    parsed.params.parallelism !== params.parallelism ||
    parsed.hash.length !== HASH_BYTES
  );
}

let dummyHash: Promise<string> | undefined;

/** Same work as a real check, for unknown accounts: login timing does not reveal registered emails. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}
