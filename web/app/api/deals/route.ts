import { dealsHandler } from "@/lib/server/dealRoutes";

/**
 * GET /api/deals?tab=&q=&mon=&sort=&kind=&viewer=&token=&page=&size=   (ADR 0020)
 *
 * One page of the deal book, searched and filtered over every deal on the contract and every
 * signed swap in the pool, not just the newest few a browser can read. Public: it only repeats
 * what the chain and the pool already say. `{ enabled: false }` without a deal contract.
 */
export const GET = dealsHandler();
