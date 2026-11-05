import { type CatalogCheck, checkCatalog } from '@mp/api/catalog';
import type { PipelineDeps } from '@mp/api/pipeline';
import { objectSize } from '@mp/api/storage';

export interface VerifyResult extends CatalogCheck {
  /** Rendition rows of ready tracks whose S3 object is missing or has another size. */
  readonly missingObjects: number;
}

/** Database rules (licenses, attribution, renditions) plus "every rendition row has its file". */
export async function verifyCatalog(
  deps: Pick<PipelineDeps, 'db' | 's3' | 'buckets'>,
  sourceId: string,
): Promise<VerifyResult> {
  const check = await checkCatalog(deps.db, sourceId);
  let missingObjects = 0;
  for (const asset of check.assets) {
    const size = await objectSize(deps.s3, deps.buckets.media, asset.s3Key);
    if (size !== asset.sizeBytes) missingObjects += 1;
  }
  return { ...check, missingObjects };
}

export function readyCount(result: VerifyResult): number {
  return result.byStatus.ready ?? 0;
}

export function verificationPassed(result: VerifyResult): boolean {
  return (
    Object.values(result.violations).every((count) => count === 0) && result.missingObjects === 0
  );
}
