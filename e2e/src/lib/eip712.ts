import { type Address, hashDomain } from "viem";

/** The EIP-712 domain separator for `domain`, computed here to compare with the contract's `DOMAIN_SEPARATOR`. */
export const domainSeparator = (domain: { name: string; version: string; chainId: bigint; verifyingContract: Address }) =>
  hashDomain({
    domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
