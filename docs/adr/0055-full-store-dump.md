# ADR 0055: A full dump of the server store

**Status:** Accepted · 2026-10-09 · Web scripts only. No contract change, no runtime change. Completes [ADR 0053](0053-back-up-sponsors-and-members.md) and [ADR 0054](0054-resumable-epoch-build-and-epoch-backup.md). The spec is [04 · Security](../04-security.md#server-store-backups).

## Context

[ADR 0053](0053-back-up-sponsors-and-members.md) and [0054](0054-resumable-epoch-build-and-epoch-backup.md) back up the three things that can be restored and checked: sponsors, signed members and built epochs. Everything else the store holds still had no copy: roles and bans, Club profiles and rules, challenges and trophies, likes and the backing records behind the running epoch, the points ledger, profiles, avatars, follows and the activity log. Some of that is rebuildable, but slowly or only in part, and the running epoch's inputs ([ADR 0054](0054-resumable-epoch-build-and-epoch-backup.md) says so) are not.

## Decision

**A script dumps every durable key to a gzipped file of JSON lines, and puts it back.**

- **`npm run store:backup -- --out file.jsonl.gz`** scans every `declub:` key and writes strings, sets and sorted sets exactly as stored (raw strings, not parsed JSON), so a restore gives back the same bytes. The file is written readable by its owner alone.
- **It leaves out what the app makes again:** any key with an expiry (rate-limit counters and the locks, which are counters that expire: restored without the expiry a lock would block for ever), the locks that don't expire, and the cached live standings. The run prints how many of each it left out and how many keys were of a type the store doesn't use.
- **`--restore file` counts and writes nothing; `--restore file --confirm` writes.** A key already in the store is kept, so restoring into a store that has moved on never rolls it back; `--overwrite` replaces a key whole. Only `declub:` keys of the three shapes are accepted, so a hand-edited file can't write outside the app's keys.
- **It is a library plus a thin script.** `lib/server/storeBackup.ts` is written against a small set of Redis commands and tested with a fake; the script maps them onto Upstash.
- **A nightly workflow runs it, but only in a private repository.** `.github/workflows/store-backup.yml` dumps the store at 03:17 UTC and keeps the file as a workflow artifact for 30 days. The dump holds Privy ids, wallets and avatars, and a public repo's artifacts can be downloaded by anyone signed in to GitHub, so the job is skipped unless `github.event.repository.private` is true (and skipped if GitHub doesn't say). It needs two secrets, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; a read-only Upstash token is enough to dump. `--min-keys` makes an empty store fail the run, and a failed scheduled run emails the repository admins.
- **Until the repo is private, run it by hand or from cron** on a machine you control, and copy the file off it.

## What it does not do

- **It doesn't check what it restores.** A dump from a tampered store restores the tampering. For sponsors, members and epochs the checked backups are the ones to trust; restore those with their own scripts, and let the dump fill in the rest (keys already restored are kept).
- **It is as fresh as its last run.** Everything written since is lost, including the running epoch's likes and activity. The more often it runs, the less that is.
- **It is not a point-in-time snapshot.** It scans while the app writes, so one key may be newer than another. Upstash's own backups, where the plan has them, are a second copy and don't have this.
- **The workflow and the Upstash adapter aren't covered by an automated test,** and the private-repo condition is untested until the repo is private (run it once by hand from the Actions tab and check it isn't skipped); only the library is. Do a restore into a scratch database before you rely on it.
- **The file is sensitive:** Privy user ids, wallets, profile text and avatars.

## Alternatives

- **Upstash's own backup alone.** Depends on the plan, and a restore replaces the whole database.
- **A write-ahead log of every change.** Exact, but it puts a second write on every request and a new service in the path.

## Consequences

- A lost store costs what changed since the last dump, not everything the store held.
- Artifacts are readable by anyone with access to the repository for 30 days, and are tied to the repo: an off-site copy (a bucket, an encrypted file) is still better, and the roadmap item for infrastructure stays open.
- A private repo spends GitHub Actions minutes (a nightly dump is a few minutes a month, but see the fill watcher's every-five-minutes schedule, which would not fit a free plan's minutes).
