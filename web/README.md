# web/

Next.js frontend, scaffolded in **Phase 2**. The planned layout, screens, hooks, tx flow and error copy are in [docs/05-frontend.md](../docs/05-frontend.md).

```bash
# from repo root, once contracts are deployed
pnpm create next-app web --ts --tailwind --app --src-dir=false
cd web && pnpm add wagmi viem @tanstack/react-query && pnpm add -D @wagmi/cli
```

Config comes from the root `.env` (`NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CHOG_ADDRESS`, `NEXT_PUBLIC_CHOG_SWAP_ADDRESS`, `NEXT_PUBLIC_CHOG_SWAP_DEPLOY_BLOCK`).
