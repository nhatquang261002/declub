# Tests

| Where | What | Tests |
|---|---|---|
| `test/` (top level) | legacy `OnDeal` (v1), `FeeAdmin.t.sol` (22 tests run against both `OnDealV2` and `OnDealIntents`, so 44), `MockChog`, `MockWMON`, `ChogGenesisMirror`, `Deploy.s.sol` | 145, plus the invariant suite in `invariant/` (I1–I7 and liveness) |
| `test/v2/` | `OnDealV2`: exact, trait and open-offer deals, claims, tokens, the fee, `DeployV2.s.sol`, `MockERC20` | 193, plus `v2/invariant/` (V1–V9, proposal statuses and liveness) |
| `test/intents/` | `OnDealIntents`: settlement, reverts, signatures, nonces, tokens, the fee, gas, `DeployIntents.s.sol` | 99, plus `intents/invariant/` (N1, N2, N5, N6 and conservation) |

`forge test` runs 440 tests in 39 suites. What each file covers, the invariants, the threat → test mapping and the Slither triage are in [docs/04-security.md](../../docs/04-security.md#test-suite).

```bash
forge test -vvv                         # all
forge test --match-path "test/v2/*"     # one contract's suite (or test/intents/*)
forge test --mc Invariant               # invariants only
forge coverage --report summary --no-match-coverage "(test|script)"
forge test --gas-report                 # per-function gas
```
