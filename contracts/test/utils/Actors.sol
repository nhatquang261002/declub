// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev A contract account whose MON acceptance can be toggled.
contract MonReceiver {
    bool public accept;

    function setAccept(bool accept_) external {
        accept = accept_;
    }

    receive() external payable {
        require(accept, "MonReceiver: rejected");
    }
}

/// @dev On receiving MON, re-enters `target` with `payload` and records the revert data.
///      Always accepts the MON itself, so the outer call's behaviour isn't affected by the
///      re-entry attempt, only by the guard.
contract ReentrantReceiver {
    address public target;
    bytes public payload;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryRevertData;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    receive() external payable {
        if (attempted || target == address(0)) return;
        attempted = true;
        (bool ok, bytes memory data) = target.call(payload);
        reentrySucceeded = ok;
        reentryRevertData = data;
    }
}
