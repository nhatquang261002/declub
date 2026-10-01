# Matcher: intent pool and local matcher

The off-chain half of [ADR 0008](../docs/adr/0008-trade-intents.md) and [ADR 0009](../docs/adr/0009-ring-swaps.md). Makers sign `Intent`s (give / want, nothing escrowed) and post them here. The matcher finds intents that satisfy each other, in pairs or rings of up to four, and settles them through `ChogSwapIntents.settle`.

It is one local Node process: an HTTP **pool** with a sqlite file, and a **matcher** loop that holds a funded testnet key and pays settlement gas. Only dependency: `viem`. Needs Node 24+ (it runs the `.ts` files directly and uses `node:sqlite`).

## Not trusted for safety

The contract checks every signature, nonce, deadline and transfer at settlement. This service can censor an intent or pick between valid counterparties. It can't change terms, move assets nobody signed for, or take anything. What it adds is liveness, and not wasting gas on settlements that would revert. Anyone can run their own pool and matcher against the same contract.

## Run it

```bash
# Root .env (see .env.example): the deployed contract and a funded TESTNET key
NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS=0x…
MATCHER_PRIVATE_KEY=0x…

cd matcher && npm install && npm start      # http://127.0.0.1:8787
```

The contract comes from `contracts/script/DeployIntents.s.sol` ([how to deploy](../contracts/script/README.md)). The key is the matcher's own account: it only pays gas and never holds anyone's assets. Use a key with testnet funds only. Real environment variables override `.env`.

| Variable | Default | |
|---|---|---|
| `NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS` | required | `ChogSwapIntents` |
| `MATCHER_PRIVATE_KEY` | required | pays settlement gas |
| `MATCHER_RPC_URL` | `NEXT_PUBLIC_RPC_URL` | |
| `NEXT_PUBLIC_CHAIN_ID` | `10143` | Multicall3 is used on 10143; set `MULTICALL3_ADDRESS` for other chains that have it |
| `MATCHER_HOST` / `MATCHER_PORT` | `127.0.0.1` / `8787` | loopback by default, since the process holds a key |
| `MATCHER_DB_PATH` | `matcher/data/pool.sqlite` | |
| `MATCHER_POLL_MS` / `MATCHER_PRUNE_MS` | `5000` / `30000` | |

## HTTP API

Bigints are decimal strings. Errors are `{ "error": code, "message": … }`. CORS is open: the book is public and nothing uses cookies.

| | |
|---|---|
| `GET /info` | `{ chainId, swap, matcher, maxCycle }` |
| `POST /intents` | `{ intent, signature }` → `201 { hash, status, created }`, or `200` if already known |
| `GET /intents` | the book. `?status=` (default `open`; `stale`, `settled`, `cancelled`, `expired`, `consumed`, `rejected`, `all`), `?maker=`, `?give=` / `?want=` (an asset key `type:token:id`, e.g. `2:0xabc…:7`), `?limit=` |
| `GET /intents/:hash` | one intent |
| `DELETE /intents/:hash` | `{ signature }`: the maker's EIP-712 signature over `CancelIntent(bytes32 intentHash)` in the same domain |
| `GET /settlements` | settled cycles with their intents. `?maker=`, `?limit=` |

`hash` is the EIP-712 struct hash, the same id the contract emits in `IntentFilled`. Posting is rejected (422) unless the intent is well formed, the deadline is 60 s to 7 days away, the signature is one the contract would accept (non-malleable ECDSA, or ERC-1271 for contract wallets), the nonce is unused and the maker holds and has approved everything in `give`. Cancelling only drops it from this pool: a copy elsewhere can still settle, so a short deadline (or `invalidateNonces`) is the real cancel.

## How matching works

- **Graph.** Intents are nodes. There is an edge `i → j` when `i.give` covers `j.want` (ERC-20 amounts are floors, NFTs exact). A settlement is a cycle of 2 to 4 intents with distinct makers. Edges are found through an asset-key index, and cycles by a bounded depth-first search capped at 5,000 cycles per pass.
- **Choosing.** Most intents settled first, then the cycle holding the oldest intent. Chosen cycles share no intent and no maker.
- **Simulate, then send.** Each cycle is an `eth_call` of `settle` first. Gas is estimated with a 10% buffer (Monad charges the gas limit, not gas used), and a cycle needing more than 5M gas is skipped: the contract's worst case is 3.3M, so more means a token is burning gas.
- **When a simulation fails.** The error names the intent where the contract can say (bad signature, expired, nonce used, a token that doesn't deliver). Otherwise (no balance, allowance or ownership) each member is re-checked on-chain. The offenders are dropped and matching runs again without them, so one broken intent doesn't hold up the others. If nobody can be blamed the cycle is skipped for a minute.
- **Pruning.** Every 30 s each live intent is re-checked: expired, nonce used, or missing balance, ownership or approval. A maker who can't honour an intent right now gets it marked `stale`, not deleted, and it comes back to `open` when they fix it.
- **Repeat offenders.** A maker whose intents fail on-chain checks three times in an hour is left out of matching. Running late, or being settled elsewhere, doesn't count against them.

## Known limits

- **A maker can still break an intent between the simulation and the block** (spend the token, revoke the approval). The matcher then pays for a revert. That is the price of free posting (ADR 0008).
- **No rate limit on `POST /intents`.** Each post costs a few RPC reads. Fine on loopback; add one before exposing it.
- **One pool, one matcher.** If it's down nothing new matches, and nothing already on-chain is affected.
- The matcher reads at most 500 open intents per pass.
- No partial fills, native MON or trait wants: the contract doesn't support them.

## Tests

```bash
npm test          # 58 tests, about a minute
npm run typecheck
```

The pure parts (cycle search, selection, codec, signature rules) are unit-tested. The rest runs end to end against a local `anvil` with the real contracts from `contracts/out` (run `forge build` first): pairs, a three-way ring, surplus, revoked approvals with fallback to the next counterparty, a stale intent coming back, banned makers, spent nonces, an intent that expires on-chain, the gas cap, ERC-1271 makers, every rejection on posting, the HTTP API, and the real process settling a pair. It also checks that the TypeScript hashing, domain separator and ABI match the built contract. Those tests skip with a message if `anvil` or `contracts/out` is missing.
