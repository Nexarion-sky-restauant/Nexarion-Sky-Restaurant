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

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures self-test(s) failed."
  exit 1
fi
echo "All verify-production-domain self-tests passed."
