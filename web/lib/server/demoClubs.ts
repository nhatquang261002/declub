import { createHash } from "node:crypto";
import type { ActivityEvent } from "../clubs";
import type { ClubProfile, StoredPost } from "../clubPosts";
import type { Roles } from "../clubRoles";
import { ON_DEAL_V2_ADDRESS } from "../config";
import { demoPace, type DemoPace } from "../demoClubs";
import type { MemberRow } from "../members";
import { profileKey, userWalletsKey, type StoredProfile } from "../profiles";
import { registry, type AssetEntry, type ClubEntry } from "../verifiedAssets";
import { activityKey, MAX_EVENTS_PER_CLUB } from "./activity";
import { postKey, postsKey } from "./board";
import { banKey, clubProfileKey, logKey, rolesKey, type Bans, type LogEntry } from "./clubState";
import { memberKey, membersKey, userClubsKey } from "./members";
import type { Store } from "./store";

/**
 * Mock Club data for development: members with verified handles, a busy board, roles, swaps and a
 * moderation log, so the Clubs screens can be seen full without anyone signing in or trading.
 * Seeded once into the in-memory store a dev server uses (lib/server/store.ts), never into Upstash
 * or a production build, and switched off with NEXT_PUBLIC_DEMO_CLUBS=false.
 *
 * Everything goes in under the same keys and shapes the real writes use, so the screens read it
 * through the real routes. The deals and transactions it names don't exist on chain.
 */

const DAY = 86_400;
const HOUR = 3_600;

/** A made-up wallet that is the same on every run. */
const wallet = (name: string) => `0x${createHash("sha256").update(`ondeal-demo:${name}`).digest("hex").slice(0, 40)}`;
const id32 = (name: string) => createHash("sha256").update(`ondeal-demo-id:${name}`).digest("hex").slice(0, 32);

type Person = { name: string; handle?: { provider: "twitter" | "discord"; handle: string }; holder: boolean };

const PEOPLE: Person[] = [
  { name: "chogmaxi", handle: { provider: "twitter", handle: "chogmaxi" }, holder: true },
  { name: "haloqueen", handle: { provider: "twitter", handle: "haloqueen" }, holder: true },
  { name: "monadmike", handle: { provider: "discord", handle: "monad.mike" }, holder: true },
  { name: "crownhunter", handle: { provider: "twitter", handle: "crownhunter" }, holder: false },
  { name: "wingsdao", handle: { provider: "twitter", handle: "wings_dao" }, holder: true },
  { name: "flipper", holder: false },
  { name: "lurker", handle: { provider: "discord", handle: "quiet.lurker" }, holder: true },
  { name: "newbie", holder: false },
  { name: "degen", handle: { provider: "twitter", handle: "degen_chog" }, holder: false },
  { name: "collector", holder: true },
];

const W = Object.fromEntries(PEOPLE.map((p) => [p.name, wallet(p.name)]));
const userId = (name: string) => `demo:${name}`;

/** [who, who, hours ago] for each completed swap. */
type Swap = [string, string, number];
/** [maker, hours ago] for each new deal. */
type Created = [string, number];

type ClubScript = {
  members: string[];
  owner?: string;
  moderators: string[];
  swaps: Swap[];
  created: Created[];
  posts: { by: string; kind: StoredPost["kind"]; text: string; hoursAgo: number; deal?: string; hidden?: StoredPost["hidden"] }[];
  pinned: number[];
  profile: Pick<ClubProfile, "description" | "links">;
  banned: string[];
};

/** The busy Club: a podium, a full board, a moderation log. */
const BUSY: ClubScript = {
  members: PEOPLE.map((p) => p.name),
  owner: "chogmaxi",
  moderators: ["monadmike"],
  swaps: [
    ["chogmaxi", "haloqueen", 3],
    ["haloqueen", "crownhunter", 9],
    ["chogmaxi", "monadmike", 20],
    ["wingsdao", "flipper", 30],
    ["monadmike", "collector", 46],
    ["chogmaxi", "wingsdao", 70],
    ["haloqueen", "degen", 96],
    ["crownhunter", "collector", 130],
    ["chogmaxi", "lurker", 200],
    ["flipper", "degen", 260],
    ["haloqueen", "monadmike", 400],
  ],
  created: [
    ["chogmaxi", 2],
    ["crownhunter", 5],
    ["degen", 12],
    ["haloqueen", 28],
    ["flipper", 50],
    ["newbie", 80],
  ],
  posts: [
    {
      by: "chogmaxi",
      kind: "note",
      hoursAgo: 120,
      text: "Welcome to the Mock Chog Club! Post what you're hunting under Looking for and attach your deal, so holders can take it in one click. Be nice.",
    },
    { by: "crownhunter", kind: "looking", hoursAgo: 1, deal: "12", text: "WTB any Chog with a crown, 2 MON over floor. Also open to a 1:1 for my halo Chog." },
    { by: "haloqueen", kind: "note", hoursAgo: 3, text: "Just swapped with @chogmaxi, settled in one transaction. This is how trading should feel." },
    { by: "degen", kind: "looking", hoursAgo: 6, text: "Looking for a wings Chog. Paying in mUSD, DM on X." },
    { by: "monadmike", kind: "note", hoursAgo: 14, text: "Reminder: a swap only counts toward Momentum when it completes. Wash trades count half." },
    { by: "flipper", kind: "note", hoursAgo: 18, hidden: "reports", text: "free chogs at totally-real-airdrop dot xyz" },
    { by: "newbie", kind: "note", hoursAgo: 40, text: "First time here. Is there a guide for trait requests?" },
    { by: "lurker", kind: "note", hoursAgo: 70, text: "Floor feels thin this week. Anyone else seeing fewer open offers?" },
  ],
  pinned: [0],
  profile: {
    description:
      "The project's own test collection on Monad testnet. Trade Chogs peer-to-peer, show off your halo, and find the crown you've been hunting.",
    links: ["https://x.com/monad", "https://docs.monad.xyz"],
  },
  banned: ["spammer"],
};

