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

The demo has its own DeClubEscrow and DeClubRewards, deployed by the demo's bank wallet:

- **DeClubEscrow:** fee 0.05 MON a side, fixed (`FEE_FIXED`), paid to the bank. The older testnet escrow charges 2 MON a side, which would cost more for each swap than the demo budget allows.
- **DeClubRewards:** the bank is the operator, with no claim delay. Fees come back to the bank and fund the epochs.

Epochs are a day long (`NEXT_PUBLIC_REWARDS_EPOCH_SECONDS=86400`). The genesis is set so that the first epoch closes just after the seeded swaps, so it can be built, published and claimed during the demo while the next one fills up.

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
REWARDS_OPERATOR=$B REWARDS_CLAIM_DELAY=0 \
  forge script script/DeployRewards.s.sol --rpc-url monad_testnet --private-key $K --broadcast
```

Put the printed addresses in the root `.env` (`DEMO_CHOG_ADDRESS`, `DEMO_SKRUMPEYS_ADDRESS`, `DEMO_R3TARDS_ADDRESS`, `NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS`, `NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS`, `NEXT_PUBLIC_CHOG_ADDRESS` = the Chog mirror), with `DEMO_PRESENTER_WALLET`. Then add the three mirrors to `web/data/assets.json` with their art (`/art/clubs/*.png`), and:

```bash
cd web
node --import ./test/register.mjs scripts/demo.ts chain     # mint, fund the personas, hand over the mirrors
node --import ./test/register.mjs scripts/demo.ts trades    # the ten swaps, into each Club's activity
node --import ./test/register.mjs scripts/demo.ts social    # profiles, members, roles, posts, follows, avatars
```

Every step skips what it already did, so a step that fails halfway can be run again. The presenter must have signed in to the app once with their wallet before `social`: the script finds their Privy user by that wallet to make them a member and the Chog Club's Owner.

**Rewards.** Set `NEXT_PUBLIC_REWARDS_GENESIS` to a minute or two from now, minus a day, so epoch 0 holds the swaps and ends shortly. Once it ends:

```bash
REWARDS_OPERATOR_KEY=$(jq -r .bank .demo/wallets.json) npm run rewards:epoch -- --publish
```

## Things to know

- **IPFS.** ipfs.io stalls on the Chog Genesis CIDs, so the demo reads IPFS through Filebase (`NEXT_PUBLIC_IPFS_GATEWAY=https://ipfs.filebase.io/ipfs/`).
- **X.** No persona shares X posts, so Momentum comes from swaps alone, and the X lines on Club pages stay empty until someone shares a real post.
- **Starting over.** A rerun of `trades` on new contracts needs `web/.demo/state.json` deleted first. Old store rows are keyed by token address, so new mirrors start clean.
