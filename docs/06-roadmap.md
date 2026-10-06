# 06 · Roadmap

This document tracks current release work. Completed implementation history
lives in the git log and the relevant ADRs.

## Current release

- [x] DeClub contracts, rewards, signed social and Club screens
- [x] Local contract, matcher, web and e2e test suites
- [x] Demo world and repeatable testnet seeding scripts
- [ ] Deploy `DeClubEscrow`, `DeClubIntents` and `DeClubRewards` to testnet
- [ ] Verify the deployments on Sourcify and configure the root `.env`
- [ ] Run the manual testnet pass with two real wallets
- [ ] Run the rewards epoch and claim flow on testnet
- [ ] Complete the go/no-go checklist in [11 · Test plan](11-test-plan.md)

## Deferred

- [ ] X engagement counts and deleted-post filtering
- [ ] Holder governance for Moderators and Club-fund grants
- [ ] Curator credit for “Looking for” posts that lead to a swap
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
