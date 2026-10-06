// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Testnet mirror of a mainnet NFT collection
/// @notice Same name, symbol, supply and token URIs as the mainnet collection, so token #n shows
///         mainnet #n's art. `revealOffset` reproduces a shifted reveal: token n reads metadata
///         `((n - 1 + offset) % maxSupply) + 1`. Owner-only sequential minting; enumerable so the
///         app can list a wallet's tokens without an indexer. Testnet only.
contract CollectionMirror is ERC721Enumerable, Ownable {
    using Strings for uint256;

    uint256 public immutable MAX_SUPPLY;
    uint256 public immutable REVEAL_OFFSET;
    string public baseURI;
    string public uriSuffix;

    uint256 public nextTokenId = 1;

    error InvalidQuantity(uint256 quantity);
    error MaxSupplyExceeded();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply,
        string memory baseURI_,
        string memory uriSuffix_,
        uint256 revealOffset
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        MAX_SUPPLY = maxSupply;
        REVEAL_OFFSET = revealOffset % maxSupply;
        baseURI = baseURI_;
        uriSuffix = uriSuffix_;
    }

    /// @return firstId The first token id minted; ids are `firstId .. firstId + quantity - 1`.
    function mintBatch(address to, uint256 quantity) external onlyOwner returns (uint256 firstId) {
        if (quantity == 0) revert InvalidQuantity(quantity);
        if (nextTokenId + quantity - 1 > MAX_SUPPLY) revert MaxSupplyExceeded();
        firstId = nextTokenId;
        for (uint256 i; i < quantity; ++i) {
            // Plain _mint, as MockChog: demo wallets are EOAs.
            // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
            _mint(to, nextTokenId++);
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 metadataId = ((tokenId - 1 + REVEAL_OFFSET) % MAX_SUPPLY) + 1;
        return string.concat(baseURI, metadataId.toString(), uriSuffix);
    }
}
