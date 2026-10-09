# Tests

| Where | What | Tests |
|---|---|---|
| `test/` (top level) | `FeeAdmin.t.sol` (24 tests run against both `DeClubEscrow` and `DeClubIntents`, so 48), `MockChog`, `MockWMON`, `ChogGenesisMirror`, `CollectionMirror` (the demo mirrors), `DeployChog.s.sol` | 67 |
| `test/escrow/` | `DeClubEscrow`: exact, trait and open-offer deals, claims, tokens, the fee, `DeployEscrow.s.sol`, `MockERC20` | 206, plus two suites in `escrow/invariant/`: V1–V9, proposal statuses and liveness, and V3 against hostile collections |
| `test/intents/` | `DeClubIntents`: settlement, reverts, signatures, nonces, tokens, the fee, gas, `DeployIntents.s.sol` | 108, plus two suites in `intents/invariant/` (N1, N2, N5, N6 and conservation; settlement against hostile collections) and a Halmos check in `intents/symbolic/` |
| `test/rewards/` | `DeClubRewards`: publish, claim, revoke, sweep, the operator role, fuzz, a root built by the web app, `DeployRewards.s.sol` | 49, plus one suite in `rewards/invariant/` (R1–R4 and every call behaving, with underfunded roots) |

`forge test` runs 435 tests in 39 suites (each invariant suite counts as one). What each file covers, the invariants, the threat → test mapping and the Slither triage are in [docs/04-security.md](../../docs/04-security.md).

```bash
forge test -vvv                         # all
forge test --match-path "test/escrow/*"     # one contract's suite (or test/intents/*, test/rewards/*)
forge test --mc Invariant               # invariants only
forge coverage --report summary --no-match-coverage "(test|script)"
forge test --gas-report                 # per-function gas

# Static analysis and symbolic checks (pipx install slither-analyzer, or prefix with
# `uvx --from slither-analyzer`; uv tool install halmos). Slither runs `forge clean`: run
# `forge build` after it before the e2e run, which reads out/.
slither . --filter-paths "lib/|test/|script/|src/mocks/"
FOUNDRY_DYNAMIC_TEST_LINKING=false halmos --match-contract DeClubIntentsSymbolic --loop 4
```

Halmos needs `FOUNDRY_DYNAMIC_TEST_LINKING=false`: otherwise Forge compiles `new` in tests to a `deployCode` cheatcode that Halmos doesn't support. Forge skips the `check_` functions, so `forge test` doesn't run them.
