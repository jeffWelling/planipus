export interface BasisHashRuntime {
  hash(value: unknown): string;
}

/**
 * Provider observations keep tombstone state in a relational column rather
 * than requiring the normalized event document to change. Both values must be
 * bound into an effect's authorization basis so deletion cannot race a stale
 * create/update through recovery or an ordinary queue delay.
 */
export function sourceObservationBasisHash(
  runtime: BasisHashRuntime,
  observationHash: string,
  tombstone: boolean
): string {
  return runtime.hash({
    version: 1,
    observation_hash: observationHash,
    tombstone
  });
}
