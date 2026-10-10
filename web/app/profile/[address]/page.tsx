"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { isAddress } from "viem";
import { CopyAddress } from "@/components/CopyAddress";
import { FollowButton } from "@/components/FollowButton";
import { BadgeCheckIcon, ExternalIcon, UserIcon, XLogoIcon } from "@/components/Icons";
import { Tabs } from "@/components/Tabs";
import { WalletAvatar } from "@/components/WalletAvatar";
import { EditProfile } from "@/components/profile/EditProfile";
import { ProfileClubs, ProfileDeals, ProfileFollowing, ProfilePosts } from "@/components/profile/ProfileLists";
import { ProfileTrophies } from "@/components/profile/ProfileTrophies";
import { useNow } from "@/hooks/useNow";
import { useFollows } from "@/hooks/useSocial";
import { useFollowGraph, useMyWallets, useWalletProfile } from "@/hooks/useWalletProfile";
import { explorerAddress } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { PROFILE_LABEL, handleLabel, profileUrl } from "@/lib/profiles";

type Section = "clubs" | "deals" | "posts" | "following";

/**
 * A wallet's profile (ADR 0042): what its owner chose to show (avatar, name, bio, and the X or
 * Discord handle they linked), then the Clubs it is in, the deals it has open, the signed posts it wrote and the wallets it follows. Anyone can
 * open it; the owner also gets the controls to change it.
 */
export default function ProfilePage() {
  const { address } = useParams<{ address: string }>();
  if (!isAddress(address, { strict: false })) {
    return (
      <div className="club-panel mx-auto max-w-md px-6 py-12 text-center">
        <p className="text-lg font-black">No profile here</p>
        <p className="mt-1 text-sm text-muted">That isn’t a wallet address.</p>
        <Link href="/clubs" className="btn-primary mt-5">
          See all Clubs
        </Link>
      </div>
    );
  }
  return <Profile address={address.toLowerCase()} />;
}

function Profile({ address }: { address: string }) {
  const now = useNow(30_000);
  const mine = useMyWallets().has(address);
  const card = useWalletProfile(address, mine);
  const follows = useFollows();
  const graph = useFollowGraph(address);
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<Section>("clubs");

  const { profile, about } = card.data ?? { profile: null, about: null };
  const handle = profile ? handleLabel(profile) : null;
  const xUrl = profile ? profileUrl(profile) : undefined;
  // Name first, then the verified handle, then the address: the address is always on the page.
  const title = about?.name ?? handle ?? shortAddress(address);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <section className="club-panel flex flex-col gap-5 px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          <WalletAvatar seed={address} size="5.5rem" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1
                className="min-w-0 break-words text-2xl font-black tracking-tight sm:text-3xl"
                title={about?.name ? "A name its owner chose. Anyone can pick any name." : undefined}
              >
                {title}
              </h1>
              {mine && (
                <span className="chip chip-mint">
                  <UserIcon />
                  This is you
                </span>
              )}
            </div>
            {profile && (
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="chip chip-mint" title={`The ${PROFILE_LABEL[profile.provider]} account linked to this wallet, checked when they signed in`}>
                  <BadgeCheckIcon />
                  Verified {PROFILE_LABEL[profile.provider]}
                </span>
                {xUrl ? (
                  <a
                    href={xUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-bold underline decoration-dotted underline-offset-2"
                  >
                    {profile.provider === "twitter" && <XLogoIcon className="size-3.5" />}
                    {handle}
                    <ExternalIcon className="size-3 opacity-60" />
                  </a>
                ) : (
                  <span className="font-bold">{handle}</span>
                )}
              </p>
            )}
            {about?.bio && <p className="mt-1 max-w-prose whitespace-pre-line break-words text-[0.95rem] leading-6">{about.bio}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
              <CopyAddress address={address} full className="text-left" />
              <a
                href={explorerAddress(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-sans font-bold underline underline-offset-2"
              >
                Explorer <ExternalIcon className="size-3" />
              </a>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mine ? (
              <button type="button" className="btn-secondary" aria-expanded={editing} onClick={() => setEditing(!editing)}>
                {editing ? "Done" : "Edit profile"}
              </button>
            ) : (
              <FollowButton target={address} follows={follows} />
            )}
          </div>
        </div>
        <dl className="flex gap-6 border-t border-[#111318]/10 pt-4 text-sm">
          <div>
            <dt className="kicker">Followers</dt>
            <dd className="text-lg font-black tabular-nums">{graph.followers}</dd>
          </div>
          <div>
            <dt className="kicker">Following</dt>
            <dd className="text-lg font-black tabular-nums">{graph.following.length}</dd>
          </div>
        </dl>
        <ProfileTrophies trophies={card.data?.trophies ?? []} />
        {mine && !editing && !about && !card.isLoading && (
          <p className="text-sm text-muted">
            Nothing about you yet.{" "}
            <button type="button" className="font-bold underline" onClick={() => setEditing(true)}>
              Add a name and a bio
            </button>
            , or pick an avatar.
          </p>
        )}
      </section>

      {mine && editing && <EditProfile />}

      <section aria-label="Activity">
        <Tabs
          label="Show"
          value={section}
          onChange={setSection}
          options={[
            { value: "clubs", label: "Clubs" },
            { value: "deals", label: "Deals" },
            { value: "posts", label: "Posts" },
            { value: "following", label: "Following" },
          ]}
          className="mb-4"
        />
        {section === "clubs" && <ProfileClubs address={address} fresh={mine} now={now} />}
        {section === "deals" && <ProfileDeals address={address} now={now} />}
        {section === "posts" && <ProfilePosts address={address} now={now} />}
        {section === "following" && <ProfileFollowing address={address} />}
      </section>
    </div>
  );
}
