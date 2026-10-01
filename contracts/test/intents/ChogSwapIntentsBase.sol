// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogSwapIntents} from "../../src/ChogSwapIntents.sol";
import {IChogSwapIntents} from "../../src/interfaces/IChogSwapIntents.sol";
import {MockChog} from "../../src/mocks/MockChog.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @dev Fixture: alice owns Chogs 1–5, bob 6–10, carol 11–15, dave 16–20. Each also holds
///      START_TOKEN of `usdc` and `weth`, and approves the contract for everything. Each has a
///      signing key (`aliceKey`, …) so tests can sign real EIP-712 intents.
abstract contract ChogSwapIntentsBase is Test {
    uint256 internal constant START_TOKEN = 1_000 ether;

    MockChog internal chog;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    ChogSwapIntents internal swap;

    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;
    uint256 internal aliceKey;
    uint256 internal bobKey;
    uint256 internal carolKey;
    uint256 internal daveKey;

    uint256 internal constant A1 = 1;
    uint256 internal constant A2 = 2;
    uint256 internal constant B1 = 6;
    uint256 internal constant B2 = 7;
    uint256 internal constant C1 = 11;
    uint256 internal constant D1 = 16;

    function setUp() public virtual {
        chog = new MockChog();
        usdc = new MockERC20("USD Coin", "USDC");
        weth = new MockERC20("Wrapped Ether", "WETH");
        swap = new ChogSwapIntents();

        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        (carol, carolKey) = makeAddrAndKey("carol");
        (dave, daveKey) = makeAddrAndKey("dave");

        _onboard(alice);
        _onboard(bob);
        _onboard(carol);
        _onboard(dave);
    }

    function _onboard(address who) internal {
        chog.mint(who, 5);
        usdc.mint(who, START_TOKEN);
        weth.mint(who, START_TOKEN);
        vm.startPrank(who);
        chog.setApprovalForAll(address(swap), true);
        usdc.approve(address(swap), type(uint256).max);
        weth.approve(address(swap), type(uint256).max);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────── asset builders

    function _erc20(address token, uint256 amount)
        internal
        pure
        returns (IChogSwapIntents.Asset memory)
    {
        return IChogSwapIntents.Asset(IChogSwapIntents.AssetType.ERC20, token, 0, amount);
    }

    function _nft(address token, uint256 id) internal pure returns (IChogSwapIntents.Asset memory) {
        return IChogSwapIntents.Asset(IChogSwapIntents.AssetType.ERC721, token, id, 1);
    }

    function _chog(uint256 id) internal view returns (IChogSwapIntents.Asset memory) {
        return _nft(address(chog), id);
    }

    function _list(IChogSwapIntents.Asset memory a)
        internal
        pure
        returns (IChogSwapIntents.Asset[] memory r)
    {
        r = new IChogSwapIntents.Asset[](1);
        r[0] = a;
    }

    function _list(IChogSwapIntents.Asset memory a, IChogSwapIntents.Asset memory b)
        internal
        pure
        returns (IChogSwapIntents.Asset[] memory r)
    {
        r = new IChogSwapIntents.Asset[](2);
        (r[0], r[1]) = (a, b);
    }

    /// @dev `count` distinct Chogs starting at `from`.
    function _chogs(uint256 from, uint256 count)
        internal
        view
        returns (IChogSwapIntents.Asset[] memory r)
    {
        r = new IChogSwapIntents.Asset[](count);
        for (uint256 i; i < count; ++i) {
            r[i] = _chog(from + i);
        }
    }

    // ─────────────────────────────────────────────── intents and signing

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    function _intent(
        address maker,
        IChogSwapIntents.Asset[] memory give,
        IChogSwapIntents.Asset[] memory want,
        uint256 nonce
    ) internal view returns (IChogSwapIntents.Intent memory) {
        return IChogSwapIntents.Intent(maker, give, want, _deadline(), nonce);
    }

    function _sign(uint256 key, IChogSwapIntents.Intent memory it)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, swap.intentDigest(it));
        return abi.encodePacked(r, s, v);
    }

    function _cycle2(IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b)
        internal
        pure
        returns (IChogSwapIntents.Intent[] memory r)
    {
        r = new IChogSwapIntents.Intent[](2);
        (r[0], r[1]) = (a, b);
    }

    function _cycle3(
        IChogSwapIntents.Intent memory a,
        IChogSwapIntents.Intent memory b,
        IChogSwapIntents.Intent memory c
    ) internal pure returns (IChogSwapIntents.Intent[] memory r) {
        r = new IChogSwapIntents.Intent[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function _sigs2(bytes memory a, bytes memory b) internal pure returns (bytes[] memory r) {
        r = new bytes[](2);
        (r[0], r[1]) = (a, b);
    }

    function _sigs3(bytes memory a, bytes memory b, bytes memory c)
        internal
        pure
        returns (bytes[] memory r)
    {
        r = new bytes[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    /// @dev Sign each intent with the key at the same index, then submit as `settler`.
    function _signAll(IChogSwapIntents.Intent[] memory cycle, uint256[] memory keys)
        internal
        view
        returns (bytes[] memory sigs)
    {
        sigs = new bytes[](cycle.length);
        for (uint256 i; i < cycle.length; ++i) {
            sigs[i] = _sign(keys[i], cycle[i]);
        }
    }

    /// @dev Alice gives her Chog A1 for 100 of bob's USDC (alice wants at least `aliceWants`).
    function _chogForUsdc(uint256 aliceWants, uint256 bobGives, uint256 nonceA, uint256 nonceB)
        internal
        view
        returns (IChogSwapIntents.Intent[] memory cycle, bytes[] memory sigs)
    {
        IChogSwapIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), aliceWants)), nonceA);
        IChogSwapIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), bobGives)), _list(_chog(A1)), nonceB);
        cycle = _cycle2(a, b);
        sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
    }

    function _assertOwner(uint256 id, address who) internal view {
        assertEq(chog.ownerOf(id), who);
    }
}
