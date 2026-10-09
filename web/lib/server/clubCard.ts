import { isAddress } from "viem";
import type { Recap } from "../recap";
import { registry } from "../verifiedAssets";
import { clubRewards } from "./rewards";
import { getStore } from "./store";

/** What a Club's preview card says: who it is, and its latest paid epoch when it has one. */
type ClubFacts = { name: string; symbol: string; image?: string; recap: Recap | null };

/**
 * What a Club's link preview needs, read on the server. `null` for an address that has no Club:
 * the page then has no special preview. A Club with no paid epoch (or a deploy without Rewards)
 * still has a card, just without the numbers.
 */
export async function readClubFacts(address: string): Promise<ClubFacts | null> {
  if (!isAddress(address, { strict: false })) return null;
  const entry = registry.clubFor(address);
  if (!entry) return null;
  const facts: ClubFacts = { name: entry.name, symbol: entry.symbol, image: entry.image, recap: null };
  try {
    const store = getStore();
    const latest = store ? (await clubRewards(store, entry.address)).epochs[0] : undefined;
    if (latest) {
      facts.recap = {
        symbol: entry.symbol,
        epoch: latest.n,
        fees: BigInt(latest.fees),
        paidHolders: BigInt(latest.paidHolders),
        holderCount: latest.holderCount,
      };
    }
  } catch {
    // The numbers are a bonus: the card still names the Club.
  }
  return facts;
}
