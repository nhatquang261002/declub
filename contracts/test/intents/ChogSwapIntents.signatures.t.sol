// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IChogSwapIntents} from "../../src/interfaces/IChogSwapIntents.sol";
import {ChogSwapIntents} from "../../src/ChogSwapIntents.sol";
import {ChogSwapIntentsBase} from "./ChogSwapIntentsBase.sol";

/// @dev A minimal ERC-1271 smart wallet owned by an EOA key.
contract Mock1271Wallet {
    address public immutable OWNER;
    bool public reject;

    constructor(address owner_) {
        OWNER = owner_;
    }

    function setReject(bool value) external {
        reject = value;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (reject) return 0xffffffff;
        return ECDSA.recover(hash, signature) == OWNER ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function exec(address target, bytes calldata data) external {
        require(msg.sender == OWNER, "owner only");
        (bool ok,) = target.call(data);
        require(ok, "exec failed");
    }
}

contract ChogSwapIntentsSignaturesTest is ChogSwapIntentsBase {
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _pair()
        internal
        view
        returns (IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b)
    {
        a = _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 100 ether)), 0);
        b = _intent(bob, _list(_erc20(address(usdc), 100 ether)), _list(_chog(A1)), 0);
    }

    // ───────────────────────────────────────────── EIP-712 conformance

    /// @dev Recompute the digest from the spec, independently of the contract's code.
    function test_digestMatchesTheEip712Spec() public view {
        (IChogSwapIntents.Intent memory a,) = _pair();

        bytes32 assetType =
            keccak256("Asset(uint8 assetType,address token,uint256 id,uint256 amount)");
        bytes32 intentType = keccak256(
            "Intent(address maker,Asset[] give,Asset[] want,address feeToken,uint256 fee,uint64 deadline,uint256 nonce)"
            "Asset(uint8 assetType,address token,uint256 id,uint256 amount)"
        );
        bytes32 giveHash = keccak256(
            abi.encodePacked(
                keccak256(abi.encode(assetType, uint8(2), address(chog), A1, uint256(1)))
            )
        );
        bytes32 wantHash = keccak256(
            abi.encodePacked(
                keccak256(abi.encode(assetType, uint8(1), address(usdc), uint256(0), 100 ether))
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                intentType,
                alice,
                giveHash,
                wantHash,
                swap.FEE_TOKEN(),
                swap.FEE_AMOUNT(),
                a.deadline,
                uint256(0)
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ChogSwapIntents"),
                keccak256("2"),
                block.chainid,
                address(swap)
            )
        );

        assertEq(swap.hashIntent(a), structHash);
        assertEq(swap.DOMAIN_SEPARATOR(), domainSeparator);
        assertEq(
            swap.intentDigest(a),
            keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
        );
    }

    function test_digestCoversEveryField() public view {
        (IChogSwapIntents.Intent memory a,) = _pair();
        bytes32 base = swap.intentDigest(a);

        IChogSwapIntents.Intent memory x = _copy(a);
        x.maker = bob;
        assertTrue(swap.intentDigest(x) != base);

        x = _copy(a);
        x.deadline += 1;
        assertTrue(swap.intentDigest(x) != base);

        x = _copy(a);
        x.nonce = 1;
        assertTrue(swap.intentDigest(x) != base);

        x = _copy(a);
        x.feeToken = address(usdc);
        assertTrue(swap.intentDigest(x) != base);

        x = _copy(a);
        x.fee += 1;
        assertTrue(swap.intentDigest(x) != base);

        x = _copy(a);
        x.give = _list(_chog(A2));
        assertTrue(swap.intentDigest(x) != base);

        x = _copy(a);
        x.want = _list(_erc20(address(usdc), 101 ether));
        assertTrue(swap.intentDigest(x) != base);
    }

    function _copy(IChogSwapIntents.Intent memory a)
        internal
        pure
        returns (IChogSwapIntents.Intent memory)
    {
        return IChogSwapIntents.Intent(
            a.maker, a.give, a.want, a.feeToken, a.fee, a.deadline, a.nonce
        );
    }

    // ───────────────────────────────────────────── bad signatures

    function test_revertsWhenSignedByTheWrongKey() public {
        (IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b) = _pair();
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(carolKey, a), _sign(bobKey, b));

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 0));
        swap.settle(cycle, sigs);
    }

    function test_revertsWhenTermsChangeAfterSigning() public {
        (IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b) = _pair();
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
        b.give = _list(_erc20(address(usdc), 101 ether)); // bob's terms edited

        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 1));
        swap.settle(cycle, sigs);
    }

    function test_revertsOnEmptyOrGarbageSignature() public {
        (IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b) = _pair();
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes memory goodA = _sign(aliceKey, a);
        bytes memory goodB = _sign(bobKey, b);

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 0));
        swap.settle(cycle, _sigs2("", goodB));

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 1));
        swap.settle(cycle, _sigs2(goodA, hex"deadbeef"));
    }

    /// @dev A signature for another deployment of the contract is worthless here.
    function test_revertsOnSignatureForAnotherContract() public {
        ChogSwapIntents other = new ChogSwapIntents(address(wmon), _feeAmount(), treasury);
        (IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b) = _pair();
        (uint8 va, bytes32 ra, bytes32 sa) = vm.sign(aliceKey, other.intentDigest(a));
        (uint8 vb, bytes32 rb, bytes32 sb) = vm.sign(bobKey, other.intentDigest(b));
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 0));
        swap.settle(cycle, _sigs2(abi.encodePacked(ra, sa, va), abi.encodePacked(rb, sb, vb)));
    }

    /// @dev A signature made on one chain can't be replayed on a fork with another chain id.
    function test_revertsOnSignatureFromAnotherChain() public {
        (IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b) = _pair();
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 0));
        swap.settle(cycle, sigs);
    }

    /// @dev The malleated twin `(r, n − s, v ^ 1)` recovers the same signer; it must be refused.
    function test_revertsOnMalleatedSignature() public {
        (IChogSwapIntents.Intent memory a, IChogSwapIntents.Intent memory b) = _pair();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, swap.intentDigest(a));
        bytes memory twin =
            abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), v == 27 ? 28 : 27);
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(twin, _sign(bobKey, b));

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 0));
        swap.settle(cycle, sigs);
    }

    // ───────────────────────────────────────────── ERC-1271 contract wallets

    function _walletMaker() internal returns (Mock1271Wallet wallet, uint256 chogId) {
        wallet = new Mock1271Wallet(alice);
        chogId = chog.mint(address(wallet), 1);
        wallet.exec(address(chog), abi.encodeCall(chog.setApprovalForAll, (address(swap), true)));
    }

    function test_contractWalletMakerSettlesViaErc1271() public {
        vm.startPrank(alice);
        (Mock1271Wallet wallet, uint256 id) = _walletMaker();
        vm.stopPrank();

        IChogSwapIntents.Intent memory a =
            _intent(address(wallet), _list(_chog(id)), _list(_erc20(address(usdc), 10 ether)), 0);
        IChogSwapIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 10 ether)), _list(_chog(id)), 0);

        swap.settle(_cycle2(a, b), _sigs2(_sign(aliceKey, a), _sign(bobKey, b)));

        _assertOwner(id, bob);
        assertEq(usdc.balanceOf(address(wallet)), 10 ether);
    }

    function test_contractWalletThatRejectsIsRefused() public {
        vm.startPrank(alice);
        (Mock1271Wallet wallet, uint256 id) = _walletMaker();
        wallet.setReject(true);
        vm.stopPrank();

        IChogSwapIntents.Intent memory a =
            _intent(address(wallet), _list(_chog(id)), _list(_erc20(address(usdc), 10 ether)), 0);
        IChogSwapIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 10 ether)), _list(_chog(id)), 0);
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 0));
        swap.settle(cycle, sigs);
    }

    function test_contractWalletSignatureFromAStrangerIsRefused() public {
        vm.startPrank(alice);
        (Mock1271Wallet wallet, uint256 id) = _walletMaker();
        vm.stopPrank();

        IChogSwapIntents.Intent memory a =
            _intent(address(wallet), _list(_chog(id)), _list(_erc20(address(usdc), 10 ether)), 0);
        IChogSwapIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 10 ether)), _list(_chog(id)), 0);
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(carolKey, a), _sign(bobKey, b));

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.BadSignature.selector, 0));
        swap.settle(cycle, sigs);
    }
}
