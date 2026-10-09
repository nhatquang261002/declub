// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDeClubIntents} from "../../src/interfaces/IDeClubIntents.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {DeClubIntentsBase} from "./DeClubIntentsBase.sol";

contract DeClubIntentsFuzzTest is DeClubIntentsBase {
    uint256 internal constant HUGE = 1e30;

    MockERC20[4] internal tok;
    address[4] internal who;
    uint256[4] internal keys;

    function setUp() public override {
        super.setUp();
        (who[0], who[1], who[2], who[3]) = (alice, bob, carol, dave);
        (keys[0], keys[1], keys[2], keys[3]) = (aliceKey, bobKey, carolKey, daveKey);
        for (uint256 t; t < 4; ++t) {
            tok[t] = new MockERC20("T", "T");
            for (uint256 p; p < 4; ++p) {
                // MockERC20 caps a single mint, so mint in chunks.
                for (uint256 k; k < 10; ++k) {
                    tok[t].mint(who[p], 1_000_000 ether);
                }
                vm.prank(who[p]);
                tok[t].approve(address(swap), type(uint256).max);
            }
        }
    }

    /// @dev Ring of `n` makers starting at `start`: maker i pays `gives[i]` of token i and asks for
    ///      at least `gives[i-1] - slack[i]` of the previous token. Returns the cycle and sigs.
    function _ring(uint256 n, uint256 start, uint256[4] memory gives, uint256[4] memory slack)
        internal
        view
        returns (IDeClubIntents.Intent[] memory cycle, bytes[] memory sigs, uint256[4] memory idx)
    {
        cycle = new IDeClubIntents.Intent[](n);
        sigs = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            uint256 me = (start + i) % n;
            uint256 prev = (start + i + n - 1) % n;
            cycle[i] = _intent(
                who[me],
                _list(_erc20(address(tok[me]), gives[me])),
                _list(_erc20(address(tok[prev]), gives[prev] - slack[me])),
                0
            );
            sigs[i] = _sign(keys[me], cycle[i]);
            idx[i] = me;
        }
    }

    /// @dev For any ring size, rotation, amounts and want slack: everyone pays exactly `give`,
    ///      receives exactly the previous maker's `give` (≥ want), and the contract keeps nothing.
    function testFuzz_ringSettlesExactly(
        uint256 sizeSeed,
        uint256 startSeed,
        uint256[4] memory gives,
        uint256[4] memory slack
    ) public {
        uint256 n = bound(sizeSeed, 2, 4);
        uint256 start = bound(startSeed, 0, n - 1);
        for (uint256 i; i < 4; ++i) {
            gives[i] = bound(gives[i], 1, 1_000 ether);
        }
        // `slack[me]` is measured against gives[prev], where prev depends on the ring size.
        for (uint256 i; i < n; ++i) {
            slack[i] = bound(slack[i], 0, gives[(i + n - 1) % n] - 1);
        }

        uint256[4][4] memory before;
        for (uint256 p; p < n; ++p) {
            for (uint256 t; t < n; ++t) {
                before[p][t] = tok[t].balanceOf(who[p]);
            }
        }

        (IDeClubIntents.Intent[] memory cycle, bytes[] memory sigs,) = _ring(n, start, gives, slack);
        swap.settle(cycle, sigs);

        for (uint256 p; p < n; ++p) {
            for (uint256 t; t < n; ++t) {
                uint256 expected = before[p][t];
                if (t == p) expected -= gives[p]; // p pays its own token
                if (t == (p + n - 1) % n) expected += gives[t]; // p receives prev's token
                assertEq(tok[t].balanceOf(who[p]), expected, "balance");
            }
            assertEq(tok[p].balanceOf(address(swap)), 0);
            assertTrue(swap.isNonceUsed(who[p], 0));
        }
    }

    /// @dev One unit short of `want` always fails, whichever maker is short and wherever the
    ///      cycle starts.
    function testFuzz_ringWithAShortGiveReverts(
        uint256 sizeSeed,
        uint256 startSeed,
        uint256 shortSeed,
        uint256[4] memory gives
    ) public {
        uint256 n = bound(sizeSeed, 2, 4);
        uint256 start = bound(startSeed, 0, n - 1);
        uint256 shortMaker = bound(shortSeed, 0, n - 1);
        for (uint256 i; i < 4; ++i) {
            gives[i] = bound(gives[i], 2, 1_000 ether);
        }
        uint256[4] memory slack; // everyone wants exactly the previous give...

        (IDeClubIntents.Intent[] memory cycle, bytes[] memory sigs,) = _ring(n, start, gives, slack);
        // ...except the maker after `shortMaker`, who now asks for one more than is given.
        uint256 asker = (shortMaker + 1) % n;
        uint256 pos = (asker + n - start) % n;
        cycle[pos].want[0].amount += 1;
        sigs[pos] = _sign(keys[asker], cycle[pos]);

        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.WantNotMet.selector, pos, 0));
        swap.settle(cycle, sigs);
    }

    /// @dev Whatever mix of used and fresh nonces a ring carries, it settles only if all are fresh,
    ///      and a failed attempt marks none of them.
    function testFuzz_staleNonceAnywhereBlocksTheRing(uint256 staleSeed) public {
        uint256 stale = bound(staleSeed, 0, 2);
        uint256[4] memory gives = [uint256(10 ether), 20 ether, 30 ether, 1];
        uint256[4] memory noSlack;
        (IDeClubIntents.Intent[] memory cycle, bytes[] memory sigs,) = _ring(3, 0, gives, noSlack);

        vm.prank(who[stale]);
        swap.invalidateNonces(0, 1);

        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.NonceUsed.selector, who[stale], 0));
        swap.settle(cycle, sigs);

        for (uint256 i; i < 3; ++i) {
            if (i != stale) assertFalse(swap.isNonceUsed(who[i], 0));
        }
    }
}
