import Link from "next/link";
import { challengePath } from "@/components/ChallengeCard";
import { TrophyIcon } from "@/components/Icons";
import type { PublicTrophy } from "@/lib/challenges";

const PLACE = ["1st", "2nd", "3rd"];

/**
 * The challenges a wallet won (ADR 0050), as a shelf of medals: gold, silver or bronze for a ranked
 * place, gold "Winner" for a challenge with one prize for every winner. Each opens its challenge.
 */
export function ProfileTrophies({ trophies }: { trophies: readonly PublicTrophy[] }) {
  if (trophies.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-[#111318]/10 pt-4" aria-labelledby="trophies-heading">
      <h2 id="trophies-heading" className="kicker inline-flex items-center gap-1.5">
        <TrophyIcon className="size-3.5" />
        Trophies <span className="tabular-nums">{trophies.length}</span>
      </h2>
      <ul className="trophy-shelf">
        {trophies.map((t) => (
          <li key={`${t.club}:${t.challenge}`}>
            <Link href={challengePath(t.club, t.challenge)} className="trophy" data-place={t.place ?? 1}>
              <span className="challenge-place challenge-place-sm" data-place={t.place ?? 1} aria-hidden>
                {t.place ?? <TrophyIcon className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold">{t.title}</span>
                <span className="block truncate text-xs font-semibold text-muted">
                  {t.place ? `${PLACE[t.place - 1] ?? `${t.place}th`} place` : "Winner"} · {t.clubName}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
