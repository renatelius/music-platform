// FFmpeg layer of the audio pipeline (ARCHITECTURE.md §6.1, ADR-017).
// Plain functions without NestJS: the worker and the tests call them directly.
export { encodeRendition } from './encode.js';
export {
  AAC_LADDER_KBPS,
  cappedBitrate,
  OPUS_LADDER_KBPS,
  planRenditions,
  type RenditionCodec,
  renditionName,
  type RenditionSpec,
} from './ladder.js';
export { analyzeAudio, type AnalysisResult, type LoudnessResult } from './analyze.js';
export { REPLAYGAIN_REFERENCE_LUFS } from './analyze.js';
export { probeAudio, type ProbeResult } from './probe.js';
export {
  checkMediaTools,
  MediaError,
  type MediaErrorCode,
  type MediaTools,
  type MediaToolsStatus,
  REQUIRED_ENCODERS,
  runTool,
  type ToolResult,
} from './tools.js';
