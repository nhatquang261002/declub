# ADR 0017: Make a deal for @handle

**Status:** Accepted · 2026-10-02 · Web only. No contract, matcher or pool change. Builds on [ADR 0011](0011-verified-profiles.md).

## Context

OTC deals are agreed on X, Discord or Telegram, then made on-chain. A private deal (`taker` set) needs the counterparty's wallet address, which is pasted from a DM. That is the step a scammer exploits: a lookalike address, or a wallet that isn't the person the maker was talking to. Privy already knows which user linked which X or Discord account, and which wallets they linked.

## Decision

**"Who can accept" takes an X or Discord handle as well as an address.** The maker types `@bob`, presses Find, and picks one of the wallets Bob shows under that handle. The deal is still locked to an address: the handle only finds it.

- **Lookup:** `GET /api/profiles/lookup?handle=…` asks Privy which user linked that X username (`getByTwitterUsername`) and which linked that Discord username (`getByDiscordUsername`), then reads that user's shared profile rows from the store. `lib/server/handleLookup.ts`.
- **Only shared profiles can be found.** A user is a match only if they turned on "Show my profile to other traders", and only the wallets whose shared row shows that exact provider and handle are returned. Someone who never shared, or whose share shows another handle (a rename not yet re-synced), is not found, and the answer is the same as for a handle nobody linked. So the lookup reveals the same `wallet ↔ handle` pairs that `/api/profiles` already shows, read in the other direction. The opt-in text on `/account` says so.
- **X and Discord are kept apart.** `bob` can be an X user and a different Discord user. Both are looked up, and each match is shown with its provider, so the maker picks the account they were talking to. A Discord share never answers an X lookup or the reverse. An x.com link is read as X only.
- **Signed in and rate limited** (30 a minute per caller, through `gateUser`), so handles can't be swept anonymously.
- **The caller's own handle** answers "That's your own handle" and no wallets.
- **Review shows who.** The review step shows the taker with `<Who>`, so a locked deal reads `@bob 0x12…34`, and a pasted address with a shared profile shows its handle before the deal is made.

## What it does not prove

The same as ADR 0011: that the X account and the wallet are linked by one Privy user, not who that person is or that they are honest. A lookalike handle (`@b0b`) is still possible, so the match shows the handle as the owner wrote it and the wallet, and the maker should check both against the conversation.

## Consequences

- One more Privy API in use: user lookup by social username. Each lookup costs up to two Privy calls.
- A trader who shares a profile can now be found by handle. That is the point, and the opt-in copy says it.
- People who don't share a profile can't receive a deal by handle; the screen tells the maker to ask them to turn sharing on, or to paste an address.
- Telegram handles would work the same way (`getByTelegramUsername`) once Telegram is a login method.
