import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fundingPlan } from "../lib/server/rewardsFunding";

const ETH = 10n ** 18n;
const GAS = ETH / 100n;

describe("fundingPlan", () => {
  it("unwraps nothing when the operator's MON covers the total and gas", () => {
    assert.deepEqual(fundingPlan({ total: 5n * ETH, mon: 6n * ETH, wmon: 3n * ETH, gas: GAS }), { unwrap: 0n, short: 0n });
  });

  it("unwraps only what the MON falls short of, gas included", () => {
    assert.deepEqual(fundingPlan({ total: 5n * ETH, mon: 2n * ETH, wmon: 10n * ETH, gas: GAS }), { unwrap: 3n * ETH + GAS, short: 0n });
  });

  it("unwraps all the WMON and reports what is still missing", () => {
    assert.deepEqual(fundingPlan({ total: 5n * ETH, mon: ETH, wmon: 2n * ETH, gas: GAS }), { unwrap: 2n * ETH, short: 2n * ETH + GAS });
  });
});
