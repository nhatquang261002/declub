# De(al) Club docs

Start here. Each page below owns one topic; if two pages disagree, the one in the **Source of truth** column wins and the other is a bug.

## What's left to do

[**Roadmap**](06-roadmap.md) is the only tracker: release gates, what's next, what's deferred. Update it in the same change that finishes an item.

## By what you need

| I want to… | Read | Source of truth for |
|---|---|---|
| Understand the product | [Product spec](01-product-spec.md) | What DeClub is and does |
| Use the app, or explain it to someone | [User guide](07-user-guide.md) | What users see and are told |
| Know how Clubs, Momentum and Rewards work | [Clubs](09-clubs.md) | Club rules, points, epochs, APIs, data |
| See how the pieces fit | [Architecture](02-architecture.md) | Components, data flow, deployments |
| Change a contract | [Contract design](03-contract-design.md) | Contract behaviour, deploy steps |
| Review risk | [Security](04-security.md) | Trust model, invariants, threats |
| Change the web app | [Frontend](05-frontend.md) | Web layout, screens, hooks, errors |
| Set up sign-in | [Privy](10-privy.md) | Identity, webhooks, env |
| Test before mainnet | [Test plan](11-test-plan.md) | Manual cases, go/no-go, canary |
| Run or rebuild the demo | [Demo world](12-demo.md) | Testnet seed data and scripts |
| Know why something was decided | [ADRs](adr/README.md) | The reasoning, 50 records |

## Brand and pitch

| Page | What it is |
|---|---|
| [Art direction](08-art-direction.md) | How the app implements the look |
| [Brand kit](brand-kit.md) | Look and voice for anything outside the app (files in `../brand/`) |
| [Project description](../README.md) | The pitch: problem, solution, why it is useful (top of the root README) |

## How these docs are kept

- **Specs say how it works now.** ADRs say why. Don't put reasoning history in a spec or current numbers in an ADR; link across.
- **One owner per fact.** Point values, caps and the fee live in the spec above, not repeated in the guide or README. The in-app guide (`web/app/guide/`) shows no weights or caps on purpose.
- **A decision that changes a rule** gets a new ADR (or an "Amended by" line on the old one), a row in the [ADR index](adr/README.md), and an edit to the spec in the same commit.
- **Finished plans are deleted**, not archived: the ADR and git history keep them.
- **Deployed addresses** live in `.env` and `contracts/broadcast/`; other pages link there instead of copying them.
- Page numbers (01–15) are only file names; they don't mean reading order.
