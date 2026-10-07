import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  TimeoutError,
  UserRejectedRequestError,
} from "viem";
import { PoolError } from "./pool";

// Contract error name → UI copy. Kept in sync with docs/05-frontend.md#error-messages.
const COPY: Record<string, string> = {
  TradeNotOpen: "This deal was already filled or cancelled.",
  TradeIsExpired: "This deal has expired.",
  TradeNotExpired: "This deal hasn't expired yet.",
  NotAllowedTaker: "This is a private offer for another wallet.",
  SelfFill: "You can't accept your own deal.",
  NotMaker: "Only the creator of this deal can do that.",
  EmptySide: "Add at least one asset or some MON to each side.",
  ExpiryInPast: "Pick an expiry in the future.",
  ERC721InsufficientApproval: "Approve DeClub to move your assets first.",
  ERC721IncorrectOwner: "An asset in this deal isn't owned by the wallet sending it.",
  ERC721NonexistentToken: "One of these assets doesn't exist.",
  WrongNativeAmount: "The MON sent doesn't match the deal plus the protocol fee.",
  WrongFee: "The protocol fee is now higher than this signed swap agreed to pay, or it names another fee token.",
  TooManyAssets: "Up to 10 assets per side.",
  TooManyNfts: "Up to 5 NFTs per side.",
  InvalidAsset: "One of the assets in this deal isn't valid.",
  DuplicateAsset: "The same asset is listed twice on one side.",
  SameAssetBothSides: "The same asset can't be on both sides of a deal.",
  UnsupportedToken: "This token takes a fee on transfer or otherwise changes amounts, so it can't be escrowed.",
  NftNotReceived: "The NFT didn't arrive in escrow, so the deal wasn't created.",
  NoteTooLong: "The note is too long. Keep it to at most 280 bytes.",
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
  ERC20InsufficientAllowance: "Approve DeClub to spend that token first.",
  SafeERC20FailedOperation: "The token transfer failed.",
  InvalidQuantity: "Mint between 1 and 20 at a time.",
  // DeClubRewards (ADR 0022)
  UnknownEpoch: "That rewards epoch hasn't been published yet.",
  NotOpenYet: "These rewards aren't open yet. Try again once the review day has passed.",
  EpochClosed: "This epoch's claim window has ended.",
  AlreadyClaimed: "These rewards were already claimed.",
  InvalidProof: "These rewards don't match the published epoch. Reload and try again.",
  OverClaim: "This epoch has already paid out everything it was funded with, so it can't pay this claim.",
  PayoutFailed: "The wallet couldn't receive the MON.",
  ZeroAccount: "There's no wallet to pay.",
};

export type ErrorKind = "rejected" | "funds" | "reverted" | "network" | "wallet" | "pool" | "unknown";

/** An error shaped for the UI: a short title, one readable sentence, and the raw cause for the curious. */
export type AppError = {
  kind: ErrorKind;
  title: string;
  message: string;
  /** Technical detail behind `message`; shown behind a "Details" toggle, never as the headline. */
  details?: string;
};

const WALLET_ERRORS = new Set([
  "ProviderNotFoundError",
  "ConnectorNotConnectedError",
  "ConnectorAlreadyConnectedError",
  "ChainNotConfiguredError",
  "SwitchChainError",
]);

const MAX_DETAILS = 600;
const clip = (text: string) => (text.length > MAX_DETAILS ? `${text.slice(0, MAX_DETAILS)}…` : text);

function rawMessage(error: unknown): string {
  if (error instanceof BaseError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Turns anything thrown by wagmi/viem/the pool into a title, one readable sentence and optional details. */
export function describeError(error: unknown): AppError {
  const raw = rawMessage(error);
  const details = (message: string) => (raw && raw !== message ? clip(raw) : undefined);

  if (error instanceof PoolError) {
    return { kind: "pool", title: "Swap pool refused this", message: error.message, details: `Pool code: ${error.code}` };
  }

  const rejected =
    (error as { code?: number } | null)?.code === 4001 ||
    (error instanceof BaseError &&
      error.walk((e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001));
  if (rejected) {
    return { kind: "rejected", title: "Request cancelled", message: "You rejected the request in your wallet. Nothing was sent." };
  }

  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const message =
        (name && COPY[name]) ||
        (name ? `The contract rejected this (${name}).` : (reverted.reason ?? "The contract rejected this transaction."));
      return {
        kind: "reverted",
        title: "This can't go through",
        message,
        details: name ? `Contract error: ${name}` : details(message),
      };
    }

    if (error.walk((e) => e instanceof InsufficientFundsError)) {
      const message = "Not enough MON to cover this transaction and gas.";
      return { kind: "funds", title: "Not enough MON", message, details: details(message) };
    }

    if (error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) {
      const message = "Couldn't reach the Monad network. Check your connection and try again.";
      return { kind: "network", title: "Network problem", message, details: details(message) };
    }
  }

  if (error instanceof Error && WALLET_ERRORS.has(error.name)) {
    const message =
      error.name === "ProviderNotFoundError"
        ? "No wallet found. Install MetaMask, Rabby or another EVM wallet."
        : error.name === "ChainNotConfiguredError" || error.name === "SwitchChainError"
          ? "Your wallet couldn't switch to the right network. Switch it manually and try again."
          : error.message;
    return { kind: "wallet", title: "Wallet problem", message, details: details(message) };
  }

  if (/connect a wallet/i.test(raw)) {
    return { kind: "wallet", title: "Wallet not connected", message: "Connect your wallet to continue." };
  }

  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(raw)) {
    const message = "Couldn't reach the server. Check your connection and try again.";
    return { kind: "network", title: "Network problem", message, details: details(message) };
  }

  const message = error instanceof BaseError ? error.shortMessage || error.message : raw;
  return { kind: "unknown", title: "Something went wrong", message, details: details(message) };
}

/** Just the one readable sentence from `describeError`. */
export function errorMessage(error: unknown): string {
  return describeError(error).message;
}
