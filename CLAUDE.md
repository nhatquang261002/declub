# De(al) Club

Every verified Monad NFT collection gets a Club: a signed Board, member rankings, weekly MON rewards and a trustless swap market whose fees pay for them. Formerly "On Deal" (renamed in ADR 0021; `OnDeal*` names in ADRs 0001–0020 are the old ones).

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry. `DeClubEscrow` (locked swaps), `DeClubIntents` (signed swaps), `DeClubRewards` (Merkle claims), `FeeAdmin` |
| `web/` | Next.js 16 + React 19 + wagmi/viem + Tailwind 4, the Privy sign-in, Upstash Redis store, rewards scripts. Has its own `CLAUDE.md` / `AGENTS.md`: read the Next.js docs in `node_modules/next/dist/docs/` before writing Next code |
| `matcher/` | Signed-intent pool and ring matcher (Node 24, SQLite) |
| `e2e/` | Pre-mainnet checks against local Anvil or testnet |
| `docs/` | Specs and ADRs. Start at `docs/README.md` |

## Commands

```bash
./scripts/test-all.sh [--quick]            # everything; logs in test-results/
cd contracts && forge test
cd matcher && npm test && npm run typecheck
cd web && npm test && npm run typecheck && npm run lint
cd web && npm run format:check             # prettier covers web, matcher, e2e
cd web && npm run dev:testnet              # port 3000; dev:mainnet is 3001
```

Rewards epochs: `npm run rewards:epoch | rewards:sponsor | rewards:verify` in `web/`. Demo world: `web/scripts/demo.ts` (see `docs/12-demo.md`).

## Docs are part of the change

- Specs say how it works now; ADRs say why. A rule change gets a new ADR (or an "Amended by" line), a row in `docs/adr/README.md`, and an edit to the owning spec in the same commit.
- `docs/06-roadmap.md` is the only tracker. Tick items there, don't keep side plans; delete finished plans.
- Point values, caps and the fee live in `docs/09-clubs.md` and the ADRs. **User-facing copy** (`/guide`, the Rewards tab, `docs/07-user-guide.md`) must not show weights or caps: say what earns points and what doesn't, in short cards and steps, not paragraphs. The fee split and the 25% bonus cap may be shown; an Owner's own settings screens keep their numbers.
- Deployed addresses live in `.env` and `contracts/broadcast/`. Don't copy them into other pages.

## Rules that bite

- **Don't edit deployed `.sol` files for cosmetic reasons** (comments, doc links). The testnet contracts are not yet Sourcify-verified and any source change breaks that.
- **Testnet and mainnet are build flavors of one codebase** (`web/scripts/flavor.mjs`, `web/lib/network.ts`). Chain-specific copy goes through `NETWORK`; never fork per chain, and no testnet value may leak into the mainnet flavor (it reads only `.env.mainnet`). Mainnet has nothing deployed.
- **Monad quirk:** a wallet under 10 MON whose second tx lands within ~1.2 s of its first executes with status 0 and still pays gas, even though simulation passes. Space txs ~3 s apart when scripting. Public RPC `testnet-rpc.monad.xyz` has timed out; `https://rpc.ankr.com/monad_testnet` serves chain 10143.
- **No indexer.** Deals are read from storage (ADR 0004), not logs (the public RPC caps `eth_getLogs` at 100 blocks); the server holds the deal book (ADR 0020) and the fill watcher fills the activity log (ADR 0019), finding transactions with Envio HyperSync when `ENVIO_API_TOKEN` is set (ADR 0051; the deal book also reads locked deals' creation times from it, ADR 0020), and `rewards:verify` checks fees against `FeeCharged` logs the same way (ADR 0052).
- Posts and follows are EIP-712 signed by the member's wallet; keep them exportable. Hiding a post is a moderator action, never a report count.

## Security rules

Full model in `docs/04-security.md`; read it before touching a contract. The goal: every escrowed asset has a path to settlement or refund, and nothing is locked forever.

**Contracts**

- No upgrade proxy, pause, sweep or owner backdoor on the deal contracts. The deployer has no power after deploy; the fee recipient, fee token and fee ceiling are immutable.
- The fee may be cut at once but raised only after 7 days and never above `MAX_FEE` (ADR 0018). Keep `DeClubEscrow` and `DeClubIntents` fee changes in step.
- Every external entry point that moves assets is `nonReentrant`, writes state before sending, and turns a failed MON send into a credit instead of reverting the whole deal. Contracts hold no stray assets: no `receive()`, no `IERC721Receiver`.
- Signed intents: the signature must cover every `give` and `get`, the nonce is spent before assets move, and the EIP-712 domain binds chain and contract. A rewards leaf hashes chain, contract and epoch, twice.
- A new contract path needs a threat row in `docs/04-security.md` and a test that names it. Run `forge lint` and Slither; justify any suppression inline.
- Role handovers are two-step. Admin and operator keys on mainnet are Safes, never a plain EOA.

**Rewards money**

- A published epoch root has a claim delay so a wrong root can be revoked; check it with `npm run rewards:verify` (it writes nothing) before any Safe signs. Never sign a root or value you did not build and verify.
- Sponsorships are recorded only after the server verifies the payment, sender and time on chain, with a signature tying the name to the payer (ADR 0036).

**Web and server**

- Never trust the client: verify EIP-712 signatures, ownership of the NFT or Club role, and moderator or Owner rights on the server for every write. Receipts are checked on chain (fills, prizes, sponsorships); don't accept a client's claim that something happened.
- Cron routes (`/api/cron/*`) and operator actions require `CRON_SECRET`; Privy webhooks are verified with Svix. Fail closed when a secret is missing.
- Secrets (`PRIVY_APP_SECRET`, Upstash tokens, `BLOB_READ_WRITE_TOKEN`, `X_BEARER_TOKEN`, operator and demo keys) stay server-side: nothing secret under a `NEXT_PUBLIC_` name, in logs, or in committed files.
- Escape user content (posts, names, bios); never `dangerouslySetInnerHTML` on it. Uploads (avatars, post pictures, Club emoji and stickers) are type-, byte- and size-checked on the server whatever the browser did; SVG is never taken, and pictures are served by the app (never from a public store address) with `nosniff` and a `sandbox` policy. Server-side fetches of user-influenced URLs (token metadata, X posts) use a timeout and `redirect: "error"`, as in `collectionScan.ts` and `xPosts.ts`; follow that pattern.
- Keep the user-safety guards: trust chips and lookalike warnings, the contract-address confirm before accepting a swap, the `/approvals` revoke page, the long-lived signature warning. A feature that weakens them needs an ADR.
- Verified-asset data (`web/data/assets.json`) only changes what the UI shows; it is never a security boundary.

**Handling mistakes**

- Anything outward-facing or hard to reverse (a mainnet deploy, publishing an epoch, a Safe transaction, pushing, sending MON) needs the user's explicit go-ahead in that moment.
- If you find a vulnerability, say so plainly with the failing case and fix it with a test; don't bury it in a refactor.

## Style

- Write code that reads like its neighbours: same comment density, naming and idiom. Comments say why, not what.
- Plain, short prose in docs and UI copy; scannable over dense. No marketing adjectives.
- Prettier (`.prettierrc.json`) formats TS. Remove what you replace: no dead code, no duplicated helpers (`.jscpd.json` and `web/knip.json` are configured for periodic clean-ups).
- Commit or push only when asked. Never commit secrets: `.env` and `.env.mainnet` are ignored; only the `*.example` files are tracked.
