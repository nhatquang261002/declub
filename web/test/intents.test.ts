import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concat, encodeAbiParameters, getAddress, hashTypedData, keccak256, toHex, type Hex } from "viem";
import { erc20Asset, nftAsset } from "../lib/assets";
import { type Intent, intentFromWire, intentHash, intentToWire, intentTypedData } from "../lib/intents";

// The app must sign exactly what OnDealIntents verifies. These are the contract's own type strings
// (src/OnDealIntents.sol), hashed by hand the way its Foundry test does, so a drift in
// lib/intents.ts breaks here instead of in every wallet.
const ASSET_TYPE = "Asset(uint8 assetType,address token,uint256 id,uint256 amount)";
const INTENT_TYPE =
  "Intent(address maker,Asset[] give,Asset[] want,address feeToken,uint256 maxFee,uint64 deadline,uint256 nonce)" +
  ASSET_TYPE;

const MAKER = getAddress("0x00000000000000000000000000000000000000a1");
const SWAP = getAddress("0x00000000000000000000000000000000000000c0");
const CHOG = getAddress("0x00000000000000000000000000000000000000c1");
const USD = getAddress("0x00000000000000000000000000000000000000c2");
const WMON = getAddress("0x00000000000000000000000000000000000000c3");

const intent: Intent = {
  maker: MAKER,
  give: [nftAsset(CHOG, 7n)],
  want: [erc20Asset(USD, 5n * 10n ** 18n)],
  feeToken: WMON,
  maxFee: 2n * 10n ** 18n,
  deadline: 1_900_000_000n,
  nonce: 42n,
};

const assetHash = (assetType: number, token: Hex, id: bigint, amount: bigint) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [keccak256(toHex(ASSET_TYPE)), assetType, token, id, amount],
    ),
  );

const expectedStructHash = keccak256(
  encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "address" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint64" },
      { type: "uint256" },
    ],
    [
      keccak256(toHex(INTENT_TYPE)),
      MAKER,
      keccak256(concat([assetHash(2, CHOG, 7n, 1n)])),
      keccak256(concat([assetHash(1, USD, 0n, 5n * 10n ** 18n)])),
      WMON,
      intent.maxFee,
      intent.deadline,
      intent.nonce,
    ],
  ),
);

describe("signed intents (ADR 0008, 0018)", () => {
  it("hash with the contract's type string, maxFee included", () => {
    assert.equal(intentHash(intent), expectedStructHash);
    assert.notEqual(intentHash({ ...intent, maxFee: intent.maxFee + 1n }), expectedStructHash);
  });

  it("sign under the contract's domain, version 3", () => {
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(toHex("OnDealIntents")),
          keccak256(toHex("3")),
          BigInt(intentTypedData(SWAP, intent).domain.chainId),
          SWAP,
        ],
      ),
    );
    assert.equal(
      hashTypedData(intentTypedData(SWAP, intent)),
      keccak256(concat(["0x1901", domainSeparator, expectedStructHash])),
    );
  });

  it("speak the pool's JSON, with maxFee as a decimal string", () => {
    const wire = intentToWire(intent);
    assert.equal(wire.maxFee, "2000000000000000000");
    assert.deepEqual(intentFromWire(JSON.parse(JSON.stringify(wire))), intent);
    // An intent in the old shape (`fee`) is not read as a maximum.
    const old: Record<string, unknown> = { ...wire, fee: wire.maxFee };
    delete old.maxFee;
    assert.equal(intentFromWire(old), null);
  });
});
