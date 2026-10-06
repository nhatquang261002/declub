# 11 · Test plan

The pre-mainnet test plan. Automated suites cover the contract logic, the matcher and the web routes. This page adds what they can't: a person with real wallets clicking through the app on Monad testnet, then a go/no-go checklist for mainnet and a canary run after deploy.

It closes the unchecked testing items in the [roadmap](06-roadmap.md): the manual pass on testnet with two real wallets, the rewards epoch and claim flow, and the go/no-go checklist ([6.1](#61-gono-go-checklist)).

## 1. Purpose and how to use it

### Scope

In scope:

- `DeClubEscrow`, `DeClubIntents` and `FeeAdmin` as deployed from the current source, driven through the app.
- The matcher (`matcher/`) as a running service: pool, matching, pruning, settlement.
- The web app (`web/`): every page, Privy sign-in, profiles, deal-by-@handle, webhooks, Clubs, the fill watcher.
- Operations: deploy, configuration, the fee admin Safe, monitoring and incident response.

Out of scope: proving contract properties. Foundry (unit, fuzz, invariant), Halmos and Slither do that ([04 · Security](04-security.md)). A manual case that overlaps an automated one checks the UI and wallet experience, not the contract rule behind it.

### Environments

| Environment | What runs there | Who | When |
|---|---|---|---|
| **Local anvil** | `scripts/test-all.sh` and the `e2e` chain scenarios against the real deploy scripts, including the fee-admin cases that need time travel (FA-03 to FA-05) | Engineer, CI | Every commit that touches contracts, matcher or web |
| **Monad testnet** | A redeploy of the current source, the matcher, a deployed web build (production mode), `e2e` verify (DEP) and web smoke (WEB), then every manual case below | Engineer for setup, testers for manual cases | Before the go/no-go meeting, on the release candidate commit |
| **Mainnet canary** | `e2e` verify (DEP) and web smoke (WEB) only, then the canary cases in [6.3](#63-post-deploy-canary) with tiny real amounts | Release owner plus one tester | Right after the mainnet deploy, before any announcement |

The README's `DeClubEscrow` and `DeClubRewards` are current. `DeClubIntents` is not deployed on testnet, so the signed-swap cases can't pass until you deploy it ([2.2](#22-contracts-and-tokens)).

### Roles

| Role | Does |
|---|---|
| Engineer | Redeploys, configures env, runs the automated suites, sets up fixtures a tester can't (a contract wallet that rejects MON, a lookalike token) |
| Tester (one or two people) | Runs the manual cases with wallets A, B and C, records results |
| Fee admin signers | Sign the `setFee` transactions for the FEE cases from the admin Safe |
| Privy dashboard owner | Sends test webhooks, unlinks the throwaway account |
| Release owner | Reviews the results, chairs go/no-go, signs off |

### Priorities

- **P0:** blocks mainnet. A failure means someone can lose funds, can't get funds back, or can't trade.
- **P1:** must pass, or the go/no-go notes record an accepted workaround.
- **P2:** polish. A failure is logged as an issue, not a blocker.

### Recording results

Copy this header and table into the release issue (or a file per run) for each run. One run is one environment, one commit and one build.

```text
Run:            testnet-2026-10-xx-1
Tester(s):
Date:
Commit:         (git rev-parse HEAD)
Build URL:
DeClubEscrow:                       deploy block:
DeClubIntents:                  deploy block:
Fee token (WMON):               fee():          MAX_FEE():
Fee recipient:                  fee admin:
Pool URL:                       matcher /info checked: yes / no
Automated: test-all.sh ___  DEP ___  WEB ___  (links to output)
Browser / wallet:
```

| ID | Result | Tx hash / evidence | Notes |
|---|---|---|---|
| M-WAL-01 | Pass / Fail / Blocked / N/A | | |

Rules:

- Every on-chain step gets its tx hash. Every copy or layout issue gets a screenshot.
- **Blocked** says what blocked it (missing fixture, env, an earlier failure). Blocked P0s count as not passed.
- A failed case gets an issue link in Notes. A re-test after a fix is a new row with the new commit.
- Don't edit a past run's results. Start a new run.

## 2. Test environment setup

### 2.1 Wallets

| Wallet | Use | Notes |
|---|---|---|
| **A** | Maker in most cases | MetaMask desktop. Linked to an X account through Privy |
| **B** | Taker, proposer, counterparty | Rabby, in a different browser or profile from A. Linked to a Discord account |
| **C** | Third party: non-party views, reclaim by a stranger, ring member, Club moderator | Phantom or Backpack (EVM). Its Privy user id goes in `CLUB_ADMIN_USER_IDS` for the admin cases |
| **D** | Fourth ring member, and a contract wallet (ERC-1271) if one can sign on Monad testnet | A Safe if one is deployable on testnet; otherwise a fourth EOA and IN-07 covers ERC-1271 |
| **Admin Safe** | `FEE_ADMIN` on both contracts | A Safe if available on testnet, otherwise a dedicated EOA. Record which in the run header |
| **Recipient** | `FEE_RECIPIENT` | A separate address from the admin. Only watched, never used to sign |
| **Matcher key** | `MATCHER_PRIVATE_KEY` | Funded with testnet MON only |
| **Throwaway Privy account** | Unlink, transfer and delete cases | Never used for anything else |

Also needed: a phone with a wallet app that has an in-app browser (MetaMask Mobile or Phantom) for M-MOB-02, and two X or Discord accounts for the handle cases.

### 2.2 Contracts and tokens

1. Redeploy `DeployEscrow.s.sol` and `DeployIntents.s.sol` from the release candidate commit ([contracts/script/README.md](../contracts/script/README.md)) with `PROTOCOL_FEE_WEI` (non-zero, small enough to run every case many times), `PROTOCOL_FEE_MAX_WEI` (about 4× the fee), `FEE_RECIPIENT`, `FEE_ADMIN` and `DEPLOY_MOCK_WMON=true`. Pass the same fee values to both. Record the addresses and deploy blocks in the run header.
2. Deploy `DeployRewards.s.sol` with `REWARDS_OPERATOR` set to a testnet wallet you hold the key for (`REWARDS_OPERATOR_KEY` for `npm run rewards:epoch -- --publish`) and `REWARDS_CLAIM_DELAY=0`, and set `NEXT_PUBLIC_REWARDS_EPOCH_SECONDS=600` and `NEXT_PUBLIC_REWARDS_GENESIS` to a recent time, so an epoch closes every ten minutes during the run.
3. Run `e2e` verify against the new addresses (DEP-01 to DEP-09). All must pass before the manual run starts.
4. Fund each of A, B, C and D with about 10 MON from the faucet: enough for gas on many transactions, MON in deals, and the fee many times over. The worst-case create is about 2.2M gas ([04](04-security.md#threats)), and Monad charges the gas limit.
5. Mint test assets. All three mocks have an open mint or deposit:

```bash
cd contracts
# mUSD (MockERC20): open mint, 18 decimals
cast send $MUSD "mint(address,uint256)" $A 1000000000000000000000 --rpc-url monad_testnet --account tester
# MockChog: open mint, at most 20 per call
cast send $MOCK_CHOG "mint(address,uint256)" $A 5 --rpc-url monad_testnet --account tester
# MockWMON: deposit() wraps, withdraw(amount) unwraps (a plain MON transfer also wraps)
cast send $WMON "deposit()" --value 1ether --rpc-url monad_testnet --account tester
```

Repeat for B, C and D. Give A, B and C at least five MockChogs and 1,000 mUSD each. Leave A without WMON, so M-SIG-01 exercises the wrap step.

The Chog Genesis mirror (`ChogGenesisMirror`) has an owner-only `mintBatch`. Get mirror tokens from the deployer, by transfer or through `DEMO_WALLETS` at deploy. The mirror's IPFS metadata is the closest thing to real Chog traits, so M-TRT-05 uses it.

Know which collection is which. The verified list (`web/data/assets.json`) has the **MockChog** (`0x220a…26e4`), mUSD, the Chog Genesis collection (`0x32A3…1908`) and the demo mirrors of Chog Genesis (`0xaDcA…2584`), skrumpeys and r3tards, so each of those NFT collections has a Club. The Holder badge in the Mock Chog Club uses MockChog.

### 2.3 Environment variables

Root `.env` (only `NEXT_PUBLIC_*` reaches the web app):

| Variable | Value for the testnet run |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL` | `10143`, the RPC the team will use (record it) |
| `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS`, `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` | The redeploy |
| `NEXT_PUBLIC_POOL_URL` | The matcher's public URL, reachable from the testers' browsers (HTTPS if the app is HTTPS) |
| `NEXT_PUBLIC_CHOG_ADDRESS` | Set explicitly. Blank falls back to MockChog |
| `NEXT_PUBLIC_MOCK_ERC20_ADDRESS` | mUSD (enables **+ Test token**) |
| `NEXT_PUBLIC_PRIVY_APP_ID` | The test Privy app |
| `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS` | `false`, unless the run covers M-WAL-07 |

`web/.env.local` or the host (server secrets; the root file can't carry them):

| Variable | Value |
|---|---|
| `PRIVY_APP_SECRET`, `PRIVY_WEBHOOK_SIGNING_SECRET` | From the test Privy app |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | A testnet-only Upstash database |
| `CRON_SECRET` | Any long random value |
| `FILL_WATCHER_START_BLOCK` | The new `DeClubEscrow` deploy block |
| `CLUB_ADMIN_USER_IDS` | C's Privy user id |

Matcher (`matcher/README.md`): `MATCHER_PRIVATE_KEY`, `MATCHER_RPC_URL`, and `MATCHER_TOKEN_ALLOWLIST` set to mUSD, MockChog and the mirror, as mainnet will run with an allowlist. Behind a proxy, set `MATCHER_TRUST_PROXY=true`. Check `GET /info` returns the redeployed contract and the fee before starting.

### 2.4 Privy, cron and matcher

- **Privy dashboard:** allow the test host's origin; enable wallet, Google, X and Discord login, and email for linking; embedded wallets off; add the webhook endpoint `https://<host>/api/webhooks/privy` for `user.linked_account`, `user.unlinked_account`, `user.transferred_account` and `user.deleted`.
- **Cron:** a scheduler calls `GET https://<host>/api/cron/fills` with `Authorization: Bearer <CRON_SECRET>` every minute. Vercel Hobby crons run only daily, which is too slow ([ADR 0019](adr/0019-fill-watcher.md)).
- **Matcher:** running for the whole session, with its log visible to the engineer. Note the matcher key's MON balance at start and end.

## 3. Automated suites

Commands live in [`e2e/README.md`](../e2e/README.md) and [`scripts/test-all.sh`](../scripts/test-all.sh). All of them must be green on the release candidate commit before the manual run starts. Link their output in the run header.

| Suite | IDs | Runs against | Mainnet-safe |
|---|---|---|---|
| `scripts/test-all.sh` | `forge build` and `forge test` (optional coverage, Slither, Halmos), matcher typecheck and tests, web typecheck, lint, tests and build, optionally the local `e2e` run | Local, CI | n/a |
| `e2e` chain: DeClubEscrow | V2-01 to V2-08 | Local anvil with the real deploy scripts, or testnet addresses | No (sends transactions) |
| `e2e` chain: intents | IN-01 to IN-08 | Local anvil, or testnet plus a running matcher (IN-08) | No |
| `e2e` chain: fee admin | FA-01 anywhere; FA-02 with the admin key (`E2E_FEE_ADMIN_KEY`); FA-03 to FA-05 local only (they move the fee or need time travel) | Local anvil, testnet | No |
| `e2e` verify | DEP-01 to DEP-09 | Testnet, mainnet | **Yes**, read-only |
| `e2e` web smoke | WEB-01 to WEB-08 | A running app: local build, preview, production | Yes (HTTP only, no writes that matter) |

What each ID checks, so the cross-references below make sense:

| ID | Checks |
|---|---|
| V2-01 | Exact swap NFT ⇄ ERC-20 + MON, fee to the recipient |
| V2-02 | Cancel refunds escrow and the fee share |
| V2-03 | Expiry: the fill reverts, anyone reclaims to the maker |
| V2-04 | Private deal, named taker |
| V2-05 | Open offer: propose, reject, accept, withdraw |
| V2-06 | Trait trade with a Merkle proof; a bad proof is rejected |
| V2-07 | Multi-asset deal, gas recorded |
| V2-08 | Guards: self-fill, wrong `msg.value` (including a missing fee share), duplicate asset, past expiry, empty side, direct MON send. Non-maker cancel and fill-after-cancel are in V2-02, `fillTrade` on an open offer in V2-05 |
| IN-01 | EIP-712 domain and hash agree with the contract |
| IN-02 | Pair settled by a third-party relayer, WMON fee per maker |
| IN-03 | Ring of 3 |
| IN-04 | Ring of 4, gas against the matcher's 5M cap |
| IN-05 | Replay and `invalidateNonces` |
| IN-06 | Rejections: expired, `maxFee` below the fee, wrong fee token, bad signature, want not met, the same maker twice, a cycle of one |
| IN-07 | ERC-1271 contract-wallet maker |
| IN-08 | Matcher round trip over HTTP: post, settle, `/settlements`, cancel by signature |
| RW-01 | A real swap's fee through the app's activity log and epoch builder: 50% to the top 10 Holders by holdings, 25% to the Owner (local) |
| RW-02 | Publish on `DeClubRewards`; claims wait for the delay, pay each leaf once, anyone can send them (local) |
| RW-03 | Revoke before claims open, an underfunded root refused past its funding, sweep after the window (local) |
| FA-01 | Non-admin or above-ceiling `setFee` rejected |
| FA-02 | Queue a raise, `applyFee` too early fails, cancel it with `setFee(fee())`. Safe on testnet: the fee never changes |
| FA-03 | A cut applies at once; open deals keep their listed fee |
| FA-04 | A raise waits 7 days, then intents with the old `maxFee` are rejected |
| FA-05 | Two-step admin handover |
| DEP-01 | Chain id |
| DEP-02 | Bytecode matches the build (immutables masked) |
| DEP-03 | Fee config as expected: recipient ≠ admin, admin is a contract, nothing pending |
| DEP-04 | The fee token wraps and unwraps like WMON |
| DEP-05 | Intents domain `("DeClubIntents", "1")` |
| DEP-06 | Both contracts charge the same fee |
| DEP-07 | Matcher `/info` agrees with the chain; its gas wallet is funded |
| DEP-08 | Constants |
| DEP-09 | App env: a real Chog collection, `FILL_WATCHER_START_BLOCK` set |
| WEB-01 | Pages render |
| WEB-02 | Security headers |
| WEB-03 | `/api/deals` |
| WEB-04 | Per-user routes reject anonymous callers |
| WEB-05 | Cron secret enforced |
| WEB-06 | Webhook signature enforced |
| WEB-07 | Input validation |
| WEB-08 | The pool points at the same contract |

## 4. Manual test cases

Run on the testnet build from [2](#2-test-environment-setup). Where a row names an automated ID, the contract logic is already covered there: the manual case checks what the person sees and signs, that the wallet prompt is right, and that the screens agree with the chain.

Shared fixture unless a row says otherwise: A, B and C each hold MockChogs (call them `#a1`, `#b1`, `#c1`, …), 1,000 mUSD and about 10 MON; A holds no WMON; all three are signed in with Privy on Monad testnet. "The fee" is `fee()` on the contract. Check balances and ownership on MonadVision or with `cast call`.

Start M-DEAL-03 and M-SIG-09 early in the session: they wait for a 1-hour expiry and a 10-minute deadline.

### 4.1 Wallet and sign-in (WAL)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-WAL-01 | P0 | Sign in with a wallet | A signed out | 1. Press **Sign in**. 2. Choose the wallet option (listed first) and MetaMask. 3. Approve the connection and the sign-in message. | Header shows A's short address. The wallet menu offers **Account & linked accounts**, **View on explorer** and **Sign out**. `/create` no longer says "Connect a wallet to create a deal." | — |
| M-WAL-02 | P0 | Wrong network | A connected, wallet switched to another chain | 1. Look at the header. 2. Press the switch button. 3. Repeat and reject the switch in the wallet. 4. On the right chain, start any transaction after switching the wallet away again. | Desktop: **Switch to Monad Testnet** (**Switch to Monad** on mainnet); at phone width: **Switch network**. Accepting switches and shows the address. Rejecting shows an error toast and leaves the button. A transaction asks to switch chain before simulating. | — |
| M-WAL-03 | P1 | Social sign-in without a wallet in this browser | B's Discord linked to B's wallet; fresh browser profile with no wallet extension | 1. **Sign in** with Discord. | Signed in. The header offers **Connect wallet** or **Link a wallet**, with "You're signed in. Connect the wallet linked to your account to trade." (or the no-wallet-linked line). No embedded wallet is created. | — |
| M-WAL-04 | P1 | Several wallets, switch the active one | A has two wallets linked (link the second on `/account` with **Link another wallet**) | 1. On `/account`, press **Use this wallet** on the second. 2. Open `/deals` and the bell. 3. Switch back. | The active wallet shows **In use**. Header, **For you** tab and notifications follow the active wallet. | — |
| M-WAL-05 | P1 | Account change inside the wallet extension | A on a deal page of their own deal | 1. In MetaMask, switch to another account without using the app. 2. Look at the deal page dock. 3. Start a transaction. | The header and dock update to the new account (no "Your deal is live" for a non-maker). No transaction is ever sent from the previous account. | — |
| M-WAL-06 | P1 | Sign out | A signed in | 1. **Sign out** from the wallet menu. 2. Reload `/history`, `/account`, a Club page. | Header reads **Sign in**. `/account` offers **Sign in**. History asks to connect. Club writes need sign-in again. | Automated: WEB-04 |
| M-WAL-07 | P2 | Injected-wallet fallback and embedded wallets | A build without `NEXT_PUBLIC_PRIVY_APP_ID`; separately, a build with `NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=true` | 1. Without Privy: press **Connect wallet**. 2. Open `/account`. 3. With embedded wallets on: sign in with Google on a fresh profile, create the wallet, open export. | 1. "Connect a wallet / Choose an installed wallet to continue." lists the EIP-6963 wallets; trading works. 2. `/account` explains the app uses an installed wallet. 3. An embedded wallet is created and connects; export shows Privy's warning. | — |

### 4.2 Create (CRE)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-CRE-01 | P0 | Exact deal: NFT for mUSD + MON | A holds `#a1` | 1. **Create deal** → **Lock assets now** → **Request exact assets** → **Continue**. 2. **+ Test token** (or **+ Token**, paste mUSD), 50; **+ MON**, 1 → **Continue**. 3. **+ NFT**, pick `#a1` from the wallet grid; expiry **24 hours** → **Continue**. 4. Review → **Approve NFT collection 0x…** → **Create deal**. | The token row reads "mUSD · 18 decimals (read from the token)". Review shows the **Preview** stage, Terms (Exact assets, Anyone, In 24 hours) and a **Protocol fee** line equal to `fee()`. The approval prompt is `setApprovalForAll` for the MockChog collection. The create prompt's value is exactly the fee. "Deal created." then the app opens `/v2/deal/<id>`. On-chain: `ownerOf(#a1)` is `DeClubEscrow`. | Automated: V2-01 |
| M-CRE-02 | P0 | Maker gives MON and an ERC-20 | — | 1. Exact deal: A gives 1 MON + 20 mUSD, asks for `#b1`. 2. Approve and create. | The mUSD approval prompt is for exactly 20 mUSD, not unlimited. The create prompt's value is 1 MON + the fee. After create, 20 mUSD and 1 MON + fee sit in `DeClubEscrow`. | Automated: V2-01 |
| M-CRE-03 | P0 | Open offer | — | 1. **Open offer**. 2. Type a note; then paste text over 280 bytes. 3. Shorten it, **Continue**, give `#a2`, **Post open offer**. | The counter shows bytes / 280 and turns red over the limit, with "The note is N bytes; the limit is 280." blocking **Continue**. Review's want side reads "You're looking for … Not enforced". After posting, the deal page stamp says "taking offers". | Automated: V2-05 |
| M-CRE-04 | P0 | Private deal by address | — | 1. Exact deal; in **Only this wallet can accept (optional)** type A's own address, then garbage, then B's address. 2. Create. | Own address: "You cannot make a private offer to yourself." Garbage: "Enter a valid wallet address, or leave it empty." B's address: "Only <B>". Review "Who can accept" shows B. `getTrade(id).taker` is B. | Automated: V2-04 |
| M-CRE-05 | P1 | Form rules | — | Try in turn: an empty side; MON on both sides; the same NFT twice on one side; the same asset on both sides; 11 assets on one side; an amount with more decimals than the token has; a non-token address in a **+ Token** row. | Each blocks **Continue** with a reason, for example "Add at least one asset.", "The same asset is listed twice on one side. Combine the amounts into one row.", "The same asset can't be on both sides. Offer and request different assets.", "Up to 10 assets per side.", "Row N: that address is not a readable token." **+ MON** is disabled once a side has MON. | Automated: V2-08 |
| M-CRE-06 | P1 | Stepper and drafts | — | 1. Fill steps 1 and 2. 2. **Back** twice, switch Exact ⇄ Open offer, go forward again. 3. Try to jump forward on the stepper. | Typed rows survive going back and switching between kinds. The stepper only goes back. | — |
| M-CRE-07 | P1 | Expiry options | — | Create one deal each with **1 hour**, **7 days**, **Never**. | Review says "In 1 hour" / "In 7 days" / "Never"; the deal page's Expires fact matches (Never for 0). | — |
| M-CRE-08 | P1 | NFT picker | A on step 2 | 1. **+ NFT**: check **Featured**, **Recent**, **In open deals**. 2. Paste mUSD's address. 3. Pick MockChog, type an id A doesn't own, then one that doesn't exist. 4. On the ask side, browse the collection. | Pasting a non-NFT shows "Not an NFT collection". Typed ids: "Your wallet doesn't own this token." / "That token doesn't exist in this collection." The ask side shows holders under each token. Multi-select adds "Add N NFTs" at once. | — |

### 4.3 Deal page: fill, cancel, reclaim, claim (DEAL)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-DEAL-01 | P0 | Take an exact deal | M-CRE-01 deal; B holds 50 mUSD and ≥ 1 MON + fee + gas | 1. B opens the link. 2. Read the dock. 3. Approve mUSD. 4. **Accept & swap**. | Dock "Take the deal" with steps (Wallet connected, Approve, Accept & swap) and a fee note. The approval is exactly 50 mUSD. The accept prompt's value is 1 MON + the deal's fee. "Swapped. The assets are in your wallet."; stamp and dock "This deal is done". On-chain: `#a1` with B; 50 mUSD and 1 MON with A; the recipient got 2 × the fee (`FeeCharged`). | Automated: V2-01 |
| M-DEAL-02 | P0 | Cancel | An open deal by A with MON, mUSD and an NFT offered | 1. A presses **Cancel deal**. | "This deal was cancelled". Everything offered and A's fee share are back in A's wallet; the recipient got nothing. | Automated: V2-02 |
| M-DEAL-03 | P0 | Expiry and reclaim | A deal by A with **1 hour** expiry, created at session start | 1. After expiry, B opens it. 2. A opens it. 3. C presses **Return assets to maker**. | Without a reload the page flips to "This deal ran out of time"; no accept and no cancel. A sees **Reclaim my assets**, others **Return assets to maker**. After C's transaction A has the assets and fee back, and C received nothing. | Automated: V2-03 |
| M-DEAL-04 | P0 | Private deal, three viewers | M-CRE-04 deal | Open it as B, as C, and signed out. | B: **★ For you** chip and the accept flow. C: "This offer is for someone else", "Only <B> can accept it.", no buttons. Signed out: "Want this? Take the deal" with a connect button. | Automated: V2-04 |
| M-DEAL-05 | P0 | Maker's own deal | A opens own open deal | Read the dock. | "Your deal is live", **Your deal** chip, **Cancel deal**, fee note "Held with your deal…". No **Accept & swap**. | Automated: V2-08 |
| M-DEAL-06 | P0 | Taker lacks what is asked | B holds less mUSD than asked (send it away) | Approve if asked, then **Accept & swap**. | The error shows before the wallet opens (simulation), as a toast and inline: "You don't have enough of that token." Nothing is sent. | Automated: V2-08 |
| M-DEAL-07 | P0 | Collect a held payout | Engineer sets up a deal where a payout to A was refused and credited (a maker contract that rejects MON, from `contracts/test/utils`, or a blocklisting token) and gives the tester control of the account | Open the deal page as the credited account; press **Claim**. | Panel "Held for you · Waiting for you to collect" lists each credited asset; after **Claim**, "Claimed." and the panel goes away; `claimable` is 0. | — |
| M-DEAL-08 | P1 | Multi-asset deal | A: 3 NFTs + 100 mUSD; asks for 2 of B's NFTs + 2 MON | Create, then fill as B. | Approvals step through "(1 of N)"; B's steps read "Approve N assets". Every asset lands where the terms say. Record gas for create and fill. | Automated: V2-07 |
| M-DEAL-09 | P1 | Cancel races a fill | Open deal by A; B has the accept prompt open in the wallet | A cancels and it confirms; then B confirms. | B's transaction fails or is refused in simulation with "This deal was already filled or cancelled."; B loses only gas; A has everything back. | Automated: V2-08 |
| M-DEAL-10 | P1 | Bad deal URLs | — | Open `/v2/deal/999999`, `/v2/deal/abc`, `/v2/deal/9101`. | "This deal does not exist." / "Invalid deal id." / does not exist. | Automated: WEB-01 |

### 4.4 Open offers (OFR)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-OFR-01 | P0 | Send an offer | A's open offer from M-CRE-03 | 1. B opens it: "Send the maker an offer". 2. **Build your offer ↓**, add `#b2` + 10 mUSD, approve, **Send offer**. | The note shows as plain text with "Written by the maker. Not verified, and not binding. Check the assets, not the note." The send prompt's value is the deal's fee (plus any MON offered). "Offer sent."; the offer shows under **Offers** tagged **Yours**; `#b2` and 10 mUSD are in escrow. | Automated: V2-05 |
| M-OFR-02 | P0 | Accept one offer | B's and C's offers active | A presses **Accept & swap** on B's offer. | Deal "This deal is done". `#a2` with B, B's assets with A, recipient +2 × fee. C's offer stays active; C still sees **Withdraw my offer**. | Automated: V2-05 |
| M-OFR-03 | P0 | Reject | A second open offer by A with C's offer on it | A presses **Reject** on C's offer. | C's assets and fee share go back to C. It moves to **Closed offers (n)**. Recipient unchanged. | Automated: V2-05 |
| M-OFR-04 | P0 | Withdraw, also after the deal ended | C's offer active on a deal A then cancels or fills | C presses **Withdraw my offer** before, and on another deal after, the deal ends. | Works in both cases; C's assets and fee share come back. | Automated: V2-05 |
| M-OFR-05 | P1 | Private open offer | Open offer with **Only this wallet can send offers** = B | Open as B and as C. | B gets the offer form. C sees "This offer is for someone else". | Automated: V2-04 |
| M-OFR-06 | P2 | Many offers | 12+ offers on one deal (several closed) | Scroll the Offers list. | Active first, closed ones folded, **Load older offers** loads the rest. | — |

### 4.5 Trait deals (TRT)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-TRT-01 | P1 | Create a trait request | A holds `#a3`; B holds a MockChog with a given trait | 1. **Request by trait**, tap **Chog** or paste the MockChog address. 2. Wait for the scan, pick one value, count 1. 3. Give `#a3`, create. | The row shows scan progress, then "Traits found for this collection." and a live match count. Review shows the trait clause. The deal page lists the request with "Checked". | Automated: V2-06 |
| M-TRT-02 | P1 | Fill a trait request | M-TRT-01 deal | B ticks a matching NFT, approves, **Accept & swap**. | Accept stays off until enough are picked ("Pick the NFTs you'll send, above."). After the fill, B's NFT is with A and `#a3` with B. | Automated: V2-06 |
| M-TRT-03 | P1 | Taker has no match | C holds no matching NFT | C opens the deal. | "You don't hold an NFT that matches this request." Accept disabled. | Automated: V2-06 |
| M-TRT-04 | P1 | Any vs all, count, unsupported | — | 1. Two values with **All of them**, check the count drops. 2. A combination nothing matches. 3. Paste mUSD or a non-enumerable contract. | 2. "nothing matches, so nobody could accept" blocks Continue. 3. The row says why it can't be read and the request can't continue. | — |
| M-TRT-05 | P1 | IPFS metadata collection | The mirror configured as `NEXT_PUBLIC_CHOG_ADDRESS` | Create and fill a trait request on the mirror. | The scan reads its IPFS metadata (1,969 tokens, under the 10,000 cap) and the fill works. This is the path real Chogs will take. | — |

### 4.6 Signed swaps (SIG)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-SIG-01 | P0 | Sign and post, with the wrap step | A holds `#a4`, MON, no WMON | 1. **Create deal** → **Sign only**. 2. Want 10 mUSD → **Continue**. 3. Give `#a4`, **Good for** 1 hour → **Continue**. 4. Run each step: **Wrap X MON into WMON**, the WMON approval, **Approve NFT #a4**. 5. **Sign and post**. | **+ MON** is absent. Review shows the fee in WMON and "Signing lets anyone settle this, with anyone". The WMON approval equals the fee; the NFT approval is `approve(id)`. The signing prompt is EIP-712 typed data: domain `DeClubIntents`, version `1`, chain 10143, the configured intents address, with `feeToken` and `maxFee`. The app opens `/intent/<hash>`: "Your swap is in the pool". | Automated: IN-01 |
| M-SIG-02 | P0 | A pair settles | M-SIG-01 open; B holds mUSD and WMON | B signs the mirror swap: gives 10 mUSD, wants `#a4`. | Within a matcher pass (about 5 s) both pages read **Settled**; the cycle reads "Matched and swapped" and "You received". `#a4` with B, 10 mUSD with A, recipient +2 × fee in WMON. The matcher key paid the gas. | Automated: IN-02, IN-08 |
| M-SIG-03 | P0 | Cancel on-chain | A live swap by A | **Cancel on-chain**, confirm. | "Cancelled on-chain. It can never settle now." `isNonceUsed` is true. Posting a saved copy of the signature is refused (nonce used). | Automated: IN-05 |
| M-SIG-04 | P1 | Remove from pool | A live swap by A | **Remove from pool**, sign the message. | No gas. Status **Cancelled**, with the line that a copy elsewhere could still settle until the deadline. | Automated: IN-08 |
| M-SIG-05 | P1 | Paused and back | A live swap giving `#a5` | 1. Revoke `#a5`'s approval in the wallet. 2. Wait about 30 s. 3. Use the approve-again button. | Status **Paused**, "Your swap is on hold", reason "An NFT this intent gives isn't approved for DeClub any more." After approving it returns to **Open**. Same for spending the WMON: "You don't hold enough WMON for the protocol fee any more." | — |
| M-SIG-06 | P1 | Pool rejections | — | 1. Sign a second swap giving the same NFT. 2. Sign swaps whose mUSD gives exceed the balance. 3. Give a token not on `MATCHER_TOKEN_ALLOWLIST`. | "Another of your signed swaps already gives this NFT. Cancel that one first." / "Together with your other signed swaps, this gives more of a token than your wallet holds." / "The pool doesn't match one of these tokens." | Automated: IN-06 |
| M-SIG-07 | P1 | Whole-collection approval | Give two NFTs of one collection | Tick **Approve whole collections**. | The copy warns the contract may move any NFT in that collection; one `setApprovalForAll` prompt replaces the per-NFT ones. | — |
| M-SIG-08 | P1 | Surplus | A wants at least 10 mUSD; B gives 15 | Let them settle. | A's "You received" shows 15 mUSD. | Automated: IN-02 |
| M-SIG-09 | P1 | Deadline passes | A swap with **10 minutes**, no counterparty | Wait 10 minutes. | Page shows **Expired**; nothing settles afterwards. | Automated: IN-06 |
| M-SIG-10 | P2 | Contract-wallet maker | D is a Safe that can sign on testnet | Sign and post from D; match it with B. | Accepted by the pool and settles. Mark N/A if no Safe signs on testnet. | Automated: IN-07 |

### 4.7 Rings (RING)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-RING-01 | P1 | Ring of 3 | No pair matches on its own | A gives `#a1'` wants `#b1'`; B gives `#b1'` wants `#c1'`; C gives `#c1'` wants `#a1'`. | One settlement transaction; each page reads "Ring of 3" / "Matched across 3 wallets"; each maker paid one fee. | Automated: IN-03 |
| M-RING-02 | P1 | Ring of 4 | D funded with an NFT and WMON | Same pattern across A, B, C, D. | "Ring of 4". Gas used is well under 5M (on anvil a 4-ring used about 445k, estimate 507k). | Automated: IN-04 |
| M-RING-03 | P1 | One member breaks | Three ring intents posted | C revokes its approval just before the next pass. | No settlement; nobody is charged; A's and B's swaps stay open; C's goes **Paused**. | — |

### 4.8 Deal list (LIST)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-LIST-01 | P0 | New deals show up | A creates a locked deal and a signed swap | Open `/deals` as B. | Both appear on **Open** within about 10 s (8 s poll), tagged **Locked** and **Signed**. | Automated: WEB-03 |
| M-LIST-02 | P1 | Tabs | A private deal for B exists | Check **Open (n)**, **For you (n)**, **All** as B, as C, signed out. | **For you** lists it for B only. Signed out: "Connect a wallet to see offers made to you." | — |
| M-LIST-03 | P1 | Search | — | Search a deal id, an NFT id, A's address, `mUSD`, the mUSD address, nonsense. | Matching deals; for nonsense "No deals match your search or filters." | Automated: WEB-07 |
| M-LIST-04 | P1 | Filters, sort, pages | 10+ deals | Try **Any MON / Offers MON / Wants MON / No MON**, **All types / Locked / Signed**, **Newest first / Ending soon**; type a page number, an out-of-range one, Escape. | Changing a filter returns to page 1; pages of 4; out-of-range clamps; Escape cancels. | — |
| M-LIST-05 | P1 | Closed deals leave Open | A filled, a cancelled and an expired deal | Check **Open** and **All**. | None on **Open**; all three on **All** with their status. | — |

### 4.9 History and notifications (HIS)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-HIS-01 | P1 | History after a fill | M-DEAL-01 done | Open `/history` as A and B. | Both list the deal under **Completed**; counts **Active deals / Completed swaps / Expired offers** add up; filters **All activity / Active / Completed / Expired** work; signed swaps appear too. | — |
| M-HIS-02 | P1 | Fill made outside the app | C fills a deal with `cast send` (`fillTrade(id)` plus value) | Wait one cron run, open C's History and the Club's **Recent swaps**. | The fill appears in both (fill watcher). | Automated: WEB-05 |
| M-HIS-03 | P1 | Accepted offer counts as the proposer's fill | M-OFR-02 | B opens `/history`. | The deal is listed as completed for B. | — |
| M-HIS-04 | P1 | Bell | Deals and swaps from earlier cases | Open the bell as A and B. | B: **For you** for the private deal. A: **Accepted**, **Ending soon** (1-hour deal), **Expired**, and **Settled** / **Paused** for swaps. The unread count drops on read. | — |
| M-HIS-05 | P2 | Read state across devices; browser alerts | A signed in on two browsers | Read on one, reload the other. Turn on **Browser alerts**, background the tab, get a deal for A. | Read state syncs. An alert fires while the tab is in the background; if blocked: "Blocked in your browser settings." | — |

### 4.10 Protocol fee and fee admin (FEE)

The fee admin's transactions go through the admin Safe (or the dedicated EOA on testnet). Keep both contracts in step: every change is made on `DeClubEscrow` and `DeClubIntents`.

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-FEE-01 | P0 | The fee shown is the fee charged | — | Compare the **Protocol fee** line on Create review, the deal dock, an offer form and the signing review with `fee()` on each contract. | Every screen shows the same amount as `fee()`; MON for locked deals, WMON for signed swaps. Each fill's `FeeCharged` amount is 2 × the deal's own fee. | Automated: V2-01, IN-02 |
| M-FEE-02 | P0 | Cut | Admin Safe signers available; one open deal listed at the old fee | 1. Admin calls `setFee(lower)` on both contracts. 2. Reload Create and the old deal. 3. Fill the old deal as B. | New deals and new swaps show the lower fee at once. The old deal still asks for its listed fee (its dock and the prompt value), and the fill charges that. | Automated: FA-03 |
| M-FEE-03 | P0 | Raise is queued, shown, and can be cancelled | — | 1. Admin calls `setFee(higher)` on both. 2. Open Create, the deal dock and the signing review. 3. Admin calls `setFee(fee())` on both. | `fee()` is unchanged; `pendingFee` and `pendingFeeAt` (7 days on) are set. The app shows the queued raise beside the current fee. After step 3 nothing is pending and the notice is gone. | Automated: FA-02 |
| M-FEE-04 | P1 | Raise prices out live swaps | Local or a dedicated testnet deploy only (needs 7 days) | Queue a raise, wait 7 days, `applyFee` on both. | Open swaps whose `maxFee` is below the new fee go **Paused** in the pool (stale), not deleted, and settle again after a cut. | Automated: FA-04 |
| M-FEE-05 | P1 | Only the admin; never above the ceiling | — | From wallet A, call `setFee`; from the admin, try `MAX_FEE() + 1`. | Both revert (`NotFeeAdmin`, `FeeTooHigh`). | Automated: FA-01 |
| M-FEE-06 | P1 | Recipient receives MON and WMON | After M-DEAL-01 and M-SIG-02 | Check the recipient on MonadVision. | MON from the V2 fill and WMON from the settle, each 2 × the fee. Nothing for cancels, rejects, withdrawals or reclaims. | Automated: V2-01, V2-02, IN-02 |

### 4.11 Privy, profiles and @handle (PRV)

This is the live checklist in [10 · Privy](10-privy.md#what-remains-to-validate), as cases.

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-PRV-01 | P0 | Link accounts | A signed in with a wallet | On `/account`: link X, Discord, email, and **Link another wallet**. | Each appears under **Linked accounts** or **Wallets**; reload keeps them. | — |
| M-PRV-02 | P0 | Per-user state is private | A and B signed in on separate browsers | 1. As A, read some notifications, add a recent collection. 2. From a shell, call `GET /api/state` without a token, with B's token, and with A's token naming B's wallet. | 1. Persists across A's devices. 2. `401` without a token, B's state with B's token, `403` for a wallet not linked to the caller. | Automated: WEB-04 |
| M-PRV-03 | P1 | Shared profile | A linked to X | Turn on **Show my profile** for X; open one of A's deals in B's browser. | B sees A's X handle beside A's wallet. Turning it off (**Stop showing**) hides it after reload. | — |
| M-PRV-04 | P1 | Deal for @handle | B linked to Discord and has shared that wallet | In Create, type B's Discord handle in the "who can accept" field, pick the wallet, create. | The lookup shows only wallets B shared; the deal locks to the chosen address (`getTrade(id).taker`). An unknown handle or one with nothing shared says so and creates nothing. | — |
| M-PRV-05 | P1 | Webhook delivery | Webhook endpoint configured | 1. Send Privy's dashboard test webhook. 2. Unlink X from the throwaway account; transfer one of its accounts; delete it. | 1. `200`. 2. After each event (and a reload) the profile and Club wallets match Privy; a deleted user's profile is gone. | Automated: WEB-06 |
| M-PRV-06 | P1 | Unlink a wallet | A has two wallets linked | **Unlink** the second. | It leaves **Wallets**; Club Holder status and roles recompute without it. | — |

### 4.12 Clubs (CLB)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-CLB-01 | P1 | Join and Holder badge across wallets | A holds a MockChog only in the second linked wallet | Open the Mock Chog Club, **Join Club**. | A is a member with **Holder**, counted across linked wallets. **Leave this Club** works and rejoining keeps nothing stale. | — |
| M-CLB-02 | P1 | Market and activity | Deals naming MockChog | Open the Club's Market and recent swaps. | The Club's open deals and signed swaps show; a fill reported through `/api/activity` (or the watcher) shows in recent swaps and in Momentum. | — |
| M-CLB-03 | P1 | Post, report, auto-hide | A, B and C members; at least two Holders | 1. A posts, with and without a deal id. 2. B and C **Report** it. | The post shows (links not clickable). Enough Holder reports hide it ("Hidden after reports"); the author still sees it. | — |
| M-CLB-04 | P1 | Owner claim | A wallet linked to the Club token's `owner()` (deploy a test token you own) | Claim ownership from the Club page. | The claimant becomes Owner; a second claim is refused; a token without `owner()` can't be claimed. | — |
| M-CLB-05 | P1 | Moderation | C is admin (`CLUB_ADMIN_USER_IDS`), A is Owner | Owner: **Make moderator** B, **Pin to top**, edit the Club page, **Hand over the Club**. B: **Hide**, **Restore**, **Ban from the Club**. C: global ban, purge a hidden Club. | Each action shows in the **Moderation log** as wallets. A banned member can't rejoin or post. Each role can do only what [09 · Clubs](09-clubs.md) allows. | — |
| M-CLB-06 | P2 | Holders-only posting, archived Club | — | Turn on holders-only posting and post as a non-holder; open an archived Club. | "Only holders can post"; the archived board is frozen. | — |

### 4.13 Mobile and responsive (MOB)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-MOB-01 | P1 | Phone width | Desktop browser at 375 px | Walk through Create, a deal page, `/deals`, `/history`, a Club. | No horizontal scroll, the dock and steppers fit, buttons are reachable, the header shows **Switch network** when needed. | — |
| M-MOB-02 | P1 | Wallet in-app browser | Phone wallet with in-app browser | Sign in, take a deal, sign a swap. | Every prompt opens in the wallet and returns to the page; typed-data signing shows the fields. | — |
| M-MOB-03 | P2 | Social sign-in on mobile | Phone browser without a wallet | Sign in with X or Google. | Signed in; the page explains how to connect the linked wallet. | — |

### 4.14 Errors and edge cases (ERR)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-ERR-01 | P0 | Rejected in the wallet | — | Reject an approval, a create, a fill and a signature. | A calm message, the button is usable again, nothing half-done (no deal, no posted swap). | — |
| M-ERR-02 | P0 | Not enough MON for value + fee + gas | B has just under what a fill needs | **Accept & swap**. | The app says what's missing before the wallet opens; no transaction is sent. | Automated: V2-08 |
| M-ERR-03 | P1 | RPC down or slow | Block the RPC host in devtools, or point `NEXT_PUBLIC_RPC_URL` at a dead URL in a test build | Load `/deals`, a deal page, Create. | Error panels with retry, not blank pages or endless spinners; nothing claims a transaction happened. | — |
| M-ERR-04 | P1 | Matcher down | Stop the matcher | Open `/deals`, sign a swap, open an `/intent/<hash>`. | Locked deals still list (signed swaps say they couldn't load); posting fails with a clear message and nothing is signed for nothing; restarting the matcher restores the book from sqlite. | Automated: WEB-03 |
| M-ERR-05 | P1 | Store down | Wrong `UPSTASH_REDIS_REST_TOKEN` in a test deployment | Use History, the bell, a Club. | The app falls back to per-browser state where the docs say so; Club writes fail clearly; trading still works. | — |
| M-ERR-06 | P1 | Stale page | Two tabs on the same deal | Fill it in one, act in the other. | The second tab learns the deal is closed on its next poll or on simulation; no transaction goes out. | Automated: V2-02 |
| M-ERR-07 | P2 | Bad links | — | Open `/intent/0xnope`, `/clubs/0xnope`, an unknown page. | Friendly "not found" states, never a stack trace. | Automated: WEB-01, WEB-07 |

### 4.15 Security-relevant UI (SEC)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-SEC-01 | P0 | Assets are what they claim | Engineer deploys a lookalike ERC-20 named "mUSD" and a lookalike NFT collection named "Chog" | A lists a deal asking for the real mUSD; B creates one offering the fake. Open both as C. | The deal page and list always show the token address beside the symbol, so the two are distinguishable. Record what the app does for an unverified token (the verified-list badges and warnings of ADR 0014 are not built yet; see [6.1](#61-gono-go-checklist)). | — |
| M-SEC-02 | P0 | Approvals are minimal | — | Watch every approval prompt in M-CRE-01/02, M-DEAL-01, M-SIG-01. | ERC-20 approvals are exact amounts; NFT approvals are per-collection only when the copy says so (or per-id for swaps); nothing approves the matcher or any address other than the two deal contracts and the fee token's spender. | — |
| M-SEC-03 | P0 | What you sign is what's shown | M-SIG-01 | Compare the wallet's typed-data view with the review screen. | Give, want, fee token, `maxFee` and deadline in the prompt match the review; the domain's `verifyingContract` is the configured intents address. | Automated: IN-01 |
| M-SEC-04 | P1 | Framing and headers | — | Try to load the app in an iframe on another origin; check response headers. | The frame is refused (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). | Automated: WEB-02 |
| M-SEC-05 | P1 | User text is inert | — | Put `<img src=x onerror=alert(1)>`, a `javascript:` link and a 2,000-character word in an offer note, a trait spec, a Club post and a Club description. | Rendered as plain text, no script runs, layout doesn't break, links aren't clickable. | — |
| M-SEC-06 | P1 | Unsolicited transfers | — | Send MON, and an NFT with `safeTransferFrom`, straight to `DeClubEscrow` and `DeClubIntents`. | All revert (no `receive()`, no `IERC721Receiver`). A plain `transferFrom` can't be refused by any contract; that NFT is lost, which the Guide should say. | Automated: V2-08 (MON) |

### 4.16 Rewards and signed social (RWD)

| ID | P | Case | Preconditions | Steps | Expected | Automated |
|---|---|---|---|---|---|---|
| M-RWD-01 | P0 | An epoch pays Holders and the Owner | A and B are members holding MockChogs (A more than B); C is the Club's Owner; short epochs (2.2) | 1. B fills a deal from D in MockChog. 2. After the epoch closes, `npm run rewards:epoch -- --publish`. 3. A, B and C open the Club's **Rewards** tab. | The script prints the Club's fees, 50% to the top 10 Holders split by NFTs held, 25% to the fund. A and B see their shares **Ready to claim**; C sees the Club-fund alert on the Club page. | RW-01, RW-02 (local) |
| M-RWD-02 | P0 | Claim | M-RWD-01 | A presses **Claim** on the Rewards tab; C presses it on **Account**. | The MON arrives; the share moves to Claimed; a second claim isn't offered. | RW-02 (local) |
| M-RWD-03 | P1 | What can't be paid rolls over | A Club with a swap and no Holder members, or no Owner | Build the next epoch. | The Club's line shows the pools rolling over; they are paid in the epoch after a Holder joins or an Owner claims. | `web/test/rewards.test.ts` |
| M-RWD-04 | P1 | Signed posts | A is a member with a shared profile, two wallets linked; the Club wallet is the first | 1. Connect the second wallet, post. 2. Switch to the Club wallet, **Sign & post**. 3. Open `/api/clubs/<MockChog>/feed`. | 1 is refused before the wallet opens ("Switch to your Club wallet"). 2 shows **Signed**. 3 has the post with its signature, which verifies against the domain in the answer. | `web/test/social.test.ts` |
| M-RWD-05 | P1 | Follows and lenses | A and B have posted | B **Follows** A, then picks **Following**, **Holders** and **Most active**. | Following shows only A's posts, without pins; Holders only Holders'; `/api/wallets/<B>/follows` has the signed follow. Unfollowing removes it. | `web/test/social.test.ts` |
| M-RWD-06 | P2 | Public epoch data | M-RWD-01 | Open `/api/rewards/epochs/<n>` and rebuild the root from its leaves. | The root matches `epochs(n).root` on `DeClubRewards`. | `DeClubRewards.leafFixture.t.sol` |
| M-RWD-07 | P1 | Link the project's X account | A is the Owner and controls an X account | **Manage → The Club on X**: enter the handle, **Link account**, post the shown text from that account (**Post it on X**), paste the post's link, **Check and link**. Then try the same with a post from another account. | The Club page shows "@handle ✓"; the log has `linked the X account`. The other account's post is refused ("isn’t from that account, or it doesn’t have the code"). **Unlink** removes it. | `web/test/xPosts.test.ts` |
| M-RWD-08 | P0 | A Holder's X post counts | M-RWD-07; B is a Holder whose profile links their X account | 1. B posts on X mentioning the linked account, and shares its link in a **Note**. 2. B shares someone else's X post. 3. B shares a second own post the same day. 4. A non-Holder shares their own. | 1: the card shows "Their own post" and **Counts**, a toast says it counts, Momentum and "X posts · 7 days" rise. 2: a card, not counted. 3 and 4: posted, with a toast saying why it didn't count. | `web/test/xPosts.test.ts` |
| M-RWD-09 | P1 | The activity bonus, counting only | M-RWD-08 in a short epoch; no `X_BEARER_TOKEN` | After the epoch closes, `npm run rewards:epoch`. | It says reach wasn't read; `/api/rewards/epochs/<n>` has `reach.available: false` and, on B's holder payout, `points` 5 (3 for the X post, 2 for the Board day of the note) and `bonusBps` 714 (428 if no Board day was recorded); the Rewards tab says each counted post adds the same, and shows "+7% active" for B. | `web/test/xPosts.test.ts`, RW-01 (local) |
| M-RWD-10 | P2 | The activity bonus, with reach (built, off until `X_BEARER_TOKEN` is set) | As M-RWD-09, with `X_BEARER_TOKEN` set in `web/.env.local`; B's X post has some likes; a second shared post is deleted on X before the epoch closes | `npm run rewards:epoch`. | It prints the reach read; B's `bonusBps` is above 714; the deleted post's entry is `ok: false, reason: "deleted"`; the Rewards tab says engaged posts count for more. | `web/test/xPosts.test.ts` |
| M-RWD-11 | P1 | Only the top 10 Holders are paid | A Club with 11 Holders (11 members whose linked wallets hold different NFT counts), swaps in the epoch | Open **Rewards → Live standings**. Then close the epoch and run `npm run rewards:epoch`. | Standings rank Holders by NFT count, a tie going to whoever joined first. The 11th sees "outside the top 10" and how many more NFTs would put them in. The built epoch has holder-pool leaves for 10 Holders only. | `web/test/standings.test.ts`, `web/test/rewards.test.ts` |
| M-RWD-12 | P1 | Active days and streaks | B is a Holder; a running epoch | B posts a top-level note on three different UTC days. B also replies to a post and has one post hidden by a Moderator on another day. | Standings show B's active days: the three days count, the reply and the hidden post don't. Each day is 2 points. After three or more days in two epochs in a row, B shows a streak. The built leaf has `days` and `streak`. | `web/test/rewards.test.ts` (active days and streaks) |
| M-RWD-13 | P2 | Replies and likes earn nothing | A and B are members and A has posted | B replies to A's post (and tries to reply to the reply), then likes it. A likes B's reply and tries to like their own post. | The reply shows one level under the post; replying to a reply is refused, and so is liking your own post. A's bell shows the reply and the like. Momentum and every `bonusBps` are unchanged. | `web/test/board.test.ts`, `web/test/boardRoutes.test.ts` |
| M-RWD-14 | P2 | The bell nudges | M-RWD-11, with B among the top 10 | Open B's bell during the epoch, and again in its last day. | "You're #N in the Club this epoch" with an estimate; in the last day, "Epoch n closes in Xh" and, if it applies, a prompt to post to keep a streak. | `web/test/standings.test.ts` |
| M-RWD-15 | P2 | Share a deal, share the week | A has a live deal and the epoch has a recap | **Share on X** on the deal page, and **Post the recap** on the Rewards tab. | Each opens a preview of the card first; its compose link opens X with the text and the page link. | `web/test/dealShare.test.ts` |

## 5. Non-functional checks

| Area | Check | Pass when |
|---|---|---|
| Performance | `/deals` with 200+ deals on testnet (script them with `e2e`); time to first list and to the next page | First page in under 3 s on a normal connection; paging and filters answer in under 1 s (server-side book, [ADR 0020](adr/0020-server-side-deal-book.md)) |
| Matcher | A book of 300+ intents; watch the log | Each pass finishes well inside `MATCHER_POLL_MS`; no "stopped early" lines in normal traffic; the gas wallet's balance trend is understood |
| RPC limits | Fill watcher catching up from `FILL_WATCHER_START_BLOCK` | It walks the chain in 100-block chunks (the public RPC caps `eth_getLogs` at 100 blocks), never errors on the cap, and the cursor moves every run |
| Gas | Record gas for create, fill, cancel, accept and settle from the testnet run | Close to the local numbers: V2 fill about 140k–175k, intents pair about 261k, ring of 3 about 364k, ring of 4 about 445k (estimate 507k, against the matcher's 5M cap). Monad charges the gas **limit**, so check the limits wallets send are not wildly above use |
| Browsers | Chrome, Firefox, Safari (desktop); Safari iOS and Chrome Android | The P0 cases pass on Chrome and one other desktop browser; mobile per 4.13 |
| Wallets | MetaMask, Rabby, Phantom or Backpack (EVM), one mobile wallet; a Safe if it signs on Monad | Sign-in, approve, create, fill and typed-data signing work on each, or the gap is written down |
| Accessibility | Keyboard-only pass through Create and a deal page; a screen reader on the deal dock; contrast on status chips | Every action is reachable by keyboard with visible focus; buttons have names; chips meet contrast |

## 6. Mainnet

### 6.1 Go/no-go checklist

Every line needs an owner and a link to evidence. Any unchecked P0 line is a no-go.

**Contracts**

- [ ] External audit of `DeClubEscrow`, `DeClubIntents` and `FeeAdmin` done; every finding fixed or accepted in writing; the deployed commit is the audited one (or the diff since was reviewed).
- [ ] A mainnet deploy path exists and was reviewed. Built: `DeployEscrow` and `DeployIntents` accept chain 143 and, there only, refuse mocks, demo wallets, a zero fee or ceiling, `FEE_FIXED`, a missing or shared recipient/admin, and any `FEE_TOKEN` but the canonical WMON (`script/FeeConfig.sol`, tested). Dry-run against the real mainnet RPC passes; the reviewer still has to sign it off.
- [ ] Canonical WMON address confirmed (`FEE_TOKEN`); the deploy script's wrap/unwrap check passed against it.
- [ ] Fee recipient Safe and a separate fee admin Safe exist, with signers and threshold recorded.
- [ ] `PROTOCOL_FEE_WEI` set from the agreed dollar amount ($5 per side, [ADR 0018](adr/0018-adjustable-protocol-fee.md)) at a recorded MON price; `PROTOCOL_FEE_MAX_WEI` about 4× that; both contracts deployed with the same values.
- [ ] The fee covers the matcher's worst-case settlement gas at mainnet gas prices.
- [ ] A runbook for re-pricing the fee (who decides, how both contracts are changed together, the 7-day notice for a raise).
- [ ] Contracts source-verified on the explorer.
- [ ] `scripts/test-all.sh --coverage --slither --halmos` green on the release commit; Slither findings still match the triage in [04 · Security](04-security.md#static-analysis).
- [ ] The full testnet run of this plan on the release commit: every P0 passed, every P1 passed or accepted.

**App and services**

- [ ] Real Chog collection address set (`NEXT_PUBLIC_CHOG_ADDRESS`), its metadata location known and the trait scan tried against it; `ERC721Enumerable` or not is known.
- [ ] Verified-collections list (`web/data/assets.json`) curated for mainnet, and the badges and warnings of [ADR 0014](adr/0014-verified-collections-list.md) built, or the decision to launch without them is recorded with M-SEC-01's result.
- [ ] No `DEMO_*` addresses and no testnet mirrors in the production env or in `web/data/assets.json`; no testnet addresses anywhere in the production env.
- [ ] Privy production app: allowed origins, login methods, `PRIVY_APP_SECRET`; webhooks need Privy's Enterprise plan, so either that is in place or the fallback (profiles sync on `/account` visits) is accepted.
- [ ] Upstash production database, separate from testnet.
- [ ] Cron scheduler calling `/api/cron/fills` every minute with `CRON_SECRET` (not Vercel Hobby's daily cron); `FILL_WATCHER_START_BLOCK` = the mainnet `DeClubEscrow` deploy block.
- [ ] Matcher: a mainnet RPC, `MATCHER_TOKEN_ALLOWLIST` set, a dedicated key funded for gas with an alert on low balance, `MATCHER_TRUST_PROXY` right for the proxy, its sqlite file on persistent storage, and log and uptime monitoring.
- [ ] `npm run verify -- --mainnet` (DEP) dry-run against the deployed addresses passes with every `EXPECT_*` set.

### 6.2 Deploy day

1. Deploy both contracts from the release commit with the agreed values. Record addresses, deploy blocks and tx hashes.
2. Verify the source on the explorer.
3. Run DEP with `--mainnet` and every `EXPECT_*` set. Stop on any failure.
4. Configure the matcher and web with the new addresses; deploy; run WEB with `--expect-live`.
5. Run the canary (6.3) before any announcement.

### 6.3 Post-deploy canary

Two team wallets, the smallest real amounts.

| ID | Case | Expected |
|---|---|---|
| C-01 | Locked deal: A lists a cheap NFT for a small amount of MON; B fills | Assets swap; the recipient Safe receives 2 × the fee; History and the list update |
| C-02 | Cancel: A lists and cancels | Everything and the fee share back to A |
| C-03 | Signed swap: A and B sign a matching pair through the app | The production matcher settles it; the recipient Safe receives 2 × the fee in WMON |
| C-04 | Fee admin: queue a raise of 1 wei and cancel it with `setFee(fee())`, through the admin Safe | Nothing changes; the Safe flow is proven before it's needed |
| C-05 | Fill watcher | The canary fills show up after a cron run |

### 6.4 Incidents

The contracts have no pause, no upgrade and no admin access to escrow. The fee admin can only change the fee within the ceiling, hand over or renounce the role. Nobody can move, freeze or rescue users' assets, and makers can always cancel or reclaim. What the team can do:

- **Take the web app down** or show a banner. Escrowed deals stay safe; makers can still cancel through the explorer.
- **Stop the matcher.** Nothing new settles through it; signed intents can still be settled by anyone holding them until their deadline, so tell users to cancel on-chain (`invalidateNonces`) if an intent must never settle.
- **Cut the fee,** at once, on both contracts.
- **Pull a token or collection** from the matcher allowlist and the verified list.
- **Communicate:** what is affected, what users should do (cancel, reclaim, revoke approvals), and when the team will update next.

If a contract bug is found, the remedy is a new deployment and moving users to it. The old contracts keep working for cancels and reclaims forever.
