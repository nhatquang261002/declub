// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// @notice Fee settings shared by DeployV2 and DeployIntents. The ceiling, recipient and token
///         are immutable once deployed, so the scripts refuse defaults that would lock in a
///         choice nobody made.
library FeeConfig {
    /// @dev PROTOCOL_FEE_MAX_WEI must be given whenever a fee is: the ceiling can't be changed
    ///      later, so it isn't guessed. With no fee and no ceiling, the ceiling is 0 (no fee ever).
    ///      An empty value (`PROTOCOL_FEE_MAX_WEI=` in .env) counts as unset.
    function maxFeeFromEnv(Vm vm, uint256 fee) internal view returns (uint256) {
        string memory raw = vm.trim(vm.envOr("PROTOCOL_FEE_MAX_WEI", string("")));
        if (bytes(raw).length != 0) return vm.parseUint(raw);
        require(fee == 0, "PROTOCOL_FEE_MAX_WEI is required when PROTOCOL_FEE_WEI is set");
        return 0;
    }

    /// @dev Without a fee admin a non-zero fee (or ceiling) is fixed forever. Allow that only
    ///      when it was asked for.
    function checkAdmin(uint256 maxFee, address feeAdmin, bool fixedFee) internal pure {
        require(
            maxFee == 0 || feeAdmin != address(0) || fixedFee,
            "FEE_ADMIN unset: set it, or FEE_FIXED=true to lock the fee for good"
        );
    }
}
