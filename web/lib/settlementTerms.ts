import type { Settlement } from "./createFlow";

/**
 * The six things to know about how a deal settles, in one place. The create screen shows `tip` in
 * a tooltip on each chip; the Guide page shows `detail` under the same `id`, so a tooltip's
 * "Learn more" lands on its own explanation. Edit the words here and both stay in step.
 * The facts come from ADR 0008 (signed swaps) and DeClubEscrow (locked deals).
 */
export type SettlementTerm = {
  /** The Deals guide anchor: /guide/deals#<id>. */
  id: string;
  mode: Settlement;
  label: string;
  /** A plus (something you get) or a minus (something you give up). */
  good: boolean;
  /** One or two sentences for the tooltip. */
  tip: string;
  /** The fuller explanation on the Guide page. */
  detail: string;
};

const SETTLEMENT_TERMS: readonly SettlementTerm[] = [
  {
    id: "cant-fail",
    mode: "escrow",
    label: "Can't fail",
    good: true,
    tip: "Your side is already in the contract, so when someone accepts, both sides move together.",
    detail:
      "Your assets are already inside the contract when someone accepts. Nothing depends on your wallet at that moment, so you can't be caught without the asset or the approval. Either both sides transfer in one transaction or nothing does.",
  },
  {
    id: "costs-gas",
    mode: "escrow",
    label: "Costs gas",
    good: false,
    tip: "Creating the deal is a transaction, and so is cancelling it. Approvals cost gas too.",
    detail:
      "Creating the deal is an on-chain transaction, and cancelling or reclaiming it is another. The one-off approval for your collection or token costs gas as well. Posting a deal and then changing your mind therefore costs two transactions.",
  },
  {
    id: "assets-locked",
    mode: "escrow",
    label: "Assets locked",
    good: false,
    tip: "The contract holds what you offer until the deal is accepted, cancelled, or it expires.",
    detail:
      "What you offer moves into the contract the moment you create the deal. You can't use or sell it elsewhere until the deal is accepted, you cancel it, or it expires and you reclaim it. A deal with no expiry stays locked until you cancel it.",
  },
  {
    id: "free",
    mode: "signed",
    label: "Free",
    good: true,
    tip: "Signing is a message, not a transaction. Posting and removing it cost no gas.",
    detail:
      "A signed swap is an off-chain message, so posting it and removing it from the pool cost no gas. You only pay for the approvals that let the contract move your assets later, and the matcher pays the gas when it settles.",
  },
  {
    id: "nothing-locked",
    mode: "signed",
    label: "Nothing locked",
    good: true,
    tip: "Your assets stay in your wallet until a match settles, so you can keep using them.",
    detail:
      "Nothing leaves your wallet when you sign. You can keep holding, showing and even trading the asset elsewhere. That is also the catch: the swap only works if the asset is still there when a match is found.",
  },
  {
    id: "can-fail",
    mode: "signed",
    label: "Can fail",
    good: false,
    tip: "If you move the asset or revoke the approval before a match, the swap fails and nothing is exchanged.",
    detail:
      "A match is checked and settled in one transaction. If you moved the asset, spent the tokens or revoked the approval in the meantime, that transaction reverts and nobody loses anything, but your swap doesn't happen. The pool marks such an intent Paused and brings it back once you fix it. It also can't use MON (wrap it as WMON), trait requests, or a single-wallet offer, and anyone who meets your terms can settle it.",
  },
];

export const termsFor = (mode: Settlement) => SETTLEMENT_TERMS.filter((t) => t.mode === mode);

/** Where the Guide explains the choice, and where each term is explained. */
export const SETTLEMENT_GUIDE = "/guide/deals#settlement";
export const termGuide = (term: Pick<SettlementTerm, "id">) => `/guide/deals#${term.id}`;
