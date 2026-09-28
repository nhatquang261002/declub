// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogSwap} from "../../src/ChogSwap.sol";
import {IChogSwap} from "../../src/interfaces/IChogSwap.sol";
import {MockChog} from "../../src/mocks/MockChog.sol";

/// @dev Shared fixture: alice owns Chogs 1–5, bob 6–10, carol 11–15. All approve the swap
///      and start with START_MON.
abstract contract ChogSwapBase is Test {
    uint256 internal constant START_MON = 100 ether;

    MockChog internal chog;
    ChogSwap internal swap;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    // Token ids by owner
    uint256 internal constant A1 = 1;
    uint256 internal constant A2 = 2;
    uint256 internal constant A3 = 3;
    uint256 internal constant B1 = 6;
    uint256 internal constant B2 = 7;
    uint256 internal constant B3 = 8;
    uint256 internal constant C1 = 11;

    function setUp() public virtual {
        chog = new MockChog();
        swap = new ChogSwap(address(chog));

        _onboard(alice);
        _onboard(bob);
        _onboard(carol);
    }

    function _onboard(address who) internal {
        chog.mint(who, 5);
        vm.deal(who, START_MON);
        vm.prank(who);
        chog.setApprovalForAll(address(swap), true);
    }

    // ─────────────────────────────────────────────── id-array helpers

    function _none() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        (r[0], r[1]) = (a, b);
    }

    function _ids(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function _range(uint256 from, uint256 count) internal pure returns (uint256[] memory r) {
        r = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            r[i] = from + i;
        }
    }

    // ─────────────────────────────────────────────── trade helpers

    function _create(
        address maker,
        uint256[] memory offeredIds,
        uint256 offeredMon,
        uint256[] memory requestedIds,
        uint256 requestedMon,
        address taker,
        uint64 expiry
    ) internal returns (uint256 id) {
        vm.prank(maker);
        id = swap.createTrade{value: offeredMon}(
            offeredIds, requestedIds, requestedMon, taker, expiry
        );
    }

    /// @dev Public, no-expiry trade: `maker` gives `offered` (+ offeredMon), wants `requested` (+ requestedMon).
    function _create(
        address maker,
        uint256[] memory offeredIds,
        uint256 offeredMon,
        uint256[] memory requestedIds,
        uint256 requestedMon
    ) internal returns (uint256) {
        return _create(maker, offeredIds, offeredMon, requestedIds, requestedMon, address(0), 0);
    }

    function _fill(address taker, uint256 id) internal {
        uint256 value = swap.getTrade(id).requestedMon;
        vm.prank(taker);
        swap.fillTrade{value: value}(id);
    }

    function _status(uint256 id) internal view returns (IChogSwap.Status) {
        return swap.getTrade(id).status;
    }

    function _assertOwner(uint256 tokenId, address expected) internal view {
        assertEq(chog.ownerOf(tokenId), expected, "unexpected Chog owner");
    }
}
