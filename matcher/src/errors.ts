import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
} from "viem";

/** True when the call reached the contract and the contract said no (as opposed to the RPC failing). */
export function isRevert(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    err.walk(
      (e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError,
    ) !== null
  );
}

export interface DecodedRevert {
  name: string;
  args: readonly unknown[];
}

/** A revert whose selector is in the ABI we passed, decoded; null for anything else. */
export function decodeRevert(err: unknown): DecodedRevert | null {
  if (!(err instanceof BaseError)) return null;
  const found = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (found instanceof ContractFunctionRevertedError && found.data) {
    return { name: found.data.errorName, args: found.data.args ?? [] };
  }
  return null;
}
