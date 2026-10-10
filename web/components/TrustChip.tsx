import type { AssetTrust } from "@/lib/assetTrust";
import { AlertIcon, BadgeCheckIcon, BanIcon, HelpIcon } from "./Icons";

/**
 * An asset's standing on the verified list (ADR 0014), as a chip. Verified means "the contract the
 * project published", never "safe" or "worth something", and the hover text says so.
 */
export function TrustChip({ trust }: { trust: AssetTrust }) {
  if (trust.tier === "blocked") {
    return (
      <span className="chip chip-danger" title="On DeClub's blocked list, usually a scam or a copy. Don't accept it.">
        <BanIcon />
        Blocked
      </span>
    );
  }
  if (trust.lookalike) {
    return (
      <span
        className="chip chip-danger"
        title={`Not verified, and named like ${trust.lookalike.name} (${trust.lookalike.symbol}), which is verified at ${trust.lookalike.address}. Probably a copy.`}
      >
        <AlertIcon />
        Lookalike
      </span>
    );
  }
  if (trust.tier === "unverified") {
    return (
      <span className="chip" title="Not on DeClub's verified list. Anyone can make a contract with any name: check the address.">
        <HelpIcon />
        Unverified
      </span>
    );
  }
  return (
    <span className="chip chip-mint" title="On DeClub's verified list: the contract the project published. Not a promise of its value.">
      <BadgeCheckIcon />
      Verified
    </span>
  );
}
