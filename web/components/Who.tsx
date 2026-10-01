"use client";

import { XLogoIcon } from "@/components/Icons";
import { useProfile } from "@/hooks/useProfiles";
import { shortAddress } from "@/lib/format";
import { PROFILE_LABEL, profileUrl } from "@/lib/profiles";

/**
 * A wallet as another trader sees it: "you", or the X / Discord account its owner chose to link
 * to it (ADR 0011), or the short address when they haven't. The address stays beside a handle so
 * it can be checked against the wallet in the deal. `plain` drops the link to the profile, for
 * places already inside a link (a deal card), where a nested anchor would be invalid.
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
  const text = full ? address : shortAddress(address);
  if (mine) return <span className="font-mono">you</span>;
  if (!profile) return <span className="font-mono break-all">{text}</span>;

  const url = plain ? undefined : profileUrl(profile);
  const label = (
    <>
      {profile.provider === "twitter" && <XLogoIcon className="size-3 shrink-0" />}
      <span className="font-semibold">{profile.provider === "twitter" ? `@${profile.handle}` : profile.handle}</span>
    </>
  );
  return (
    <span className="inline-flex items-baseline gap-1.5" title={`${PROFILE_LABEL[profile.provider]} account linked to ${address}`}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2"
        >
          {label}
        </a>
      ) : (
        <span className="inline-flex items-center gap-1">{label}</span>
      )}
      <span className="font-mono text-[0.7rem] break-all opacity-70">{text}</span>
    </span>
  );
}
