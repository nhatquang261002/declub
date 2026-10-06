# e2e: pre-mainnet checks against real contracts

Three tools. The unit, fuzz and invariant suites in `contracts/`, `matcher/` and `web/` prove the logic; these check that the pieces work together as deployed. Test IDs and the manual cases that build on them are in [docs/11 · Test plan](../docs/11-test-plan.md).

| Command | What | Sends transactions |
|---|---|---|
| `npm run local` | Every chain scenario on a fresh anvil, deployed by the real `DeployEscrow.s.sol` and `DeployIntents.s.sol` with a fee and a fee admin, with the matcher process running | Local only |
| `npm run testnet` | The same scenarios against the addresses in the root `.env` | Yes, testnet only (refuses any other chain) |
| `npm run verify` | Read-only checks of a deployment (DEP) | **No.** Safe on mainnet |
| `npm run web -- --url <app>` | HTTP smoke tests of a running app (WEB) | No |

Each run prints a line per case and writes `results/<run>-<time>.{json,md}`; the `.md` table pastes into a test-plan run record. Exit code 1 means something failed. `--only V2,IN-02` runs the cases whose IDs start with those prefixes.

`../scripts/test-all.sh` runs every suite in the repo plus `npm run local` in one go.

## Setup

```bash
cd contracts && forge build          # the scenarios read ABIs and bytecode from contracts/out
cd ../matcher && npm install         # for IN-08 (the local run starts the real matcher)
cd ../web && npm install             # V2-06 builds its Merkle set with the app's web/lib/merkle.ts
cd ../e2e && npm install
```

Needs Node 24+, and `anvil` for the local run.

## Chain scenarios

| ID | Scenario |
|---|---|
| V2-01 | Exact swap: NFT for ERC-20 + MON, filled by anyone; `FeeCharged` is both sides' share |
| V2-02 | Cancel returns NFT, ERC-20, MON and the fee share; only the maker can cancel; a cancelled deal can't be filled |
| V2-03 | Expiry: a late fill reverts; anyone reclaims to the maker |
| V2-04 | Private deal: only the named taker fills |
| V2-05 | Open offer: two proposals, reject one, accept one, a third withdrawn; `fillTrade` refused |
| V2-06 | Trait deal with the app's Merkle builder; a token outside the set is refused |
| V2-07 | Multi-asset deal, gas recorded |
| V2-08 | Guards: self-fill, wrong MON amount (and a missing fee share), duplicate asset, past expiry, empty side, MON sent straight to the contract |
| IN-01 | EIP-712 domain, struct hash and digest agree with the contract |
| IN-02 | Pair settled by a third party; each maker pays the fee in WMON |
| IN-03 | Ring of 3 |
| IN-04 | Ring of 4, under the matcher's 5M gas cap; a fifth is refused |
| IN-05 | Replay refused; `invalidateNonces` kills a signed intent |
| IN-06 | Refused: expired, `maxFee` below the fee, wrong fee token, bad signature, want not met, same maker twice, cycle of one |
| IN-07 | ERC-1271 contract wallet as a maker (and its refusal) |
| IN-08 | Matcher over HTTP: post a pair, it settles, `/settlements`; cancel by signature, signature withheld after |
| RW-01 | A real swap's fee goes through the app's activity log and epoch builder: 50% to Holders by holdings, 25% to the Owner (local only) |
| RW-02 | The relayer publishes the epoch on `DeClubRewards`; claims wait for the delay, pay each leaf once, and anyone can send them (local only) |
| RW-03 | A wrong root is revoked before claims open; an underfunded one can't overpay; the rest is swept after the window (local only) |
| FA-01 | Only the admin sets the fee, never above the ceiling; both contracts charge the same |
| FA-02 | A raise is queued for 7 days, can't apply early, `setFee(fee())` cancels it (needs the admin key) |
| FA-03 | A cut applies at once; an open deal keeps its listed fee (local only) |
| FA-04 | A raise applies after 7 days; intents signed with the old `maxFee` are refused (local only) |
| FA-05 | Two-step admin handover (local only) |

Assertions use events and the parties that didn't send the transaction, since Monad charges the gas limit and a sender's MON balance says little. On a local chain the contract's own balance is checked too.

The fee cases run last: FA-04 moves a local chain's clock a week ahead. The local run also deploys `DeClubRewards` with `DeployRewards.s.sol` (the relayer is its operator, a one-hour claim delay and a one-day window); the RW cases load the web app's own server code (`web/lib/server/rewards.ts` and friends) through `web/test/register.mjs`.

### Local

```bash
npm run local                      # about a minute
npm run local -- --no-matcher      # skip the matcher (IN-08 skips)
E2E_MATCHER_LOGS=1 npm run local   # show the matcher's log
```

