// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// @notice Fee settings shared by DeployEscrow and DeployIntents. The ceiling, recipient and token
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

    /// @dev A recipient or admin without a ceiling is a half-set fee: the ceiling is immutable, so
    ///      the contract would deploy with no fee that can never be turned on. Refuse it.
    function checkConsistent(uint256 maxFee, address recipient, address feeAdmin) internal pure {
        require(
            maxFee != 0 || (recipient == address(0) && feeAdmin == address(0)),
            "FEE_RECIPIENT/FEE_ADMIN set but PROTOCOL_FEE_MAX_WEI is 0: set the fee, or unset them"
        );
    }

    uint256 internal constant MONAD_TESTNET = 10143;
    uint256 internal constant MONAD_MAINNET = 143;
    uint256 internal constant ANVIL = 31337;
    /// @dev Canonical wrapped MON on Monad mainnet (docs.monad.xyz, network information).
    address internal constant MAINNET_WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;

    /// @dev The chains the scripts deploy to. Returns true on Monad mainnet, where `checkMainnet`
    ///      must also pass. Any other chain reverts.
    function requireSupportedChain() internal view returns (bool mainnet) {
        uint256 id = block.chainid;
        require(id == MONAD_TESTNET || id == ANVIL || id == MONAD_MAINNET, "unsupported chain");
        return id == MONAD_MAINNET;
    }

    /// @dev Extra rules for mainnet, where nothing is a demo and nothing defaults: a real fee with
    ///      a ceiling, a recipient, and a fee admin that is not the recipient (a fixed fee is
    ///      refused: on mainnet the admin is how the fee follows the MON price).
    function checkMainnet(
        uint256 fee,
        uint256 maxFee,
        address recipient,
        address admin,
        bool fixedFee
    ) internal pure {
        require(fee != 0 && maxFee != 0, "mainnet: set PROTOCOL_FEE_WEI and PROTOCOL_FEE_MAX_WEI");
        require(fee <= maxFee, "mainnet: fee above its ceiling");
        require(recipient != address(0), "mainnet: set FEE_RECIPIENT (a Safe)");
        require(!fixedFee && admin != address(0), "mainnet: set FEE_ADMIN (a Safe), not FEE_FIXED");
        require(admin != recipient, "mainnet: FEE_ADMIN must differ from FEE_RECIPIENT");
    }
}
