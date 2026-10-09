/**
 * Funding an epoch: `publish` takes native MON, but signed swaps paid their fees in WMON (ADR 0015),
 * so the operator unwraps what it is short before publishing (ADR 0022).
 */

/** Gas the operator keeps back for `publish` when working out the unwrap; the limit is what it's billed on. */
export const PUBLISH_GAS_LIMIT = 300_000n;

type FundingPlan = {
  /** WMON to unwrap first: what the operator's MON falls short of `total` plus gas, at most its WMON. */
  unwrap: bigint;
  /** What is still missing after unwrapping all of it: someone has to send MON to the operator. */
  short: bigint;
};

/** What the operator must unwrap to fund `total`, keeping `gas` back for the transactions. */
export function fundingPlan(input: { total: bigint; mon: bigint; wmon: bigint; gas: bigint }): FundingPlan {
  const needed = input.total + input.gas - input.mon;
  if (needed <= 0n) return { unwrap: 0n, short: 0n };
  const unwrap = needed < input.wmon ? needed : input.wmon;
  return { unwrap, short: needed - unwrap };
}
