// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {MockChog} from "../src/mocks/MockChog.sol";

contract MockChogTest is Test {
    MockChog internal chog;
    address internal alice = makeAddr("alice");

    function setUp() public {
        chog = new MockChog();
    }

    function test_mint_sequentialIds() public {
        assertEq(chog.mint(alice, 3), 1);
        assertEq(chog.mint(alice, 2), 4);
        assertEq(chog.balanceOf(alice), 5);
        assertEq(chog.ownerOf(5), alice);
        assertEq(chog.tokenOfOwnerByIndex(alice, 4), 5);
        assertEq(chog.nextTokenId(), 6);
    }

    function test_mint_revertsOnBadQuantity() public {
        vm.expectRevert(abi.encodeWithSelector(MockChog.InvalidQuantity.selector, 0));
        chog.mint(alice, 0);
        vm.expectRevert(abi.encodeWithSelector(MockChog.InvalidQuantity.selector, 21));
        chog.mint(alice, 21);
    }

    function test_traits_deterministic() public view {
        (string memory h1, string memory e1, string memory b1) = chog.traitsOf(42);
        (string memory h2, string memory e2, string memory b2) = chog.traitsOf(42);
        assertEq(h1, h2);
        assertEq(e1, e2);
        assertEq(b1, b2);
    }

    function test_tokenURI_isBase64Json() public {
        chog.mint(alice, 20); // hit a spread of trait colours
        for (uint256 id = 1; id <= 20; ++id) {
            string memory uri = chog.tokenURI(id);
            assertEq(_prefix(uri, 29), "data:application/json;base64,");
        }
    }

    function test_tokenURI_revertsForUnminted() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        chog.tokenURI(1);
    }

    function _prefix(string memory s, uint256 n) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; ++i) {
            out[i] = b[i];
        }
        return string(out);
    }
}
