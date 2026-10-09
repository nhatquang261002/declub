# ADR 0035: Sponsored epochs, recorded by the operator

**Status:** Accepted · 2026-10-07 · Sponsors can also pay from the app: [ADR 0036](0036-sponsor-from-the-app.md). · Web and scripts only: no contract change, no redeploy. Amends [ADR 0022](0022-club-rewards.md) (where a Club's pool comes from). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

The Holder pool is half the swap fees, and early Clubs trade little, so early pools are tiny. A project, a partner or an ecosystem fund may want to add to a Club's pool for a week, and the Club's Owner may want to boost their own. `DeClubRewards.publish` is `onlyOperator` and funds one epoch's whole root with `msg.value`, so only the operator can put MON in; and the epoch builder only knows fees.

## Decision

**A sponsor sends MON to the operator, and the operator records who gave what to which Club before the epoch is built.**

- **The ledger.** `declub:rewards:{chain}:sponsors:{epoch}` holds `{club, amount, sponsor, kind, at}` entries (`kind` is `owner` or `partner`). `npm run rewards:sponsor -- --epoch N --club 0x… --amount 5 --name "…" [--owner]` writes one (`recordSponsor`); `--list` reads them back. A name is one line of at most 40 characters.
- **It joins the Holder pool, all of it.** `pools(fees, carried, sponsored)` adds it to `holderPool`: split among the 10 most active Holders by shares × (1 + bonus) ([ADR 0037](0037-most-active-holders-are-paid.md)), like the fees. None goes to the Club fund or the protocol, because a sponsor who gives to Holders means Holders. With no Holders it carries to the next epoch's Holder pool.
- **Recorded before the build.** A built epoch is fixed (`recordSponsor` answers `built`), and the record is then used for the next one. The ledger of an epoch is copied into its record (`clubs[].sponsored`, `clubs[].sponsors`), so a rebuild of the proof doesn't need it.
- **Funded with the epoch.** The epoch's `total` is the sum of the leaves, which now includes sponsored money, so `rewards-epoch.ts --publish` sends it with the rest. The operator's wallet needs the sponsors' MON beforehand, and it's the sponsor's trust in the operator that holds the money until then.
- **Shown.** The running epoch's Rewards tab says "Epoch N is sponsored: X MON by …" before it closes (`ClubRewardsView.open`); the live estimate includes it; the built epoch's panel shows a Sponsored figure with names; the weekly recap adds "🎁 X MON sponsored by …" (names clipped to 20 characters so it stays under X's limit).
- **Owner top-ups are the same thing.** The Owner sends MON to the operator, who records it with `--owner`, and it shows as "Name (Owner)".

## What it does not do

- **It isn't trustless.** The sponsor trusts the operator to record it and fund it; the record is public in the epoch but the deposit is not on chain. [ADR 0022](0022-club-rewards.md) already trusts the operator with the root. The upgrade path is an on-chain `sponsor(club)` deposit with a `Sponsored` event, which needs a contract change and redeploy.
- **It isn't self-serve.** There is no in-app sponsor button: only the operator writes the ledger.
- **It doesn't resist a fixed prize.** A sponsored Club with no trading pays its most active Holders, so someone can buy an NFT and post to share it. That's the sponsor's choice of Club; the pool still needs a holding and activity.
- **It doesn't pay by volume.** A sponsor wanting a match on fees (per fee paid, up to a cap) would need a rule on top; one that returns more than 25% per fee to a Club that trades with itself makes wash trading profitable.

## Consequences

- No contract change, no redeploy. The epoch record gains optional fields, so earlier epochs still read.
- A new operator job: record sponsors before building, and hold the MON until publishing.
- Tests: the split with sponsors, the built record and total, carry with no Holders, the ledger's rules (no zero, no empty name, none after the build, names cleaned), the running epoch's view, and the recap line and its length.
