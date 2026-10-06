import { bookParams, pageBook, parseBookQuery, toWireListing, type BookResponse } from "../dealBook";
import { getBook, type Book } from "./dealBook";
import { fail } from "./gate";
import { clientId, getStore, withinLimit } from "./store";

// The book refreshes every few seconds and the list polls, so a short shared cache is enough.
const CACHE = { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=10" };

type Deps = { book?: () => Book | null; now?: () => number };

/** GET /api/deals: a page of the book for a query (lib/dealBook.ts). */
export function dealsHandler(deps: Deps = {}) {
  return async function GET(request: Request) {
    const query = parseBookQuery(new URL(request.url).searchParams);
    if (typeof query === "string") return fail(400, "bad_request", query);

    const book = (deps.book ?? getBook)();
    if (!book) return Response.json({ enabled: false } satisfies BookResponse, { headers: CACHE });

    const store = getStore();
    if (store && !(await withinLimit(store, "deals-read", clientId(request), 240, 60))) {
      return fail(429, "rate_limited", "Too many requests.");
    }

    const tab = query.tab === "all" ? "all" : "open";
    let source: Awaited<ReturnType<Book["source"]>>;
    try {
      source = await book.source(tab);
    } catch (error) {
      console.error(`deal book read failed (${bookParams(query)}):`, error);
      return fail(502, "unavailable", "The deals couldn't be read from the chain. Try again in a moment.");
    }

    const now = Math.floor((deps.now ?? Date.now)() / 1000);
    const page = pageBook(source, query, now);
    const body: BookResponse = {
      enabled: true,
      items: page.items.map(toWireListing),
      total: page.total,
      counts: page.counts,
      signedError: source.signedError,
    };
    return Response.json(body, { headers: CACHE });
  };
}
