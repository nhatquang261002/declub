// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealIntents} from "../../../src/OnDealIntents.sol";
import {IOnDealIntents} from "../../../src/interfaces/IOnDealIntents.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";

/// @dev A smart-wallet maker that accepts any signature (ERC-1271), so the solver never has to
///      reason about `ecrecover`. Signatures have their own suite; this one is about who ends up
///      with what.
contract AnyWallet {
    function approve(address token, address spender) external {
        MockERC20(token).approve(spender, type(uint256).max);
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

/// @dev Symbolic checks for Halmos (`halmos --match-contract OnDealIntentsSymbolic`). Forge
///      skips `check_` functions. Every amount and every token choice is symbolic, so one run
///      covers every pair and every 3-ring of single-asset ERC-20 intents, in every rotation:
///      either `settle` reverts, or each maker receives at least its `want` and pays exactly its
///      `give`, and the contract keeps nothing.
contract OnDealIntentsSymbolic is Test {
    uint256 internal constant START = 1_000_000 ether; // MockERC20.MAX_MINT_PER_TX

    OnDealIntents internal swap;
    // Separate variables, not an array: Halmos can't index storage with a symbolic value.
    MockERC20 internal t0;
    MockERC20 internal t1;
    MockERC20 internal t2;
    AnyWallet[3] internal makers;

    function setUp() public {
        swap = new OnDealIntents(address(0), 0, 0, address(0), address(0));
        (t0, t1, t2) =
        (new MockERC20("T0", "T0"), new MockERC20("T1", "T1"), new MockERC20("T2", "T2"));
        for (uint256 m; m < 3; ++m) {
            makers[m] = new AnyWallet();
            for (uint8 t; t < 3; ++t) {
                _token(t).mint(address(makers[m]), START);
                makers[m].approve(address(_token(t)), address(swap));
            }
        }
    }

    function check_pairPaysEveryWant(
        uint8 give0,
        uint8 want0,
        uint8 give1,
        uint8 want1,
        uint256 g0,
        uint256 w0,
        uint256 g1,
        uint256 w1
    ) public {
        uint8[] memory gives = new uint8[](2);
        uint8[] memory wants = new uint8[](2);
        uint256[] memory g = new uint256[](2);
        uint256[] memory w = new uint256[](2);
        (gives[0], gives[1], wants[0], wants[1]) = (give0, give1, want0, want1);
        (g[0], g[1], w[0], w[1]) = (g0, g1, w0, w1);
        _check(gives, wants, g, w);
    }

    function check_ringPaysEveryWant(
        uint8 give0,
        uint8 want0,
        uint8 give1,
        uint8 want1,
        uint8 give2,
        uint8 want2,
        uint256 g0,
        uint256 w0,
        uint256 g1,
        uint256 w1,
        uint256 g2,
        uint256 w2
    ) public {
        uint8[] memory gives = new uint8[](3);
        uint8[] memory wants = new uint8[](3);
        uint256[] memory g = new uint256[](3);
        uint256[] memory w = new uint256[](3);
        (gives[0], gives[1], gives[2]) = (give0, give1, give2);
        (wants[0], wants[1], wants[2]) = (want0, want1, want2);
        (g[0], g[1], g[2]) = (g0, g1, g2);
        (w[0], w[1], w[2]) = (w0, w1, w2);
        _check(gives, wants, g, w);
    }

    function _check(
        uint8[] memory gives,
        uint8[] memory wants,
        uint256[] memory g,
        uint256[] memory w
    ) internal {
        uint256 n = gives.length;
        IOnDealIntents.Intent[] memory cycle = new IOnDealIntents.Intent[](n);
        bytes[] memory sigs = new bytes[](n);
        // before[m][t]: maker m's balance of token t.
        uint256[3][] memory before = new uint256[3][](n);
        for (uint256 m; m < n; ++m) {
            vm.assume(gives[m] < 3 && wants[m] < 3);
            vm.assume(g[m] <= START && w[m] <= START);
            cycle[m] = _intent(address(makers[m]), gives[m], g[m], wants[m], w[m], m);
            sigs[m] = "";
            for (uint8 t; t < 3; ++t) {
                before[m][t] = _token(t).balanceOf(address(makers[m]));
            }
        }

        try swap.settle(cycle, sigs) {}
        catch {
            return; // reverting is always safe
        }

        for (uint256 m; m < n; ++m) {
            address who = address(makers[m]);
            // Received at least the want.
            assertGe(
                _token(wants[m]).balanceOf(who), _pick(before[m], wants[m]) + w[m], "want not met"
            );
            // Paid exactly the give, and nothing else of that token went missing.
            uint256 received = gives[(m + n - 1) % n] == gives[m] ? g[(m + n - 1) % n] : 0;
            assertEq(
                _token(gives[m]).balanceOf(who) + g[m],
                _pick(before[m], gives[m]) + received,
                "give"
            );
        }
        for (uint8 t; t < 3; ++t) {
            assertEq(_token(t).balanceOf(address(swap)), 0, "contract kept tokens");
        }
    }

    function _intent(
        address maker,
        uint8 giveT,
        uint256 giveAmt,
        uint8 wantT,
        uint256 wantAmt,
        uint256 nonce
    ) internal view returns (IOnDealIntents.Intent memory it) {
        IOnDealIntents.Asset[] memory give = new IOnDealIntents.Asset[](1);
        IOnDealIntents.Asset[] memory want = new IOnDealIntents.Asset[](1);
        give[0] = IOnDealIntents.Asset(
            IOnDealIntents.AssetType.ERC20, address(_token(giveT)), 0, giveAmt
        );
        want[0] = IOnDealIntents.Asset(
            IOnDealIntents.AssetType.ERC20, address(_token(wantT)), 0, wantAmt
        );
        it = IOnDealIntents.Intent(
            maker, give, want, address(0), 0, uint64(block.timestamp + 1), nonce
        );
    }

    function _token(uint8 i) internal view returns (MockERC20) {
        return i == 0 ? t0 : i == 1 ? t1 : t2;
    }

    function _pick(uint256[3] memory a, uint8 i) internal pure returns (uint256) {
        return i == 0 ? a[0] : i == 1 ? a[1] : a[2];
    }
}
