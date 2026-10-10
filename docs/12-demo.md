# 12 · Demo world

The hackathon demo runs on Monad testnet, on mirrors of three mainnet collections, with a small cast of invented holders who trade, post and follow each other. This page says what is in it and how to build it again.

## What it is

**Three Clubs, mirrored from mainnet.** `contracts/src/mocks/CollectionMirror.sol` copies each collection's name, symbol, supply and token URIs, so testnet token #n shows mainnet #n's art. Chog Genesis reveals with an offset (mainnet #1 is `1462.json`), which the mirror reproduces.

| Club | Mainnet | Supply | Metadata | Owner in the demo |
|---|---|---|---|---|
| Chog Genesis (CHOG) | `0xc96d…3763` | 1,969 | IPFS, `.json`, reveal offset 1461 | the presenter |
| skrumpeys (SKRUMP) | `0xb0da…c2d0` | 3,333 | evmfs.xyz | `pixel.warden` |
| r3tards (R3TARDS) | `0x2007…0c29` | 1,033 | scatter.art | `intern_zero` |

Only the demo holdings are minted: 61 tokens over 13 wallets. Each mirror's `owner()` is handed to its Club's Owner, so the claimed Owner and the chain agree.

**Thirteen personas** (`web/scripts/demo/content.ts`), each with a Discord handle. The app doesn't link Discord handles, so no persona points at a real person's X account. The presenter's own wallet (`DEMO_PRESENTER_WALLET`) holds in all three Clubs and owns the Chog Club, but posts nothing: posting is for the live demo.

**Real swaps.** Ten DeClubEscrow trades between personas: seven filled (NFT for NFT across Clubs, and NFT for MON) and three left open, each linked from a "looking" post. The Market tabs, deal pages, Momentum and the Rewards pools all come from these.

**The off-chain part**, written through the app's own server functions into Upstash:

- shared profiles, avatars (each persona's first NFT), Club memberships with their join dates;
- roles, moderators and the moderation log;
- each Club's description, mainnet link, X tags and pinned post;
- 24 signed posts over twelve days;
- 23 signed follows.

## Demo contracts

The demo has its own DeClubEscrow, DeClubIntents and DeClubRewards, deployed by the demo's bank wallet:

- **DeClubEscrow:** fee 0.05 MON per NFT a side moves, fixed (`FEE_FIXED`), ceiling 0.2 MON, paid to the bank ([ADR 0033](adr/0033-fee-per-nft.md)). The demo's swaps move one NFT a side, so each side pays 0.05. The older testnet escrow charged 2 MON a side, which would cost more for each swap than the demo budget allows.
- **DeClubIntents:** the same fee, paid in a `MockWMON` the same script deploys (`DEPLOY_MOCK_WMON`), since testnet has no canonical WMON. The mock only wraps 1:1 (`deposit`), so a wallet gets WMON by wrapping MON. The matcher (`matcher/README.md`) needs it.
- **DeClubRewards:** the bank is the operator, with no claim delay. Fees come back to the bank and fund the epochs.

Epoch 0 was a day long (`NEXT_PUBLIC_REWARDS_EPOCH_SECONDS=86400`), with the genesis set so that it closed just after the seeded swaps and could be built, published and claimed during the demo. From epoch 1 epochs are a week (`604800`): the genesis moved back to `1790666999` so epoch 1 starts where epoch 0 ended, Tuesday 2026-10-06 07:30 UTC, and each epoch closes Tuesday 07:30 UTC.

## Build it

From a clean testnet, with Upstash credentials in `web/.env.local`:

```bash
cd web
node --import ./test/register.mjs scripts/demo.ts wallets     # keys in web/.demo/ (git-ignored); prints the bank
# send ~4.3 testnet MON to the bank

cd ../contracts
K=$(jq -r .bank ../web/.demo/wallets.json); B=$(cast wallet address $K)
forge script script/DeployMirrors.s.sol --rpc-url monad_testnet --private-key $K --broadcast
PROTOCOL_FEE_WEI=50000000000000000 PROTOCOL_FEE_MAX_WEI=200000000000000000 FEE_RECIPIENT=$B FEE_FIXED=true \
  forge script script/DeployEscrow.s.sol --rpc-url monad_testnet --private-key $K --broadcast
PROTOCOL_FEE_WEI=50000000000000000 PROTOCOL_FEE_MAX_WEI=200000000000000000 FEE_RECIPIENT=$B FEE_FIXED=true DEPLOY_MOCK_WMON=true \
  forge script script/DeployIntents.s.sol --rpc-url monad_testnet --private-key $K --broadcast
REWARDS_OPERATOR=$B REWARDS_CLAIM_DELAY=0 \
  forge script script/DeployRewards.s.sol --rpc-url monad_testnet --private-key $K --broadcast
```

Put the printed addresses in the root `.env` (`DEMO_CHOG_ADDRESS`, `DEMO_SKRUMPEYS_ADDRESS`, `DEMO_R3TARDS_ADDRESS`, `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS`, `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS`, `NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS`, `NEXT_PUBLIC_CHOG_ADDRESS` = the Chog mirror), with `DEMO_PRESENTER_WALLET`. Then add the three mirrors to `web/data/assets.json` with their art (`/art/clubs/*.png`), and:

```bash
cd web
node --import ./test/register.mjs scripts/demo.ts chain     # mint, fund the personas, hand over the mirrors
node --import ./test/register.mjs scripts/demo.ts trades    # the ten swaps, into each Club's activity
node --import ./test/register.mjs scripts/demo.ts social    # profiles, members, roles, posts, follows, avatars
node --import ./test/register.mjs scripts/demo.ts challenges  # a challenge of every judging mode and phase
node --import ./test/register.mjs scripts/demo.ts market    # open deals for testers: singles and bundles
node --import ./test/register.mjs scripts/demo.ts signed    # signed deals and rings in the intent pool
```

**Market.** `market` lists 20 deals with random asks (a MON price or an NFT from another Club), 20 for 0.01 to 0.05 MON so a fresh wallet straight from the faucet can buy one, and 8 bundles of several items a side (`MARKET` in `content.ts`). Bundles go first. The personas list tokens they still hold, in a seeded shuffle; each pays the fee, and the bank tops a persona up when its balance is short. It stops when the bank runs low and continues on a rerun (`DEMO_GAS_PCT=200` keeps the gas limit, which Monad bills, down).

**Signed deals.** `signed` posts DeClubIntents intents to the pool (`NEXT_PUBLIC_POOL_URL`): rings first (`RINGS`), then single and multi-item deals priced in WMON (`SIGNED`). Each maker approves its NFTs and WMON once and wraps enough MON to cover the fee on every live deal; the signatures cost nothing. One ring is complete, so the matcher settles it within seconds. The others leave their last leg to the presenter: the step prints which of their NFTs to give for which, and signing that swap in the app closes the ring. Signed deals last the pool's longest deadline, 7 days, and NFTs in a live signed deal are left out of `market`.

**Challenges** (`CHALLENGES` in `content.ts`): open ones start in the running epoch through the app's own functions, with signed entries sharing invented X posts (`dcdemo…` handles) and likes. "Ended" ones ran over the four days before it: they are written to the store as the app would have kept them, then the app settles them, so their points count in the epoch they ended in (or the running one, if that epoch is closed). The Chog Club, the presenter's, has one waiting for the Owner's pick and one with a Chog prize to send. A Club allows three open at once, so the step stops if a Club already has more open than it leaves room for.

Every step skips what it already did, so a step that fails halfway can be run again. The presenter must have signed in to the app once with their wallet before `social`: the script finds their Privy user by that wallet to make them a member and the Chog Club's Owner.

**Rewards.** Set `NEXT_PUBLIC_REWARDS_GENESIS` to a minute or two from now, minus a day, so epoch 0 holds the swaps and ends shortly. Once it ends:

```bash
REWARDS_OPERATOR_KEY=$(jq -r .bank .demo/wallets.json) npm run rewards:epoch -- --publish
```

## Things to know

- **IPFS.** ipfs.io stalls on the Chog Genesis CIDs, so the demo reads IPFS through Filebase (`NEXT_PUBLIC_IPFS_GATEWAY=https://ipfs.filebase.io/ipfs/`).
- **X.** No persona shares X posts, so the X lines on Club pages stay empty until someone shares a real post. Momentum comes from the swaps and from Holder personas' Board posts ([ADR 0047](adr/0047-board-posts-in-momentum.md)): one a day per persona per Club, from a social step run after this change.
- **Starting over.** A rerun of `trades` on new contracts needs `web/.demo/state.json` reset to `{ "trades": {} }` first. Old store rows are keyed by token address, so new mirrors start clean. The step names tokens by the order they were minted, so on the *same* mirrors it only works while every NFT is back with its first holder: cancel the open trades on the old escrow and return the swapped NFTs first, or deploy fresh mirrors. Activity recorded from the old escrow stays in the store beside the new.
- **Monad's reserve balance.** A wallet holding under 10 MON can only run a transaction that dips below the reserve if it sent no other in the last few blocks (about 1.2 s). Otherwise the transaction reverts and still pays for gas, even though a simulation succeeds. `demo.ts` waits 3 s between a wallet's transactions (the approval, then the trade). Gas is billed on the limit, so the script also caps the limit at what the wallet can afford at the max fee (`DEMO_GAS_PCT`, default 300, is the ceiling as a percentage of the estimate).
- **Budget.** A persona's trade costs its 0.05 fee plus about 0.05 to 0.1 MON of gas, so the personas need more than the fees alone; the bank's fees come back as swaps fill. Rebuilding on a new escrow took about 1.2 MON of top-ups beyond what the personas held, and about 0.5 MON was lost to failed transactions before the spacing was added.
- **RPC.** If `testnet-rpc.monad.xyz` times out, pass another RPC for the run, e.g. `NEXT_PUBLIC_RPC_URL=https://rpc.ankr.com/monad_testnet` (`--rpc-url` for Foundry). A value set in the shell wins over `.env`.
