// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChogSwap} from "../src/interfaces/IChogSwap.sol";
import {ChogSwapBase} from "./utils/ChogSwapBase.sol";

contract ChogSwapFuzzTest is ChogSwapBase {
    /// MON is conserved across create + fill, whichever side carries it.
    function testFuzz_fill_conservesMon(uint256 mon, bool makerPays) public {
        mon = bound(mon, 0, START_MON);
        uint256 offeredMon = makerPays ? mon : 0;
        uint256 requestedMon = makerPays ? 0 : mon;
        uint256 total = alice.balance + bob.balance;

        uint256 id = _create(alice, _ids(A1), offeredMon, _ids(B1), requestedMon);
        _fill(bob, id);

        assertEq(alice.balance + bob.balance, total);
        assertEq(address(swap).balance, 0);
        assertEq(alice.balance, START_MON - offeredMon + requestedMon);
        assertEq(bob.balance, START_MON + offeredMon - requestedMon);
    }

    /// Any msg.value other than the exact requestedMon reverts.
    function testFuzz_fill_revertsOnWrongMon(uint256 requested, uint256 sent) public {
        requested = bound(requested, 0, START_MON);
        sent = bound(sent, 0, START_MON);
        vm.assume(sent != requested);

        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), requested);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.WrongMonAmount.selector, requested, sent));
        swap.fillTrade{value: sent}(id);
    }

    /// Fill succeeds up to and including `expiry`, reverts strictly after it.
    function testFuzz_expiryBoundary(uint64 ttl, uint64 elapsed) public {
        ttl = uint64(bound(ttl, 1, 365 days));
        elapsed = uint64(bound(elapsed, 0, 2 * 365 days));
        // Read once before the warp; everything after uses `nowTs`.
        // forge-lint: disable-next-line(environment-read-across-mutation)
        uint256 start = block.timestamp;
        uint64 expiry = uint64(start) + ttl;

        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0, address(0), expiry);
        uint256 nowTs = start + elapsed;
        vm.warp(nowTs);

        if (nowTs > expiry) {
            assertTrue(swap.isExpired(id));
            vm.prank(bob);
            vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeIsExpired.selector, id));
            swap.fillTrade(id);

            swap.reclaimExpired(id);
            _assertOwner(A1, alice);
        } else {
            assertFalse(swap.isExpired(id));
            _fill(bob, id);
            _assertOwner(A1, bob);
        }
    }

    /// Only the named taker can fill a direct request.
    function testFuzz_directRequest_onlyNamedTaker(address caller) public {
        vm.assume(caller != bob && caller != alice);
        uint256 id = _create(alice, _ids(A1), 0, _none(), 1 ether, bob, 0);

        vm.deal(caller, 1 ether);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.NotAllowedTaker.selector, id));
        swap.fillTrade{value: 1 ether}(id);
    }

    /// Nobody but the maker can cancel.
    function testFuzz_cancel_onlyMaker(address caller) public {
        vm.assume(caller != alice);
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.NotMaker.selector, id));
        swap.cancelTrade(id);
    }
}
