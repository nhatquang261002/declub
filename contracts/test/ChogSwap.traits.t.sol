// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChogSwap} from "../src/interfaces/IChogSwap.sol";
import {ChogSwapBase} from "./utils/ChogSwapBase.sol";

contract ChogSwapTraitsTest is ChogSwapBase {
    function _root(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function test_traitRequest_fillsWithCollectionScopedProofs() public {
        bytes32 a = swap.traitLeaf(B1);
        bytes32 b = swap.traitLeaf(B2);
        bytes32 root = _root(a, b);
        uint256[] memory offered = _ids(A1);
        bytes32[][] memory proofs = new bytes32[][](2);
        proofs[0] = new bytes32[](1);
        proofs[1] = new bytes32[](1);
        proofs[0][0] = b;
        proofs[1][0] = a;

        vm.prank(alice);
        uint256 id = swap.createTrade{value: 1 ether}(offered, root, 2, 0, address(0), 0);
        vm.prank(bob);
        swap.fillTrade(id, _ids(B1, B2), proofs);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        _assertOwner(B2, alice);
        assertEq(uint8(swap.getTrade(id).status), uint8(IChogSwap.Status.Filled));
    }

    function test_traitRequest_rejectsWrongCollectionLeaf() public {
        bytes32 root = keccak256(abi.encode(address(0x1234), B1));
        vm.prank(alice);
        uint256 id = swap.createTrade(_ids(A1), root, 1, 0, address(0), 0);

        bytes32[][] memory proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.InvalidTraitProof.selector, B1));
        swap.fillTrade(id, _ids(B1), proofs);
    }

    function test_traitRequest_preservesExactIdFill() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        _fill(bob, id);
        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
    }

    function test_traitRequest_rejectsDuplicateIds() public {
        bytes32 leaf = swap.traitLeaf(B1);
        vm.prank(alice);
        uint256 id = swap.createTrade(_ids(A1), leaf, 2, 0, address(0), 0);
        bytes32[][] memory proofs = new bytes32[][](2);
        proofs[0] = new bytes32[](0);
        proofs[1] = new bytes32[](0);
        vm.prank(bob);
        vm.expectRevert(IChogSwap.InvalidTraitRequest.selector);
        swap.fillTrade(id, _ids(B1, B1), proofs);
    }
}
