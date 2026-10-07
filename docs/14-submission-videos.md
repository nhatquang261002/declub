# 14 · Submission videos

Two videos are required. Anything marked **fill** needs a real fact from the team.

| Video | Limit | Must show |
|---|---|---|
| Technical demo | 3:00, YouTube, Loom or Vimeo | The live working product. No slides, no code walkthrough |
| Pitch | 2:00 | The team, the problem, why we are building it |

Speaking pace is about 140 words a minute, so the demo script is about 400 words and the pitch about 270. Aim to finish 10 seconds under each limit.

## Technical demo (3:00)

### Before recording

- Run the [demo world](12-demo.md) on testnet and open the app in a clean browser profile, 1080p, zoomed to 110% so text reads on a phone.
- Wallet: `DEMO_PRESENTER_WALLET`. Sign in once beforehand, hold NFTs in all three Clubs, fund it with testnet MON.
- Have a second wallet ready in another profile for the counterparty of the live swap.
- Epoch 0 must have ended and be unpublished, so the rewards step can run live (see "Rewards" in doc 12).
- Do not show signed swaps (`DeClubIntents` is not deployed on testnet). Use escrow swaps only.
- Record in two or three takes by section and cut together. Record the voice-over after the screen, or talk while clicking; either works if you rehearse twice.
- Show the testnet badge once, so judges know the chain.

### Script and shots

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Home page, then the Chog Genesis Club | "This is De(al) Club, live on Monad testnet. Every verified NFT collection gets a Club: a market, a signed conversation and rewards funded by the swaps its members make." |
| 0:15–0:45 | Club page: Market tab with open deals, the activity feed | "Here is the Chog Genesis Club. These swaps are real transactions on our escrow contract, NFT for NFT and NFT for MON. Nobody sends first, and the swap settles atomically." |
| 0:45–1:30 | Open an open deal, connect the presenter wallet, accept it, confirm the transaction, show the completed deal, then **open the transaction on testnet.monadvision.com** and point at the chain, the `DeClubEscrow` address and the NFT transfers | "I'll take this deal live. I approve, I confirm, and both sides move in one transaction on Monad testnet. Here it is on the explorer, sent to our DeClubEscrow contract, with both transfers in one atomic transaction. Each side paid a fee, and that fee is where the Club's rewards come from." |
| 1:30–2:00 | Board tab: write a post, wallet signature prompt, post appears. Follow a member | "Posts and follows are signed by the member's wallet, not stored as an account on our server. I sign, and the post is mine, exportable and verifiable." |
| 2:00–2:40 | Rewards tab: standings, then run the epoch and claim (publish in a second window, then click Claim) | "The fees go back: 50% to the Club's top Holders, 25% to a fund the Owner claims, 25% to the protocol. This epoch just closed, we publish it, and I claim my share. Posting about the Club on X and showing up on active days raises a Holder's share. Swaps add a little too, capped, with repeat partners counting half, so wash trading costs more than it earns." |
| 2:40–2:55 | Share card preview, then a quick pan across the three Clubs | "A deal or a weekly recap becomes a share card for X, which is how a Club grows. Three Clubs are live here, mirrored from real Monad collections." |
| 2:55–3:00 | Home page with the URL | "De(al) Club. Your community's market, owned by its members." |

### Risks to rehearse

- **Wallet popups** can eat seconds. Pre-approve the NFT collection before recording, or edit the wait out.
- **RPC lag.** If a confirmation takes more than 3 seconds, cut it and say nothing; a jump cut is fine.
- **Rewards publish** is a CLI step (`npm run rewards:epoch -- --publish`). Keep the terminal off screen and run it between takes; show only the Claim click in the app. If you want to show it, keep it under 5 seconds.
- **IPFS art** can stall. The demo already uses the Filebase gateway; load every Club page once before recording so images are cached.

## Pitch (2:00)

Three speakers works best: one for the people, one for the problem, one for the why. Face to camera with the logo behind, no slides, plain light, good audio. Audio matters more than video quality.

### Script

