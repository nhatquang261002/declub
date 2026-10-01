import { getAddress, isAddress, parseAbi, type Address } from "viem";
import { CHOG_ADDRESS, KNOWN_COLLECTIONS } from "./config";

/** The ERC-721 reads the NFT picker makes on any collection. Every one is optional on a real contract. */
export const nftReadAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function supportsInterface(bytes4) view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address, uint256) view returns (uint256)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
]);

export const ERC721_INTERFACE = "0x80ac58cd";
export const ENUMERABLE_INTERFACE = "0x780e9d63";

/** What the contract says about itself. A contract can claim any name, so the UI shows the address too. */
export type CollectionInfo = {
  address: Address;
  name: string | null;
  symbol: string | null;
  isErc721: boolean;
  /** Can list a wallet's tokens (`tokenOfOwnerByIndex`) and browse (`tokenByIndex`). */
  enumerable: boolean;
  totalSupply: bigint | null;
};

/** "Chog (CHOG)", or the short address while the contract hasn't answered. */
export function collectionLabel(info: Pick<CollectionInfo, "name" | "symbol" | "address"> | undefined, fallback: string): string {
  if (!info?.name && !info?.symbol) return fallback;
  return info.name && info.symbol && info.name !== info.symbol ? `${info.name} (${info.symbol})` : (info.name ?? info.symbol)!;
}

/** Collections the app offers first: the Chog collection, then NEXT_PUBLIC_KNOWN_COLLECTIONS. */
export const featuredCollections = (): Address[] => {
  const seen = new Set<string>();
  return [CHOG_ADDRESS, ...KNOWN_COLLECTIONS].filter((a) => {
    const key = a.toLowerCase();
    return !seen.has(key) && !!seen.add(key);
  });
};

export const isFeatured = (address: string) =>
  featuredCollections().some((a) => a.toLowerCase() === address.toLowerCase());

// ─────────────────────────────────────────────────────────────── Recently used

const RECENT_KEY = "ondeal:recent-collections";
const RECENT_MAX = 8;

/** Storage can be blocked or full; the picker works without it. */
export function recentCollections(): Address[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a)) : [];
  } catch {
    return [];
  }
}

export function rememberCollection(address: Address) {
  try {
    const next = [address, ...recentCollections().filter((a) => a.toLowerCase() !== address.toLowerCase())];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_MAX)));
  } catch {
    // Not remembering is fine.
  }
}

// ─────────────────────────────────────────────────────────────── Images

/**
 * Token art comes from whatever the collection's metadata says, so only plain images are shown:
 * http(s) or an inline image. Anything else (javascript:, file:, ...) is dropped.
 */
export function safeImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^(https?:\/\/|data:image\/)/i.test(url) ? url : null;
}
