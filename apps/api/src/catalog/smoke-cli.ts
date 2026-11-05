// Setup check of the catalog read side on the DEVELOPMENT database (after catalog.bat import):
// the same queries the API serves - home, release, artist, search with a typo, suggestions.
// Usage: pnpm --filter @mp/api catalog:smoke
import { loadConfig } from '../config/env.js';
import { createDb, createPool } from '../db/client.js';
import { getArtist, getHome, getRelease, search, suggest, withCountry } from './queries.js';

const config = loadConfig(process.env);
const pool = createPool(config.db.url, 4);
const db = createDb(pool);
const failures: string[] = [];
const check = (ok: boolean, message: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

/** Drops one letter from the middle of the longest word: a realistic typo. */
function typo(text: string): string | null {
  const word = text
    .split(' ')
    .filter((part) => /^\p{L}+$/u.test(part))
    .sort((a, b) => b.length - a.length)[0];
  if (word === undefined || word.length < 6) return null;
  const middle = Math.floor(word.length / 2);
  return word.slice(0, middle) + word.slice(middle + 1);
}

try {
  const started = Date.now();
  const home = await getHome(db);
  const { stats } = home;
  console.log(
    `catalog: ${String(stats.tracks)} playable tracks, ${String(stats.releases)} releases, ${String(stats.artists)} artists`,
  );
  check(stats.tracks > 0, 'catalog has playable tracks (empty? run catalog.bat -> 2)');

  const firstRelease = home.recentReleases[0];
  if (firstRelease !== undefined) {
    const release = await getRelease(db, firstRelease.id);
    check(
      release !== null && release.tracks.length === firstRelease.trackCount,
      `release "${firstRelease.title}": ${String(release?.tracks.length ?? 0)} tracks, license on each: ${String(release?.tracks.every((track) => track.license.attribution !== '') ?? false)}`,
    );
  }

  const firstArtist = home.artists[0];
  if (firstArtist !== undefined) {
    const artist = await getArtist(db, firstArtist.id);
    check(
      artist !== null,
      `artist "${firstArtist.name}": ${String(artist?.releases.length ?? 0)} releases`,
    );

    // Country unknown, as for a listener without a CDN header.
    const exact = await withCountry(db, null, (tx) => search(tx, firstArtist.name, 5));
    check(
      exact.artists[0]?.id === firstArtist.id,
      `search "${firstArtist.name}": artist first, ${String(exact.tracks.length)} tracks`,
    );
    const misspelled = typo(firstArtist.name);
    if (misspelled !== null) {
      const fuzzy = await withCountry(db, null, (tx) => search(tx, misspelled, 5));
      check(
        fuzzy.artists.some((found) => found.id === firstArtist.id),
        `search with a typo "${misspelled}" finds "${firstArtist.name}"`,
      );
    }
    const prefix = firstArtist.name.slice(0, 3);
    const suggestions = await withCountry(db, null, (tx) => suggest(tx, prefix, 8));
    check(
      suggestions.items.length > 0,
      `suggest "${prefix}": ${String(suggestions.items.length)} suggestions`,
    );
  }
  console.log(`done in ${String(Date.now() - started)} ms`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await pool.end();
}
process.exit(failures.length === 0 ? 0 : 1);
