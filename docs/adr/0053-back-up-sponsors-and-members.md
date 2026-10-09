# ADR 0053: Back up the two things only the store knows: sponsors and members

**Status:** Accepted · 2026-10-09 · Web only. No contract change. Extends [ADR 0036](0036-sponsor-from-the-app.md) (sponsors) and [ADR 0016](0016-clubs-and-momentum.md) (members). Adds one signed record to [ADR 0023](0023-signed-posts-and-lenses.md)'s family. The specs are [09 · Clubs](../09-clubs.md) and [04 · Security](../04-security.md#server-store-backups).

## Context

The Upstash store is the only place the server keeps anything that isn't on a chain, and it has no backup ([06 · Roadmap](../06-roadmap.md)). Most of it is rebuildable: fills and activity from the chain, posts and follows from their signatures. Two things are not:

| What | Why it can't be rebuilt |
|---|---|
| **Sponsorships** | The MON is on chain, at the operator. Which Club it is for and the name it is shown under were only in the ledger: the sponsor's signature was checked and thrown away. |
| **Club members** | A member is a Privy user id and a copy of their wallets. No chain, and no record the member made, says they joined. |

## Decision

**Keep the proof next to each, and add an export and a restore that re-check it.**

- **Sponsors keep their signature.** The ledger entry gains `signature`: the sponsor's signature of `sponsorMessage(club, tx, name)`. With the transaction hash already kept, the chain gives the payer, amount, recipient and time, and the signature binds the name and Club to the payer. That is the whole record. The signature is never put in an epoch record or sent to the browser.
- **Members sign a `Join` message.** `Join { club, wallet, at }` in the social domain ([ADR 0023](0023-signed-posts-and-lenses.md)). A member signs it with the wallet their membership is shown under (no gas, nothing moves). `PUT /api/clubs/[token]/membership` verifies it and keeps it beside the row. It must name this Club, the wallet shown on the Members list, and a time within five minutes. That wallet is already public through the list, so the backup reveals nothing new: a second linked wallet is never tied to a Club. Joining asks for the signature straight after; a member who declines is still a member and the menu offers it again, as does a member from before this.
- **Leaving, a ban or an unlinked wallet deletes the signature.** It follows the row. A backup is as fresh as its export, so an export is also a list of who was in at that moment.
- **Export.** `npm run rewards:sponsor -- --export file` writes the sponsors; `npm run members:backup -- --export file` writes every Club's signed members. Entries without a signature (written by hand, or before this) are counted and left out, so the operator knows what the backup lacks.
- **Restore re-checks everything.** `--restore` sends each sponsor through the same checks as a new payment (to the operator, large enough, succeeded, the sponsor's signature), with the epoch it was in. Each member's signature is checked, Privy finds the account that linked the wallet, and they join as a join would, so a ban that survived still holds. Neither adds what the chain and the signer don't support, and running it twice changes nothing: a payment is counted once per epoch ledger, and a member joins once.
- **A shared check.** Follows, posts and joins used two copies of the EOA-then-ERC-1271 check; it is one function now (`lib/server/socialSignature.ts`).

## What it does not do

- **It is not a store backup.** Held-average samples, built epoch records and proofs, roles, bans, the points ledger, challenges, avatars and profiles are still only in the store. The roadmap item stays open. The two here were first because nothing else can recreate them.
- **A member who never signed is not in the file** and has to join again. Existing members have none until they sign. The signed share is on the export's output.
- **A restored `joinedAt` is the time they signed.** A member now shown under another wallet is restored but must sign again; the script lists them.
- **The file is private.** It holds wallets and sponsor names, and a restore from a stale file brings back anyone who left since. Keep it with the operator keys' care, not in the repo.

## Alternatives

- **Export members without signatures.** Easy, but a restore would trust the file, so a file edited by anyone with access could add members, and members feed rewards.
- **Require the signature to join.** Cleaner, but it blocks a Privy account whose wallet isn't connected in the browser, and it would lock out every existing member until they sign.
- **Look members up by wallet in Privy only.** Nothing says they chose a Club.

## Consequences

- A lost store costs the Club lists only the members who didn't sign, and the sponsor ledger nothing that was signed.
- Joining takes a second wallet prompt. A declined prompt is quiet.
- `GET /api/clubs/[token]/membership` also returns `club` and `signed`.
