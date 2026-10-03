import type { Hex } from "viem";
import { MAX_CYCLE, assetKey } from "./intent.ts";
import type { Intent } from "./types.ts";

export interface Node {
  hash: Hex;
  intent: Intent;
  /** Milliseconds, for "oldest first". */
  createdAt: number;
}

/**
 * Default cap on the work one search does, counted as edges looked at by the depth-first search.
 * Counting cycles found isn't enough: a layered graph where no cycle ever closes (a few makers,
 * each with many intents chaining into the next) has no cycles to count but ~L^4 paths to walk.
 * 200k edges is well under 100 ms and far more than an honest book needs.
 */
export const MAX_SEARCH_STEPS = 200_000;

export interface FindOptions {
  maxCycle?: number;
  /** Stop enumerating after this many cycles, so a huge or adversarial pool can't stall a round. */
  maxCycles?: number;
  /** Stop after looking at this many edges in the search (`MAX_SEARCH_STEPS`), cycles or not. */
  maxSteps?: number;
}

export interface SearchResult {
  cycles: number[][];
  /** Edges looked at. */
  steps: number;
  /** True when the search stopped at `maxSteps` or `maxCycles` rather than running out of graph. */
  truncated: boolean;
}

/**
 * Directed graph over the intents: an edge `i → j` means `i.give` covers `j.want`, so in a cycle
 * `j` can follow `i` (the contract pays `cycle[k].give` to `cycle[k+1].maker`).
 * Indexed by asset key: only intents giving `j`'s first wanted asset are candidates.
 * Same rule as `covers` (intent.ts), on pre-computed keys and lower-cased makers so the inner
 * loop is string compares and map lookups.
 */
export function buildEdges(nodes: Node[]): number[][] {
  const makers = nodes.map((n) => n.intent.maker.toLowerCase());
  // Per node: asset key → the most it gives of that asset (an ERC-20 want is a floor).
  const gives = nodes.map((n) => {
    const m = new Map<string, bigint>();
    for (const a of n.intent.give) {
      const k = assetKey(a);
      const had = m.get(k);
      if (had === undefined || a.amount > had) m.set(k, a.amount);
    }
    return m;
  });
  const wants = nodes.map((n) => n.intent.want.map((a) => ({ key: assetKey(a), amount: a.amount })));

  const givers = new Map<string, number[]>();
  gives.forEach((m, i) => {
    for (const k of m.keys()) {
      const list = givers.get(k);
      if (list) list.push(i);
      else givers.set(k, [i]);
    }
  });

  const succ: number[][] = nodes.map(() => []);
  wants.forEach((want, jIdx) => {
    const first = want[0];
    if (!first) return;
    for (const iIdx of givers.get(first.key) ?? []) {
      if (iIdx === jIdx || makers[iIdx] === makers[jIdx]) continue;
      const g = gives[iIdx]!;
      if (want.every((w) => (g.get(w.key) ?? -1n) >= w.amount)) succ[iIdx]!.push(jIdx);
    }
  });
  return succ;
}

/**
 * Every simple cycle of length 2..`maxCycle` with distinct makers, each exactly once (rotated to
 * start at its lowest index), until `maxCycles` cycles or `maxSteps` edges. A cycle is a list of
 * node indexes in settlement order.
 */
export function searchCycles(nodes: Node[], opts: FindOptions = {}): SearchResult {
  const maxCycle = opts.maxCycle ?? MAX_CYCLE;
  const maxCycles = opts.maxCycles ?? 5000;
  const maxSteps = opts.maxSteps ?? MAX_SEARCH_STEPS;
  const succ = buildEdges(nodes);
  const makers = nodes.map((n) => n.intent.maker.toLowerCase());
  const cycles: number[][] = [];
  let steps = 0;
  let truncated = false;

  const path: number[] = [];
  const makerIn = (m: string) => {
    for (const p of path) if (makers[p] === m) return true;
    return false;
  };

  for (let start = 0; start < nodes.length && !truncated; start++) {
    path.length = 0;
    path.push(start);
    const walk = () => {
      const last = path[path.length - 1]!;
      for (const next of succ[last]!) {
        if (cycles.length >= maxCycles || steps >= maxSteps) {
          truncated = true;
          return;
        }
        steps++;
        if (next === start) {
          if (path.length >= 2) cycles.push([...path]);
        } else if (next > start && path.length < maxCycle && !makerIn(makers[next]!)) {
          path.push(next);
          walk();
          path.pop();
          if (truncated) return;
        }
      }
    };
    walk();
  }
  return { cycles, steps, truncated };
}

/** `searchCycles`, just the cycles. */
export function findCycles(nodes: Node[], opts: FindOptions = {}): number[][] {
  return searchCycles(nodes, opts).cycles;
}

/**
 * Pick disjoint cycles to settle: most intents first (ADR 0009), then the one containing the
 * oldest intent. Cycles also can't share a maker, so one maker's several intents settle one per
 * round and the next round re-checks the chain.
 */
export function selectCycles(nodes: Node[], cycles: number[][]): number[][] {
  const oldest = (c: number[]) => Math.min(...c.map((i) => nodes[i]!.createdAt));
  const total = (c: number[]) => c.reduce((s, i) => s + nodes[i]!.createdAt, 0);
  const key = (c: number[]) => c.map((i) => nodes[i]!.hash).join();

  const ranked = [...cycles].sort(
    (a, b) =>
      b.length - a.length ||
      oldest(a) - oldest(b) ||
      total(a) - total(b) ||
      key(a).localeCompare(key(b)),
  );

  const usedIntents = new Set<number>();
  const usedMakers = new Set<string>();
  const picked: number[][] = [];
  for (const c of ranked) {
    const makers = c.map((i) => nodes[i]!.intent.maker.toLowerCase());
    if (c.some((i) => usedIntents.has(i)) || makers.some((m) => usedMakers.has(m))) continue;
    c.forEach((i) => usedIntents.add(i));
    makers.forEach((m) => usedMakers.add(m));
    picked.push(c);
  }
  return picked;
}