The local deployment uses anvil's public test mnemonic: accounts 1 to 5 trade, 7 is the fee admin, 8 the fee recipient, 9 the matcher. The fee is 2 MON per side with an 8 MON ceiling.

### Testnet

Run it on a fresh redeploy of the current source (the deployed contracts in the README predate the fee; `npm run verify` shows it).

| Variable | |
|---|---|
| `E2E_MNEMONIC` or `E2E_PRIVATE_KEYS` | **Testnet-only** wallets: accounts 0 to 4 of the mnemonic, or 5 comma-separated keys. Account 0 needs MON and tops the others up |
| `E2E_MIN_MON` | Top-up target per wallet, default 1 |
| `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS`, `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` | The deployment under test |
| `NEXT_PUBLIC_MOCK_ERC20_ADDRESS` (or `E2E_ERC20_ADDRESS`) | An ERC-20 with an open `mint` (mUSD) |
| `E2E_NFT_ADDRESS` | An ERC-721 with an open `mint(to, quantity)`; default the testnet MockChog `0x220a…26e4` |
| `NEXT_PUBLIC_POOL_URL` (or `E2E_POOL_URL`) | A running matcher for IN-08; without it IN-08 skips |
| `E2E_FEE_ADMIN_KEY` | Optional: the fee admin's key, for FA-02 (queues and cancels a raise; the fee never changes) |
| `E2E_RPC_URL` | Default `NEXT_PUBLIC_RPC_URL` |
| `E2E_ENV_FILE` | Read another env file instead of the root `.env` |

V2-03 waits about 20 s of real time for a deal to expire.

## Verify (DEP)

```bash
npm run verify                     # addresses from the root .env
npm run verify -- --mainnet        # mainnet rules: warnings become failures, every EXPECT_* required
```

| ID | Check |
|---|---|
| DEP-01 | The RPC serves the expected chain (`EXPECT_CHAIN_ID`, default `NEXT_PUBLIC_CHAIN_ID`) |
| DEP-02 | Runtime code equals this checkout's build, with immutables masked |
| DEP-03 | Fee within the ceiling and as expected; recipient ≠ admin; admin and recipient are contracts (Safes); nothing pending; 7-day raise delay |
| DEP-04 | The fee token is 18 decimals, wraps MON and refuses an unbacked unwrap (simulated, nothing sent); equals `EXPECT_FEE_TOKEN` |
| DEP-05 | The intents EIP-712 domain is `("DeClubIntents", "1")`, as the app and matcher sign |
| DEP-06 | Both contracts have the same fee, ceiling, recipient and admin |
| DEP-07 | The matcher's `/info` agrees with the chain; its gas wallet holds at least `E2E_MATCHER_MIN_MON` (default 1) |
| DEP-08 | Assets per side 10, max cycle 4 |
| DEP-09 | App env: `NEXT_PUBLIC_CHOG_ADDRESS` set and deployed, `FILL_WATCHER_START_BLOCK` set |

Expectations, all optional except under `--mainnet`: `EXPECT_FEE_WEI`, `EXPECT_MAX_FEE_WEI`, `EXPECT_FEE_RECIPIENT`, `EXPECT_FEE_ADMIN`, `EXPECT_FEE_TOKEN`. Override the addresses with `VERIFY_V2_ADDRESS`, `VERIFY_INTENTS_ADDRESS` and `VERIFY_RPC_URL`.

## Web smoke (WEB)

```bash
cd ../web && npm run build && npm start &      # or a deployed URL
cd ../e2e && npm run web -- --url http://localhost:3000
npm run web -- --url https://<preview> --expect-live   # store, Privy, cron and the book must be on
```

| ID | Check |
|---|---|
| WEB-01 | Every page answers 200 without the error boundary; `/v2/create`, `/intents/new` and `/intents` redirect; unknown pages 404 |
| WEB-02 | Security headers on pages and API routes (and HSTS on HTTPS) |
| WEB-03 | `/api/deals` answers a page of the book, and says whether signed swaps loaded |
| WEB-04 | `/api/state`, `/api/profile`, `/api/me/clubs` refuse anonymous and forged-token callers |
| WEB-05 | `/api/cron/fills` refuses a missing or wrong secret (and runs with `CRON_SECRET`, if set) |
| WEB-06 | The Privy webhook refuses unsigned and badly signed requests |
| WEB-07 | Bad hashes and addresses are 400s, never 500s |
| WEB-08 | The pool is up, settles through the app's intents contract, and allows the app's origin |

Without `--expect-live`, a feature that is off on this server (no store, no Privy secret) is reported as a warning.
