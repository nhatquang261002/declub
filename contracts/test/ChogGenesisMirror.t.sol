// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogGenesisMirror} from "../src/mocks/ChogGenesisMirror.sol";

contract ChogGenesisMirrorTest is Test {
    function test_identityAndMetadata() public {
        ChogGenesisMirror mirror = new ChogGenesisMirror();
        mirror.mintBatch(address(this), 1);

        assertEq(mirror.name(), "Chog Genesis");
        assertEq(mirror.symbol(), "CHOG");
        assertEq(mirror.totalSupply(), 1);
        assertEq(
            mirror.tokenURI(1),
            "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1.json"
        );
    }

    function test_mintsFullCatalog() public {
        ChogGenesisMirror mirror = new ChogGenesisMirror();
        mirror.mintBatch(address(this), mirror.MAX_SUPPLY());
        assertEq(mirror.totalSupply(), 1969);
        assertEq(mirror.ownerOf(1969), address(this));
    }
}
