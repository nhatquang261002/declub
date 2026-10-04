#!/usr/bin/env bash
# Every automated check in the repo, in one go: the pre-mainnet gate.
#
#   scripts/test-all.sh                 contracts, matcher, web (incl. build), e2e on a local anvil
#   scripts/test-all.sh --quick         skip the web build and the e2e run
#   scripts/test-all.sh --coverage --slither --halmos   add the slow/static checks
#   scripts/test-all.sh --only contracts,matcher        run some sections (contracts, matcher, web, e2e)
#
# Each step's output goes to test-results/<time>/<step>.log; a summary table prints at the end and
# is saved as summary.md. Exits 1 if any step failed. Needs forge/anvil, Node 24+, npm.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUICK=0 COVERAGE=0 SLITHER=0 HALMOS=0 ONLY=""
for a in "$@"; do
  case "$a" in
    --quick) QUICK=1 ;;
    --coverage) COVERAGE=1 ;;
    --slither) SLITHER=1 ;;
    --halmos) HALMOS=1 ;;
    --only=*) ONLY="${a#--only=}" ;;
    --only) echo "use --only=contracts,web" >&2; exit 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

OUT="$ROOT/test-results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.md"
FAILED=0
ROWS=""

want() { [[ -z "$ONLY" || ",$ONLY," == *",$1,"* ]]; }

# step <name> <dir> <command...>: run it, log it, record pass/fail and time.
step() {
  local name="$1" dir="$2"; shift 2
  local log="$OUT/$name.log" start end status
  printf '%-28s ' "$name"
  start=$(date +%s)
  (cd "$dir" && "$@") >"$log" 2>&1
  status=$?
  end=$(date +%s)
  if [[ $status -eq 0 ]]; then
    printf '\033[32mpass\033[0m  %4ss\n' "$((end - start))"
    ROWS+="| $name | pass | $((end - start))s |"$'\n'
  else
    printf '\033[31mFAIL\033[0m  %4ss  (%s)\n' "$((end - start))" "${log#$ROOT/}"
    tail -n 15 "$log" | sed 's/^/      /'
    ROWS+="| $name | **FAIL** | $((end - start))s |"$'\n'
    FAILED=1
  fi
}

skip() {
  printf '%-28s \033[90mskip\033[0m  %s\n' "$1" "$2"
  ROWS+="| $1 | skip | $2 |"$'\n'
}

need_modules() { [[ -d "$1/node_modules" ]] || (cd "$1" && npm ci --no-audit --no-fund >/dev/null 2>&1); }

echo "On Deal test gate · $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null) · logs in ${OUT#$ROOT/}"
echo

if want contracts; then
  step contracts:build "$ROOT/contracts" forge build --sizes
  step contracts:test "$ROOT/contracts" forge test
  if [[ $COVERAGE -eq 1 ]]; then
    step contracts:coverage "$ROOT/contracts" forge coverage --report summary --no-match-coverage "(test|script)"
  else
    skip contracts:coverage "--coverage"
  fi
  if [[ $SLITHER -eq 1 ]] && command -v slither >/dev/null; then
    # Exit code is the finding count; the triage in docs/04-security.md decides what matters, so review the log.
    step contracts:slither "$ROOT/contracts" bash -c 'slither . --filter-paths "lib/|test/|script/|src/mocks/" || true'
  else
    skip contracts:slither "--slither (needs slither-analyzer)"
  fi
  if [[ $HALMOS -eq 1 ]] && command -v halmos >/dev/null; then
    step contracts:halmos "$ROOT/contracts" env FOUNDRY_DYNAMIC_TEST_LINKING=false halmos --match-contract OnDealIntentsSymbolic --loop 4
  else
    skip contracts:halmos "--halmos (needs halmos)"
  fi
fi

if want matcher; then
  need_modules "$ROOT/matcher"
  step matcher:typecheck "$ROOT/matcher" npm run typecheck
  step matcher:test "$ROOT/matcher" npm test
fi

if want web; then
  need_modules "$ROOT/web"
  step web:typecheck "$ROOT/web" npm run typecheck
  step web:lint "$ROOT/web" npm run lint
  step web:test "$ROOT/web" npm test
  # A production build must not depend on dev-only demo flags.
  if [[ $QUICK -eq 0 ]]; then
    step web:build "$ROOT/web" env NEXT_PUBLIC_DEMO_DEALS=false NEXT_PUBLIC_DEMO_CLUBS=false NEXT_PUBLIC_DEMO_CREATE=false npm run build
  else
    skip web:build "--quick"
  fi
fi

if want e2e; then
  need_modules "$ROOT/e2e"
  step e2e:typecheck "$ROOT/e2e" npm run typecheck
  if [[ $QUICK -eq 0 ]]; then
    # Fresh anvil, the real deploy scripts, the matcher process, every scenario (docs/11-test-plan.md §3).
    step e2e:local "$ROOT/e2e" npm run local
  else
    skip e2e:local "--quick"
  fi
fi

{
  echo "# Test gate $(date '+%Y-%m-%d %H:%M')"
  echo
  echo "- commit: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)$(git -C "$ROOT" diff --quiet 2>/dev/null || echo ' (uncommitted changes)')"
  echo "- result: $([[ $FAILED -eq 0 ]] && echo pass || echo FAIL)"
  echo
  echo "| Step | Result | Time |"
  echo "|---|---|---|"
  printf '%s' "$ROWS"
} >"$SUMMARY"

echo
if [[ $FAILED -eq 0 ]]; then echo "all steps passed · ${SUMMARY#$ROOT/}"; else echo "some steps FAILED · ${SUMMARY#$ROOT/}"; fi
exit $FAILED
