import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from "viem";

// Contract error name → UI copy. Kept in sync with docs/05-frontend.md#error-messages.
const COPY: Record<string, string> = {
  TradeNotOpen: "This trade was already filled or cancelled.",
  TradeIsExpired: "This trade has expired.",
  TradeNotExpired: "This trade hasn't expired yet.",
  NotAllowedTaker: "This is a private offer for another wallet.",
  SelfFill: "You can't accept your own trade.",
  WrongMonAmount: "The MON amount doesn't match the trade.",
  NotMaker: "Only the creator can cancel this trade.",
  EmptySide: "Add at least one Chog or some MON to each side.",
  MonOnBothSides: "Put MON on one side only.",
  TooManyTokens: "Up to 10 Chogs per side.",
  ExpiryInPast: "Pick an expiry in the future.",
  NothingToWithdraw: "There's nothing to withdraw.",
  WithdrawFailed: "Your wallet couldn't receive the MON.",
  ERC721InsufficientApproval: "Approve Chog Swap to move your Chogs first.",
  ERC721IncorrectOwner: "A Chog in this trade isn't owned by the wallet sending it.",
  ERC721NonexistentToken: "One of these Chogs doesn't exist.",
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
