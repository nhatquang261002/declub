import { createPublicClient, http, verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { chain } from "../chain";
import { RPC_URL } from "../config";
import type { followTypedData, joinTypedData, postTypedData, replyTypedData } from "../social";

type Typed = ReturnType<typeof postTypedData> | ReturnType<typeof replyTypedData> | ReturnType<typeof followTypedData> | ReturnType<typeof joinTypedData>;

let verifier: PublicClient | undefined;

/** viem's check of a signed social record: an EOA's signature, or a smart wallet's through ERC-1271. */
export async function verifySocialSignature(signer: Address, typed: Typed, signature: Hex): Promise<boolean> {
  // A plain wallet's signature is checked here; only a smart wallet costs a call (ERC-1271).
  if (await verifyTypedData({ address: signer, signature, ...typed }).catch(() => false)) return true;
  verifier ??= createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;
  try {
    if (!(await verifier.getCode({ address: signer }))) return false;
    return await verifier.verifyTypedData({ address: signer, signature, ...typed });
  } catch {
    return false;
  }
}
