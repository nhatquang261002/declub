// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IDeClubEscrow} from "../../src/interfaces/IDeClubEscrow.sol";
import {DeClubEscrowBase} from "./DeClubEscrowBase.sol";

/// @dev Trait requests (docs/adr/0006-trait-requests-in-v2.md): an `ERC721Trait` asset commits to
///      a Merkle set of token ids, and the taker proves each id they hand over is in it.
contract DeClubEscrowTraitsTest is DeClubEscrowBase {
    IDeClubEscrow.AssetType internal constant TRAIT = IDeClubEscrow.AssetType.ERC721Trait;
    string internal constant SPEC = '{"v":1,"clauses":[{"mode":"any","traits":[["Hat","Crown"]]}]}';

    // ───────────────────────────────────────────── merkle helpers

    function _leaf(address token, uint256 id) internal pure returns (bytes32) {
        return keccak256(abi.encode(token, id));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Sorted-pair tree over `ids` (same shape as web/lib/merkle.ts). Returns the root and
    ///      one proof per id, in the order given.
    function _tree(address token, uint256[] memory ids)
        internal
        pure
        returns (bytes32 root, bytes32[][] memory proofs)
    {
        uint256 n = ids.length;
        proofs = new bytes32[][](n);
        bytes32[] memory level = new bytes32[](n);
        uint256[] memory groupStart = new uint256[](n);
        uint256[] memory groupEnd = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            level[i] = _leaf(token, ids[i]);
            groupStart[i] = i;
            groupEnd[i] = i + 1;
            proofs[i] = new bytes32[](0);
        }
        while (level.length > 1) {
            uint256 next = (level.length + 1) / 2;
            bytes32[] memory up = new bytes32[](next);
            uint256[] memory upStart = new uint256[](next);
            uint256[] memory upEnd = new uint256[](next);
            for (uint256 i; i < level.length; i += 2) {
                if (i + 1 == level.length) {
                    up[i / 2] = level[i];
                    upStart[i / 2] = groupStart[i];
                    upEnd[i / 2] = groupEnd[i];
                    continue;
                }
                for (uint256 k = groupStart[i]; k < groupEnd[i]; ++k) {
                    proofs[k] = _push(proofs[k], level[i + 1]);
                }
                for (uint256 k = groupStart[i + 1]; k < groupEnd[i + 1]; ++k) {
                    proofs[k] = _push(proofs[k], level[i]);
                }
                up[i / 2] = _pair(level[i], level[i + 1]);
                upStart[i / 2] = groupStart[i];
                upEnd[i / 2] = groupEnd[i + 1];
            }
            level = up;
            groupStart = upStart;
            groupEnd = upEnd;
        }
        root = level[0];
    }

    function _push(bytes32[] memory a, bytes32 x) internal pure returns (bytes32[] memory r) {
        r = new bytes32[](a.length + 1);
        for (uint256 i; i < a.length; ++i) {
            r[i] = a[i];
        }
        r[a.length] = x;
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d)
        internal
        pure
        returns (uint256[] memory r)
    {
        r = new uint256[](4);
        (r[0], r[1], r[2], r[3]) = (a, b, c, d);
    }

    function _one(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        (r[0], r[1]) = (a, b);
    }

    function _proofOf(bytes32[][] memory proofs, uint256 index)
        internal
        pure
        returns (bytes32[][] memory r)
    {
        r = new bytes32[][](1);
        r[0] = proofs[index];
    }

    function _traitAsset(bytes32 root, uint256 amount)
        internal
        view
        returns (IDeClubEscrow.Asset memory)
    {
        return IDeClubEscrow.Asset(TRAIT, address(chog), uint256(root), amount);
    }

    function _fill1(uint256[] memory ids, bytes32[][] memory proofs)
        internal
        pure
        returns (IDeClubEscrow.TraitFill[] memory r)
    {
        r = new IDeClubEscrow.TraitFill[](1);
        r[0] = IDeClubEscrow.TraitFill(ids, proofs);
    }

    function _createTrait(
        address maker,
        IDeClubEscrow.Asset[] memory offered,
        IDeClubEscrow.Asset[] memory requested
    ) internal returns (uint256 id) {
        vm.prank(maker);
        id = swap.createTraitTrade{value: _nativeOf(offered)}(
            offered, requested, address(0), 0, SPEC
        );
    }

    /// @dev The set {6, 7, 8, 11}: bob owns 6–8 and carol owns 11. Index 0..3 in that order.
    function _set() internal view returns (bytes32 root, bytes32[][] memory proofs) {
        return _tree(address(chog), _ids(6, 7, 8, 11));
    }

    /// @dev alice offers 10 MON for any 1 Chog from the set.
    function _openTraitTrade() internal returns (uint256 id, bytes32[][] memory proofs) {
        bytes32 root;
        (root, proofs) = _set();
        id = _createTrait(alice, _list(_native(10 ether)), _list(_traitAsset(root, 1)));
    }

    /// @dev A root and proof produced by web/lib/merkle.ts (ids 1..37, every third one, id 16),
    ///      checked with the same OpenZeppelin routine the contract uses. Guards the two
    ///      implementations against drifting apart.
    function test_aProofBuiltByTheWebAppVerifies() public pure {
        address token = 0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4;
        bytes32 root = 0x69549bde08e9037826039129dfb40ed55a40128a8a21c77881e1cb1f342a0222;
        bytes32[] memory proof = new bytes32[](4);
        proof[0] = 0xc2f0409ae29cd939abf5e5f6b84386c4bc8266c74d659e5ed75cc016a3db0752;
        proof[1] = 0xb00f9caf5e1c386131ac553761444455865bd60911f6a26827aba04c740bd93c;
        proof[2] = 0x7018fd02e9e655622e5f94614f3bbba8cc43a3b18c5a845087d9078457351449;
        proof[3] = 0x3d53e5ee679be01bdf44a14aa214aba6cb81e4bcb8500a6fc7033b0854e3d853;
        assertTrue(MerkleProof.verify(proof, root, _leaf(token, 16)));
        assertFalse(MerkleProof.verify(proof, root, _leaf(token, 17)));
    }

    // ───────────────────────────────────────────── creation

    function test_createStoresTheTraitAssetAndSpec() public {
        (bytes32 root,) = _set();
        IDeClubEscrow.Asset[] memory offered = _list(_native(10 ether));
        IDeClubEscrow.Asset[] memory requested = _list(_traitAsset(root, 2));

        vm.expectEmit(true, false, false, true, address(swap));
        emit IDeClubEscrow.TraitSpec(1, SPEC);
        uint256 id = _createTrait(alice, offered, requested);

        IDeClubEscrow.Trade memory t = swap.getTrade(id);
        assertEq(uint8(t.requested[0].assetType), uint8(TRAIT));
        assertEq(t.requested[0].token, address(chog));
        assertEq(t.requested[0].id, uint256(root));
        assertEq(t.requested[0].amount, 2);
        assertEq(swap.traitSpec(id), SPEC);
        assertEq(address(swap).balance, 10 ether);
    }

    function test_plainTradeHasNoSpec() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        assertEq(swap.traitSpec(id), "");
    }

    function test_createTradeRejectsTraitAssets() public {
        (bytes32 root,) = _set();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.createTrade{value: 1}(_list(_native(1)), _list(_traitAsset(root, 1)), address(0), 0);
    }

    function test_traitAssetsAreRequestedSideOnly() public {
        (bytes32 root,) = _set();
        IDeClubEscrow.Asset[] memory trait = _list(_traitAsset(root, 1));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.createTraitTrade(trait, _list(_chog(B1)), address(0), 0, SPEC);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.createOpenOffer(trait, address(0), 0, "");

        uint256 offer = _openOffer(alice, _list(_chog(A1)), "anything");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.propose(offer, trait);
    }

    function test_traitAssetFieldRules() public {
        (bytes32 root,) = _set();
        IDeClubEscrow.Asset[] memory offered = _list(_chog(A1));
        IDeClubEscrow.Asset[4] memory bad = [
            IDeClubEscrow.Asset(TRAIT, address(chog), 0, 1), // zero root
            IDeClubEscrow.Asset(TRAIT, address(chog), uint256(root), 0), // zero amount
            IDeClubEscrow.Asset(TRAIT, address(chog), uint256(root), 11), // over the side cap
            IDeClubEscrow.Asset(TRAIT, alice, uint256(root), 1) // token isn't a contract
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
            swap.createTraitTrade(offered, _list(bad[i]), address(0), 0, SPEC);
        }

        // The cap itself is fine.
        _createTrait(alice, offered, _list(_traitAsset(root, 10)));
    }

    function test_traitAssetsRespectDuplicateAndSizeRules() public {
        (bytes32 root,) = _set();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.DuplicateAsset.selector, 1));
        swap.createTraitTrade(
            _list(_chog(A1)), _list(_traitAsset(root, 1), _traitAsset(root, 2)), address(0), 0, SPEC
        );

        // Same collection, different roots: two separate requests.
        (bytes32 other,) = _tree(address(chog), _one(9));
        _createTrait(alice, _list(_chog(A1)), _list(_traitAsset(root, 1), _traitAsset(other, 1)));
    }

    function test_specRules() public {
        (bytes32 root,) = _set();
        IDeClubEscrow.Asset[] memory offered = _list(_chog(A1));
        IDeClubEscrow.Asset[] memory requested = _list(_traitAsset(root, 1));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.BadTraitSpec.selector, 0, 1024));
        swap.createTraitTrade(offered, requested, address(0), 0, "");

        bytes memory big = new bytes(1025);
        for (uint256 i; i < big.length; ++i) {
            big[i] = "x";
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.BadTraitSpec.selector, 1025, 1024));
        swap.createTraitTrade(offered, requested, address(0), 0, string(big));

        // Exactly the cap is fine.
        bytes memory max = new bytes(1024);
        for (uint256 i; i < max.length; ++i) {
            max[i] = "x";
        }
        vm.prank(alice);
        swap.createTraitTrade(offered, requested, address(0), 0, string(max));
    }

    function test_createTraitTradeNeedsATraitAsset() public {
        vm.prank(alice);
        vm.expectRevert(IDeClubEscrow.NoTraitAsset.selector);
        swap.createTraitTrade(_list(_chog(A1)), _list(_chog(B1)), address(0), 0, SPEC);
    }

    function test_createTraitTradeKeepsTheOtherCreationChecks() public {
        (bytes32 root,) = _set();
        IDeClubEscrow.Asset[] memory requested = _list(_traitAsset(root, 1));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 5, 4));
        swap.createTraitTrade{value: 4}(_list(_native(5)), requested, address(0), 0, SPEC);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SameAssetBothSides.selector, 0, 1));
        swap.createTraitTrade(
            _list(_chog(A1)), _list(_traitAsset(root, 1), _chog(A1)), address(0), 0, SPEC
        );

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.ExpiryInPast.selector, 1));
        swap.createTraitTrade(_list(_chog(A1)), requested, address(0), 1, SPEC);
    }

    // ───────────────────────────────────────────── filling

    function test_fillsWithOneIdFromTheSet() public {
        (uint256 id, bytes32[][] memory proofs) = _openTraitTrade();
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.prank(bob);
        swap.fillTraitTrade(id, _fill1(_one(7), _proofOf(proofs, 1)));

        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Filled));
        _assertOwner(7, alice);
        assertEq(bob.balance, bobBefore + 10 ether);
        assertEq(alice.balance, aliceBefore);
        assertEq(address(swap).balance, 0);
    }

    function test_everyMemberOfTheSetCanFill() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        uint256[4] memory members = [uint256(6), 7, 8, 11];
        address[4] memory holders = [bob, bob, bob, carol];
        for (uint256 i; i < members.length; ++i) {
            uint256 id = _createTrait(alice, _list(_native(1 ether)), _list(_traitAsset(root, 1)));
            vm.prank(holders[i]);
            swap.fillTraitTrade(id, _fill1(_one(members[i]), _proofOf(proofs, i)));
            _assertOwner(members[i], alice);
        }
    }

    function test_fillsAnAmountOfTwo() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        uint256 id = _createTrait(alice, _list(_native(10 ether)), _list(_traitAsset(root, 2)));

        bytes32[][] memory two = new bytes32[][](2);
        (two[0], two[1]) = (proofs[0], proofs[2]);
        vm.prank(bob);
        swap.fillTraitTrade(id, _fill1(_two(6, 8), two));

        _assertOwner(6, alice);
        _assertOwner(8, alice);
    }

    function test_fillsATradeThatMixesTraitAssetsWithEverythingElse() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        (bytes32 other, bytes32[][] memory otherProofs) = _tree(address(chog), _two(9, 10));
        IDeClubEscrow.Asset[] memory requested = new IDeClubEscrow.Asset[](4);
        requested[0] = _traitAsset(root, 1);
        requested[1] = _chog(8); // an exact NFT alongside the trait sets
        requested[2] = _traitAsset(other, 1);
        requested[3] = _erc20(address(usdc), 50 ether);
        uint256 id = _createTrait(alice, _list(_chog(A1), _native(3 ether)), requested);

        IDeClubEscrow.TraitFill[] memory fills = new IDeClubEscrow.TraitFill[](2);
        fills[0] = IDeClubEscrow.TraitFill(_one(6), _proofOf(proofs, 0));
        fills[1] = IDeClubEscrow.TraitFill(_one(9), _proofOf(otherProofs, 0));

        // bob holds 6–10, so he can supply all of it.
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        swap.fillTraitTrade(id, fills);

        _assertOwner(6, alice);
        _assertOwner(8, alice);
        _assertOwner(9, alice);
        _assertOwner(A1, bob);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 50 ether);
        assertEq(bob.balance, bobBefore + 3 ether);
    }

    function test_fillTradeRefusesATraitTrade() public {
        (uint256 id,) = _openTraitTrade();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TraitFillRequired.selector, id));
        swap.fillTrade(id);
    }

    function test_fillTraitTradeWithNoFillsFillsAPlainTrade() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(bob);
        swap.fillTraitTrade(id, new IDeClubEscrow.TraitFill[](0));
        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
    }

    function test_fillTraitTradeRefusesFillsOnAPlainTrade() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        (, bytes32[][] memory proofs) = _set();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitFill.selector, 0));
        swap.fillTraitTrade(id, _fill1(_one(6), _proofOf(proofs, 0)));
    }

    function test_rejectsAnIdOutsideTheSet() public {
        (uint256 id, bytes32[][] memory proofs) = _openTraitTrade();
        // bob owns 9 and 10 but they're not in the set; borrow 6's proof.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitProof.selector, 0, 9));
        swap.fillTraitTrade(id, _fill1(_one(9), _proofOf(proofs, 0)));
    }

    function test_rejectsAProofForADifferentId() public {
        (uint256 id, bytes32[][] memory proofs) = _openTraitTrade();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitProof.selector, 0, 7));
        swap.fillTraitTrade(id, _fill1(_one(7), _proofOf(proofs, 2)));
    }

    function test_rejectsAnEmptyProof() public {
        (uint256 id,) = _openTraitTrade();
        bytes32[][] memory empty = new bytes32[][](1);
        empty[0] = new bytes32[](0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitProof.selector, 0, 6));
        swap.fillTraitTrade(id, _fill1(_one(6), empty));
    }

    function test_proofFromAnotherCollectionFails() public {
        // The same ids under a different token address build a different tree.
        (uint256 id,) = _openTraitTrade();
        (, bytes32[][] memory foreign) = _tree(address(usdc), _ids(6, 7, 8, 11));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitProof.selector, 0, 6));
        swap.fillTraitTrade(id, _fill1(_one(6), _proofOf(foreign, 0)));
    }

    function test_rejectsTheWrongNumberOfIds() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        uint256 id = _createTrait(alice, _list(_native(10 ether)), _list(_traitAsset(root, 2)));

        // one id for an amount of two
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitFill.selector, 0));
        swap.fillTraitTrade(id, _fill1(_one(6), _proofOf(proofs, 0)));

        // two ids but one proof
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitFill.selector, 0));
        swap.fillTraitTrade(id, _fill1(_two(6, 7), _proofOf(proofs, 0)));
    }

    function test_rejectsARepeatedId() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        uint256 id = _createTrait(alice, _list(_native(10 ether)), _list(_traitAsset(root, 2)));
        bytes32[][] memory twice = new bytes32[][](2);
        (twice[0], twice[1]) = (proofs[0], proofs[0]);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitFill.selector, 0));
        swap.fillTraitTrade(id, _fill1(_two(6, 6), twice));
    }

    function test_rejectsTheWrongNumberOfFills() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        (bytes32 other,) = _tree(address(chog), _two(9, 10));
        uint256 id = _createTrait(
            alice, _list(_native(10 ether)), _list(_traitAsset(root, 1), _traitAsset(other, 1))
        );

        // one fill for two trait assets
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitFill.selector, 1));
        swap.fillTraitTrade(id, _fill1(_one(6), _proofOf(proofs, 0)));

        // none at all
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TraitFillRequired.selector, id));
        swap.fillTraitTrade(id, new IDeClubEscrow.TraitFill[](0));

        // an extra fill
        (root, proofs) = _set();
        uint256 single = _createTrait(alice, _list(_native(1 ether)), _list(_traitAsset(root, 1)));
        IDeClubEscrow.TraitFill[] memory two = new IDeClubEscrow.TraitFill[](2);
        two[0] = IDeClubEscrow.TraitFill(_one(6), _proofOf(proofs, 0));
        two[1] = IDeClubEscrow.TraitFill(_one(7), _proofOf(proofs, 1));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitFill.selector, 1));
        swap.fillTraitTrade(single, two);
    }

    function test_fillsAreOrderedLikeTheTraitAssets() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        (bytes32 other, bytes32[][] memory otherProofs) = _tree(address(chog), _two(9, 10));
        uint256 id = _createTrait(
            alice, _list(_native(10 ether)), _list(_traitAsset(root, 1), _traitAsset(other, 1))
        );

        IDeClubEscrow.TraitFill[] memory swapped = new IDeClubEscrow.TraitFill[](2);
        swapped[0] = IDeClubEscrow.TraitFill(_one(9), _proofOf(otherProofs, 0));
        swapped[1] = IDeClubEscrow.TraitFill(_one(6), _proofOf(proofs, 0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidTraitProof.selector, 0, 9));
        swap.fillTraitTrade(id, swapped);
    }

    function test_aTakerWhoDoesNotOwnTheIdRevertsTheWholeFill() public {
        (uint256 id, bytes32[][] memory proofs) = _openTraitTrade();
        // 11 is in the set, but carol owns it, not bob.
        vm.prank(bob);
        vm.expectRevert();
        swap.fillTraitTrade(id, _fill1(_one(11), _proofOf(proofs, 3)));
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
        assertEq(address(swap).balance, 10 ether);
    }

    function test_theSingleLeafSetHasAnEmptyProof() public {
        (bytes32 root, bytes32[][] memory proofs) = _tree(address(chog), _one(6));
        assertEq(proofs[0].length, 0);
        uint256 id = _createTrait(alice, _list(_native(1 ether)), _list(_traitAsset(root, 1)));
        vm.prank(bob);
        swap.fillTraitTrade(id, _fill1(_one(6), _proofOf(proofs, 0)));
        _assertOwner(6, alice);
    }

    function test_theStandardFillRulesStillApply() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        IDeClubEscrow.TraitFill[] memory fills = _fill1(_one(6), _proofOf(proofs, 0));

        // taker-only
        vm.prank(alice);
        uint256 id = swap.createTraitTrade{value: 1 ether}(
            _list(_native(1 ether)), _list(_traitAsset(root, 1)), carol, 0, SPEC
        );
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotAllowedTaker.selector, id));
        swap.fillTraitTrade(id, fills);

        // no self-fill: alice would need to own an id in the set, so use one she holds
        (bytes32 aroot, bytes32[][] memory aproofs) = _tree(address(chog), _two(A1, A2));
        uint256 own = _createTrait(alice, _list(_native(1 ether)), _list(_traitAsset(aroot, 1)));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SelfFill.selector, own));
        swap.fillTraitTrade(own, _fill1(_one(A1), _proofOf(aproofs, 0)));

        // expiry
        vm.prank(alice);
        uint256 timed = swap.createTraitTrade{value: 1 ether}(
            _list(_native(1 ether)),
            _list(_traitAsset(root, 1)),
            address(0),
            uint64(block.timestamp + 1 hours),
            SPEC
        );
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeIsExpired.selector, timed));
        swap.fillTraitTrade(timed, fills);

        // settled
        (uint256 done, bytes32[][] memory doneProofs) = _openTraitTrade();
        vm.prank(bob);
        swap.fillTraitTrade(done, _fill1(_one(6), _proofOf(doneProofs, 0)));
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeNotOpen.selector, done));
        swap.fillTraitTrade(done, _fill1(_one(11), _proofOf(doneProofs, 3)));
    }

    function test_fillTraitTradeRefusesAnOpenOffer() public {
        uint256 offer = _openOffer(alice, _list(_chog(A1)), "anything");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.OpenOfferNoFill.selector, offer));
        swap.fillTraitTrade(offer, new IDeClubEscrow.TraitFill[](0));
    }

    function test_nativeInRequestedStillNeedsExactValue() public {
        (bytes32 root, bytes32[][] memory proofs) = _set();
        uint256 id =
            _createTrait(alice, _list(_chog(A1)), _list(_traitAsset(root, 1), _native(2 ether)));
        IDeClubEscrow.TraitFill[] memory fills = _fill1(_one(6), _proofOf(proofs, 0));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 2 ether, 1)
        );
        swap.fillTraitTrade{value: 1}(id, fills);

        vm.prank(bob);
        swap.fillTraitTrade{value: 2 ether}(id, fills);
        assertEq(alice.balance, START_MON + 2 ether);
        _assertOwner(A1, bob);
    }

    // ───────────────────────────────────────────── the other exits

    function test_makerCancelsAndReclaimsATraitTrade() public {
        (bytes32 root,) = _set();
        uint256 a = _createTrait(alice, _list(_chog(A1)), _list(_traitAsset(root, 1)));
        vm.prank(alice);
        swap.cancelTrade(a);
        _assertOwner(A1, alice);

        vm.prank(alice);
        uint256 b = swap.createTraitTrade(
            _list(_chog(A1)),
            _list(_traitAsset(root, 1)),
            address(0),
            uint64(block.timestamp + 1 hours),
            SPEC
        );
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(carol);
        swap.reclaimExpired(b);
        _assertOwner(A1, alice);
    }
}
