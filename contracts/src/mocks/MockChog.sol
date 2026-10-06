// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {
    ERC721Enumerable
} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title MockChog: testnet / test-only stand-in for the Chog collection
/// @notice Open mint, sequential ids from 1, deterministic on-chain traits and SVG art.
///         Enumerable so the frontend can list a wallet's Chogs without an indexer.
contract MockChog is ERC721Enumerable {
    using Strings for uint256;

    uint256 public constant MAX_MINT_PER_TX = 20;

    uint256 public nextTokenId = 1;

    error InvalidQuantity(uint256 quantity);

    constructor() ERC721("Mock Chog", "MCHOG") {}

    /// @notice Anyone can mint. Testnet only.
    /// @return firstId The first token id minted; ids are `firstId .. firstId + quantity - 1`.
    function mint(address to, uint256 quantity) external returns (uint256 firstId) {
        if (quantity == 0 || quantity > MAX_MINT_PER_TX) revert InvalidQuantity(quantity);
        firstId = nextTokenId;
        for (uint256 i; i < quantity; ++i) {
            // Plain _mint so tests can mint to contracts without a receiver hook.
            // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
            _mint(to, firstId + i);
        }
        nextTokenId = firstId + quantity;
    }

    // ─────────────────────────────────────────────────────────────── Traits

    function traitsOf(uint256 tokenId)
        public
        pure
        returns (string memory hat, string memory eyes, string memory background)
    {
        hat = _pick(tokenId, "hat", _hats());
        eyes = _pick(tokenId, "eyes", _eyes());
        background = _pick(tokenId, "background", _backgrounds());
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        (string memory hat, string memory eyes, string memory background) = traitsOf(tokenId);

        string memory json = string.concat(
            '{"name":"Mock Chog #',
            tokenId.toString(),
            '","description":"Testnet stand-in for Chogs, used by DeClub.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(tokenId, hat, eyes, background))),
            '","attributes":[{"trait_type":"Hat","value":"',
            hat,
            '"},{"trait_type":"Eyes","value":"',
            eyes,
            '"},{"trait_type":"Background","value":"',
            background,
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ─────────────────────────────────────────────────────────────── Internals

    function _pick(uint256 tokenId, string memory salt, string[] memory options)
        private
        pure
        returns (string memory)
    {
        return options[uint256(keccak256(abi.encode(tokenId, salt))) % options.length];
    }

    function _hats() private pure returns (string[] memory o) {
        o = new string[](5);
        (o[0], o[1], o[2], o[3], o[4]) = ("None", "Wizard Hat", "Crown", "Beanie", "Cowboy Hat");
    }

    function _eyes() private pure returns (string[] memory o) {
        o = new string[](4);
        (o[0], o[1], o[2], o[3]) = ("Blue", "Green", "Laser", "Sleepy");
    }

    function _backgrounds() private pure returns (string[] memory o) {
        o = new string[](4);
        (o[0], o[1], o[2], o[3]) = ("Purple", "Mint", "Sunset", "Night");
    }

    function _color(string memory name) private pure returns (string memory) {
        bytes32 h = keccak256(bytes(name));
        if (h == keccak256("Purple")) return "#836EF9";
        if (h == keccak256("Mint")) return "#A0F0D0";
        if (h == keccak256("Sunset")) return "#FF9E6D";
        if (h == keccak256("Night")) return "#200052";
        if (h == keccak256("Blue")) return "#3B82F6";
        if (h == keccak256("Green")) return "#22C55E";
        if (h == keccak256("Laser")) return "#EF4444";
        return "#6B7280"; // Sleepy
    }

    function _svg(uint256 tokenId, string memory hat, string memory eyes, string memory background)
        private
        pure
        returns (string memory)
    {
        string memory eye = _color(eyes);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">',
            '<rect width="200" height="200" fill="',
            _color(background),
            '"/><ellipse cx="100" cy="125" rx="70" ry="55" fill="#6E54FF"/>',
            '<circle cx="70" cy="95" r="18" fill="#fff"/><circle cx="130" cy="95" r="18" fill="#fff"/>',
            '<circle cx="70" cy="95" r="8" fill="',
            eye,
            '"/><circle cx="130" cy="95" r="8" fill="',
            eye,
            '"/><text x="100" y="190" font-family="monospace" font-size="14" text-anchor="middle" fill="#fff">#',
            tokenId.toString(),
            " ",
            hat,
            "</text></svg>"
        );
    }
}
