#!/usr/bin/env bash
# Offline tests for the JSON assertions in verify-production-domain.sh.
# Covers the four responses that matter: active, pending, wrong domain, API error.
# No network access, no credentials - runs in CI on ubuntu-latest (needs bash + jq).

set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FIXTURES="$HERE/fixtures"

DOMAIN=nexarionsky.com
export DOMAIN

# Sourcing only defines functions and defaults; it never runs main().
# shellcheck source=./verify-production-domain.sh
source "$HERE/verify-production-domain.sh"
# The sourced script enables errexit; this harness counts failures instead.
set +e

failures=0

expect_code() {
  local label="$1" fixture="$2" want="$3" got output
  output=$(assert_domain_json "$FIXTURES/$fixture" 2>&1)
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS  $label (exit $got)"
  else
    echo "FAIL  $label: expected exit $want, got $got"
    printf '%s\n' "$output" | sed 's/^/        /'
    failures=$((failures + 1))
  fi
}

expect_grep() {
  local label="$1" pattern="$2" fixture="$3" want_match="$4"
  if grep -q "$pattern" "$FIXTURES/$fixture"; then
    matched=yes
  else
    matched=no
  fi
  if [ "$matched" = "$want_match" ]; then
    echo "PASS  $label"
  else
    echo "FAIL  $label: expected match=$want_match, got match=$matched"
    failures=$((failures + 1))
  fi
}

echo "== verify-production-domain self-tests =="

expect_code "active domain is accepted"              domain-active.json       0
expect_code "pending domain is retryable, not active" domain-pending.json      10
expect_code "different hostname is rejected"          domain-wrong-domain.json 1
expect_code "API error is rejected"                   domain-api-error.json    1

# Regression guard for the bug this script replaces: the old check was
#   grep -q '"name":"nexarionsky.com"' domains.json
# against a LIST endpoint. Cloudflare returns pretty-printed JSON, so that
# pattern could never match; and any whitespace-tolerant replacement would
# still be a substring test that matches a longer hostname and ignores status.
expect_grep "fixtures are pretty-printed like the real API" '"name":"nexarionsky.com"' domain-active.json no
expect_grep "a naive substring grep would over-match"       'nexarionsky\.com'         domain-wrong-domain.json yes

# ---------------------------------------------------------------------------
# Offline serving-check tests for the propagation-race fix.
#
# The real verify_serving fetches three hosts. We stub `curl` so each URL maps
# to a local fixture, then assert the pass/fail decision for four scenarios.
# The race case (domain AND alias both stale, deployment fresh) MUST fail -
# that is the exact false positive this fix removes.
# ---------------------------------------------------------------------------
SERVING_DIR=$(mktemp -d)
trap 'rm -rf "$SERVING_DIR"' EXIT

write_html() { # $1 = filename, $2 = js asset, $3 = css asset
  printf '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/%s"></script><link rel="stylesheet" href="/assets/%s"></body></html>\n' \
    "$2" "$3" > "$SERVING_DIR/$1"
}
echo "console.log(1)" > "$SERVING_DIR/probe.js"

curl() {
  local url="" out="" a prev=""
  for a in "$@"; do
    if [ "$prev" = "-o" ]; then out="$a"; fi
    case "$a" in http://*|https://*) url="$a" ;; esac
    prev="$a"
  done
  local fixture=""
  case "$url" in
    "https://nexarionsky.com/")            fixture="domain.html" ;;
    "https://nexarion-sky.pages.dev/")     fixture="alias.html" ;;
    "https://new-dep.nexarion-sky.pages.dev/") fixture="deployment.html" ;;
    "https://nexarionsky.com/assets/index-NEW.js") fixture="probe.js" ;;
    "https://nexarionsky.com/assets/index-OLD.js") fixture="probe.js" ;;
  esac
  if [ -n "$fixture" ] && [ -f "$SERVING_DIR/$fixture" ]; then
    [ "$out" = "/dev/null" ] || cat "$SERVING_DIR/$fixture" > "$out"
    return 0
  fi
  return 1
}

expect_rc() { # $1 = label, $2 = expected exit code of verify_serving
  local label="$1" want="$2" got
  verify_serving >/dev/null 2>&1
  got=$?
  if [ "$got" = "$want" ]; then
    echo "PASS  $label (exit $got)"
  else
    echo "FAIL  $label: expected exit $want, got $got"
    failures=$((failures + 1))
  fi
}

PROJECT=nexarion-sky
DEPLOYMENT_URL=https://new-dep.nexarion-sky.pages.dev

write_html domain.html     index-OLD.js index-OLD.css
write_html alias.html      index-OLD.js index-OLD.css
write_html deployment.html index-NEW.js index-NEW.css
expect_rc "race: stale domain+alias vs fresh deployment is REJECTED" 1

write_html domain.html     index-NEW.js index-NEW.css
write_html alias.html      index-NEW.js index-NEW.css
write_html deployment.html index-NEW.js index-NEW.css
expect_rc "all hosts current: accepted" 0

DEPLOYMENT_URL=""
write_html domain.html index-NEW.js index-NEW.css
write_html alias.html  index-NEW.js index-NEW.css
expect_rc "fallback: domain matches alias, accepted" 0

write_html domain.html index-NEW.js index-NEW.css
write_html alias.html  index-OLD.js index-OLD.css
expect_rc "fallback: domain differs from alias, REJECTED" 1

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures self-test(s) failed."
  exit 1
fi
echo "All verify-production-domain self-tests passed."
