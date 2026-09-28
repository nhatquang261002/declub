// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChogSwap} from "../src/ChogSwap.sol";
import {MockChog} from "../src/mocks/MockChog.sol";

/// @notice Deploys ChogSwap, and MockChog first if CHOG_ADDRESS is unset.
/// @dev Env (all optional):
///        CHOG_ADDRESS          existing Chog collection; blank → deploy MockChog
///        DEMO_WALLETS          comma-separated addresses to mint MockChogs to
///        DEMO_MINT_PER_WALLET  MockChogs per demo wallet (default 5, max 20)
contract Deploy is Script {
    struct Config {
        address chog; // address(0) → deploy MockChog
        address[] demoWallets;
        uint256 mintPerWallet;
    }

    struct Result {
        address chog;
        address swap;
        uint256 deployBlock;
        bool deployedMock;
    }

    function run() external returns (Result memory r) {
        r = deploy(configFromEnv());
        _log(r);
    }

    function configFromEnv() public view returns (Config memory c) {
        string memory chogEnv = vm.trim(vm.envOr("CHOG_ADDRESS", string("")));
        if (bytes(chogEnv).length != 0) c.chog = vm.parseAddress(chogEnv);
        c.demoWallets = parseAddresses(vm.envOr("DEMO_WALLETS", string("")));
        c.mintPerWallet = vm.envOr("DEMO_MINT_PER_WALLET", uint256(5));
    }

    function deploy(Config memory c) public returns (Result memory r) {
        r.deployBlock = block.number;
        vm.startBroadcast();

        if (c.chog == address(0)) {
            MockChog mock = new MockChog();
            r.chog = address(mock);
            r.deployedMock = true;
            for (uint256 i; i < c.demoWallets.length; ++i) {
                mock.mint(c.demoWallets[i], c.mintPerWallet);
            }
        } else {
            r.chog = c.chog;
        }

        r.swap = address(new ChogSwap(r.chog));

        vm.stopBroadcast();
    }

    function parseAddresses(string memory csv) public pure returns (address[] memory out) {
        csv = vm.trim(csv);
        if (bytes(csv).length == 0) return out;
        string[] memory parts = vm.split(csv, ",");
        out = new address[](parts.length);
        for (uint256 i; i < parts.length; ++i) {
            out[i] = vm.parseAddress(vm.trim(parts[i]));
        }
    }

    function _log(Result memory r) internal pure {
        console.log("Chog      :", r.chog, r.deployedMock ? "(MockChog)" : "(existing)");
        console.log("ChogSwap  :", r.swap);
        console.log("");
        console.log("# paste into .env");
        console.log(string.concat("NEXT_PUBLIC_CHOG_ADDRESS=", vm.toString(r.chog)));
        console.log(string.concat("NEXT_PUBLIC_CHOG_SWAP_ADDRESS=", vm.toString(r.swap)));
        console.log(
            string.concat("NEXT_PUBLIC_CHOG_SWAP_DEPLOY_BLOCK=", vm.toString(r.deployBlock))
        );
    }
}
