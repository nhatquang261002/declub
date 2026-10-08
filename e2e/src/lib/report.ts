import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { REPO } from "./env.ts";

export type Outcome = "pass" | "fail" | "skip" | "warn";

export interface Result {
  id: string;
  title: string;
  outcome: Outcome;
  ms: number;
  /** Why it failed, was skipped or warned. */
  detail?: string;
  /** Measurements and evidence: gas, tx hashes. */
  notes: string[];
}

export interface Case<C> {
  id: string;
  title: string;
  /** Returns a reason to skip, or null to run. */
  skip?: (ctx: C) => string | null;
  run: (ctx: C, note: (s: string) => void) => Promise<void>;
}

/** Thrown by a check that found something worth a look but not a failure. */
export class Warning extends Error {}

const ICON: Record<Outcome, string> = { pass: "✓", fail: "✗", skip: "-", warn: "!" };
const COLOR: Record<Outcome, string> = { pass: "32", fail: "31", skip: "90", warn: "33" };
const tty = process.stdout.isTTY;
const paint = (o: Outcome, s: string) => (tty ? `\x1b[${COLOR[o]}m${s}\x1b[0m` : s);

/** `--only V2,IN-02` keeps cases whose id starts with any of the prefixes. */
export function selected(id: string, only?: string): boolean {
  if (!only || only === "true") return true;
  return only.split(",").some((p) => id.toUpperCase().startsWith(p.trim().toUpperCase()));
}

/** Runs cases in order; a failure doesn't stop the rest. */
export async function runCases<C>(cases: Case<C>[], ctx: C, only?: string): Promise<Result[]> {
  const results: Result[] = [];
  for (const c of cases) {
    if (!selected(c.id, only)) continue;
    const notes: string[] = [];
    const t0 = Date.now();
    let outcome: Outcome = "pass";
    let detail: string | undefined = c.skip?.(ctx) ?? undefined;
    if (detail) {
      outcome = "skip";
    } else {
      try {
        await c.run(ctx, (s) => notes.push(s));
      } catch (e) {
        outcome = e instanceof Warning ? "warn" : "fail";
        detail = e instanceof Error ? (e.stack && outcome === "fail" ? firstLines(e) : e.message) : String(e);
      }
    }
    const r: Result = { id: c.id, title: c.title, outcome, ms: Date.now() - t0, detail, notes };
    results.push(r);
    print(r);
  }
  return results;
}

function firstLines(e: Error): string {
  return (e.message || String(e)).split("\n").slice(0, 8).join("\n");
}

export function print(r: Result) {
  const time = r.outcome === "skip" ? "" : ` (${(r.ms / 1000).toFixed(1)}s)`;
  console.log(`${paint(r.outcome, ICON[r.outcome])} ${r.id.padEnd(7)} ${r.title}${time}`);
  for (const n of r.notes) console.log(`          ${n}`);
  if (r.detail) console.log(paint(r.outcome, r.detail.replace(/^/gm, "          ")));
}

/** Prints the totals and writes `e2e/results/<name>-<time>.{json,md}`. Returns the exit code. */
export function finish(name: string, results: Result[], meta: Record<string, string> = {}): number {
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const line = `${count("pass")} passed, ${count("fail")} failed, ${count("warn")} warnings, ${count("skip")} skipped`;
  console.log(`\n${count("fail") ? paint("fail", line) : paint("pass", line)}`);

  let commit = "";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {}
  const at = new Date().toISOString();
  const info = { run: name, at, commit, ...meta };
  const dir = resolve(REPO, "e2e/results");
  mkdirSync(dir, { recursive: true });
  const stem = resolve(dir, `${name}-${at.replace(/[:.]/g, "-")}`);
  writeFileSync(`${stem}.json`, JSON.stringify({ ...info, results }, null, 2));

  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const md = [
    `# ${name}`,
    "",
    ...Object.entries(info).map(([k, v]) => `- **${k}:** ${v}`),
    `- **result:** ${line}`,
    "",
    "| ID | Case | Result | Notes |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${cell(r.title)} | ${r.outcome} | ${cell([...r.notes, r.detail ?? ""].filter(Boolean).join("; "))} |`),
    "",
  ].join("\n");
  writeFileSync(`${stem}.md`, md);
  console.log(`report: ${stem}.md`);
  return count("fail") ? 1 : 0;
}
