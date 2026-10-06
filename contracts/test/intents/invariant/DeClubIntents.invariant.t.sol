// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {DeClubIntents} from "../../../src/DeClubIntents.sol";
import {MockChog} from "../../../src/mocks/MockChog.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {Handler} from "./Handler.sol";

/// @dev ADR 0008 invariants, however pair settlements, rings, invalidations, moved NFTs, revoked
///      approvals and time interleave:
///      N1 the contract never holds anything; N2 a nonce settles at most once and never after it
///      was invalidated; N5 nothing settles after its deadline. N3/N4 (assets only leave signers'
///      wallets, everyone is paid) show up as conservation: nothing is created or destroyed.
///      The contract charges a fee in WMON: N6 the recipient has received exactly the fee in
///      force at each settlement for every maker in it, nothing otherwise, and nothing settles
///      for a maker whose signed `maxFee` is below the fee. The fee admin changes the fee
///      during the run.
contract DeClubIntentsInvariantTest is Test {
    uint256 internal constant START = 100_000 ether;
    uint256 internal constant FEE = 2 ether;
    address internal constant FEE_ADMIN = address(0xFEEAD);

    DeClubIntents internal swap;
    MockChog internal chog;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockERC20 internal wmon;
    address internal treasury = makeAddr("treasury");
    Handler internal handler;

    function setUp() public {
        wmon = new MockERC20("Wrapped MON", "WMON");
        swap = new DeClubIntents(address(wmon), FEE, 4 * FEE, treasury, FEE_ADMIN);
        chog = new MockChog();
        usdc = new MockERC20("USD Coin", "USDC");
        weth = new MockERC20("Wrapped Ether", "WETH");

        address[4] memory actors;
        uint256[4] memory keys;
        string[4] memory names = ["alice", "bob", "carol", "dave"];
        for (uint256 i; i < 4; ++i) {
            (actors[i], keys[i]) = makeAddrAndKey(names[i]);
            chog.mint(actors[i], 5);
            for (uint256 k; k < START / 1_000_000 ether + 1; ++k) {
                usdc.mint(actors[i], START);
                weth.mint(actors[i], START);
                wmon.mint(actors[i], START);
            }
            vm.startPrank(actors[i]);
            chog.setApprovalForAll(address(swap), true);
            usdc.approve(address(swap), type(uint256).max);
            weth.approve(address(swap), type(uint256).max);
            wmon.approve(address(swap), type(uint256).max);
            vm.stopPrank();
        }
        handler = new Handler(swap, chog, usdc, weth, actors, keys, FEE_ADMIN);
        targetContract(address(handler));
    }

    function invariant_N1_contractHoldsNothing() public view {
        assertEq(address(swap).balance, 0);
        assertEq(usdc.balanceOf(address(swap)), 0);
        assertEq(weth.balanceOf(address(swap)), 0);
        assertEq(wmon.balanceOf(address(swap)), 0);
        assertEq(chog.balanceOf(address(swap)), 0);
    }

    function invariant_conservation() public view {
        uint256 usdcSum;
        uint256 wethSum;
        uint256 chogSum;
        for (uint256 i; i < 4; ++i) {
            address a = handler.actors(i);
            usdcSum += usdc.balanceOf(a);
            wethSum += weth.balanceOf(a);
            chogSum += chog.balanceOf(a);
        }
        assertEq(usdcSum, usdc.totalSupply());
        assertEq(wethSum, weth.totalSupply());
        assertEq(chogSum, 20);
    }

    /// N6: every settled maker paid the fee in force, to the recipient, and nobody else paid
    ///     anything. Nobody paid more than they signed for.
    function invariant_N6_feesAreChargedPerSettledMaker() public view {
        assertEq(wmon.balanceOf(treasury), handler.feesPaid());
        assertFalse(handler.settledBelowMaxFee());
        uint256 held;
        for (uint256 i; i < 4; ++i) {
            held += wmon.balanceOf(handler.actors(i));
        }
        assertEq(held + wmon.balanceOf(treasury), wmon.totalSupply());
    }

    function invariant_N2_nonceSettlesAtMostOnce() public view {
        assertFalse(handler.nonceSettledTwice());
        assertFalse(handler.invalidatedNonceSettled());
    }

    function invariant_N2_settledNoncesAreMarkedUsed() public view {
        for (uint256 i; i < 4; ++i) {
            address a = handler.actors(i);
            for (uint256 n; n < handler.NONCE_RANGE(); ++n) {
                if (handler.settledNonce(a, n) || handler.invalidatedNonce(a, n)) {
                    assertTrue(swap.isNonceUsed(a, n));
                }
            }
        }
    }

    function invariant_N5_nothingSettlesAfterItsDeadline() public view {
        assertFalse(handler.settledAfterDeadline());
    }

    function afterInvariant() public view {
        console2.log("settlement attempts / successes:", handler.attempts(), handler.settlements());
    }
}
