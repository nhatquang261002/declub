// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {OnDeal} from "../src/OnDeal.sol";
import {MockChog} from "../src/mocks/MockChog.sol";
import {ChogGenesisMirror} from "../src/mocks/ChogGenesisMirror.sol";

/// @notice Deploys the trait-enabled OnDeal, and MockChog first if CHOG_ADDRESS is unset.
/// @dev Env (all optional):
///        CHOG_ADDRESS          existing Chog collection; blank → deploy MockChog
///        DEMO_WALLETS          comma-separated addresses to mint MockChogs to
///        DEMO_MINT_PER_WALLET  MockChogs per demo wallet (default 5, max 20)
///        DEPLOY_CHOG_MIRROR    true → deploy the Chog Genesis testnet mirror
///        MIRROR_CATALOG_OWNER  wallet receiving the remaining mirror supply
///        MIRROR_MINT_BATCH     mirror mint size per transaction (default 20)
contract Deploy is Script {
    struct Config {
        address chog; // address(0) → deploy MockChog
        address[] demoWallets;
        uint256 mintPerWallet;
        bool deployMirror;
        address mirrorCatalogOwner;
        uint256 mirrorMintBatch;
    }

    struct Result {
        address chog;
        address swap;
        uint256 deployBlock;
        bool deployedMock;
        bool deployedMirror;
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
        c.deployMirror = vm.envOr("DEPLOY_CHOG_MIRROR", false);
        string memory catalogOwner = vm.trim(vm.envOr("MIRROR_CATALOG_OWNER", string("")));
        if (bytes(catalogOwner).length != 0) c.mirrorCatalogOwner = vm.parseAddress(catalogOwner);
        c.mirrorMintBatch = vm.envOr("MIRROR_MINT_BATCH", uint256(20));
    }

    function deploy(Config memory c) public returns (Result memory r) {
        require(block.chainid == 10143 || block.chainid == 31337, "testnet deployment only");
        r.deployBlock = block.number;
        vm.startBroadcast();

        if (c.chog == address(0)) {
            if (c.deployMirror) {
                ChogGenesisMirror mirror = new ChogGenesisMirror();
                r.chog = address(mirror);
                r.deployedMock = true;
                r.deployedMirror = true;
                uint256 minted;
                for (uint256 i; i < c.demoWallets.length; ++i) {
                    mirror.mintBatch(c.demoWallets[i], c.mintPerWallet);
                    minted += c.mintPerWallet;
                }
                address catalogOwner = c.mirrorCatalogOwner;
                if (catalogOwner == address(0)) catalogOwner = msg.sender;
                require(c.mirrorMintBatch > 0, "invalid mirror batch");
                while (minted < mirror.MAX_SUPPLY()) {
                    uint256 remaining = mirror.MAX_SUPPLY() - minted;
                    uint256 batch = remaining < c.mirrorMintBatch ? remaining : c.mirrorMintBatch;
                    mirror.mintBatch(catalogOwner, batch);
                    minted += batch;
                }
            } else {
                MockChog mock = new MockChog();
                r.chog = address(mock);
                r.deployedMock = true;
                for (uint256 i; i < c.demoWallets.length; ++i) {
                    mock.mint(c.demoWallets[i], c.mintPerWallet);
                }
            }
        } else {
            r.chog = c.chog;
        }

        r.swap = address(new OnDeal(r.chog));

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
        string memory kind = r.deployedMirror ? "(Chog Genesis mirror)" : (r.deployedMock ? "(MockChog)" : "(existing)");
        console.log("Chog      :", r.chog, kind);
        console.log("OnDeal  :", r.swap);
        console.log("");
        console.log("# paste into .env");
        console.log(string.concat("NEXT_PUBLIC_CHOG_ADDRESS=", vm.toString(r.chog)));
        console.log(string.concat("NEXT_PUBLIC_ON_DEAL_ADDRESS=", vm.toString(r.swap)));
        // block.number here is the simulation block, before anything is mined. It's a safe
        // lower bound for event scans; the exact block is in broadcast/.../run-latest.json.
        console.log("# deploy block: lower bound; exact block is in the broadcast receipts");
        console.log(
            string.concat("NEXT_PUBLIC_ON_DEAL_DEPLOY_BLOCK=", vm.toString(r.deployBlock))
        );
    }
}
