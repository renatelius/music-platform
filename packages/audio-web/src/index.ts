export { BufferDeck, type Deck, ElementDeck } from './decks.js';
export {
  crossfadeSeconds,
  dbToGain,
  EQ_BANDS_HZ,
  EQ_MAX_DB,
  EQ_PRESETS,
  eqPreampDb,
  type EqPresetName,
  fadeCurve,
  normalizeBalance,
  normalizeEq,
  volumeToGain,
} from './dsp.js';
export { MAX_DECODED_DURATION_MS, WebAudioEngine, type WebAudioEngineOptions } from './engine.js';
export { bindMediaSession, type MediaSessionOptions } from './media-session.js';

/** Whether this browser can play a source `mimeType` (for player-core `chooseSource`). */
export function browserCanPlay(mimeType: string): boolean {
  if (typeof Audio === 'undefined') return false;
  return new Audio().canPlayType(mimeType) !== '';
}