/** A quieter Club: a few members, one swap, nothing pinned. */
const QUIET: ClubScript = {
  members: ["monadmike", "collector", "degen", "newbie"],
  moderators: [],
  swaps: [["monadmike", "degen", 50]],
  created: [
    ["collector", 10],
    ["newbie", 100],
  ],
  posts: [{ by: "collector", kind: "looking", hoursAgo: 8, text: "Swapping mUSD for any Chog. Name your price." }],
  pinned: [],
  profile: { description: "", links: [] },
  banned: [],
};

async function seedClub(store: Store, entry: ClubEntry, script: ClubScript, nowMs: number) {
  const token = entry.address.toLowerCase();
  // A paired Club trades both its assets: every other swap is in its memecoin (or collection).
  const traded = (i: number) => (entry.linked && i % 2 === 1 ? [entry.linked.address.toLowerCase()] : [token]);
  const now = Math.floor(nowMs / 1000);
  const contract = (ON_DEAL_V2_ADDRESS ?? "0x0000000000000000000000000000000000000000").toLowerCase();
  let deal = 100;

  const events: ActivityEvent[] = [
    ...script.swaps.map(([a, b, hours], i): ActivityEvent => ({
      id: `0x${id32(`${token}:swap:${i}`)}${id32("pad")}:1`,
      kind: "swapped",
      contract,
      deal: String(deal++),
      block: 1_000_000 + i,
      at: now - hours * HOUR,
      parties: [W[a], W[b]],
      tokens: traded(i),
    })),
    ...script.created.map(([maker, hours], i): ActivityEvent => ({
      id: `0x${id32(`${token}:created:${i}`)}${id32("pad")}:0`,
      kind: "created",
      contract,
      deal: String(deal++),
      block: 2_000_000 + i,
      at: now - hours * HOUR,
      parties: [W[maker]],
      tokens: traded(i),
    })),
  ];
  await store.rank(
    activityKey(token),
    events.map((e) => ({ member: JSON.stringify(e), score: e.at })),
    MAX_EVENTS_PER_CLUB,
  );

  // Joined over the last few weeks, the Owner first.
  for (const [i, name] of script.members.entries()) {
    const person = PEOPLE.find((p) => p.name === name)!;
    const row: MemberRow = {
      userId: userId(name),
      wallets: [W[name]],
      displayWallet: W[name],
      holder: person.holder,
      // Checked "in the future", so the members list never re-reads these wallets' (empty) balances.
      holderCheckedAt: nowMs + 365 * DAY * 1000,
      joinedAt: nowMs - (30 - i * 2.5) * DAY * 1000,
    };
    await store.set(memberKey(token, row.userId), row);
    await store.addMember(membersKey(token), row.userId);
    await store.addMember(userClubsKey(row.userId), token);
  }

  const roles: Roles = { ...(script.owner ? { owner: userId(script.owner) } : {}), moderators: script.moderators.map(userId) };
  await store.set(rolesKey(token), roles);

  const ids = script.posts.map((_, i) => id32(`${token}:post:${i}`));
  for (const [i, p] of script.posts.entries()) {
    const post: StoredPost = {
      id: ids[i],
      userId: userId(p.by),
      wallet: W[p.by],
      kind: p.kind,
      text: p.text,
      ...(p.deal ? { link: { kind: "deal" as const, id: p.deal } } : {}),
      at: nowMs - p.hoursAgo * HOUR * 1000,
      ...(p.hidden ? { hidden: p.hidden } : {}),
    };
    await store.set(postKey(token, post.id), post);
    await store.rank(postsKey(token), [{ member: post.id, score: post.at }], 500);
  }

  const profile: ClubProfile = { ...script.profile, holdersOnlyPosts: false, pinned: script.pinned.map((i) => ids[i]) };
  await store.set(clubProfileKey(token), profile);

  if (script.banned.length > 0) {
    const by = W[script.owner ?? script.moderators[0]];
    const bans: Bans = Object.fromEntries(script.banned.map((name) => [userId(name), { wallet: wallet(name), at: nowMs - 2 * DAY * 1000, by }]));
    await store.set(banKey(token), bans);
  }

  if (script.owner) {
    const owner = W[script.owner];
    const log: Omit<LogEntry, "id">[] = [
      { at: nowMs - 6 * DAY * 1000, actor: owner, action: "edit_profile" },
      ...script.moderators.map((m) => ({ at: nowMs - 5 * DAY * 1000, actor: owner, action: "appoint_moderator", target: W[m] })),
      { at: nowMs - 5 * DAY * 1000 + 1, actor: owner, action: "pin_post", target: ids[0] },
      ...script.banned.map((name) => ({ at: nowMs - 2 * DAY * 1000, actor: owner, action: "ban", target: wallet(name) })),
      ...script.posts.flatMap((p, i) => (p.hidden === "reports" ? [{ at: nowMs - (p.hoursAgo - 1) * HOUR * 1000, actor: owner, action: "auto_hide", target: ids[i] }] : [])),
    ];
    await store.rank(
      logKey(token),
      log.map((entry, i) => {
        const full: LogEntry = { id: id32(`${token}:log:${i}`), ...entry };
        return { member: JSON.stringify(full), score: full.at };
      }),
      1_000,
    );
  }
}

