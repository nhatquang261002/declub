// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {IDeClubIntents} from "../../src/interfaces/IDeClubIntents.sol";
import {DeClubIntentsBase} from "./DeClubIntentsBase.sol";

/// @dev Worst case for `MAX_CYCLE` (ADR 0009): four makers, ten assets on each side, all ERC-721.
///      The measured figure is recorded in docs/03-contract-design.md.
contract DeClubIntentsGasTest is DeClubIntentsBase {
    function _ids(uint256 maker) internal view returns (IDeClubIntents.Asset[] memory r) {
        // Everyone ends up with 10 Chogs: their 5 from the fixture plus 5 minted here.
        r = new IDeClubIntents.Asset[](10);
        uint256 base = 1 + maker * 5; // fixture ids
        uint256 extra = 21 + maker * 5; // minted below, in maker order
        for (uint256 i; i < 5; ++i) {
            r[i] = _chog(base + i);
            r[5 + i] = _chog(extra + i);
        }
    }

    function _worstRing()
        internal
        returns (IDeClubIntents.Intent[] memory cycle, bytes[] memory sigs)
    {
        address[4] memory who = [alice, bob, carol, dave];
        uint256[4] memory keys = [aliceKey, bobKey, carolKey, daveKey];
        for (uint256 i; i < 4; ++i) {
            chog.mint(who[i], 5);
        }
        cycle = new IDeClubIntents.Intent[](4);
        sigs = new bytes[](4);
        for (uint256 i; i < 4; ++i) {
            cycle[i] = _intent(who[i], _ids(i), _ids((i + 3) % 4), 0);
            sigs[i] = _sign(keys[i], cycle[i]);
        }
    }

    function test_worstCaseRingGas() public virtual {
        (IDeClubIntents.Intent[] memory cycle, bytes[] memory sigs) = _worstRing();

        uint256 before = gasleft();
        swap.settle(cycle, sigs);
        uint256 used = before - gasleft();
        console2.log("worst-case ring (4 makers x 10 NFTs each way), gas:", used);

        // Each Chog moved exactly once, to the next maker.
        _assertOwner(1, bob);
        _assertOwner(21, bob);
        _assertOwner(6, carol);
        _assertOwner(26, carol);
        _assertOwner(11, dave);
        _assertOwner(16, alice);
        _assertOwner(36, alice);
        assertEq(chog.balanceOf(address(swap)), 0);
        assertLt(used, 12_000_000, "worst case no longer fits the budget");
    }
}

/// @dev The same worst case with the protocol fee on: four more ERC-20 transfers.
contract DeClubIntentsGasWithFeeTest is DeClubIntentsGasTest {
    function _feeAmount() internal pure override returns (uint256) {
        return 2 ether;
    }

    function test_worstCaseRingGas() public override {
        super.test_worstCaseRingGas();
        assertEq(wmon.balanceOf(treasury), 8 ether);
    }
}
