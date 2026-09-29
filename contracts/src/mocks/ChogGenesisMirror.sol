// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Chog Genesis testnet mirror
/// @notice Reproduces the real collection's public identity and IPFS token URI shape.
///         Enumerable ownership and owner-only minting are testnet conveniences.
contract ChogGenesisMirror is ERC721Enumerable, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 1969;
    string public constant METADATA_BASE =
        "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/";

    uint256 public nextTokenId = 1;

    error InvalidQuantity(uint256 quantity);
    error MaxSupplyExceeded();

    constructor() ERC721("Chog Genesis", "CHOG") Ownable(msg.sender) {}

    function mintBatch(address to, uint256 quantity) external onlyOwner returns (uint256 firstId) {
        if (quantity == 0) revert InvalidQuantity(quantity);
        if (nextTokenId + quantity - 1 > MAX_SUPPLY) revert MaxSupplyExceeded();
        firstId = nextTokenId;
        for (uint256 i; i < quantity; ++i) {
            _mint(to, nextTokenId++);
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(METADATA_BASE, tokenId.toString(), ".json");
    }
}
