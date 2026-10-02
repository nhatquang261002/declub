# Scripts

## `Deploy.s.sol`

1. If `CHOG_ADDRESS` is empty, deploy `MockChog` and mint `DEMO_MINT_PER_WALLET` (default 5) to each address in `DEMO_WALLETS`.
2. Deploy the current trait-enabled `OnDeal(chog)`.
   The contract supports both exact token-ID requests and collection-scoped Merkle trait requests.
   With `DEPLOY_CHOG_MIRROR=true`, the script deploys a `Chog Genesis` mirror using the real
   collection's IPFS metadata base and mints the 1,969-token catalog in batches.
3. Print ready-to-paste `NEXT_PUBLIC_*` lines (addresses and deploy block) for `.env`.

A dry run (no key needed) against Monad testnet estimates about **4.07M gas, roughly 0.83 MON** at the worst-case max fee.

### Deployer wallet

Use an encrypted keystore rather than a raw private key in `.env`:

```bash
cast wallet import deployer --interactive   # paste a testnet key once; stored encrypted
cast wallet address --account deployer
# fund it from the Monad testnet faucet
cast balance --ether $(cast wallet address --account deployer) --rpc-url monad_testnet
```

### Dry run → deploy → verify

```bash
cd contracts
set -a; source ../.env; set +a          # CHOG_ADDRESS, DEMO_WALLETS, DEMO_MINT_PER_WALLET

# 1. Simulate against live testnet state (nothing is sent)
forge script script/Deploy.s.sol --rpc-url monad_testnet

# 2. Broadcast and verify on MonadVision (Sourcify)
forge script script/Deploy.s.sol --rpc-url monad_testnet --account deployer --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

To verify manually afterwards:

```bash
forge verify-contract <OnDeal address> src/OnDeal.sol:OnDeal --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(address)" <Chog address>)
forge verify-contract <MockChog address> src/mocks/MockChog.sol:MockChog --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Browse on [MonadVision](https://testnet.monadvision.com/) or [Monadscan](https://testnet.monadscan.com/).

The script is intentionally restricted to Monad testnet (`chainid == 10143`) for live
deployments and local Anvil (`chainid == 31337`) for tests; it will revert on mainnet.
The broadcast log for testnet goes to
`broadcast/Deploy.s.sol/10143/run-latest.json`. Commit it so there's a record of the
deployed addresses. Local (31337) runs and dry runs are gitignored.

## `DeployIntents.s.sol`

Deploys `OnDealIntents` ([ADR 0008](../../docs/adr/0008-trade-intents.md), [0009](../../docs/adr/0009-ring-swaps.md)) with its protocol fee ([ADR 0015](../../docs/adr/0015-protocol-fee.md), [ADR 0018](../../docs/adr/0018-adjustable-protocol-fee.md)). The existing mUSD and Chog collection work with it. A dry run estimated about **2.05M gas, roughly 0.42 MON** before the fee was added.

Protocol fee, from the environment (all optional; with `PROTOCOL_FEE_WEI` unset there is no fee):

| Variable | |
|---|---|
| `PROTOCOL_FEE_WEI` | what each maker pays when a cycle settles, in `FEE_TOKEN` units (18 decimals), until the fee admin changes it |
| `PROTOCOL_FEE_MAX_WEI` | the ceiling the fee admin can never go above; defaults to 4 × `PROTOCOL_FEE_WEI`, at most 500 tokens |
| `FEE_RECIPIENT` | who receives it (a Safe); required when the ceiling is not 0 |
| `FEE_ADMIN` | who may change the fee (a different Safe); unset means the fee is fixed for good |
| `FEE_TOKEN` | the chain's wrapped MON; required when the ceiling is not 0, unless the next one is set |
| `DEPLOY_MOCK_WMON` | `true` deploys a `MockWMON` and uses it as the fee token. Testnet has no canonical WMON. Ignored when `FEE_TOKEN` is set |

The same `PROTOCOL_FEE_WEI`, `PROTOCOL_FEE_MAX_WEI`, `FEE_RECIPIENT` and `FEE_ADMIN` go to `DeployV2.s.sol` (there the fee is plain MON), so both contracts charge the same amount. Both print the fee settings they deployed with. The recipient, token and ceiling are immutable. The amount isn't: the fee admin calls `setFee` on each contract (a cut applies at once, a raise needs `applyFee` 7 days later), so keep the two in step.

```bash
cd contracts
forge script script/DeployIntents.s.sol --rpc-url monad_testnet            # dry run

forge script script/DeployIntents.s.sol --rpc-url monad_testnet --account deployer --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

It prints `NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS=…` for the root `.env`, which the matcher and (later) the app read.
