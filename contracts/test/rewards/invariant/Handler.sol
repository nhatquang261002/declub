// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubRewards} from "../../../src/DeClubRewards.sol";
import {IDeClubRewards} from "../../../src/interfaces/IDeClubRewards.sol";

/// @dev Publishes, claims, revokes and sweeps epochs at random, over four Holders, and keeps
///      its own books to check the contract's. Some roots are underfunded on purpose, the way a
///      buggy builder would publish them.
contract RewardsHandler is Test {
    uint256 internal constant HOLDERS = 4;

    DeClubRewards public immutable REWARDS;
    address public immutable OPERATOR;

    address[HOLDERS] public holders;
    uint64[] public epochList;
    mapping(uint64 epoch => uint256[HOLDERS]) internal amounts;
    mapping(uint64 epoch => bool) public published;

    /// @dev What each epoch should still hold, by the handler's own count.
    mapping(uint64 epoch => uint256) public ghost_left;
    mapping(uint64 epoch => mapping(address => uint256)) public ghost_paidTimes;
    uint256 public ghost_received; // every wei a Holder got
    uint256 public ghost_funded; // every wei that went in and stayed in (net of refunds)
    uint256 public ghost_swept;

    /// @dev Every time the contract did something the handler's books say it shouldn't. Counted
    ///      rather than asserted: an assert here would revert the call, and with
    ///      `fail_on_revert = false` the fuzzer would just drop it, bad state and all.
    uint256 public ghost_violations;
    string public lastViolation;

    uint256 public calls_publish;
    uint256 public calls_claim;
    uint256 public calls_revoke;
    uint256 public calls_sweep;

    constructor(DeClubRewards rewards, address operator) {
        REWARDS = rewards;
        OPERATOR = operator;
        for (uint256 i; i < HOLDERS; ++i) {
            holders[i] = address(uint160(0xA11CE + i));
        }
    }

    function epochCount() external view returns (uint256) {
        return epochList.length;
    }

    // ───────────────────────────────────────────── actions

    function publish(uint256 seed, bool underfund) external {
        uint64 epoch = uint64(epochList.length + 1);
        uint256 total;
        bytes32[] memory leaves = new bytes32[](HOLDERS);
        for (uint256 i; i < HOLDERS; ++i) {
            uint256 a = bound(uint256(keccak256(abi.encode(seed, i))), 1, 5 ether);
            amounts[epoch][i] = a;
            total += a;
            leaves[i] = REWARDS.leaf(epoch, holders[i], a);
        }
        uint256 funding = underfund ? total / 2 : total;
        (bytes32 root,) = _tree(leaves, 0);
        vm.deal(OPERATOR, funding);
        vm.prank(OPERATOR);
        REWARDS.publish{value: funding}(epoch, root);

        epochList.push(epoch);
        published[epoch] = true;
        ghost_left[epoch] = funding;
        ghost_funded += funding;
        ++calls_publish;
    }

    function claim(uint256 epochSeed, uint256 holderSeed) external {
        if (epochList.length == 0) return;
        uint64 epoch = epochList[bound(epochSeed, 0, epochList.length - 1)];
        uint256 h = bound(holderSeed, 0, HOLDERS - 1);
        address account = holders[h];
        uint256 amount = amounts[epoch][h];
        bytes32[] memory proof = _proofFor(epoch, h);

        IDeClubRewards.Epoch memory e = REWARDS.epochs(epoch);
        bool ok = published[epoch] && !e.closed && block.timestamp >= e.openAt
            && !REWARDS.isClaimed(epoch, account) && amount <= ghost_left[epoch];

        uint256 before = account.balance;
        try REWARDS.claim(epoch, account, amount, proof) {
            _expect(ok, "a claim that should fail went through");
            _expect(account.balance - before == amount, "paid the wrong amount");
            // Saturating, so an over-claim is recorded above rather than reverting this call.
            ghost_left[epoch] = amount > ghost_left[epoch] ? 0 : ghost_left[epoch] - amount;
            ghost_received += amount;
            ++ghost_paidTimes[epoch][account];
            ++calls_claim;
        } catch {
            _expect(!ok, "a valid claim reverted");
        }
    }

    function revoke(uint256 epochSeed) external {
        if (epochList.length == 0) return;
        uint64 epoch = epochList[bound(epochSeed, 0, epochList.length - 1)];
        IDeClubRewards.Epoch memory e = REWARDS.epochs(epoch);
        bool ok = published[epoch] && block.timestamp < e.openAt;
        uint256 before = OPERATOR.balance;
        vm.prank(OPERATOR);
        try REWARDS.revoke(epoch) {
            _expect(ok, "a late revoke went through");
            _expect(
                OPERATOR.balance - before == ghost_left[epoch], "revoke refunded the wrong amount"
            );
            ghost_funded -= ghost_left[epoch];
            ghost_left[epoch] = 0;
            published[epoch] = false;
            ++calls_revoke;
        } catch {
            _expect(!ok, "a valid revoke reverted");
        }
    }

    function sweep(uint256 epochSeed) external {
        if (epochList.length == 0) return;
        uint64 epoch = epochList[bound(epochSeed, 0, epochList.length - 1)];
        IDeClubRewards.Epoch memory e = REWARDS.epochs(epoch);
        bool ok = published[epoch] && !e.closed
            && block.timestamp >= uint256(e.openAt) + REWARDS.CLAIM_WINDOW();
        uint256 before = OPERATOR.balance;
        vm.prank(OPERATOR);
        try REWARDS.sweep(epoch) {
            _expect(ok, "an early sweep went through");
            _expect(OPERATOR.balance - before == ghost_left[epoch], "swept the wrong amount");
            ghost_swept += ghost_left[epoch];
            ghost_left[epoch] = 0;
            ++calls_sweep;
        } catch {
            _expect(!ok, "a valid sweep reverted");
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 40 days));
    }

    function _expect(bool fine, string memory what) internal {
        if (fine) return;
        ++ghost_violations;
        lastViolation = what;
    }

    // ───────────────────────────────────────────── merkle

    function _proofFor(uint64 epoch, uint256 h) internal view returns (bytes32[] memory proof) {
        bytes32[] memory leaves = new bytes32[](HOLDERS);
        for (uint256 i; i < HOLDERS; ++i) {
            leaves[i] = REWARDS.leaf(epoch, holders[i], amounts[epoch][i]);
        }
        (, proof) = _tree(leaves, h);
    }

    /// @dev Root of a sorted-pair tree, and the proof for leaf `at`.
    function _tree(bytes32[] memory level, uint256 at)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        proof = new bytes32[](0);
        uint256 idx = at;
        while (level.length > 1) {
            bytes32[] memory up = new bytes32[]((level.length + 1) / 2);
            for (uint256 i; i < level.length; i += 2) {
                if (i + 1 == level.length) {
                    up[i / 2] = level[i];
                    continue;
                }
                if (idx == i || idx == i + 1) proof = _push(proof, level[idx == i ? i + 1 : i]);
                (bytes32 a, bytes32 b) =
                    level[i] <= level[i + 1] ? (level[i], level[i + 1]) : (level[i + 1], level[i]);
                up[i / 2] = keccak256(abi.encodePacked(a, b));
            }
            idx /= 2;
            level = up;
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
