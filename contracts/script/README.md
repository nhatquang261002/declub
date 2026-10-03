# Scripts

| Script | Deploys | Used by the app |
|---|---|---|
| `DeployV2.s.sol` | `OnDealV2`, optionally `MockERC20` (mUSD) | yes |
| `DeployIntents.s.sol` | `OnDealIntents`, optionally `MockWMON` | yes (and the matcher) |
| `Deploy.s.sol` | legacy `OnDeal` (v1), optionally `MockChog` or the `ChogGenesisMirror` | only the Chog collection |

Every script refuses chains other than Monad testnet (`chainid == 10143`) and local Anvil (`31337`, for tests): `deploy` reverts with "testnet deployment only", so none can run on mainnet. Each `run()` only parses the env into a `Config` and calls `deploy(Config)`, so tests call `deploy` directly. All of them print ready-to-paste lines for the root `.env`.

The current source has to be redeployed before the fee and signed swaps work on testnet: the deployed contracts predate the protocol fee and `FeeAdmin`, and the deployed intents contract uses an older EIP-712 domain. Details in [03 · Contract Design](../../docs/03-contract-design.md#deployed-vs-source).

## `DeployV2.s.sol`

Deploys `OnDealV2` ([ADR 0005](../../docs/adr/0005-generic-asset-model.md)) with its protocol fee ([ADR 0015](../../docs/adr/0015-protocol-fee.md), [ADR 0018](../../docs/adr/0018-adjustable-protocol-fee.md)). All variables are optional; with `PROTOCOL_FEE_WEI` unset there is no fee.

| Variable | |
|---|---|
| `PROTOCOL_FEE_WEI` | what each side pays per completed deal, in MON wei, until the fee admin changes it (default 0) |
| `PROTOCOL_FEE_MAX_WEI` | the ceiling the fee admin can never go above, at most 500 MON; required when `PROTOCOL_FEE_WEI` is set |
| `FEE_RECIPIENT` | who receives it (a Safe); required when the ceiling is not 0 |
| `FEE_ADMIN` | who may change the fee (a different Safe); required when the ceiling is not 0, unless `FEE_FIXED` is set |
| `FEE_FIXED` | `true` deploys with no fee admin, so the fee never changes |
| `DEPLOY_MOCK_ERC20` | `true` also deploys `MockERC20("Mock USD", "mUSD")` with an open mint |
| `DEMO_WALLETS` | comma-separated addresses to mint mUSD to |
| `DEMO_MINT_AMOUNT` | mUSD per demo wallet, in whole tokens (default 1000) |

It prints `NEXT_PUBLIC_ON_DEAL_V2_ADDRESS`, `NEXT_PUBLIC_ON_DEAL_V2_DEPLOY_BLOCK`, the fee settings read back from the contract, and `NEXT_PUBLIC_MOCK_ERC20_ADDRESS` when the mock was deployed. The app reads the two addresses; nothing reads the deploy block today.

```bash
cd contracts
forge script script/DeployV2.s.sol --rpc-url monad_testnet            # dry run

forge script script/DeployV2.s.sol --rpc-url monad_testnet --account deployer --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

## `DeployIntents.s.sol`

Deploys `OnDealIntents` ([ADR 0008](../../docs/adr/0008-trade-intents.md), [0009](../../docs/adr/0009-ring-swaps.md)) with its protocol fee ([ADR 0015](../../docs/adr/0015-protocol-fee.md), [ADR 0018](../../docs/adr/0018-adjustable-protocol-fee.md)). The existing mUSD and Chog collection work with it. A dry run estimated about **2.05M gas, roughly 0.42 MON** before the fee was added.

Protocol fee, from the environment (all optional; with `PROTOCOL_FEE_WEI` unset there is no fee):

| Variable | |
|---|---|
| `PROTOCOL_FEE_WEI` | what each maker pays when a cycle settles, in `FEE_TOKEN` units (18 decimals), until the fee admin changes it |
| `PROTOCOL_FEE_MAX_WEI` | the ceiling the fee admin can never go above, at most 500 tokens; required when `PROTOCOL_FEE_WEI` is set |
| `FEE_RECIPIENT` | who receives it (a Safe); required when the ceiling is not 0 |
| `FEE_ADMIN` | who may change the fee (a different Safe); required when the ceiling is not 0, unless `FEE_FIXED` is set |
| `FEE_FIXED` | `true` deploys with no fee admin, so the fee never changes |
| `FEE_TOKEN` | the chain's wrapped MON; required when the ceiling is not 0, unless the next one is set. Before broadcasting, the script wraps and unwraps 1 wei of it in its local simulation and checks 18 decimals, and refuses anything that doesn't behave like WMON |
| `DEPLOY_MOCK_WMON` | `true` deploys a `MockWMON` and uses it as the fee token. Testnet has no canonical WMON. Ignored when `FEE_TOKEN` is set |

The same `PROTOCOL_FEE_WEI`, `PROTOCOL_FEE_MAX_WEI`, `FEE_RECIPIENT`, `FEE_ADMIN` and `FEE_FIXED` go to `DeployV2.s.sol` (there the fee is plain MON), so both contracts charge the same amount. Both print the fee settings they deployed with. The recipient, token and ceiling are immutable. The amount isn't: the fee admin calls `setFee` on each contract (a cut applies at once, a raise needs `applyFee` 7 days later), so keep the two in step.

The recipient, token and ceiling can't be changed after deploy, so the scripts don't guess them (both share `script/FeeConfig.sol`): a fee without `PROTOCOL_FEE_MAX_WEI` is refused rather than given a default ceiling, and a non-zero ceiling without `FEE_ADMIN` is refused unless `FEE_FIXED=true` says a fee nobody can change is what you want. The contracts accept any ceiling up to 500; the roadmap's plan is about 4 × the launch fee.

```bash
cd contracts
forge script script/DeployIntents.s.sol --rpc-url monad_testnet            # dry run

forge script script/DeployIntents.s.sol --rpc-url monad_testnet --account deployer --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

It prints `NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS=…` for the root `.env`, which the matcher and the app read, then `NEXT_PUBLIC_ON_DEAL_INTENTS_DEPLOY_BLOCK` (nothing reads it today), `MOCK_WMON_ADDRESS` when it deployed the mock, and the fee settings.

## `Deploy.s.sol` (legacy v1)

Deploys `OnDeal` (v1), which the app no longer uses. The `NEXT_PUBLIC_ON_DEAL_ADDRESS` line it prints is read by nothing. It's still the script that deploys a Chog collection for testnet.

1. If `CHOG_ADDRESS` is empty:
   - with `DEPLOY_CHOG_MIRROR=true`, deploy a `Chog Genesis` mirror (`ChogGenesisMirror`) using the real collection's IPFS metadata base, mint `DEMO_MINT_PER_WALLET` (default 5) to each address in `DEMO_WALLETS`, then mint the rest of the 1,969-token catalog to `MIRROR_CATALOG_OWNER` (default: the deployer) in batches of `MIRROR_MINT_BATCH` (default 20);
   - otherwise deploy `MockChog` and mint `DEMO_MINT_PER_WALLET` (default 5, at most 20) to each address in `DEMO_WALLETS`.
2. Deploy `OnDeal(chog)`, which supports exact token-id requests and collection-scoped Merkle trait requests (don't use the trait requests: see [04 · Security](../../docs/04-security.md#accepted-limitations-v1)).
3. Print `NEXT_PUBLIC_CHOG_ADDRESS` (read by the app), `NEXT_PUBLIC_ON_DEAL_ADDRESS` and `NEXT_PUBLIC_ON_DEAL_DEPLOY_BLOCK`.

A dry run (no key needed) against Monad testnet estimated about **4.07M gas, roughly 0.83 MON** at the worst-case max fee, without the mirror.

## Deployer wallet

Use an encrypted keystore rather than a raw private key in `.env`:

```bash
cast wallet import deployer --interactive   # paste a testnet key once; stored encrypted
cast wallet address --account deployer
# fund it from the Monad testnet faucet
cast balance --ether $(cast wallet address --account deployer) --rpc-url monad_testnet
```

## Dry run → deploy → verify

The same steps work for each script; `Deploy.s.sol` is shown.

```bash
cd contracts
set -a; source ../.env; set +a          # the variables listed above for the script you run

# 1. Simulate against live testnet state (nothing is sent)
forge script script/Deploy.s.sol --rpc-url monad_testnet

# 2. Broadcast and verify on MonadVision (Sourcify)
forge script script/Deploy.s.sol --rpc-url monad_testnet --account deployer --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

To verify manually afterwards:

```bash
forge verify-contract <OnDealV2 address> src/OnDealV2.sol:OnDealV2 --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(uint256,uint256,address,address)" <fee> <maxFee> <recipient> <admin>)
forge verify-contract <OnDealIntents address> src/OnDealIntents.sol:OnDealIntents --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(address,uint256,uint256,address,address)" <feeToken> <fee> <maxFee> <recipient> <admin>)
forge verify-contract <OnDeal address> src/OnDeal.sol:OnDeal --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(address)" <Chog address>)
forge verify-contract <MockChog address> src/mocks/MockChog.sol:MockChog --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Browse on [MonadVision](https://testnet.monadvision.com/) or [Monadscan](https://testnet.monadscan.com/).

## Broadcast records

Each testnet broadcast writes `broadcast/<Script>.s.sol/10143/run-<timestamp>.json` and overwrites `run-latest.json` with the same content. So `run-latest.json` only records the most recent run, and earlier deployments live in the timestamped files: for example, `Deploy.s.sol/10143/run-latest.json` now holds the v1 `ChogSwap` and the `ChogGenesisMirror`, while the original v1 contract and `MockChog` are in `run-1790581370358.json`. Commit both kinds so there's a record of every deployed address. Local (31337) runs and dry runs are gitignored.
