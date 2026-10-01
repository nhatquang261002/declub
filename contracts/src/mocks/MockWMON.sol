// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWMON: testnet / test-only wrapped MON
/// @notice The same shape as WETH9 (`deposit`, `withdraw`, a `receive` that deposits), so the
///         app's "wrap MON" step and the intents fee (docs/adr/0015-protocol-fee.md) can be
///         exercised on a network that has no canonical WMON. 18 decimals, 1:1 with MON.
contract MockWMON is ERC20 {
    event Deposit(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    error WithdrawFailed();

    constructor() ERC20("Wrapped MON", "WMON") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        emit Withdrawal(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
    }
}
