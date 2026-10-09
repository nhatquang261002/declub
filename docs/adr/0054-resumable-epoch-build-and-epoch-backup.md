# ADR 0054: A resumable epoch build, and a backup of built epochs

**Status:** Accepted · 2026-10-09 · Web only. No contract change. Amends [ADR 0022](0022-club-rewards.md) (how an epoch is built and kept). Continues [ADR 0053](0053-back-up-sponsors-and-members.md). The specs are [09 · Clubs](../09-clubs.md#rewards) and [04 · Security](../04-security.md#server-store-backups).

## Context

Two problems in how a built epoch is kept, both about money Holders can claim.

**A build could stop half done and wedge.** `buildEpoch` wrote about eight keys one after another and set `last` (the "this epoch is done" marker) at the end. If it stopped after the epoch record and before `last`, every later call found the record and answered `exists` without writing the rest, and epoch n+1 was refused as out of order because `last` was still n−1. The carry into the next epoch and the streaks were never saved. Nothing repaired it.

**A built epoch lived only in the store.** The record carries every Holder's Merkle proof, and the inputs it was built from, frozen when the epoch closed, are only in the store too: the holdings average, the likes and replies that stood, the active days. Lose the store after a root is published and Holders can't claim, and the inputs to rebuild the same root are gone.

## Decision

**The epoch record is the commit point; everything after it is derived.**

- **Before the record, a build writes nothing a rebuild reads.** It writes the points and backing records, which a rebuild overwrites with the same values (the inputs are frozen in each Club's closing). A stop there means building again.
- **After the record, `finishEpoch` does the rest from the record and the closings:** the epoch and per-account indexes, each Club's carry (it is in the record), each Club's streaks (from the closing's active days), and last of all `last`. It can be repeated: the indexes are sets, the carry is a copy, and `nextStreaks` now leaves a member already counted for epoch n as they are, so it is safe on streaks that were already moved.
- **`buildEpoch` finishes a stopped build.** A record that is there while `last` isn't `n` (and `n` is next) is finished and reported as built. A record at or below `last` is `exists`, as before.
- **Export.** `npm run rewards:backup -- --export file` writes each built epoch: the record, the public points and backing records, each Club's frozen closing, the holdings samples and the X reach. Sponsors stay in [ADR 0053](0053-back-up-sponsors-and-members.md)'s export.
- **Restore checks before it writes.** From epoch 0 in order: the record is for this chain and rewards contract; its root is the tree of its leaves, every proof opens, the money adds up per Club against the epochs already restored and the sponsor ledger; and, when the epoch is published, its root and total are the chain's. It never replaces a different epoch. Restoring one that exists finishes it if it was left half done. A first epoch above 0 needs `--from-here`.

## What it does not do

- **It doesn't cover the running epoch.** Its inputs (the daily holdings samples, the activity log, the likes) are still only in the store until it closes. A backup after each build keeps every closed epoch; the open one is lost with the store, and the next one is built from what is left.
- **It can't prove the right people were paid.** A restore checks that a record holds together and matches the chain, as `rewards:verify` does. A record built from tampered inputs is still self-consistent.
- **Streaks run through every epoch.** Restoring from epoch 0 rebuilds them; with `--from-here` they start at the first restored epoch.
- **The file is private.** It holds Privy user ids and wallets in the closings.

## Alternatives

- **Write the whole result as one value, then apply it.** A single atomic commit, but the value is the record, points, backing and ledger together, which can pass an Upstash request-size limit on a big epoch. The record alone is already one value; deriving the rest keeps every write as small as it was.
- **Write `last` first.** Then a stop leaves `last` ahead of a record that isn't there and the epoch is skipped for ever.
- **A transaction around all of it.** Upstash's `multi` batches commands in one request, but the body is then as large as all of them together.

## Consequences

- A build that stops anywhere is finished by running it again; a crash before the record is built from scratch.
- A lost store costs the Club lists and sponsors only what they didn't sign (ADR 0053) and the open epoch's inputs; every closed epoch can be restored and claimed.
- `rewards:epoch` prints `built` for an epoch it finished.
