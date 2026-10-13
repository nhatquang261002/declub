"use client";

import { useMemo } from "react";
import type { Hex } from "viem";
import { useIntent } from "@/hooks/usePool";
import { useNow } from "@/hooks/useNow";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { assetsToDraft, type DraftRow } from "@/lib/assetDraft";
import { erc20Tokens } from "@/lib/assets";
import { sameAddress } from "@/lib/deals";
import { isLive } from "@/lib/intents";

const HASH = /^0x[0-9a-fA-F]{64}$/;

export type MatchDraft =
  { state: "none" } | { state: "loading" } | { state: "unavailable"; reason: string } | { state: "ready"; hash: Hex; give: DraftRow[]; want: DraftRow[] };

/**
 * The create form for the other side of someone's signed swap: you give what they want and want what they
 * give, so the two fit and the matcher can settle them as a pair. Their token amounts are minimums, so
 * giving exactly that much is enough. Says why when it can't be offered; the form is then empty as usual.
 */
export function useMatchDraft(param: string | null, me: string | undefined): MatchDraft {
  const hash = param && HASH.test(param) ? (param as Hex) : undefined;
  const now = useNow(30_000);
  const { row, isLoading, error } = useIntent(hash);
  const tokens = useMemo(() => (row ? erc20Tokens([...row.intent.give, ...row.intent.want]) : []), [row]);
  const { info, isLoading: infoLoading } = useTokenInfo(tokens);

  const rows = useMemo(() => {
    if (!row) return null;
    const decimalsOf = (token: string) => info.get(token.toLowerCase())?.decimals;
    const give = assetsToDraft(row.intent.want, decimalsOf);
    const want = assetsToDraft(row.intent.give, decimalsOf);
    return give && want ? { give, want } : null;
  }, [row, info]);

  if (!param) return { state: "none" };
  if (!hash) return { state: "unavailable", reason: "That isn't a signed swap id." };
  if (isLoading || (row && infoLoading)) return { state: "loading" };
  if (error) return { state: "unavailable", reason: "Couldn't load that signed swap from the pool." };
  if (!row) return { state: "unavailable", reason: "The pool doesn't know that signed swap." };
  if (sameAddress(row.intent.maker, me)) return { state: "unavailable", reason: "That swap is yours. A match has to come from another wallet." };
  if (!isLive(row.status) || row.intent.deadline < BigInt(now)) return { state: "unavailable", reason: "That swap is no longer open." };
  if (!rows) return { state: "unavailable", reason: "That swap can't be mirrored here. Start a new swap instead." };
  return { state: "ready", hash, ...rows };
}
