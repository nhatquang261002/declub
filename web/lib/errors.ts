import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from "viem";

// Contract error name → UI copy. Kept in sync with docs/05-frontend.md#error-messages.
const COPY: Record<string, string> = {
  TradeNotOpen: "This deal was already filled or cancelled.",
  TradeIsExpired: "This deal has expired.",
  TradeNotExpired: "This deal hasn't expired yet.",
  NotAllowedTaker: "This is a private offer for another wallet.",
  SelfFill: "You can't accept your own deal.",
  WrongMonAmount: "The MON amount doesn't match the deal.",
  NotMaker: "Only the creator of this deal can do that.",
  EmptySide: "Add at least one asset or some MON to each side.",
  MonOnBothSides: "Put MON on one side only.",
  TooManyTokens: "Up to 10 assets per side.",
  ExpiryInPast: "Pick an expiry in the future.",
  NothingToWithdraw: "There's nothing to withdraw.",
  WithdrawFailed: "Your wallet couldn't receive the MON.",
  ERC721InsufficientApproval: "Approve On Deal to move your assets first.",
  ERC721IncorrectOwner: "An asset in this deal isn't owned by the wallet sending it.",
  ERC721NonexistentToken: "One of these assets doesn't exist.",
  WrongNativeAmount: "The MON amount doesn't match the deal.",
  TooManyAssets: "Up to 10 assets per side.",
  InvalidAsset: "One of the assets in this deal isn't valid.",
  DuplicateAsset: "The same asset is listed twice on one side.",
  SameAssetBothSides: "The same asset can't be on both sides of a deal.",
  UnsupportedToken: "This token takes a fee on transfer or otherwise changes amounts, so it can't be escrowed.",
  NftNotReceived: "The NFT didn't arrive in escrow, so the deal wasn't created.",
  NoteTooLong: "The note is too long. Keep it under 280 bytes.",
  NotOpenOffer: "This deal has a fixed ask, so it doesn't take offers.",
  OpenOfferNoFill: "This is an open offer. Send the maker an offer instead of accepting it directly.",
  SelfPropose: "You can't make an offer on your own deal.",
  UnknownProposal: "That offer doesn't exist.",
  ProposalNotActive: "That offer was already accepted, rejected or withdrawn.",
  NotProposer: "Only the wallet that made this offer can withdraw it.",
  NoTraitAsset: "Add at least one trait request.",
  BadTraitSpec: "The trait request description is empty or too long. Choose fewer traits.",
  TraitFillRequired: "This deal asks for NFTs by trait. Choose which of yours to send.",
  InvalidTraitFill: "The NFTs you chose don't fit this request. Pick exactly the number it asks for.",
  InvalidTraitProof: "One of the NFTs you chose isn't in the set this deal asks for.",
  NothingToClaim: "There's nothing to claim.",
  ClaimFailed: "The transfer still failed. Your claim is kept, so try again later.",
  ERC20InsufficientBalance: "You don't have enough of that token.",
  ERC20InsufficientAllowance: "Approve On Deal to spend that token first.",
  SafeERC20FailedOperation: "The token transfer failed.",
  InvalidQuantity: "Mint between 1 and 20 at a time.",
};

/** Turns anything thrown by wagmi/viem into one readable sentence. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof BaseError)) {
    return error instanceof Error ? error.message : String(error);
  }

  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    const name = reverted.data?.errorName;
    if (name && COPY[name]) return COPY[name];
    if (name) return `The contract rejected this (${name}).`;
    return reverted.reason ?? "The contract rejected this transaction.";
  }

  const rejected = error.walk(
    (e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001,
  );
  if (rejected) return "You rejected the request in your wallet.";

  if (error.walk((e) => e instanceof InsufficientFundsError)) {
    return "Not enough MON to cover this transaction and gas.";
  }

  return error.shortMessage || error.message;
}
