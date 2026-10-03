# Matcher: intent pool and local matcher

The off-chain half of [ADR 0008](../docs/adr/0008-trade-intents.md) and [ADR 0009](../docs/adr/0009-ring-swaps.md). Makers sign `Intent`s (give / want, nothing escrowed) and post them here. The matcher finds intents that satisfy each other, in pairs or rings of up to four, and settles them through `OnDealIntents.settle`.

It is one local Node process: an HTTP **pool** with a sqlite file, and a **matcher** loop that holds a funded testnet key and pays settlement gas. Only dependency: `viem`. Needs Node 24+ (it runs the `.ts` files directly and uses `node:sqlite`).

## Not trusted for safety

The contract checks every signature, nonce, deadline and transfer at settlement. This service can censor an intent or pick between valid counterparties. It can't change terms, move assets nobody signed for, or take anything. What it adds is liveness, and not wasting gas on settlements that would revert. Anyone can run their own pool and matcher against the same contract.

## Run it

```bash
# Root .env (see .env.example): the deployed contract and a funded TESTNET key
NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS=0x…
MATCHER_PRIVATE_KEY=0x…

cd matcher && npm install && npm start      # http://127.0.0.1:8787
```

The contract comes from `contracts/script/DeployIntents.s.sol` ([how to deploy](../contracts/script/README.md)). The key is the matcher's own account: it only pays gas and never holds anyone's assets. Use a key with testnet funds only. Real environment variables override `.env`.

The contract charges a protocol fee ([ADR 0015](../docs/adr/0015-protocol-fee.md)): every maker in a settled cycle pays a flat amount of WMON from their wallet to the fee recipient, and signs the most they'll pay (`maxFee`) into the intent. The fee admin can change the amount ([ADR 0018](../docs/adr/0018-adjustable-protocol-fee.md)), so the matcher reads the token and recipient once at start but the amount for every submission, every prune pass and `/info`. An intent whose `maxFee` is below the fee is refused (`wrong_fee`), or goes `stale` if a raise priced it out (revived by a cut, and not counted against its maker). The matcher never receives or holds any of the fee.

