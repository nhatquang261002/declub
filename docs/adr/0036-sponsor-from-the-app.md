# ADR 0036: Sponsor an epoch from the app, with the payment checked on chain

**Status:** Accepted · 2026-10-07 · Web only: no contract change. Amends [ADR 0035](0035-sponsored-epochs.md) (who records a sponsorship). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

[ADR 0035](0035-sponsored-epochs.md) made sponsoring a CLI job: the sponsor sends MON to the operator and the operator writes it down. A sponsor can't do it themselves, and an Owner who wants to boost their own Club has to message someone. An in-app form can't call `DeClubRewards.publish` (operator only), but it can send MON to the operator and have the server confirm it.

## Decision

**A sponsor pays the operator from the app; the server reads that payment off the chain and records it.**

- **The form** is a "Sponsor this epoch" button in the header of a Club's Rewards tab, beside the Overview and History views, that opens a dialog form (`components/SponsorEpoch.tsx`, closable by Escape or a click outside except while a payment is in flight): an amount in MON (at least `SPONSOR_MIN_WEI`, 0.1 MON) and a name (at most 40 characters). It shows only when the server knows the operator.
- **Two steps, one flow** (`useSponsorFlow`): send a plain MON transfer to the operator, then sign a message `DeClub sponsorship / Club / Payment / Name` (`sponsorMessage`) with the same wallet.
- **`POST /api/clubs/[token]/sponsor { tx, name, signature }`** believes nothing the browser says about the money. It reads the transaction, its receipt and its block from the chain and requires: it succeeded, it was sent to the operator (`operator()` on `DeClubRewards`, cached five minutes), it carried at least the minimum. **The amount, the payer and the time come from the chain;** only the Club and the name come from the request.
- **The signature binds the name to the payer.** It must verify (`verifyMessage`, smart wallets included) for the transaction's sender, so nobody else can put a name on a payment they saw on chain.
- **It lands in the epoch the payment's block belongs to** (`epochAt(block time)`); when that epoch is built already, in the next one. The money is never left unrecorded because the epoch closed in between.
- **A payment counts once.** `declub:rewards:sponsor-tx:{hash}` keeps what was recorded: asking again returns the same answer (`already: true`). Writers take a per-epoch lock (`recordSponsor` answers `busy`), so two payments recorded together aren't lost.
- **The Owner's own top-up is labelled so:** when the payer is one of the Owner's linked wallets the entry's kind is `owner`, otherwise `partner`.
- **If the payment lands but recording fails** (a closed tab, a refused signature) the form keeps the hash and offers "Finish recording"; a paid-already field takes a hash from the connected wallet. Nothing is paid twice.
- **The wallet that paid is public** with each entry (`by`, shown shortened beside the name on the Rewards tab), because a name is free text and the wallet is what the chain vouches for.
- **The recap names only vetted sponsors:** ones the operator recorded (no `by`) or the Owner paid as. A name anyone typed doesn't go into a post Holders share on X; the amount still does.
- **The operator can remove an entry** before the epoch is built: `rewards:sponsor -- --epoch N --remove-tx 0x…`. The MON stays with the operator, to record under another name or refund. The payment stays marked taken, so it isn't added again.

## What it does not do

- **It isn't trustless.** The operator still receives the money and funds the epoch; the sponsor trusts them to. The record is public in the epoch, the deposit is not a contract event. An on-chain `sponsor(club)` deposit stays the upgrade path.
- **It can't stop an impersonating name,** only show the paying wallet beside it, keep it out of the recap, and let the operator remove it. 0.1 MON is the price of a name.
- **It doesn't refund.** The form says so.
- **A payment sent after the last epoch it could land in** (no epoch left unbuilt) can't happen: the next epoch always exists.
- **It doesn't watch the chain.** A payment is recorded only when its sender asks, so a transfer to the operator with no request is just a transfer.

## Consequences

- No contract change, no redeploy. New files: `lib/server/sponsorRoutes.ts`, `app/api/clubs/[token]/sponsor/route.ts`, `hooks/useSponsorFlow.ts`, `components/SponsorEpoch.tsx`; `Sponsorship` gains `by` and `tx`.
- Tests: the route against injected payments (recipient, size, success, signature, replay, kind, epoch rollover, locks, removal); the real endpoint was also called on the testnet to check the operator read and an unknown transaction.
- Not tested: the wallet flow in a browser (send, sign, record) and a real payment end to end.
