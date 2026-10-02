import { getAddress, keccak256, toHex, type Address } from "viem";
import { CHAIN_ID } from "./config";
import type { AssetEntry, TokenCategory } from "./verifiedAssets";
import raw from "../data/assets.json" with { type: "json" };

/**
 * Mock Clubs for development, so the Clubs screens can be seen with many Clubs at every pace,
 * along with the cases that have no Club of their own: a stablecoin and wrapped MON (verified, no
 * community) and memecoins that share a collection's Club. They join the verified list
 * (lib/verifiedAssets.ts) only outside production builds, and NEXT_PUBLIC_DEMO_CLUBS=false turns
 * them off, along with the mock activity the dev server seeds (lib/server/demoClubs.ts). Their
 * addresses are made up: no contract lives there.
 */
export const DEMO_CLUBS = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_CLUBS !== "false";

/** How busy a mock Club is made to look. */
export type DemoPace = "hot" | "busy" | "rising" | "steady" | "fading" | "quiet";

type Demo = {
  name: string;
  symbol: string;
  kind: AssetEntry["kind"];
  category?: TokenCategory;
  /** Absent for a token with no Club of its own: one with no community, or one that joins another's. */
  pace?: DemoPace;
  image?: string;
  archived?: true;
  /** The symbol of the collection whose Club this memecoin joins: a mock one, or one on the real list. */
  joins?: string;
};

const LIST: Demo[] = [
  { name: "Halo Chogs", symbol: "HALO", kind: "erc721", pace: "hot", image: "/art/chogs/chog-02.png" },
  { name: "Gmonad Coin", symbol: "GMONAD", kind: "erc20", category: "memecoin", pace: "busy" },
  { name: "Crowned Chogs", symbol: "CROWN", kind: "erc721", pace: "rising", image: "/art/chogs/chog-03.png" },
  { name: "Chog Coin", symbol: "CHOG", kind: "erc20", category: "memecoin", joins: "MCHOG" },
  { name: "Winged Chogs", symbol: "WINGS", kind: "erc721", pace: "fading", image: "/art/chogs/chog-04.png" },
  { name: "Monad Mascots", symbol: "MASCOT", kind: "erc721", pace: "busy", image: "/art/chogs/chog-05.png" },
  { name: "Purple Pepe", symbol: "PURP", kind: "erc20", category: "memecoin", pace: "rising" },
  { name: "Testnet Toads", symbol: "TOAD", kind: "erc721", pace: "steady" },
  { name: "Toad Coin", symbol: "TOADZ", kind: "erc20", category: "memecoin", joins: "TOAD" },
  { name: "Gm Ghosts", symbol: "GMG", kind: "erc721", pace: "quiet" },
  { name: "Block Builders", symbol: "BUILD", kind: "erc721", pace: "fading" },
  { name: "Molandak Maxis", symbol: "MOLA", kind: "erc721", pace: "steady" },
  { name: "Old Chogs v1", symbol: "OCHOG", kind: "erc721", pace: "fading", archived: true },
  // Verified, so their deals are trusted, but with no community: no Club.
  { name: "Wrapped MON", symbol: "WMON", kind: "erc20", category: "wrapped" },
  { name: "Testnet Tether", symbol: "tUSDT", kind: "erc20", category: "stablecoin" },
];

const address = (symbol: string): Address => getAddress(`0x${keccak256(toHex(`ondeal-demo-club:${symbol}`)).slice(-40)}`);

/** The Club a mock memecoin joins, or nothing when that collection isn't listed (the pairing is dropped). */
function joined(symbol: string): Address | undefined {
  if (LIST.some((d) => d.symbol === symbol)) return address(symbol);
  const real = (raw as { chainId: number; symbol: string; address: string }[]).find((e) => e.chainId === CHAIN_ID && e.symbol === symbol);
  return real ? getAddress(real.address) : undefined;
}

/** The mock Clubs as entries of the verified list: empty when they are switched off. */
export const DEMO_ASSETS: AssetEntry[] = DEMO_CLUBS
  ? LIST.map((d) => {
      const club = d.archived ? ("archived" as const) : d.joins ? joined(d.joins) : undefined;
      return {
        chainId: CHAIN_ID,
        address: address(d.symbol),
        kind: d.kind,
        ...(d.category ? { category: d.category } : {}),
        name: d.name,
        symbol: d.symbol,
        status: "verified",
        note: "A mock asset for development (NEXT_PUBLIC_DEMO_CLUBS). Not a real asset.",
        ...(d.image ? { image: d.image } : {}),
        ...(club ? { club } : {}),
      };
    })
  : [];

/** The pace a mock Club was given, or null for a real one (or a mock token with no Club of its own). */
export function demoPace(token: string): DemoPace | null {
  const found = LIST.find((d) => address(d.symbol).toLowerCase() === token.toLowerCase());
  return found?.pace ?? null;
}
