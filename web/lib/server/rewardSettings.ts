import { isOwnerOrAdmin, mayActOn, roleOf } from "../clubRoles";
import { CLUB_RULE_BOUNDS, OWNER_RULES, checkRules, epochAt } from "../rewards";
import type { AssetEntry } from "../verifiedAssets";
import { roleIn, type Actor, type Deps } from "./board";
import { rewardBans, rewardBansKey, rulesView, saveRules, type RewardBan } from "./clubRules";
import { adminIds, appendLog, loadRoles } from "./clubState";
import { allRows } from "./members";
import { standingsKey } from "./streaks";
import type { Store } from "./store";

/**
 * What a Club's Owner decides about its rewards (ADR 0044): the rules, which take effect from the
 * next epoch, and who is banned from rewards, which applies to every epoch not yet closed. Both are
 * the Owner's (or an app admin's), both are logged, and both are published with each epoch.
 */

const nowOf = (deps: Deps) => deps.now?.() ?? Date.now();
const isAdmin = (deps: Deps, userId: string) => (deps.admins ?? adminIds()).has(userId);
const epochNow = (deps: Deps) => epochAt(Math.floor(nowOf(deps) / 1000), deps.epochs?.genesis, deps.epochs?.length);

export type RulesView = Awaited<ReturnType<typeof rulesView>> & { epoch: number; bounds: typeof CLUB_RULE_BOUNDS };

/** The Club's rules now and any change waiting, with the bounds an Owner may set them within. Public. */
export async function clubRulesView(store: Store, entry: AssetEntry, deps: Deps = {}): Promise<RulesView> {
  const n = epochNow(deps);
  return { epoch: n, ...(await rulesView(store, entry.address, Math.max(0, n))), bounds: CLUB_RULE_BOUNDS };
}

/**
 * The Owner changes some of the Club's paying rules (`OWNER_RULES`). Only the rules sent change; each is checked against
 * its bounds. The change waits for the next epoch, and a second change in the same epoch replaces
 * the first.
 */
export async function updateRules(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  input: unknown,
  deps: Deps = {},
): Promise<{ ok: true; view: RulesView } | { ok: false; reason: "forbidden" | "archived" | "invalid"; message?: string }> {
  const token = entry.address.toLowerCase();
  if (!isOwnerOrAdmin(await roleIn(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  const n = epochNow(deps);
  const before = await rulesView(store, token, Math.max(0, n));
  const base = before.next?.rules ?? before.current;
  const checked = checkRules(input, base);
  if (!checked.ok) return { ok: false, reason: "invalid", message: checked.message };
  const changed = OWNER_RULES.filter((k) => checked.rules[k] !== base[k]);
  if (changed.length === 0) return { ok: true, view: await clubRulesView(store, entry, deps) };
  const from = Math.max(0, n + 1);
  await saveRules(store, token, { from, rules: checked.rules, at: nowOf(deps), by: actor.wallet });
  await appendLog(
    store,
    token,
    { actor: actor.wallet, action: "edit_rules", detail: `from epoch ${from}: ${changed.map((k) => `${k} ${base[k]} → ${checked.rules[k]}`).join(", ")}` },
    nowOf(deps),
  );
  return { ok: true, view: await clubRulesView(store, entry, deps) };
}

export type RewardBanView = { wallet: string; at: number; by: string };

/** Who is banned from the Club's rewards. The Owner, Moderators and admins may read it. */
export async function listRewardBans(store: Store, entry: AssetEntry, userId: string, deps: Deps = {}): Promise<RewardBanView[] | null> {
  const role = await roleIn(store, entry.address.toLowerCase(), userId, deps);
  if (role === "member") return null;
  return Object.values(await rewardBans(store, entry.address)).sort((a, b) => b.at - a.at);
}

/**
 * The Owner bans a member (named by their Club wallet) from rewards, or lifts it (ADR 0044). A banned
 * member isn't paid, and their likes and replies give nobody points. It applies to every epoch not
 * yet closed, the running one included; a closed epoch keeps what it froze. Nobody can be banned by
 * someone who doesn't outrank them.
 */
export async function setRewardBan(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  wallet: unknown,
  ban: boolean,
  deps: Deps = {},
): Promise<{ ok: true; wallet: string } | { ok: false; reason: "forbidden" | "not_found" | "invalid" | "no_change" }> {
  const token = entry.address.toLowerCase();
  if (typeof wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { ok: false, reason: "invalid" };
  const mine = await roleIn(store, token, actor.userId, deps);
  if (!isOwnerOrAdmin(mine)) return { ok: false, reason: "forbidden" };
  const w = wallet.toLowerCase();
  const bans = await rewardBans(store, token);
  const banned = Object.entries(bans).find(([, b]) => b.wallet === w);
  if (!ban) {
    if (!banned) return { ok: false, reason: "no_change" };
    delete bans[banned[0]];
  } else {
    // By the Club wallet the Members list shows, as for bans.
    const row = (await allRows(store, token)).find((r) => r.displayWallet === w);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.userId === actor.userId) return { ok: false, reason: "invalid" };
    const roles = await loadRoles(store, token);
    if (!mayActOn(mine, roleOf(roles, row.userId, isAdmin(deps, row.userId)))) return { ok: false, reason: "forbidden" };
    if (bans[row.userId]) return { ok: false, reason: "no_change" };
    bans[row.userId] = { wallet: w, at: nowOf(deps), by: actor.wallet } satisfies RewardBan;
  }
  await store.set(rewardBansKey(token), bans);
  // The live standings are cached for minutes: drop this Club's copy so the change shows now.
  await store.del(standingsKey(token));
  await appendLog(store, token, { actor: actor.wallet, action: ban ? "reward_ban" : "reward_unban", target: w }, nowOf(deps));
  return { ok: true, wallet: w };
}
