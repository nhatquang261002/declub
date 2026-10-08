"use client";

import Link from "next/link";
import { XLogoIcon } from "@/components/Icons";
import { useProfile } from "@/hooks/useProfiles";
import { profilePath } from "@/lib/about";
import { shortAddress } from "@/lib/format";
import { PROFILE_LABEL } from "@/lib/profiles";
import { CopyAddress } from "@/components/CopyAddress";

/**
 * A wallet as another trader sees it: "you", or the X / Discord account its owner chose to link
 * to it (ADR 0011), or the short address when they haven't. The address stays beside a handle so
 * it can be checked against the wallet in the deal. Each opens that wallet's profile (ADR 0042);
 * the address copies from its own icon. `plain` drops the links, for places already inside a link
 * (a deal card), where a nested anchor would be invalid.
 */
export function Who({
  address,
  mine = false,
  plain = false,
  full = false,
}: {
  address: string;
  mine?: boolean;
  plain?: boolean;
  /** Spell out the whole address, where people are meant to check it (a deal's page). */
  full?: boolean;
}) {
  const profile = useProfile(mine ? undefined : address);
  const href = profilePath(address);
  const open = "underline decoration-dotted underline-offset-2 hover:decoration-solid";
  if (mine) {
    return plain ? (
      <span className="font-mono">you</span>
    ) : (
      <Link href={href} className={`font-mono ${open}`} title="Your profile">
        you
      </Link>
    );
  }

  if (!profile) {
    if (plain)
      return (
        <span className="font-mono">
          <CopyAddress address={address} full={full} inLink />
        </span>
      );
    return (
      <span className="inline-flex items-baseline gap-1 font-mono">
        <Link href={href} className={`${full ? "break-all" : ""} ${open}`} title="Open profile">
          {full ? address : shortAddress(address)}
        </Link>
        <CopyAddress address={address} iconOnly />
      </span>
    );
  }

  const label = (
    <>
      {profile.provider === "twitter" && <XLogoIcon className="size-3 shrink-0" />}
      <span className="font-semibold">{profile.provider === "twitter" ? `@${profile.handle}` : profile.handle}</span>
    </>
  );
  return (
    <span className="inline-flex items-baseline gap-1.5" title={`${PROFILE_LABEL[profile.provider]} account linked to ${address}`}>
      {plain ? (
        <span className="inline-flex items-center gap-1">{label}</span>
      ) : (
        <Link href={href} className={`inline-flex items-center gap-1 ${open}`}>
          {label}
        </Link>
      )}
      <span className="font-mono text-[0.7rem] opacity-70">
        <CopyAddress address={address} full={full} inLink={plain} />
      </span>
    </span>
  );
}
