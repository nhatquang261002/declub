# Scripts

## `Deploy.s.sol`

1. If `CHOG_ADDRESS` is empty, deploy `MockChog` and mint `DEMO_MINT_PER_WALLET` (default 5) to each address in `DEMO_WALLETS`.
2. Deploy `ChogSwap(chog)`.
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
forge verify-contract <ChogSwap address> src/ChogSwap.sol:ChogSwap --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --constructor-args $(cast abi-encode "constructor(address)" <Chog address>)
forge verify-contract <MockChog address> src/mocks/MockChog.sol:MockChog --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Browse on [MonadVision](https://testnet.monadvision.com/) or [Monadscan](https://testnet.monadscan.com/).

The broadcast log for testnet goes to `broadcast/Deploy.s.sol/10143/run-latest.json`. Commit it so there's a record of the deployed addresses. Local (31337) runs and dry runs are gitignored.
