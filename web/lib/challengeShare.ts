import { isFlat, likesDecide, type PublicChallenge, type Winner } from "./challenges";
import { SITE_URL } from "./config";

/**
 * What a member posts on X about a Club challenge (ADR 0045): a win, their entry, an invitation to
 * enter, or the results. Pure, so the share button and the tests word it alike. The post links the
 * challenge's page, whose preview card (opengraph-image) shows the podium or the prize.
 */

/** The places in words; a ranked challenge pays at most three. */
const PLACE_WORDS = ["1st", "2nd", "3rd"];
export const placeWord = (place: number) => PLACE_WORDS[place - 1] ?? `${place}th`;

/** Clips a name or title so the post stays inside X's limit whatever it is given. */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "Oct 12, 00:00 UTC": when it ends, the same for every reader (an epoch ends on the hour, UTC). */
export function endsText(endsAt: number): string {
  const d = new Date(endsAt);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

/** "@a, @b and @c", or "@a, @b, @c and 4 more", for at most three names. */
export function namesText(names: readonly string[], total = names.length): string {
  const shown = names.slice(0, 3);
  const more = total - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export type ShareOptions = {
  /** The Club's name ("Chog"): the post says "the Chog Club". */
  club: string;
  /** The viewer's wallets, any case: a winner among them makes it their win. */
  viewerWallets?: readonly string[];
  /** A winner's name for the results (an X handle, "@chog"), or undefined to leave them unnamed. */
  nameOf?: (wallet: string) => string | undefined;
};

/** The viewer's own win, if any: their entry won, or a winner is one of their wallets. */
export function viewerWin(c: PublicChallenge, viewerWallets: readonly string[]): Winner | undefined {
  const mine = new Set(viewerWallets.map((w) => w.toLowerCase()));
  return c.settled?.winners.find((w) => (c.mine !== undefined && w.post === c.mine) || mine.has(w.wallet.toLowerCase()));
}

/**
 * The post's text, without the link (X adds that), always short: the title and the Club's name are
 * clipped, and at most three winners are named.
 */
export function challengeShareText(c: PublicChallenge, { club, viewerWallets = [], nameOf }: ShareOptions): string {
  const title = `“${clip(c.title, 60)}”`;
  const where = `the ${clip(club, 30)} Club on DeClub`;
  const winners = [...(c.settled?.winners ?? [])].sort((a, b) => a.place - b.place);
  const flat = isFlat(c.judging);

  const win = viewerWin(c, viewerWallets);
  if (c.phase === "settled" && win) {
    const head = flat ? `I’m a winner of ${title} in ${where} 🏆` : `I won ${placeWord(win.place)} place in ${title} in ${where} 🏆`;
    return `${head}\n\nPost about the Club on X, win its challenges.`;
  }
  if (c.phase === "open") {
    if (c.mine) {
      const ask = likesDecide(c) ? "Like my entry to push it up 👇" : "Enter yours before it ends 👇";
      return `I entered ${title} in ${where} ✍️\n\n${ask}`;
    }
    return `${clip(club, 30)} Club challenge: ${title} — enter by ${endsText(c.endsAt)} 🏆\n\nPost about it on X, share it on the Club’s Board 👇`;
  }
  if (c.phase === "settled" && winners.length > 0) {
    // The first three are named, only when every one of them has a name: a gap would misplace the rest.
    const shown = winners.slice(0, 3);
    const names = shown.map((w) => nameOf?.(w.wallet)).filter((n): n is string => !!n).map((n) => clip(n, 20));
    const named = names.length === shown.length;
    const head = `Results are in for ${title} in ${where} 🏆`;
    if (flat) {
      const count = `${winners.length} ${winners.length === 1 ? "winner" : "winners"}`;
      return named ? `${head}\n\n${count}: ${namesText(names, winners.length)}` : `${head}\n\n${count}.`;
    }
    return named ? `${head}\n\n${shown.map((w, i) => `${placeWord(w.place)}: ${names[i]}`).join("\n")}` : head;
  }
  if (c.phase === "closing" || c.phase === "judging") return `${title} in ${where} has ended. The results are coming 🏆`;
  return `A challenge in ${where}: ${title}`;
}

/** The challenge's page, which the post links: its preview card is the podium, or the prize. */
export const challengePageUrl = (token: string, id: string, origin: string = SITE_URL) => `${origin.replace(/\/+$/, "")}/clubs/${token.toLowerCase()}/challenges/${id}`;

/** The X compose link: the post's text, and the challenge's page. `origin` defaults to where the app is served. */
export function challengeShareUrl(c: PublicChallenge, options: ShareOptions & { token: string; origin?: string }): string {
  const url = challengePageUrl(options.token, c.id, options.origin);
  return `https://x.com/intent/post?text=${encodeURIComponent(challengeShareText(c, options))}&url=${encodeURIComponent(url)}`;
}