| Time | Speaker | Line |
|---|---|---|
| 0:00–0:20 | Speaker 1 | "Hi, we're **fill: team name**. I'm **fill**, I **fill: role and one proof, e.g. built X**. With me are **fill** and **fill**, who **fill**. We built De(al) Club for the Monad hackathon." |
| 0:20–0:55 | Speaker 2 | "NFT communities live on Discord and X, but the value they create leaves. A marketplace takes the trading fee and gives nothing back. A Discord can be banned or deleted. Holders who post, welcome new people and trade with each other earn nothing for it, and swapping with a stranger still means someone has to send first." |
| 0:55–1:30 | Speaker 3 | "So we gave every Monad NFT collection a Club. Members swap NFTs trustlessly, and the fee from each swap comes back: half to the Club's top Holders, a quarter to a fund the Owner controls. Posts and follows are signed by the member's wallet, so they belong to the member. The more a Holder shows up for their community, the more they own of what it earns." |
| 1:30–1:50 | Speaker 1 | "We're building this because **fill: your real reason, one sentence, personal**. Our first step is **fill: e.g. the Chog Genesis Owner and N testers**, and we're **fill: current status, e.g. live on testnet with N testers**." |
| 1:50–2:00 | All | "De(al) Club. Your community's market, owned by its members." |

### Notes

- If the team is one person, drop the speaker split and extend the intro by one sentence about why you can build this alone (the contracts, matcher and app are already built).
- The "why" line is what judges remember. Make it true and specific; a personal story beats a market size.
- Don't claim traction we don't have. Use the numbers from the [go-to-market](13-go-to-market.md) table only once they are filled.
- Don't put a mainnet claim in either video; mainnet contracts are not deployed.

## What the hackathon requires

The organisers' list for the demo video: publicly accessible, shows the product in actual operation, and **shows Monad blockchain integration**. The script covers the last point with the explorer step at 0:45–1:30 and the Rewards claim at 2:00–2:40, both real testnet transactions. Say "Monad testnet" aloud at least twice, and leave the wallet's network name visible during a signature.

### Monad integration (for the submission form)

Draft text, to edit:

> De(al) Club runs on Monad testnet (chain id 10143). Swaps settle atomically in `DeClubEscrow`, so a two-NFT trade is one transaction. Rewards are paid weekly from the swap fees through `DeClubRewards`, a Merkle distributor, so a Holder claims their share in one transaction. Both only work as a product because transactions are fast and cheap: a swap that needs an approval, a deposit and a fill would be too slow and too expensive to use as a social action on a congested chain. Each Club is a verified Monad NFT collection, read from the collection's own contract and its `owner()`.

Keep that last claim honest: the demo Clubs are testnet mirrors of three mainnet collections ([doc 12](12-demo.md)), not the real contracts.

Contract addresses on Monad testnet (chain `10143`), from `.env` and `contracts/broadcast/`:

| Contract | Address |
|---|---|
| `DeClubEscrow` | `0xb8bB420CFf0dFB781cD6c1cF1569B137EFc3148f` |
| `DeClubRewards` | `0xfEC46AF05cAFe35B6b715982bCAf1DD02bb73E9a` |
| Chog Genesis mirror (demo) | `0xadca7be2cdf247a388a6fb4b19fdf0b436ad2584` |
| skrumpeys mirror (demo) | `0xa2545c8c2907cfdaccfc43774a04ffa5c3d174c2` |
| r3tards mirror (demo) | `0x816f53ac5f57f7a69e0a9467d945e5778a864da8` |
| `DeClubIntents` | **Not deployed.** Leave it out of the list |

Explorer links: `https://testnet.monadvision.com/address/<address>`. Before submitting, open each link and confirm it shows the contract. If the explorer shows the contract as unverified, verify the source first.

Mainnet: nothing is deployed. Say "testnet" everywhere, and say mainnet is a build flavor that still needs its contracts deployed and its verified assets listed (see the README).

## Publishing checklist

- [ ] Upload both as **Unlisted** (YouTube/Vimeo) or a Loom link anyone can open, and test each in a private window.
- [ ] Add captions (YouTube auto-captions, then fix "Monad", "DeClub" and "Holder").
- [ ] Put each video's title, length and link in the submission form: `De(al) Club: technical demo (2:5x)`, `De(al) Club: pitch (1:5x)`.
- [ ] Check both are under the limit on the player, not just in the editor.
