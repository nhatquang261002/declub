"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { isAddress } from "viem";
import { LoadError } from "@/components/ErrorPanel";
import { ArrowLeftIcon } from "@/components/Icons";
import { useChallenge } from "@/hooks/useChallenges";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useNow } from "@/hooks/useNow";
import { toClubInfo } from "@/lib/clubs";
import { registry } from "@/lib/verifiedAssets";
import { ChallengeDetail } from "../../ChallengeDetail";
import { Loading } from "../../parts";

/**
 * One challenge and the entries members posted into it (ADR 0045): `/clubs/<club>/challenges/<id>`.
 * The brief, what it pays, when it ends, the entry box for members, every entry with its likes, and
 * the Owner's controls. Linked from the challenge's card on the Board, the timeline and the Club's
 * Challenges tab.
 */
export default function ChallengePage() {
  const params = useParams<{ address: string; id: string }>();
  const entry = isAddress(params.address, { strict: false }) ? registry.clubFor(params.address) : null;
  if (!entry) {
    return (
      <div className="club-panel mx-auto max-w-md px-6 py-12 text-center">
        <p className="text-lg font-black">No Club here</p>
        <Link href="/clubs" className="btn-primary mt-5">
          See all Clubs
        </Link>
      </div>
    );
  }
  return <Challenge token={entry.address} id={params.id} />;
}

function Challenge({ token, id }: { token: string; id: string }) {
  const now = useNow(30_000);
  const entry = registry.clubFor(token)!;
  const info = toClubInfo(entry);
  const me = useClubMembership(token);
  const { challenge, isLoading, error } = useChallenge(token, id);
  const back = `/clubs/${token.toLowerCase()}?tab=challenges`;

  return (
    <>
      <Link href={back} className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold underline-offset-2 hover:underline">
        <ArrowLeftIcon /> {info.name} challenges
      </Link>
      {isLoading ? (
        <Loading label="Loading the challenge" rows={2} />
      ) : error && !challenge ? (
        <LoadError title="Couldn’t load the challenge" error={error} />
      ) : !challenge ? (
        <div className="club-panel mx-auto max-w-md px-6 py-12 text-center">
          <p className="text-lg font-black">No such challenge</p>
          <p className="mt-1 text-sm text-muted">It may have been removed, or the link is wrong.</p>
          <Link href={back} className="btn-primary mt-5">
            See the Club’s challenges
          </Link>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl">
          <ChallengeDetail
            c={challenge}
            token={token}
            now={now}
            club={info.name}
            owner={me.role === "owner" || me.role === "admin"}
            member={!!me.member}
            holder={!!me.holder}
            recheck={{ run: me.recheck, busy: me.rechecking }}
            wallet={me.wallet}
            archived={info.archived}
          />
        </div>
      )}
    </>
  );
}
