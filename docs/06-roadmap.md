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
- [ ] Try a real sponsorship in a browser on testnet: send, sign, see it on the Rewards tab, build and publish the epoch
- [ ] Deploy `DeClubIntents` to testnet: the retired `OnDealIntents` has a different EIP-712 domain, so `NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS` stays blank, which hides signed swaps, until it is deployed
- [ ] Verify the deployments on Sourcify
- [ ] Run the manual testnet pass with two real wallets
- [ ] Run the rewards epoch and claim flow on testnet
- [ ] Turn on X reach: set `X_BEARER_TOKEN` (the code is built; off by default)
- [ ] Complete the go/no-go checklist in [11 · Test plan](11-test-plan.md)

## Next: Club social

- [x] Club Pulse: swaps, new deals and new members as system messages between posts on the Board, built from the activity log and member list, with no signing (ADR 0043)
- [x] Club challenges: the Owner starts a challenge any time, members answer with a Board post, winners are picked by likes or by the Owner and earn the points the Owner set, as epoch points (ADR 0045)
- [ ] Member roles and titles: the Owner gives custom titles ("Artist", "OG") that show next to a name on posts, on top of the existing Moderator role

## Deferred

- [ ] On-chain `sponsor(club)` deposit with a `Sponsored` event, so sponsors don't have to trust the operator (needs a `DeClubRewards` change and redeploy)
- [ ] Hold-time snapshot for Holder shares (lowest balance across the epoch), so buying just before an epoch closes earns nothing
- [ ] Holder governance for Moderators and Club-fund grants
- [ ] Trade-receipt badges

## References

- [01 · Product spec](01-product-spec.md)
- [02 · Architecture](02-architecture.md)
- [03 · Contract design](03-contract-design.md)
- [04 · Security](04-security.md)
- [05 · Frontend](05-frontend.md)
- [07 · User guide](07-user-guide.md)
- [09 · Clubs](09-clubs.md)
- [11 · Test plan](11-test-plan.md)
- [12 · Demo](12-demo.md)
- [13 · Why communities move, and how we grow](13-go-to-market.md)
