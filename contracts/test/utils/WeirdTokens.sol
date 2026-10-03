// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev Non-standard tokens the generic swap has to survive. All test-only.

/// Burns 1% of every transfer, so the receiver gets less than the sender sent.
contract FeeToken is ERC20 {
    constructor() ERC20("Fee", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) return super._update(from, to, value);
        uint256 fee = value / 100;
        super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}

/// Returns true from transferFrom without moving anything.
contract LyingToken is ERC20 {
    constructor() ERC20("Liar", "LIE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return true;
    }
}

/// An ERC-721 whose transferFrom silently does nothing.
contract LyingNft is ERC721 {
    constructor() ERC721("LiarNft", "LNFT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function transferFrom(address, address, uint256) public pure override {}
}

/// An ERC-721 whose transferFrom does nothing, instead of reverting, when the move isn't allowed.
/// Allowed moves go through.
contract SoftNft is ERC721 {
    constructor() ERC721("SoftNft", "SNFT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function transferFrom(address from, address to, uint256 id) public override {
        address owner = _ownerOf(id);
        if (owner != from || !_isAuthorized(owner, msg.sender, id)) return;
        _transfer(from, to, id);
    }
}

/// USDT-style: transfer / transferFrom return nothing.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// An ERC-20 that refuses to pay blocked recipients (like a USDC blacklist), toggleable.
contract BlocklistToken is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blocklist", "BLK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool value) external {
        blocked[who] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "BlocklistToken: recipient blocked");
        super._update(from, to, value);
    }
}

/// An ERC-721 that refuses to send to blocked recipients, toggleable.
contract BlocklistNft is ERC721 {
    mapping(address => bool) public blocked;

    constructor() ERC721("BlocklistNft", "BNFT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function setBlocked(address who, bool value) external {
        blocked[who] = value;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        require(!blocked[to], "BlocklistNft: recipient blocked");
        return super._update(to, tokenId, auth);
    }
}

/// An ERC-20 that re-enters `target` with `payload` the first time it moves tokens
/// (like an ERC-777 hook). Records whether the re-entry got through.
contract HookToken is ERC20 {
    address public target;
    bytes public payload;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryRevertData;

    constructor() ERC20("Hook", "HOOK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        attempted = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attempted || target == address(0) || from == address(0)) return;
        attempted = true;
        (bool ok, bytes memory data) = target.call(payload);
        reentrySucceeded = ok;
        reentryRevertData = data;
    }
}
