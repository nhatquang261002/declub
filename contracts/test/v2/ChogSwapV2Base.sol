// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogSwapV2} from "../../src/ChogSwapV2.sol";
import {IChogSwapV2} from "../../src/interfaces/IChogSwapV2.sol";
import {MockChog} from "../../src/mocks/MockChog.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @dev Fixture: alice owns Chogs 1–5, bob 6–10, carol 11–15. Each also holds START_MON MON and
///      START_TOKEN of `usdc` and `weth`, and approves the swap for everything.
abstract contract ChogSwapV2Base is Test {
    uint256 internal constant START_MON = 100 ether;
    uint256 internal constant START_TOKEN = 1_000 ether;

    MockChog internal chog;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    ChogSwapV2 internal swap;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant A1 = 1;
    uint256 internal constant A2 = 2;
    uint256 internal constant B1 = 6;
    uint256 internal constant B2 = 7;
    uint256 internal constant C1 = 11;

    function setUp() public virtual {
        chog = new MockChog();
        usdc = new MockERC20("USD Coin", "USDC");
        weth = new MockERC20("Wrapped Ether", "WETH");
        swap = new ChogSwapV2();

        _onboard(alice);
        _onboard(bob);
        _onboard(carol);
    }

    function _onboard(address who) internal {
        chog.mint(who, 5);
        usdc.mint(who, START_TOKEN);
        weth.mint(who, START_TOKEN);
        vm.deal(who, START_MON);
        vm.startPrank(who);
        chog.setApprovalForAll(address(swap), true);
        usdc.approve(address(swap), type(uint256).max);
        weth.approve(address(swap), type(uint256).max);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────── asset builders

    function _native(uint256 amount) internal pure returns (IChogSwapV2.Asset memory) {
        return IChogSwapV2.Asset(IChogSwapV2.AssetType.Native, address(0), 0, amount);
    }

    function _erc20(address token, uint256 amount)
        internal
        pure
        returns (IChogSwapV2.Asset memory)
    {
        return IChogSwapV2.Asset(IChogSwapV2.AssetType.ERC20, token, 0, amount);
    }

    function _nft(address token, uint256 id) internal pure returns (IChogSwapV2.Asset memory) {
        return IChogSwapV2.Asset(IChogSwapV2.AssetType.ERC721, token, id, 1);
    }

    function _chog(uint256 id) internal view returns (IChogSwapV2.Asset memory) {
        return _nft(address(chog), id);
    }

    function _list(IChogSwapV2.Asset memory a)
        internal
        pure
        returns (IChogSwapV2.Asset[] memory r)
    {
        r = new IChogSwapV2.Asset[](1);
        r[0] = a;
    }

    function _list(IChogSwapV2.Asset memory a, IChogSwapV2.Asset memory b)
        internal
        pure
        returns (IChogSwapV2.Asset[] memory r)
    {
        r = new IChogSwapV2.Asset[](2);
        (r[0], r[1]) = (a, b);
    }

    function _list(
        IChogSwapV2.Asset memory a,
        IChogSwapV2.Asset memory b,
        IChogSwapV2.Asset memory c
    ) internal pure returns (IChogSwapV2.Asset[] memory r) {
        r = new IChogSwapV2.Asset[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    /// @dev `count` distinct Chogs starting at `from`.
    function _chogs(uint256 from, uint256 count)
        internal
        view
        returns (IChogSwapV2.Asset[] memory r)
    {
        r = new IChogSwapV2.Asset[](count);
        for (uint256 i; i < count; ++i) {
            r[i] = _chog(from + i);
        }
    }

    // ─────────────────────────────────────────────── trade helpers

    /// @dev `maker` opens a public, no-expiry trade. Native in `offered` is sent as msg.value.
    function _create(
        address maker,
        IChogSwapV2.Asset[] memory offered,
        IChogSwapV2.Asset[] memory requested
    ) internal returns (uint256) {
        return _create(maker, offered, requested, address(0), 0);
    }

    function _create(
        address maker,
        IChogSwapV2.Asset[] memory offered,
        IChogSwapV2.Asset[] memory requested,
        address taker,
        uint64 expiry
    ) internal returns (uint256 id) {
        vm.prank(maker);
        id = swap.createTrade{value: _nativeOf(offered)}(offered, requested, taker, expiry);
    }

    function _fill(address taker, uint256 id) internal {
        uint256 value = _nativeOf(swap.getTrade(id).requested);
        vm.prank(taker);
        swap.fillTrade{value: value}(id);
    }

    function _nativeOf(IChogSwapV2.Asset[] memory assets) internal pure returns (uint256 sum) {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].assetType == IChogSwapV2.AssetType.Native) sum += assets[i].amount;
        }
    }

    function _status(uint256 id) internal view returns (IChogSwapV2.Status) {
        return swap.getTrade(id).status;
    }

    function _assertOwner(uint256 tokenId, address expected) internal view {
        assertEq(chog.ownerOf(tokenId), expected, "unexpected Chog owner");
    }
}
