# ADR 0020: Search and filter the whole deal book on the server

**Status:** Accepted · 2026-10-03 · Web only. No contract, matcher or pool change. Lifts the "search, filters or sorting" trigger of [ADR 0003](0003-no-indexer-in-v1.md) without an indexer, reading storage as [ADR 0004](0004-read-deals-from-storage.md) does.

## Context

The deals page searched and filtered in the browser, over the newest 200 deals it had read (`tradeCount`, then one multicall of `getTrade`). Anything older couldn't be found, and every visitor paid for the same 200 reads. A Club's market had the same limit. ADR 0003 named search and filters as the point to add an indexer, and ADR 0019 named a hosted indexer as the answer for server-side filtering.

The app also still carried the first, Chog-only deal contract: a Chogs / Multi-asset switch on Deals and History, its own detail page, cards, filters and create flow. It has no fee, and the app fell back to its testnet address when none was set.

## Decision

**The server holds the book and the browser asks it for a page.**

- **`GET /api/deals`** takes the deals page's query (`tab`, `q`, `mon`, `sort`, `kind`), the connected wallet (`viewer`, for private offers and "For you"), up to two `token`s (a Club's market), and `page` / `size` (at most 50). It answers one page plus the totals for the tabs. Public, cached at the edge for 3 s.
- **The book** (`web/lib/server/dealBook.ts`) reads storage the way the browser did, once for everyone. A filled or cancelled deal never changes, so it is read once and kept. Open deals (expired ones included, until reclaimed) and new ids are read again when the book is more than 5 s old, 100 `getTrade` per multicall, 4 multicalls at a time. Requests during a refresh share it, and a failed refresh serves the last book. Symbols and names are read once per token or NFT collection, in locked deals and signed swaps alike, so a search for "USDC" or "Chog" finds every deal that holds it. (Until 2026-10-10 only ERC-20s in locked deals were read, so a collection name found nothing.)
- **Signed swaps** come from the pool on the same refresh, and are merged and filtered with the deals. The pool being down drops only them, and the answer says so. A signed swap travels as the pool's own row, so the browser recomputes its hash as it does for a row from the pool.
- **The filtering is shared code** (`web/lib/dealBook.ts`): the same tabs, search, MON filter and sort as before, now over every deal.
- **Everything lives in the server's memory.** A cold start reads the book again: one multicall per 100 deals that aren't closed yet, plus one per 100 closed ones the first time.
- **The first deal contract is gone from the app.** OnDealV2 is the deal contract. Without `NEXT_PUBLIC_ON_DEAL_V2_ADDRESS` there are no deals, rather than a fallback to a testnet address.

## Alternatives

- **A hosted indexer** (Envio, Ponder, The Graph). Still the answer once the book is too big to re-read its open deals every few seconds, or for history that only events hold. For filtering what storage already returns, it is one more service to run.
- **Keep the book in the store** (Upstash) so cold starts are cheap. Closed deals would be one key each, and a cold read of thousands of keys costs about what reading them from the chain does. Worth it if cold starts become a problem.
- **Keep filtering in the browser, and read more.** Every visitor would read the whole book.

## Consequences

- Search, filters, tabs and paging cover every deal and every signed swap the pool lists, and the totals are exact.
- The server's RPC calls grow with the number of open deals, not with visitors. With many thousands open, the 5 s refresh gets expensive; that is the point to revisit the indexer.
- History and the notifications bell still read the newest 200 deals in the browser. Moving them needs a `party=` filter that includes deals a wallet filled, which the fill records (ADR 0012, 0019) can provide.
- A Club's market lists at most 50 locked deals per asset and says when there are more. It now leaves out private offers made to other wallets, like the deals page.
- Deal links were `/v2/deal/[id]`; the prefix was dropped later, and those links redirect to `/deal/[id]`.
