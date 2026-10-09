// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CollectionMirror} from "../src/mocks/CollectionMirror.sol";

/// @notice Deploys testnet mirrors of three Monad mainnet collections for the demo: same names,
///         symbols, supplies and metadata as mainnet, minting nothing. `web/scripts/demo.ts`
///         mints the demo holdings and hands each mirror to its Club's Owner.
/// @dev Mainnet sources (read 2026-10-06):
///        Chog Genesis 0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763  ipfs, `.json`, reveal offset 1461
///        skrumpeys    0xb0dad798c80e40dd6b8e8545074c6a5b7b97d2c0  evmfs.xyz, no suffix
///        r3tards      0x200723a706de0013316e5cd8eba2b3f53dd90c29  scatter.art, no suffix
contract DeployMirrors is Script {
    struct Result {
        address chog;
        address skrumpeys;
        address r3tards;
    }

    function run() external returns (Result memory r) {
        r = deploy();
        console.log("# paste into .env");
        console.log(string.concat("DEMO_CHOG_ADDRESS=", vm.toString(r.chog)));
        console.log(string.concat("DEMO_SKRUMPEYS_ADDRESS=", vm.toString(r.skrumpeys)));
        console.log(string.concat("DEMO_R3TARDS_ADDRESS=", vm.toString(r.r3tards)));
    }

    function deploy() public returns (Result memory r) {
        require(block.chainid == 10143 || block.chainid == 31337, "testnet deployment only");
        vm.startBroadcast();
        r.chog = address(
            new CollectionMirror(
                "Chog Genesis",
                "CHOG",
                1969,
                "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/",
                ".json",
                1461
            )
        );
        r.skrumpeys = address(
            new CollectionMirror(
                "skrumpeys",
                "SKRUMP",
                3333,
                "https://evmfs.xyz/143/107912197/0xea267b4d1b58b7ece2b50010670b565fb8f59da5af5c08ec0fdce7bea8c66f25/",
                "",
                0
            )
        );
        r.r3tards = address(
            new CollectionMirror(
                "r3tards",
                "R3TARDS",
                1033,
                "https://www.scatter.art/api/instareveal/mfrvr5upu9925ja07o6ckk6v/",
                "",
                0
            )
        );
        vm.stopBroadcast();
    }
}
