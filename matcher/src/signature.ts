import { type Address, type Hex, isAddressEqual, recoverAddress, size, slice } from "viem";
import { erc1271Abi } from "./abi.ts";
import type { Reader } from "./chain.ts";
import { isRevert } from "./errors.ts";

const ERC1271_MAGIC = "0x1626ba7e";
const SECP256K1_N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/**
 * Whether `signature` over `digest` is one `ChogSwapIntents.settle` would accept for `maker`.
 * It mirrors OZ `SignatureChecker`: a contract maker is asked via ERC-1271, an EOA must produce
 * a 65-byte, non-malleable ECDSA signature with v of 27 or 28. (viem's own verifier also accepts
 * ERC-6492 wrappers and high-s signatures, which the contract would reject.)
 */
export async function verifyMakerSignature(
  reader: Reader,
  maker: Address,
  digest: Hex,
  signature: Hex,
): Promise<boolean> {
  const code = await reader.getCode({ address: maker });
  if (code && code !== "0x") {
    try {
      const magic = await reader.readContract({
        address: maker,
        abi: erc1271Abi,
        functionName: "isValidSignature",
        args: [digest, signature],
      });
      return magic === ERC1271_MAGIC;
    } catch (err) {
      if (isRevert(err)) return false;
      throw err;
    }
  }
  return verifyEcdsa(maker, digest, signature);
}

export async function verifyEcdsa(maker: Address, digest: Hex, signature: Hex): Promise<boolean> {
  if (size(signature) !== 65) return false;
  const s = BigInt(slice(signature, 32, 64));
  const v = Number(BigInt(slice(signature, 64, 65)));
  if (s > SECP256K1_N_HALF || (v !== 27 && v !== 28)) return false;
  try {
    return isAddressEqual(await recoverAddress({ hash: digest, signature }), maker);
  } catch {
    return false;
  }
}
