# Tests

What each file covers, the invariants (I1–I7), the threat → test mapping and the Slither triage are in [docs/04-security.md](../../docs/04-security.md#test-suite).

```bash
forge test -vvv                 # all
forge test --mc Invariant       # invariants only
forge coverage --report summary --no-match-coverage "(test|script)"
forge test --gas-report         # per-function gas
```
