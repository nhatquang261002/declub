// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealIntents} from "../../../src/OnDealIntents.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {LyingNft, SoftNft} from "../../utils/WeirdTokens.sol";
import {HostileHandler} from "./HostileHandler.sol";

/// @dev N1, N3 and N4 against hostile collections (see HostileHandler): however signed gives of
///      ids the maker doesn't own (the receiver's own included), NFTs that never move and
///      type-confused assets are mixed in with honest pairs and rings, the contract holds
///      nothing, no USDC is created or destroyed, no hostile cycle settles and every honest one
///      does, paying each maker what the cycle says.
contract OnDealIntentsHostileInvariantTest is Test {
    OnDealIntents internal swap;
    SoftNft internal soft;
    LyingNft internal liar;
    MockERC20 internal usdc;
    HostileHandler internal handler;

    function setUp() public {
        // No fee: the fee has its own suites, and here it would only add noise.
        swap = new OnDealIntents(address(0), 0, 0, address(0), address(0));
        soft = new SoftNft();
        liar = new LyingNft();
        usdc = new MockERC20("USD Coin", "USDC");
        handler = new HostileHandler(swap, soft, liar, usdc);
        targetContract(address(handler));
    }

    /// N1: the contract never holds a `soft` id, a `liar` id or USDC.
    function invariant_holdsNothing() public view {
        for (uint256 id = 1; id <= handler.softCount(); ++id) {
            assertTrue(soft.ownerOf(id) != address(swap), "soft id held");
        }
        for (uint256 a; a < 4; ++a) {
            assertEq(liar.ownerOf(handler.LIAR_BASE() + a), handler.actors(a), "liar id moved");
        }
        assertEq(usdc.balanceOf(address(swap)), 0, "usdc held");
    }

    /// Conservation: the four makers still hold all the USDC there is.
    function invariant_usdcIsConserved() public view {
        uint256 sum;
        for (uint256 a; a < 4; ++a) {
            sum += usdc.balanceOf(handler.actors(a));
        }
        assertEq(sum, 4 * handler.START_USDC());
        assertEq(usdc.totalSupply(), sum);
    }

    function invariant_hostileCyclesNeverSettle() public view {
        assertEq(handler.ghost_hostileSettled(), 0, "hostile cycle settled");
        assertEq(handler.ghost_validReverted(), 0, "honest cycle reverted");
        assertEq(handler.ghost_badSettlement(), 0, "bad settlement");
    }

    function invariant_callSummary() public {
        emit log_named_uint("pair", handler.calls("pair"));
        emit log_named_uint("ring", handler.calls("ring"));
        emit log_named_uint("refused", handler.calls("refused"));
    }
}
