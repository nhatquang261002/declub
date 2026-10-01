import type { Hex } from "viem";
import { isAddressEqual } from "viem";
import { MAX_CYCLE, assetKey, covers } from "./intent.ts";
import type { Intent } from "./types.ts";

export interface Node {
  hash: Hex;
  intent: Intent;
  /** Milliseconds, for "oldest first". */
  createdAt: number;
}

export interface FindOptions {
  maxCycle?: number;
  /** Stop enumerating after this many cycles, so a huge or adversarial pool can't stall a round. */
  maxCycles?: number;
}

/**
 * Directed graph over the intents: an edge `i → j` means `i.give` covers `j.want`, so in a cycle
 * `j` can follow `i` (the contract pays `cycle[k].give` to `cycle[k+1].maker`).
 * Indexed by asset key: only intents giving `j`'s first wanted asset are candidates.
 */
export function buildEdges(nodes: Node[]): number[][] {
  const givers = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    for (const a of n.intent.give) {
      const k = assetKey(a);
      const list = givers.get(k);
      if (list) list.push(i);
      else givers.set(k, [i]);
    }
  });

  const succ: number[][] = nodes.map(() => []);
  nodes.forEach((j, jIdx) => {
    const first = j.intent.want[0];
    if (!first) return;
    for (const iIdx of givers.get(assetKey(first)) ?? []) {
      const i = nodes[iIdx]!;
      if (iIdx === jIdx || isAddressEqual(i.intent.maker, j.intent.maker)) continue;
      if (covers(i.intent.give, j.intent.want)) succ[iIdx]!.push(jIdx);
    }
  });
  return succ;
}

/**
 * Every simple cycle of length 2..`maxCycle` with distinct makers, each exactly once (rotated to
 * start at its lowest index). A cycle is a list of node indexes in settlement order.
 */
export function findCycles(nodes: Node[], opts: FindOptions = {}): number[][] {
  const maxCycle = opts.maxCycle ?? MAX_CYCLE;
  const maxCycles = opts.maxCycles ?? 5000;
  const succ = buildEdges(nodes);
  const out: number[][] = [];

  const makerIn = (path: number[], idx: number) =>
    path.some((p) => isAddressEqual(nodes[p]!.intent.maker, nodes[idx]!.intent.maker));

  for (let start = 0; start < nodes.length && out.length < maxCycles; start++) {
    const path = [start];
    const walk = () => {
      const last = path[path.length - 1]!;
      for (const next of succ[last]!) {
        if (out.length >= maxCycles) return;
        if (next === start) {
          if (path.length >= 2) out.push([...path]);
        } else if (next > start && path.length < maxCycle && !makerIn(path, next)) {
          path.push(next);
          walk();
          path.pop();
        }
      }
    };
    walk();
  }
  return out;
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
