// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealV2} from "../../src/OnDealV2.sol";
import {IOnDealV2} from "../../src/interfaces/IOnDealV2.sol";
import {MockChog} from "../../src/mocks/MockChog.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @dev Fixture: alice owns Chogs 1–5, bob 6–10, carol 11–15. Each also holds START_MON MON and
///      START_TOKEN of `usdc` and `weth`, and approves the swap for everything.
///      The swap is deployed with no protocol fee, so a test reads as the plain deal; the
///      fee suite (`OnDealV2.fee.t.sol`) overrides `_fee` and the invariants run with one.
///      Every helper that sends native MON adds `swap.FEE()`, so it works either way.
abstract contract OnDealV2Base is Test {
    uint256 internal constant START_MON = 100 ether;
    uint256 internal constant START_TOKEN = 1_000 ether;

    MockChog internal chog;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    OnDealV2 internal swap;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal treasury = makeAddr("treasury");

    uint256 internal constant A1 = 1;
    uint256 internal constant A2 = 2;
    uint256 internal constant B1 = 6;
    uint256 internal constant B2 = 7;
    uint256 internal constant C1 = 11;

    function setUp() public virtual {
        chog = new MockChog();
        usdc = new MockERC20("USD Coin", "USDC");
        weth = new MockERC20("Wrapped Ether", "WETH");
        swap = new OnDealV2(_fee(), treasury);

        _onboard(alice);
        _onboard(bob);
        _onboard(carol);
    }

    /// @dev The per-side protocol fee the fixture deploys with. 0 unless a suite overrides it.
    function _fee() internal view virtual returns (uint256) {
        return 0;
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

    function _native(uint256 amount) internal pure returns (IOnDealV2.Asset memory) {
        return IOnDealV2.Asset(IOnDealV2.AssetType.Native, address(0), 0, amount);
    }

    function _erc20(address token, uint256 amount)
        internal
        pure
        returns (IOnDealV2.Asset memory)
    {
        return IOnDealV2.Asset(IOnDealV2.AssetType.ERC20, token, 0, amount);
    }

    function _nft(address token, uint256 id) internal pure returns (IOnDealV2.Asset memory) {
        return IOnDealV2.Asset(IOnDealV2.AssetType.ERC721, token, id, 1);
    }

    function _chog(uint256 id) internal view returns (IOnDealV2.Asset memory) {
        return _nft(address(chog), id);
    }

    function _list(IOnDealV2.Asset memory a)
        internal
        pure
        returns (IOnDealV2.Asset[] memory r)
    {
        r = new IOnDealV2.Asset[](1);
        r[0] = a;
    }

    function _list(IOnDealV2.Asset memory a, IOnDealV2.Asset memory b)
        internal
        pure
        returns (IOnDealV2.Asset[] memory r)
    {
        r = new IOnDealV2.Asset[](2);
        (r[0], r[1]) = (a, b);
    }

    function _list(
        IOnDealV2.Asset memory a,
        IOnDealV2.Asset memory b,
        IOnDealV2.Asset memory c
    ) internal pure returns (IOnDealV2.Asset[] memory r) {
        r = new IOnDealV2.Asset[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    /// @dev `count` distinct Chogs starting at `from`.
    function _chogs(uint256 from, uint256 count)
        internal
        view
        returns (IOnDealV2.Asset[] memory r)
    {
        r = new IOnDealV2.Asset[](count);
        for (uint256 i; i < count; ++i) {
            r[i] = _chog(from + i);
        }
    }

    // ─────────────────────────────────────────────── trade helpers

    /// @dev `maker` opens a public, no-expiry trade. Native in `offered` is sent as msg.value.
    function _create(
        address maker,
        IOnDealV2.Asset[] memory offered,
        IOnDealV2.Asset[] memory requested
    ) internal returns (uint256) {
        return _create(maker, offered, requested, address(0), 0);
    }

    function _create(
        address maker,
        IOnDealV2.Asset[] memory offered,
        IOnDealV2.Asset[] memory requested,
        address taker,
        uint64 expiry
    ) internal returns (uint256 id) {
        // Read the value before the prank: any call, even a view, would spend it.
        uint256 value = _nativeOf(offered) + swap.FEE();
        vm.prank(maker);
        id = swap.createTrade{value: value}(offered, requested, taker, expiry);
    }

    /// @dev `maker` opens a public, no-expiry open offer with `note`.
    function _openOffer(address maker, IOnDealV2.Asset[] memory offered, string memory note)
        internal
        returns (uint256)
    {
        return _openOffer(maker, offered, note, address(0), 0);
    }

    function _openOffer(
        address maker,
        IOnDealV2.Asset[] memory offered,
        string memory note,
        address taker,
        uint64 expiry
    ) internal returns (uint256 id) {
        uint256 value = _nativeOf(offered) + swap.FEE();
        vm.prank(maker);
        id = swap.createOpenOffer{value: value}(offered, taker, expiry, note);
    }

    function _propose(address who, uint256 id, IOnDealV2.Asset[] memory assets)
        internal
        returns (uint256 proposalId)
    {
        uint256 value = _nativeOf(assets) + swap.FEE();
        vm.prank(who);
        proposalId = swap.propose{value: value}(id, assets);
    }

    function _fill(address taker, uint256 id) internal {
        uint256 value = _nativeOf(swap.getTrade(id).requested) + swap.FEE();
        vm.prank(taker);
        swap.fillTrade{value: value}(id);
    }

    function _nativeOf(IOnDealV2.Asset[] memory assets) internal pure returns (uint256 sum) {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].assetType == IOnDealV2.AssetType.Native) sum += assets[i].amount;
        }
    }

    function _status(uint256 id) internal view returns (IOnDealV2.Status) {
        return swap.getTrade(id).status;
    }

    function _assertOwner(uint256 tokenId, address expected) internal view {
        assertEq(chog.ownerOf(tokenId), expected, "unexpected Chog owner");
    }
}
