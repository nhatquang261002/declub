import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

// `npm run abi` rebuilds the contracts and regenerates lib/abi.ts.
// The output is committed, so the app builds without Foundry installed.
export default defineConfig({
  out: "lib/abi.ts",
  plugins: [
    foundry({
      project: "../contracts",
      include: ["OnDealV2.sol/**", "OnDealIntents.sol/**", "MockChog.sol/**"],
    }),
  ],
});