| Variable | Default | |
|---|---|---|
| `NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS` | required | `OnDealIntents` |
| `MATCHER_PRIVATE_KEY` | required | pays settlement gas |
| `MATCHER_RPC_URL` | `NEXT_PUBLIC_RPC_URL` | |
| `NEXT_PUBLIC_CHAIN_ID` | `10143` | Multicall3 is used on 10143; set `MULTICALL3_ADDRESS` for other chains that have it |
| `MATCHER_HOST` / `MATCHER_PORT` | `127.0.0.1` / `8787` | loopback by default, since the process holds a key |
| `MATCHER_DB_PATH` | `matcher/data/pool.sqlite` | |
| `MATCHER_POLL_MS` / `MATCHER_PRUNE_MS` | `5000` / `30000` | |
| `MATCHER_ENV_FILE` | repo-root `.env` | another env file to load (the tests point it at a path that doesn't exist) |
| `MATCHER_TOKEN_ALLOWLIST` | unset (any token) | comma-separated token addresses. When set, only intents whose give and want tokens are all listed (the fee token always is) are accepted and matched. **Set it on any public deployment** (see [On-chain reverts](#how-matching-works)) |
| `MATCHER_MAX_INTENTS_PER_MAKER` | `20` | live (`open` + `stale`) intents one maker may have |
| `MATCHER_RATE_LIMIT_IP` | `60` | `POST`/`DELETE` requests per minute per client IP (token bucket, burst of the same size); `0` turns it off |
| `MATCHER_RATE_LIMIT_MAKER` | `20` | intents per minute per maker, counted once the signature checks out; `0` turns it off |
| `MATCHER_TRUST_PROXY` | `false` | take the client IP from the last `X-Forwarded-For` entry instead of the socket. Only behind a proxy that sets it, or clients can pick their own IP |
| `MATCHER_PRUNE_BATCH` | `500` | intents re-checked per prune pass |
| `MATCHER_MAX_SEARCH_STEPS` | `200000` | edges the cycle search may look at per pass |
| `MATCHER_TOKEN_BAN_MS` | `86400000` (24 h) | how long a token in a settlement that reverted on-chain is suspended |
| `MATCHER_MAX_STRIKES` | `3` | on-chain reverts (within 30 days) after which a maker is left out of matching |

## HTTP API

Bigints are decimal strings. Errors are `{ "error": code, "message": … }`. CORS is open: the book is public and nothing uses cookies.

| | |
|---|---|
| `GET /info` | `{ chainId, swap, matcher, fee: { token, amount, recipient }, maxCycle }` (`amount` is a decimal string) |
| `POST /intents` | `{ intent, signature }` → `201 { hash, status, created }`, or `200` if already known. `429 rate_limited` (with `Retry-After`) past the per-IP or per-maker limit |
| `GET /intents` | the book. `?status=` (default `open`; `stale`, `settled`, `cancelled`, `expired`, `consumed`, `rejected`, `all`), `?maker=`, `?give=` / `?want=` (an asset key `type:token:id`, e.g. `2:0xabc…:7`), `?token=` (any intent naming that token address, either side, any id), `?limit=` |
| `GET /intents/:hash` | one intent |
| `DELETE /intents/:hash` | `{ signature }`: the maker's EIP-712 signature over `CancelIntent(bytes32 intentHash)` in the same domain. Shares the per-IP limit with `POST` |
| `GET /settlements` | settled cycles with their intents, newest first. `?maker=`, `?token=` (cycles naming that token), `?after=` (milliseconds: later cycles only, oldest first), `?limit=` |

`hash` is the EIP-712 struct hash, the same id the contract emits in `IntentFilled`. Every row carries the maker's `signature` while it is live (`open` or `stale`), so anyone can settle it. Once it is terminal (`cancelled`, `settled`, `expired`, `consumed`, `rejected`) `signature` is `"0x"`: a cancelled intent's signature would let anyone settle what its maker took out of the pool. (A copy someone saved earlier still works until the deadline; that is what the deadline and `invalidateNonces` are for.)

Posting is rejected (422) unless the intent is well formed, it names the contract's fee token (`feeToken`) and signs a `maxFee` of at least the current `fee()` (`wrong_fee`; more is fine, the maker pays only the fee), the deadline is 60 s to 7 days away, the signature is one the contract would accept (non-malleable ECDSA, or ERC-1271 for contract wallets), the nonce is unused and the maker holds and has approved everything in `give` plus the fee (`fee_balance`, `fee_allowance`; the fee counts on top of any give of the same token).

On top of that, a maker's intents are checked together, so one balance can't back any number of intents:

| Code | |
|---|---|
| `too_many_intents` | the maker already has `MATCHER_MAX_INTENTS_PER_MAKER` live intents |
| `nft_committed` | another live intent of the maker already gives that NFT (so listing one NFT for two different prices means cancelling the first) |
| `balance_committed` | the maker's live intents and this one together give more of an ERC-20 than the maker holds |
| `token_not_allowed` | `MATCHER_TOKEN_ALLOWLIST` is set and the intent names a token not on it |
| `token_banned` | the intent names a token suspended after an on-chain revert |
| `rate_limited` (429) | too many intents from this maker; only posts with the maker's valid signature count, so nobody can use up someone else's budget | Cancelling only drops it from this pool: a copy elsewhere can still settle, so a short deadline (or `invalidateNonces`) is the real cancel.

## How matching works

- **Graph.** Intents are nodes. There is an edge `i → j` when `i.give` covers `j.want` (ERC-20 amounts are floors, NFTs exact). A settlement is a cycle of 2 to 4 intents with distinct makers. Edges are found through an asset-key index, and cycles by a depth-first search that stops at 5,000 cycles or 200,000 edges looked at (`MATCHER_MAX_SEARCH_STEPS`), whichever comes first. The step cap is what bounds the work: a book built so that no cycle ever closes (a few makers with many intents, each layer feeding the next) has nothing to count but millions of paths. At the cap the pass settles what it found and logs that it stopped early.
- **Window.** Each pass reads the oldest 500 open intents that are not from a left-out maker, not naming a suspended (or, with an allowlist, unlisted) token, and not about to expire. A maker has at most 20 of them.
- **Choosing.** Most intents settled first, then the cycle holding the oldest intent. Chosen cycles share no intent and no maker.
- **Simulate, then send.** Each cycle is an `eth_call` of `settle` first. Gas is estimated with a 10% buffer (Monad charges the gas limit, not gas used), and a cycle needing more than 5M gas is skipped: the contract's worst case is 3.4M (with the fee), so more means a token is burning gas.
- **When a simulation fails.** The error names the intent where the contract can say (bad signature, expired, nonce used, a token that doesn't deliver). Otherwise (no balance, allowance or ownership) each member is re-checked on-chain. The offenders are dropped and matching runs again without them, so one broken intent doesn't hold up the others. If nobody can be blamed the cycle is skipped for a minute.
- **Pruning.** Every 30 s each live intent is re-checked: expired, nonce used, or missing balance, ownership or approval. A maker who can't honour an intent right now gets it marked `stale`, not deleted, and it comes back to `open` when they fix it.
- **Repeat offenders.** A maker whose intents fail on-chain checks three times in an hour is left out of matching. Running late, or being settled elsewhere, doesn't count against them.
- **On-chain reverts.** A settlement that passed its simulation and then reverted on-chain cost the matcher gas, and something in it may act differently in a real transaction than in an `eth_call` (a token, or a contract maker), which a fresh nonce would let it repeat for free. So every token in the cycle that isn't the fee token or allowlisted is suspended for `MATCHER_TOKEN_BAN_MS` (kept in the sqlite file, so a restart doesn't lift it): nothing naming it is matched or accepted. The makers giving a suspended token, and any contract makers, get a strike (everyone in the cycle if that's nobody); `MATCHER_MAX_STRIKES` strikes in 30 days and a maker is left out. Without an allowlist this also suspends legitimate tokens when the revert was an honest race, which is why a public deployment should list its tokens: listed tokens are never suspended.
- **Pruning cost.** Each prune pass re-checks at most `MATCHER_PRUNE_BATCH` intents, oldest first, and the next pass carries on where it stopped.

## Known limits

- **A maker can still break an intent between the simulation and the block** (spend the token, revoke the approval). The matcher then pays for a revert. That is the price of free posting (ADR 0008).
- **Rate limits are in memory** and per process: a restart resets them. Behind a proxy set `MATCHER_TRUST_PROXY`, or every client shares the proxy's IP budget.
- **The step cap can starve honest cycles.** A hostile book can still use up the search budget each pass; the per-maker cap, the per-maker balance checks and the fee balance every maker must hold keep how much of the window one party can fill bounded, not zero.
- **One pool, one matcher.** If it's down nothing new matches, and nothing already on-chain is affected.
- The matcher reads at most 500 open intents per pass, and a maker may have 20 live intents.
- No partial fills, native MON or trait wants: the contract doesn't support them.

## Tests

```bash
npm test          # 110 tests, about two minutes
npm run typecheck
```

The pure parts (cycle search and its work bound on a hostile layered book, selection, codec, signature rules, rate limiting, signatures withheld from terminal rows) are unit-tested, and so is what happens when a settlement reverts on-chain after a clean simulation (against a fake chain: suspended tokens, strikes, the allowlist). The rest runs end to end against a local `anvil` with the real contracts from `contracts/out` (run `forge build` first): pairs, a three-way ring, surplus, revoked approvals with fallback to the next counterparty, a stale intent coming back, banned makers, spent nonces, an intent that expires on-chain, the gas cap, ERC-1271 makers, every rejection on posting (including the per-maker cap, an NFT or a balance already committed, and the per-maker rate limit), a prune pass that stops at its batch and carries on, the HTTP API, and the real process settling a pair. It also checks that the TypeScript hashing, domain separator and ABI match the built contract. Those tests skip with a message if `anvil` or `contracts/out` is missing.
