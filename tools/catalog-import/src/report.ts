import type { ImportReport } from './importer.js';
import { formatBytes } from './util.js';
import { readyCount, verificationPassed, type VerifyResult } from './verify.js';

export function formatCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return 'none';
  return entries.map(([key, count]) => `${key}: ${String(count)}`).join(', ');
}

const sum = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((total, count) => total + count, 0);

/** Human-readable summary: what was imported, what was rejected and why, rule checks. */
export function formatReport(
  report: ImportReport | null,
  check: VerifyResult,
  target: number,
): string[] {
  const lines: string[] = [];
  if (report !== null) {
    const seconds = Math.round(report.durationMs / 1000);
    lines.push(
      `Revision: ${report.revision ?? '(not opened: target already reached)'}`,
      `Parts scanned: ${String(report.partsScanned)} (unreadable: ${String(report.scanErrors)}), rows read: ${String(report.rowsRead)}, time: ${String(seconds)} s`,
      `Audio of ${String(report.partsWithAudio)} part(s): ~${formatBytes(report.estimatedDownloadBytes)}${report.dryRun ? ' would be downloaded' : ''}; downloaded in total: ${formatBytes(report.bytesDownloaded)}`,
    );
    if (report.dryRun) {
      lines.push(
        `DRY RUN: would import ${String(report.wouldImport)} track(s): ${formatCounts(report.importedByLicense)}`,
      );
    } else {
      lines.push(
        `Imported now: ${String(report.importedNow)} (${formatCounts(report.importedByLicense)}); already in catalog: ${String(report.readyAtStart)}`,
      );
    }
    lines.push(
      `Rejected before download: ${String(sum(report.rejected))} (${formatCounts(report.rejected)})`,
      `  licenses not allowed: ${formatCounts(report.rejectedLicenses)}`,
      `Duplicates in the dataset: ${String(report.duplicates)}; skipped by the per-release limit: ${String(report.releaseCapSkipped)}`,
      `Rejected by the audio pipeline: ${String(sum(report.pipelineFailures))} (${formatCounts(report.pipelineFailures)})`,
    );
  }
  const ready = readyCount(check);
  const v = check.violations;
  lines.push(
    '',
    `Catalog: ${String(ready)}/${String(target)} ready tracks (all statuses: ${formatCounts(check.byStatus)})`,
    `  ready by license: ${formatCounts(check.readyByLicense)}`,
    `  failed by reason: ${formatCounts(check.failures)}`,
    `Checks: disallowed licenses ${String(v.disallowedLicense)}, ready without rights ${String(v.readyWithoutRights)}, without license link ${String(v.missingLicenseUrl)}, without attribution ${String(v.missingAttribution)}, without source link ${String(v.missingSourceUrl)}, without renditions ${String(v.readyWithoutRenditions)}, renditions missing in S3 ${String(check.missingObjects)} of ${String(check.assets.length)}`,
  );
  const passed = verificationPassed(check);
  const complete = report?.dryRun === true ? true : ready >= target;
  lines.push(
    passed && complete
      ? 'RESULT: OK'
      : `RESULT: FAILED${passed ? '' : ' (rule violations)'}${complete ? '' : ` (only ${String(ready)} of ${String(target)} ready)`}`,
  );
  return lines;
}
