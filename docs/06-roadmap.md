# 06 · Roadmap

Status key: `[ ]` todo · `[~]` in progress · `[x]` done

## Phase 0: Foundations

- [x] Repo layout, `.gitignore`, `.env.example`
- [x] Product spec, architecture, contract design, security, frontend docs
- [x] ADRs 0001–0003
- [x] v1 escrow interface
- [x] `foundry.toml`, `remappings.txt`

## Phase 1: Protocol

**Goal:** a tested v1 escrow deployed to Monad testnet with MockChog.

- [x] Install Foundry (forge 1.8.3)
- [x] `forge install` forge-std + OpenZeppelin v5.7.0
- [x] `MockChog.sol` (ERC721Enumerable, open mint, on-chain SVG + traits)
- [x] v1 escrow: create / fill / cancel / reclaimExpired / withdraw
- [x] Unit tests per function
- [x] Fuzz tests
- [x] Invariant tests I1–I7 + liveness
- [x] `forge coverage` 100% on the v1 escrow, gas measured
- [x] Slither run, findings triaged ([04](04-security.md#static-analysis))
- [x] Confirm the Monad testnet chain id, RPC and verifier (10143, Sourcify via MonadVision)
- [x] `script/Deploy.s.sol` + tests, dry run against Monad testnet succeeds
- [x] Deploy and verify on testnet. The v1 escrow `0xA3301cec…c298` and MockChog `0x220a2C52…26e4` at block 66352698, both a Sourcify full match (addresses in the [README](../README.md#deployments-monad-testnet-chain-10143))

## Phase 2: Marketplace UI

**Goal:** run the demo end to end in a browser.

- [x] `create-next-app web` (Next.js 16, TS, Tailwind 4, App Router; npm)
- [x] wagmi 3 config + Monad testnet chain + connect button (injected / EIP-6963)
- [x] ABI generation (`@wagmi/cli` Foundry plugin → `web/lib/abi.ts`, `npm run abi`)
- [x] Trade loading from storage: `tradeCount` + multicall `getTrade` ([ADR 0004](adr/0004-read-deals-from-storage.md); the public RPC caps `eth_getLogs` at 100 blocks)
- [x] `useTxFlow` states + error mapping
- [x] Open Trades (Open / For you / All tabs, paging); now the `/deals` list
- [x] My Chogs (+ MockChog mint panel for demo wallets). Since removed: the NFT picker in Create lists what a wallet holds
- [x] Create Trade (approval step, form rules), for v1. Replaced by `/create` for V2 and signed swaps
- [x] Trade Detail (escrow panel, fill / cancel / reclaim), for v1. Replaced by the V2 deal page `/v2/deal/[id]` (`DealSheet`)
- [x] History + withdraw (local fill record until an indexer exists; see the server-side record below). v1's `withdraw` is V2's `claim` now
- [x] Server-side saves: fills (receipt-verified), notification read markers and recent collections move to Upstash for signed-in users, with the browser as fallback ([ADR 0012](adr/0012-server-side-saves.md))
- [x] Fill watcher: `GET /api/cron/fills` (behind `CRON_SECRET`) follows the finalized head from a cursor in 100-block chunks and feeds every fill and V2 creation through the same receipt checks as a report, so History and Momentum also have deals the app never saw ([ADR 0019](adr/0019-fill-watcher.md)). Tested with a fake chain, run end to end against a local anvil and scanned live on Monad testnet. Still to do: pick a scheduler (Vercel Hobby crons run only daily) and set `FILL_WATCHER_START_BLOCK` to backfill
- [x] `npm run build` + lint clean (Next.js 16.3.6, then 7 routes; the app now has 13 pages, 3 of them redirects, and 25 API routes)
- [ ] Manual pass on Monad testnet (create → fill → cancel / reclaim → claim with two wallets), on a redeploy of the current source (see Phase 4)
- [ ] Rehearse the demo script ([01 · Product Spec §9](01-product-spec.md#9-demo-script))

## Phase 3: Differentiation

- [x] Trait-based requests using a Merkle set, in v1 ([design](03-contract-design.md#phase-3-trait-based-requests)). The app uses V2's version (Phase 4)
- [x] Trait metadata pipeline (metadata traits → matching ids → root in the create flow)
- [x] Direct-request inbox (the **For you** tab filters open deals by `taker = me`)
- [x] Search and filters on Open Trades, client-side (Chog / trade # / maker address, MON filter, sort by ending soon). Loaded up to 200 trades while a filter was active. Superseded by the server-side search below
- [x] Trait search on Open Trades: matched traits of Chogs on either side ("crown", "Hat: Crown"), and named trait-request trades by their Merkle root. v1 only, removed with it. The V2 query matches a deal id, NFT id, maker or taker, token address or symbol (`web/lib/dealFiltersV2.ts`); a trait deal is named by its on-chain spec
- [x] Server-side filtering across the whole book, without an indexer: the server holds every deal in memory (closed ones read once, open ones re-read; `web/lib/server/dealBook.ts`) and `GET /api/deals` answers a searched, filtered page; Club markets use it too ([ADR 0020](adr/0020-server-side-deal-book.md)). History and notifications still read the newest 200
- [x] Trait lookups beyond MockChog: trait requests scan any collection's metadata on the server (`/api/collection-traits`, [ADR 0006](adr/0006-trait-requests-in-v2.md)). MockChog's `traitsOf` is only read to display a Chog's traits
- [x] Notifications: in-app bell + opt-in browser alerts, derived client-side from trade state. Push while no tab is open needs the indexer ([ADR 0003](adr/0003-no-indexer-in-v1.md))

## Phase 4: Protocol expansion

- [x] Generic `Asset[]` model: any ERC-721, ERC-20, native. `DeClubEscrow`, a separate contract beside v1 ([ADR 0005](adr/0005-generic-asset-model.md)); 100% coverage, invariants (now V1–V9). Deployed to testnet in builds that predate the fee (see the README)
- [x] Multi-asset trades (up to 10 assets per side, any mix; same contract)
- [x] Deploy `DeClubEscrow` to testnet (`script/DeployEscrow.s.sol`) and verify. `0x8a05…CC75` and a MockERC20 (mUSD) `0xd300…6F6c`, blocks 66874644 / 66874652, both on Sourcify
- [x] Frontend for V2, plumbing: V2 ABI, optional config, a deal model and hooks, `useTokenInfo`, error copy. Today these are `DealV2` (`web/lib/dealsV2.ts`), `useDealsV2`, `useDealV2` and `useDealBook`; the v1 adapter went with v1
- [x] Frontend for V2, create and detail screens (now `/create`, which `/v2/create` redirects to, and `/v2/deal/[id]`): asset editor, exact-amount ERC-20 approvals, NFT collection approvals, accept / cancel / reclaim, `claim`. Typechecked and built; not exercised against a deployed V2 yet
- [x] Frontend for V2, list: a Chogs / Multi-asset switch on Trades and History (removed with v1, below), V2 cards and filters (search by NFT id, token symbol or address, maker; MON filter; sort), fills remembered per contract. Typechecked, linted and built; the filter logic was checked with sample trades, but the list has not been exercised against the deployed V2 yet
- [x] Trait requests in V2: `ERC721Trait` asset with a Merkle root, `createTraitTrade` with an on-chain spec, `fillTraitTrade`. Several traits per request (any / all), and a server scan of the chosen collection's traits ([ADR 0006](adr/0006-trait-requests-in-v2.md)). Contract and frontend done, 31 tests, 100% coverage. Deployed with open offers (see the README), source-verified; the create and fill screens still need a pass against it
- [x] Open offers ("make me an offer"): the maker lists assets with a text note and takers escrow proposals. Contract, tests and frontend (create mode, offers list, send / accept / reject / withdraw) done. Deployed: `DeClubEscrow` `0x7359…E1bB` at block 67163690 (Sourcify full match, before the fee was added), frontend pointed at it. The screens still need a pass against it ([ADR 0007](adr/0007-open-offers.md))
- [~] Trade intents + off-chain matcher ([ADR 0008](adr/0008-trade-intents.md), accepted): signed EIP-712 intents, `DeClubIntents` settles wallet to wallet, off-chain pool and matcher. Contract done (65 tests then, 97 now; 100% coverage) and deployed to testnet with `script/DeployIntents.s.sol`: `0x54B6…0Fd2` at block 67194397 (Sourcify full match). That deployment signs with the domain `("ChogSwapIntents", "1")`; the code, matcher and app have since moved to `("DeClubIntents", "1")` with `feeToken` / `maxFee`, so it no longer matches and must be redeployed. Pool and local matcher done in [`matcher/`](../matcher/) (79 tests now, against a local anvil: pairs, rings, revoked approvals, ERC-1271 makers, the HTTP API, the process). Frontend built and merged into the deal screens: a *Sign only* choice on `/create` (EIP-712 signing, approvals, short-deadline default, consent notice), signed swaps tagged **Signed** in the `/deals` and `/history` lists beside locked deals, `/intent/[hash]` (status, cancel, settled cycle), and bell notifications; typechecked, linted and built, the library layer cross-checked against the contract and a live pool, but not yet clicked through with a real wallet on testnet
- [ ] Multi-party ring swaps ([ADR 0009](adr/0009-ring-swaps.md), accepted, `MAX_CYCLE = 4`): cycles of the same signed intents through the same `settle`, so no separate contract. Contract side done (rings of 2–4, worst case 3.3M gas) and the matcher's cycle search is built and tested (three-way ring settled end to end); the "matched in a ring" display is built (`CycleView`), not yet seen with a real ring on testnet
- [x] Privy sign-in, wallet-first (Google / X / Discord / wallet; email is linkable for recovery; linked accounts and active-wallet switching; embedded wallets opt-in) and an account screen to link, unlink and share profiles ([ADR 0010](adr/0010-privy-sign-in.md)). Optional behind `NEXT_PUBLIC_PRIVY_APP_ID`; injected-wallet fallback remains available
- [x] Privy webhooks keep verified profiles and Club wallets in step: `user.linked_account` / `unlinked_account` / `transferred_account` / `deleted` re-sync current state from Privy (`POST /api/webhooks/privy`, Svix-verified, replay-safe). Route and logic are tested with signed requests ([ADR 0013](adr/0013-privy-webhooks.md))
- [x] Make a deal for @handle: “who can accept” accepts an X or Discord handle, looks up the Privy user, and narrows the result to wallets that user has explicitly shared. The maker selects the wallet and the deal locks to that address ([ADR 0017](adr/0017-deal-by-handle.md)). Lookup and route are unit-tested
- [ ] Live Privy validation: configure the deployed origin, `PRIVY_APP_SECRET`, Upstash persistence, and webhook signing secret; run the account, profile, handle lookup, Club wallet-sync, and webhook checklist in [10 · Privy](10-privy.md)
- [ ] Verified-collections list for mainnet: a curated `web/data/assets.json` marks collections and tokens as verified or blocked, and the UI badges, warns or hides by tier. It only changes what the UI shows; the contracts stay permissionless ([ADR 0014](adr/0014-verified-collections-list.md), accepted). The list file is built (`web/data/assets.json`, which Clubs use); the badges and warnings are still to build
- [x] Protocol fee, $2 per side: a flat fee when a deal completes, so a pair pays $4 and a ring of n pays n × $2. `DeClubEscrow` takes MON escrowed with each side (refunded on cancel, reclaim, reject or withdraw); `DeClubIntents` pulls WMON (wrapped MON) from every maker in `settle` (signed in the intent, domain version bump). Amounts and recipient fixed at deploy (**superseded by [ADR 0018](adr/0018-adjustable-protocol-fee.md)**, next item: the amount is now adjustable), shown in the review, fill and signing steps ([ADR 0015](adr/0015-protocol-fee.md)). Built: contracts (100% coverage, invariants V9 and N6), deploy scripts with `MockWMON`, the matcher (66 tests then) and the app (typechecked, linted, built). Not deployed: the testnet contracts predate it (see the redeploy item)
- [x] Adjustable protocol fee: a fee admin (a Safe apart from the recipient's) can cut the fee at once or raise it after 7 days, never above a ceiling fixed at deploy, and can renounce. An escrow deal keeps the fee it was listed with; an intent signs `maxFee`, the most it pays, and is charged the fee in force (EIP-712 domain version `3`). Launch at $5 per side, ceiling about 4× that ([ADR 0018](adr/0018-adjustable-protocol-fee.md)). Built: `FeeAdmin` shared by both contracts (100% coverage, admin suite against both, invariants with the fee changing mid-run), deploy scripts (`PROTOCOL_FEE_MAX_WEI`, `FEE_ADMIN`), the matcher re-reading the fee every pass (79 tests) and the app (per-deal fee on fills and proposals, queued raises shown, typechecked, linted, built)
- [x] Audit follow-up (2026-10-03): Slither 0.11.4 on `DeClubEscrow`, `DeClubIntents` and `FeeAdmin`, every finding triaged ([04](04-security.md#static-analysis)); invariant suites against hostile NFT collections for both contracts, each shown to catch the bug it targets by mutation; a Halmos proof that every pair and 3-ring of ERC-20 intents pays every `want`; deploy scripts that refuse a fee without a ceiling, a fee nobody can change unless `FEE_FIXED=true`, and a `FEE_TOKEN` that doesn't wrap and unwrap like WMON
- [x] **Redeployed 2026-10-05** `DeClubEscrow` and `DeClubIntents` from the current source (2 MON fee, 8 MON ceiling, mock WMON; addresses in the [README](../README.md#deployments-monad-testnet-chain-10143)). Original item:  `DeClubEscrow` and `DeClubIntents` from the current source (`script/DeployEscrow.s.sol`, `script/DeployIntents.s.sol`, with `PROTOCOL_FEE_WEI`, `PROTOCOL_FEE_MAX_WEI`, `FEE_RECIPIENT`, `FEE_ADMIN` and `DEPLOY_MOCK_WMON=true`), then set `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS`, `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` and `FILL_WATCHER_START_BLOCK` and update the README. Every deployed V2 and intents contract predates the fee and `FeeAdmin` (`fee()` reverts), and the intents one signs with the old domain, so the fee and signed swaps can't work on testnet until then
- [ ] Protocol fee, before mainnet: the canonical WMON address, the recipient Safe and a separate admin Safe, the dollar-to-MON amount for `PROTOCOL_FEE_WEI` ($5 per side) and `PROTOCOL_FEE_MAX_WEI` (about 4×), a check that the fee covers the matcher's worst-case settlement gas, a runbook for re-pricing it, and a click-through on testnet with a real wallet (wrap, approve, sign, settle; create, fill, cancel and reject for escrow; a cut and a raise)
- [x] No v1 on mainnet: the v1 escrow has no fee and isn't deployed there ([ADR 0018](adr/0018-adjustable-protocol-fee.md)). Removed from the app: the deals list, History, `/deal/[id]`, `ChogsFlow` and the Chogs / Multi-asset switch are gone, and the deal contracts have no fallback address ([ADR 0020](adr/0020-server-side-deal-book.md)). Only the Chog collection still defaults to the testnet MockChog `0x220a…26e4` when `NEXT_PUBLIC_CHOG_ADDRESS` is blank
- [ ] Reputation (the Club member Momentum below is its first step)
- [ ] Clubs and Momentum: a community per verified asset with a Market, Board and Members, a Holder badge, roles (admin, Owner, Moderator, Member) and an activity score ([ADR 0016](adr/0016-clubs-and-momentum.md), accepted; [spec](09-clubs.md)). Build order: (1) `web/data/assets.json` + loader, store ops, `ingestTx` + `reportTx`, `momentum.ts`, tests; (2) read-only Club pages and the matcher `token=` filter; (3) membership, Holder, leaderboard, webhook wallet sync; (4) board, reports, roles, moderation log; (5) user guide and docs. Steps 1 to 5 built (assets list, Momentum, receipt-verified activity log, `POST /api/activity`, `npm test` in `web/`; read-only `/clubs` and `/clubs/[address]` with the Market tab, `/api/clubs`, and the matcher's `token=` / `after=` filters; membership, the Holder badge, the Members leaderboard and wallet sync from the Privy webhook; the Board with reports and auto-hide, roles, bans, pins, the Club page, the moderation log and admin tools, with a permission matrix tested role by role; the user guide and frontend notes). Left open: a click-through on Monad testnet with two wallets and real Privy sign-in (join, Holder check, `owner()` claim, posting and moderation, `/api/activity` on a real receipt), the Club banner image, and the "Not in v1" list in [09-clubs.md](09-clubs.md)
- [~] Pre-mainnet testing ([11 · Test plan](11-test-plan.md)): `scripts/test-all.sh` runs every suite; `e2e/` runs 21 chain scenarios against the real deploy scripts on anvil (all passing) or on testnet, a read-only deployment verifier (safe on mainnet; it confirms the current testnet contracts are stale) and web smoke tests. Left: the manual testnet run on a redeploy, and the go/no-go checklist
- [ ] External audit before mainnet with real Chogs

## Phase 5: De(al) Club

**Goal:** Clubs are the product and their members own a share of the market (the Monad hackathon's social and culture track). [ADR 0021](adr/0021-declub-pivot.md).

- [x] Rename to De(al) Club / DeClub: contracts (`DeClubEscrow`, `DeClubIntents` with the domain `("DeClubIntents", "1")`), tests, deploy scripts, the matcher, the app, env vars (`NEXT_PUBLIC_DECLUB_*`), the store prefix (`declub:`), the wordmark and the docs. ADRs 0001–0020 keep their names
- [x] Delete the v1 escrow (`OnDeal`) and its tests; `DeployChog.s.sol` deploys the testnet Chog collection alone
- [x] `DeClubRewards` ([ADR 0022](adr/0022-club-rewards.md)): per-epoch Merkle roots funded by the operator, a claim delay to revoke a wrong root, a window then a sweep. 49 tests, invariants R1–R4 checked by mutation, 100% coverage, a root built by the web app verified on chain, `DeployRewards.s.sol` with mainnet rules
- [x] Epoch builder: fees recorded per swap (`ActivityEvent.fee`, settlement receipts for signed swaps), 40% to Holders by holdings and 20% to the Owner per Club, carry-over, built in order and once, `npm run rewards:epoch [--publish]`, public epoch, account and Club routes
- [x] Rewards screens: the Club's Rewards tab, the Owner's Club-fund alert, Your Club rewards on Account, one claim for every open epoch
- [x] Signed posts and follows ([ADR 0023](adr/0023-signed-posts-and-lenses.md)): EIP-712 under `("DeClub Social", "1")`, signed by the Club wallet, checked on the server (ERC-1271 too), exported per Club and per wallet; follows per wallet, newest wins
- [x] Feed lenses: Newest, Top traders, Holders, Following, as pure functions over public inputs
- [x] The app and docs lead with Clubs: home page, nav, Clubs and Deals guides, product spec and demo script, README
- [x] e2e on anvil: a real swap's fee through the app's builder to claims on `DeClubRewards`, revoke, over-claim and sweep (RW-01 to RW-03)
- [ ] Deploy `DeClubEscrow`, `DeClubIntents` and `DeClubRewards` on testnet, verify them on Sourcify, and set the addresses in `.env` and the README
- [ ] Click-through on testnet with real wallets: join as a Holder, swap, build and publish a short epoch, claim as a Holder and as the Owner, sign a post, follow, switch lenses, read the exports
- [x] Slither on `DeClubRewards` (0.11.6, 2026-10-06), triaged into [04 · Security](04-security.md#static-analysis): 15 results, none a bug
- [ ] Rename the repo folder and the GitHub repository; the support address (`support@on-deal.app`) still names the old domain
- [ ] Later: holder governance (signed votes on Moderators and Club-fund grants), curator credit for "Looking for" posts that lead to a swap, trade-receipt badges

## Open questions

| Question                                                                                                                        | Needed by                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Real Chog contract address (the app's default Chog collection), and is it `ERC721Enumerable`?                                  | Mainnet                      |
| WalletConnect (needs a project id + `@walletconnect/ethereum-provider`)? Privy's sign-in covers most mobile users, so maybe not | Mobile wallets               |
| Where do Chog traits live (IPFS JSON? API?), and are they final? The server's trait scan reads `tokenURI` metadata             | Mainnet trait requests       |
| Canonical WMON address, recipient and admin Safes, and the MON amounts for the $5 protocol fee and its ceiling (ADR 0018)      | Mainnet deploy               |
| The rewards operator Safe, and whether the fee recipient funds each epoch from it or forwards fees to it | Mainnet rewards |
| Should a Club's Holders vote on how the Club fund is spent instead of the Owner collecting it? | After the hackathon |