/** A small seeded random source, so the same Club gets the same mock history on every run. */
function random(seed: string) {
  let n = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return () => {
    n = (Math.imul(n, 1_664_525) + 1_013_904_223) >>> 0;
    return n / 2 ** 32;
  };
}

/** When a pace's swaps happened (hours ago), how many there were, and how many people joined. */
const PACES: Record<DemoPace, { swaps: number; from: number; to: number; members: number; posts: number }> = {
  hot: { swaps: 16, from: 1, to: 150, members: 10, posts: 4 },
  busy: { swaps: 7, from: 2, to: 160, members: 8, posts: 3 },
  // All of it in the last two days: the weekly change is up.
  rising: { swaps: 5, from: 1, to: 48, members: 6, posts: 2 },
  steady: { swaps: 3, from: 10, to: 600, members: 5, posts: 1 },
  // All of it two to three weeks ago: still counted, and falling.
  fading: { swaps: 6, from: 200, to: 500, members: 4, posts: 1 },
  quiet: { swaps: 0, from: 0, to: 0, members: 2, posts: 0 },
};

const CHATTER: { kind: StoredPost["kind"]; text: (symbol: string) => string }[] = [
  { kind: "looking", text: (s) => `Looking for ${s}. Open to offers in MON or mUSD.` },
  { kind: "note", text: (s) => `${s} has been moving this week. Anyone else seeing more offers?` },
  { kind: "note", text: () => "Just closed a swap here, settled in one transaction. Smooth." },
  { kind: "looking", text: (s) => `WTB ${s}, will pay a little over the last trade.` },
  { kind: "note", text: () => "gm Club. Remember: only completed swaps count toward Momentum." },
];

/** A generated history for a mock Club, to the shape of its pace. */
function pacedScript(entry: AssetEntry, pace: DemoPace): ClubScript {
  const p = PACES[pace];
  const rand = random(entry.address);
  const pick = () => PEOPLE[Math.floor(rand() * PEOPLE.length)].name;
  const members = [...new Set(Array.from({ length: p.members * 3 }, pick))].slice(0, p.members);
  const between = () => Math.round(p.from + rand() * (p.to - p.from));
  const swaps: Swap[] = Array.from({ length: p.swaps }, () => {
    const a = pick();
    let b = pick();
    while (b === a) b = pick();
    return [a, b, between()];
  });
  return {
    members,
    owner: pace === "hot" || pace === "busy" ? members[0] : undefined,
    moderators: pace === "hot" ? members.slice(1, 2) : [],
    swaps,
    created: Array.from({ length: Math.ceil(p.swaps / 2) }, (): Created => [pick(), between()]),
    posts: Array.from({ length: p.posts }, (_, i) => {
      const line = CHATTER[(i + Math.floor(rand() * CHATTER.length)) % CHATTER.length];
      return { by: members[i % members.length], kind: line.kind, text: line.text(entry.symbol), hoursAgo: Math.round(1 + rand() * 72) };
    }),
    pinned: [],
    profile: { description: "", links: [] },
    banned: [],
  };
}

/** Fills `store` with mock activity: the project's own collection busy, any other real Club quiet, each mock Club at its pace. */
export async function seedDemoClubs(store: Store, nowMs = Date.now()): Promise<void> {
  for (const person of PEOPLE) {
    if (!person.handle) continue;
    const row: StoredProfile = { ...person.handle, userId: userId(person.name), updatedAt: nowMs };
    await store.set(profileKey(W[person.name]), row);
    await store.setMembers(userWalletsKey(row.userId), [W[person.name]]);
  }
  for (const [i, entry] of registry.clubs().entries()) {
    const pace = demoPace(entry.address);
    const script = pace ? pacedScript(entry, pace) : i === 0 ? BUSY : QUIET;
    // An archived Club keeps its history but takes no new members or posts.
    const archived = entry.club === "archived";
    await seedClub(store, entry, archived ? { ...script, members: [], owner: undefined, moderators: [], posts: [], pinned: [], banned: [] } : script, nowMs);
  }
}
