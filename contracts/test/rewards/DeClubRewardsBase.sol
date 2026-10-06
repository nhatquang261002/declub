// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubRewards} from "../../src/DeClubRewards.sol";
import {IDeClubRewards} from "../../src/interfaces/IDeClubRewards.sol";

/// @dev Shared fixture for the rewards suites: an operator, three Holders, a stranger, and a
///      sorted-pair Merkle tree builder over any leaves (the same shape as web/lib/merkle.ts).
abstract contract DeClubRewardsBase is Test {
    uint256 internal constant DELAY = 1 days;
    uint256 internal constant WINDOW = 90 days;

    DeClubRewards internal rewards;

    address internal operator = makeAddr("operator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    /// @dev One epoch's leaves, as the builder publishes them.
    struct Drop {
        address[] accounts;
        uint256[] amounts;
        bytes32 root;
        bytes32[][] proofs;
        uint256 total;
    }

    function setUp() public virtual {
        rewards = new DeClubRewards(operator, _delay(), WINDOW);
        vm.deal(operator, 1_000 ether);
    }

    /// @dev Override for a suite that wants claims open at once.
    function _delay() internal pure virtual returns (uint256) {
        return DELAY;
    }

    // ───────────────────────────────────────────── drops

    function _drop(uint64 epoch, address[] memory accounts, uint256[] memory amounts)
        internal
        view
        returns (Drop memory d)
    {
        d.accounts = accounts;
        d.amounts = amounts;
        bytes32[] memory leaves = new bytes32[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            leaves[i] = rewards.leaf(epoch, accounts[i], amounts[i]);
            d.total += amounts[i];
        }
        (d.root, d.proofs) = _tree(leaves);
    }

    /// @dev Alice 3, Bob 2, Carol 1 MON.
    function _abc(uint64 epoch) internal view returns (Drop memory) {
        address[] memory accounts = new address[](3);
        (accounts[0], accounts[1], accounts[2]) = (alice, bob, carol);
        uint256[] memory amounts = new uint256[](3);
        (amounts[0], amounts[1], amounts[2]) = (3 ether, 2 ether, 1 ether);
        return _drop(epoch, accounts, amounts);
    }

    function _publish(uint64 epoch, Drop memory d) internal {
        vm.prank(operator);
        rewards.publish{value: d.total}(epoch, d.root);
    }

    /// @dev Publish and wait until claims open.
    function _open(uint64 epoch, Drop memory d) internal {
        _publish(epoch, d);
        vm.warp(block.timestamp + _delay());
    }

    function _claim(uint64 epoch, Drop memory d, uint256 i) internal {
        rewards.claim(epoch, d.accounts[i], d.amounts[i], d.proofs[i]);
    }

    // ───────────────────────────────────────────── merkle

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @dev Sorted-pair tree, an odd last node carried up as is. Returns the root and one proof
    ///      per leaf, in the order given.
    function _tree(bytes32[] memory leaves)
        internal
        pure
        returns (bytes32 root, bytes32[][] memory proofs)
    {
        uint256 n = leaves.length;
        proofs = new bytes32[][](n);
        bytes32[] memory level = new bytes32[](n);
        uint256[] memory groupStart = new uint256[](n);
        uint256[] memory groupEnd = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            level[i] = leaves[i];
            groupStart[i] = i;
            groupEnd[i] = i + 1;
            proofs[i] = new bytes32[](0);
        }
        while (level.length > 1) {
            uint256 next = (level.length + 1) / 2;
            bytes32[] memory up = new bytes32[](next);
            uint256[] memory upStart = new uint256[](next);
            uint256[] memory upEnd = new uint256[](next);
            for (uint256 i; i < level.length; i += 2) {
                if (i + 1 == level.length) {
                    up[i / 2] = level[i];
                    upStart[i / 2] = groupStart[i];
                    upEnd[i / 2] = groupEnd[i];
                    continue;
                }
                for (uint256 k = groupStart[i]; k < groupEnd[i]; ++k) {
                    proofs[k] = _push(proofs[k], level[i + 1]);
                }
                for (uint256 k = groupStart[i + 1]; k < groupEnd[i + 1]; ++k) {
                    proofs[k] = _push(proofs[k], level[i]);
                }
                up[i / 2] = _pair(level[i], level[i + 1]);
                upStart[i / 2] = groupStart[i];
                upEnd[i / 2] = groupEnd[i + 1];
            }
            level = up;
            groupStart = upStart;
            groupEnd = upEnd;
        }
        root = level[0];
    }

    function _push(bytes32[] memory a, bytes32 x) internal pure returns (bytes32[] memory r) {
        r = new bytes32[](a.length + 1);
        for (uint256 i; i < a.length; ++i) {
            r[i] = a[i];
        }
        r[a.length] = x;
    }
}

/// @dev Refuses MON, so a claim to it or a sweep to it fails.
contract MonRefuser {
    receive() external payable {
        revert("no MON");
    }
}

/// @dev Re-enters `claim` from its `receive`, to show the guard holds.
contract ReentrantClaimer {
    IDeClubRewards internal immutable REWARDS;
    uint64 internal epoch;
    uint256 internal amount;
    bytes32[] internal proof;
    bool public reentered;

    constructor(IDeClubRewards rewards) {
        REWARDS = rewards;
    }

    function arm(uint64 e, uint256 a, bytes32[] calldata p) external {
        (epoch, amount, proof) = (e, a, p);
    }

    receive() external payable {
        if (reentered) return;
        reentered = true;
        REWARDS.claim(epoch, address(this), amount, proof);
    }
}
