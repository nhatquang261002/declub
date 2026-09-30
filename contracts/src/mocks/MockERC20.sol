// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20: testnet / test-only fungible token
/// @notice Open mint, 18 decimals. Lets the generic swap be demoed without real tokens.
contract MockERC20 is ERC20 {
    uint256 public constant MAX_MINT_PER_TX = 1_000_000 ether;

    error InvalidAmount(uint256 amount);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// @notice Anyone can mint. Testnet only.
    function mint(address to, uint256 amount) external {
        if (amount == 0 || amount > MAX_MINT_PER_TX) revert InvalidAmount(amount);
        _mint(to, amount);
    }
}
