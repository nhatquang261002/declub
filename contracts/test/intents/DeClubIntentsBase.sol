// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubIntents} from "../../src/DeClubIntents.sol";
import {IDeClubIntents} from "../../src/interfaces/IDeClubIntents.sol";
import {MockChog} from "../../src/mocks/MockChog.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @dev Fixture: alice owns Chogs 1–5, bob 6–10, carol 11–15, dave 16–20. Each also holds
///      START_TOKEN of `usdc`, `weth` and `wmon` (the fee token), and approves the contract for
///      everything. Each has a signing key (`aliceKey`, …) so tests can sign real EIP-712 intents.
///      The contract is deployed with no protocol fee, so a test reads as the plain settlement;
///      the fee suite (`DeClubIntents.fee.t.sol`) overrides `_feeAmount`. Intents always carry
///      the contract's own fee token and its current fee as `maxFee`, so they are valid either
///      way. `feeAdmin` may change the fee up to `_maxFee`.
abstract contract DeClubIntentsBase is Test {
    uint256 internal constant START_TOKEN = 1_000 ether;

    MockChog internal chog;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockERC20 internal wmon;
    DeClubIntents internal swap;
    address internal treasury = makeAddr("treasury");
    address internal feeAdmin = makeAddr("feeAdmin");

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
        wmon = new MockERC20("Wrapped MON", "WMON");
        swap = new DeClubIntents(address(wmon), _feeAmount(), _maxFee(), treasury, feeAdmin);

        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        (carol, carolKey) = makeAddrAndKey("carol");
        (dave, daveKey) = makeAddrAndKey("dave");

        _onboard(alice);
        _onboard(bob);
        _onboard(carol);
        _onboard(dave);
    }

    /// @dev What each maker pays per settlement. 0 unless a suite overrides it.
    function _feeAmount() internal view virtual returns (uint256) {
        return 0;
    }

    /// @dev The ceiling the fixture deploys with.
    function _maxFee() internal view virtual returns (uint256) {
        return 4 * _feeAmount();
    }

    function _onboard(address who) internal {
        chog.mint(who, 5);
        usdc.mint(who, START_TOKEN);
        weth.mint(who, START_TOKEN);
        wmon.mint(who, START_TOKEN);
        vm.startPrank(who);
        chog.setApprovalForAll(address(swap), true);
        usdc.approve(address(swap), type(uint256).max);
        weth.approve(address(swap), type(uint256).max);
        wmon.approve(address(swap), type(uint256).max);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────── asset builders

    function _erc20(address token, uint256 amount)
        internal
        pure
        returns (IDeClubIntents.Asset memory)
    {
        return IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC20, token, 0, amount);
    }

    function _nft(address token, uint256 id) internal pure returns (IDeClubIntents.Asset memory) {
        return IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC721, token, id, 1);
    }

    function _chog(uint256 id) internal view returns (IDeClubIntents.Asset memory) {
        return _nft(address(chog), id);
    }

    function _list(IDeClubIntents.Asset memory a)
        internal
        pure
        returns (IDeClubIntents.Asset[] memory r)
    {
        r = new IDeClubIntents.Asset[](1);
        r[0] = a;
    }

    function _list(IDeClubIntents.Asset memory a, IDeClubIntents.Asset memory b)
        internal
        pure
        returns (IDeClubIntents.Asset[] memory r)
    {
        r = new IDeClubIntents.Asset[](2);
        (r[0], r[1]) = (a, b);
    }

    /// @dev `count` distinct Chogs starting at `from`.
    function _chogs(uint256 from, uint256 count)
        internal
        view
        returns (IDeClubIntents.Asset[] memory r)
    {
        r = new IDeClubIntents.Asset[](count);
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
        IDeClubIntents.Asset[] memory give,
        IDeClubIntents.Asset[] memory want,
        uint256 nonce
    ) internal view returns (IDeClubIntents.Intent memory) {
        return IDeClubIntents.Intent(
            maker, give, want, swap.FEE_TOKEN(), swap.fee(), _deadline(), nonce
        );
    }

    function _sign(uint256 key, IDeClubIntents.Intent memory it)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, swap.intentDigest(it));
        return abi.encodePacked(r, s, v);
    }

    function _cycle2(IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b)
        internal
        pure
        returns (IDeClubIntents.Intent[] memory r)
    {
        r = new IDeClubIntents.Intent[](2);
        (r[0], r[1]) = (a, b);
    }

    function _cycle3(
        IDeClubIntents.Intent memory a,
        IDeClubIntents.Intent memory b,
        IDeClubIntents.Intent memory c
    ) internal pure returns (IDeClubIntents.Intent[] memory r) {
        r = new IDeClubIntents.Intent[](3);
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
    function _signAll(IDeClubIntents.Intent[] memory cycle, uint256[] memory keys)
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
        returns (IDeClubIntents.Intent[] memory cycle, bytes[] memory sigs)
    {
        IDeClubIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), aliceWants)), nonceA);
        IDeClubIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), bobGives)), _list(_chog(A1)), nonceB);
        cycle = _cycle2(a, b);
        sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
    }

    function _assertOwner(uint256 id, address who) internal view {
        assertEq(chog.ownerOf(id), who);
    }
}
