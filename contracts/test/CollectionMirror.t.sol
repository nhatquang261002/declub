// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CollectionMirror} from "../src/mocks/CollectionMirror.sol";
import {DeployMirrors} from "../script/DeployMirrors.s.sol";

contract CollectionMirrorTest is Test {
    string internal constant CHOG_BASE =
        "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/";

    /// Mainnet Chog Genesis: #1 → 1462.json, #508 → 1969.json, #509 → 1.json, #1969 → 1461.json.
    function test_revealOffsetMatchesMainnetChog() public {
        CollectionMirror chog =
            new CollectionMirror("Chog Genesis", "CHOG", 1969, CHOG_BASE, ".json", 1461);
        chog.mintBatch(address(this), 20);
        assertEq(chog.tokenURI(1), string.concat(CHOG_BASE, "1462.json"));
        assertEq(chog.tokenURI(2), string.concat(CHOG_BASE, "1463.json"));

        CollectionMirror full =
            new CollectionMirror("Chog Genesis", "CHOG", 1969, CHOG_BASE, ".json", 1461);
        full.mintBatch(address(this), 1969);
        assertEq(full.tokenURI(508), string.concat(CHOG_BASE, "1969.json"));
        assertEq(full.tokenURI(509), string.concat(CHOG_BASE, "1.json"));
        assertEq(full.tokenURI(1969), string.concat(CHOG_BASE, "1461.json"));
    }

    function test_noOffsetNoSuffix() public {
        CollectionMirror m =
            new CollectionMirror("r3tards", "R3TARDS", 1033, "https://example.com/m/", "", 0);
        m.mintBatch(address(this), 3);
        assertEq(m.tokenURI(3), "https://example.com/m/3");
        assertEq(m.totalSupply(), 3);
        assertEq(m.tokenOfOwnerByIndex(address(this), 2), 3);
    }

    function test_mintRules() public {
        CollectionMirror m = new CollectionMirror("x", "X", 5, "b/", "", 0);
        vm.expectRevert(abi.encodeWithSelector(CollectionMirror.InvalidQuantity.selector, 0));
        m.mintBatch(address(this), 0);
        m.mintBatch(address(this), 5);
        vm.expectRevert(CollectionMirror.MaxSupplyExceeded.selector);
        m.mintBatch(address(this), 1);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector, makeAddr("stranger")
            )
        );
        m.mintBatch(address(this), 1);
    }

    function test_deployScriptMirrorsTheThreeCollections() public {
        DeployMirrors script = new DeployMirrors();
        DeployMirrors.Result memory r = script.deploy();
        assertEq(CollectionMirror(r.chog).name(), "Chog Genesis");
        assertEq(CollectionMirror(r.chog).MAX_SUPPLY(), 1969);
        assertEq(CollectionMirror(r.skrumpeys).symbol(), "SKRUMP");
        assertEq(CollectionMirror(r.skrumpeys).MAX_SUPPLY(), 3333);
        assertEq(CollectionMirror(r.r3tards).name(), "r3tards");
        assertEq(CollectionMirror(r.r3tards).MAX_SUPPLY(), 1033);
    }
}
