# 06 · Roadmap

This document tracks current release work. Completed implementation history
lives in the git log and the relevant ADRs.

## Current release

- [x] DeClub contracts, rewards, signed social and Club screens
- [x] Local contract, matcher, web and e2e test suites
- [x] Demo world and repeatable testnet seeding scripts
- [x] Deploy `DeClubEscrow` and `DeClubRewards` to testnet (demo deployment, root `.env` set)
- [x] Swaps count in the Holder bonus, capped ([ADR 0034](adr/0034-swaps-count-in-the-holder-bonus.md))
- [x] Sponsored epochs ([ADR 0035](adr/0035-sponsored-epochs.md)), from the app with the payment checked on chain ([ADR 0036](adr/0036-sponsor-from-the-app.md)) or by the operator with `npm run rewards:sponsor`; either way before the epoch is built
- [ ] Improve in-app posting:
  - [x] One picture per post, signed by its hash and kept in private object storage ([ADR 0056](adr/0056-post-pictures-and-emoji.md))
  - [x] Emoji and sticker buttons on a tool row in the composer, and in the reply box (ADR 0056)
- [ ] Try a real sponsorship in a browser on testnet: send, sign, see it on the Rewards tab, build and publish the epoch
- [x] Deploy `DeClubIntents` to testnet with the per-NFT fee (2026-10-07)
- [ ] Verify the deployments on Sourcify
- [ ] Run the manual testnet pass with two real wallets
- [ ] Run the rewards epoch and claim flow on testnet
- [ ] Run the fill watcher on testnet with `ENVIO_API_TOKEN` and backfill from the deploy block ([ADR 0051](adr/0051-hypersync-for-the-fill-watcher.md); built and unit-tested, not yet run against HyperSync)
- [ ] Check Deals' Newest first on testnet with `ENVIO_API_TOKEN`: locked deals and signed swaps interleave by creation time ([ADR 0020](adr/0020-server-side-deal-book.md); built and unit-tested, not yet run against HyperSync)
- [ ] Turn on X reach: set `X_BEARER_TOKEN` (the code is built; off by default)
- [ ] Complete the go/no-go checklist in [11 · Test plan](11-test-plan.md)

## Next

- [ ] Build proper infrastructure for the project: hosting, monitoring, backups and a real cron/queue in place of the free GitHub-scheduled fill watcher and the single Redis store (the sponsor ledger, member lists, built epochs and, unchecked, the whole store now export and restore: `rewards:sponsor --export`, `members:backup`, `rewards:backup`, `store:backup`; `store:backup` runs nightly from `store-backup.yml` once the repo is private; still to do: an off-site copy, and a backup of the pictures in Vercel Blob, which the store dump leaves out, [ADR 0056](adr/0056-post-pictures-and-emoji.md))
- [ ] Improve in-app posting:
  - [x] A Club's own emoji and stickers, added by staff and used as `:name:`, and twelve built-in stickers every Club has ([ADR 0057](adr/0057-club-emoji-and-stickers.md))
  - [ ] Make a Club's own emoji and stickers members-only: the pack list and its pictures go only to members and staff (the built-in stickers stay open), the pictures are fetched with the member's token and shown from memory, and everyone else sees `:name:` as text; amends ADR 0057
  - [ ] Browser-test pictures and Club emoji end to end (M-CLB-07, M-CLB-08) once the Blob store is on the deployed environment
  - [ ] Cap a picture's pixel dimensions on the server (today only type, bytes and file size are checked, so a small file can declare a huge canvas)
  - [ ] GIFs (needs the dimension cap first; a raw upload keeps the animation, so the file-size limits are the only shrinking), and a still poster for people who prefer less motion
  - [ ] Formatting (bold, links) and more than one picture per post
- [ ] Improve the timeline algorithm
- [ ] Integrate X engagement into the account (reach and activity from a linked X account; related: turn on X reach, above)
- [ ] Add new challenge types, beyond the member's own X post:
  - [ ] Streak quest: active on N days during the challenge, no entry form
  - [ ] Trade quest: a deal or swap in the Club's asset during the challenge, checked on-chain
  - [ ] Board post: any Board post, no X needed (art, pitches, members without X)
  - [ ] Raid: quote or reply to an X post the Owner names (needs a check that the X API reads quotes)
- [ ] Custom roles for members: the Owner gives titles ("Artist", "OG") that show next to a name on posts, on top of the existing Moderator role

## Deferred

- [ ] On-chain `sponsor(club)` deposit with a `Sponsored` event, so sponsors don't have to trust the operator (needs a `DeClubRewards` change and redeploy)
- [ ] Hold-time snapshot for Holder shares (lowest balance across the epoch), so buying just before an epoch closes earns nothing
- [ ] Holder governance for Moderators and Club-fund grants
- [ ] Trade-receipt badges

## References

The full map of docs and decisions is in the [docs index](README.md).
