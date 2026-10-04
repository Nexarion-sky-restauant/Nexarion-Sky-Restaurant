#!/usr/bin/env bash
# Verifies that the production custom domain is attached to the Cloudflare Pages
# project, is active, and is serving the current production build.
#
# Read-only: Cloudflare GET requests plus public HTTPS. It cannot change DNS,
# Pages, Supabase, secrets, or PRODUCTION_ENABLED.
#
# Required environment: DOMAIN, PROJECT, CF_ACCOUNT_ID, CF_API_TOKEN
# Optional environment: CF_API_BASE, ATTEMPTS, SLEEP_SECONDS,
#                       SERVING_ATTEMPTS, SERVING_SLEEP_SECONDS
#
# Sourcing this file only defines functions and defaults, so the self-test can
# exercise assert_domain_json against recorded fixtures with no network access.

set -euo pipefail

CF_API_BASE="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
ATTEMPTS="${ATTEMPTS:-10}"
SLEEP_SECONDS="${SLEEP_SECONDS:-30}"
SERVING_ATTEMPTS="${SERVING_ATTEMPTS:-4}"
SERVING_SLEEP_SECONDS="${SERVING_SLEEP_SECONDS:-20}"

# Exit codes: 0 = active, 10 = still pending (a propagation delay), 1 = hard failure.
assert_domain_json() {
  local file="$1" status verification

  if ! jq -e '.success == true' "$file" >/dev/null 2>&1; then
    echo "Cloudflare returned success=false:"
    jq -c '{success, errors}' "$file" 2>/dev/null || cat "$file"
    return 1
  fi

  # Exact identity, not a substring match: a list-wide grep for
  # '"name":"nexarionsky.com"' also matches 'nexarionsky.com.attacker.tld'.
  if ! jq -e --arg d "$DOMAIN" '.result.name == $d' "$file" >/dev/null 2>&1; then
    echo "Response describes a different hostname than the one being verified."
    echo "  expected: $DOMAIN"
    echo "  actual:   $(jq -r '.result.name // "<absent>"' "$file" 2>/dev/null || echo '<unparsable>')"
    return 1
  fi

  status=$(jq -r '.result.status // "unknown"' "$file")
  verification=$(jq -r '.result.verification_data.status // "unknown"' "$file")
  echo "domain=$DOMAIN status=$status verification=$verification"

  if [ "$status" = "active" ] && [ "$verification" = "active" ]; then
    return 0
  fi
  if [ "$status" = "pending" ] || [ "$verification" = "pending" ]; then
    return 10
  fi

  echo "Unexpected custom domain state:"
  jq -c '{status: .result.status, verification_data: .result.verification_data, validation_data: .result.validation_data}' "$file" 2>/dev/null || cat "$file"
  return 1
}

fetch_domain_json() {
  # $1 = file to write. Prints the HTTP status code.
  curl -s -o "$1" -w '%{http_code}' \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    "$CF_API_BASE/accounts/$CF_ACCOUNT_ID/pages/projects/$PROJECT/domains/$DOMAIN"
}

assets_from_html() {
  grep -oE '/assets/[A-Za-z0-9._-]+\.(js|css)' | sort -u || true
}

verify_serving() {
  local domain_assets alias_assets probe

  curl -fsS --retry 3 -o apex.html "https://$DOMAIN/" || {
    echo "https://$DOMAIN/ did not return a successful response."
    return 1
  }
  grep -q '<div id="root">' apex.html || {
    echo "https://$DOMAIN/ did not serve the SPA shell (no <div id=\"root\">)."
    return 1
  }

  domain_assets=$(assets_from_html <apex.html)
  if [ -z "$domain_assets" ]; then
    echo "No hashed asset reference found in the HTML served by https://$DOMAIN/."
    return 1
  fi

  probe=$(printf '%s\n' "$domain_assets" | grep -m1 '\.js$' || true)
  if [ -z "$probe" ]; then
    echo "No JavaScript asset found to probe on https://$DOMAIN."
    return 1
  fi
  curl -fsS -o /dev/null "https://$DOMAIN$probe" || {
    echo "$probe is not served by https://$DOMAIN."
    return 1
  }

  curl -fsS --retry 3 -o alias.html "https://$PROJECT.pages.dev/" || {
    echo "Could not read https://$PROJECT.pages.dev/ to compare builds."
    return 1
  }
  alias_assets=$(assets_from_html <alias.html)

  # Proves the custom domain serves THIS deployment, not an older or unrelated one.
  if [ "$domain_assets" != "$alias_assets" ]; then
    echo "Build mismatch between https://$DOMAIN and https://$PROJECT.pages.dev."
    echo "--- custom domain ---"
    printf '%s\n' "$domain_assets"
    echo "--- project alias ---"
    printf '%s\n' "${alias_assets:-<none>}"
    return 1
  fi

  echo "https://$DOMAIN is active and serving the current production build:"
  printf '%s\n' "$domain_assets"
  return 0
}

main() {
  : "${DOMAIN:?DOMAIN is required}"
  : "${PROJECT:?PROJECT is required}"
  : "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID is required}"
  : "${CF_API_TOKEN:?CF_API_TOKEN is required}"

  echo "Verifying custom domain $DOMAIN on Pages project $PROJECT"

  local attempt http rc
  rc=1
  for attempt in $(seq 1 "$ATTEMPTS"); do
    http=$(fetch_domain_json domain.json)
    if [ "$http" != "200" ]; then
      # An auth, permission or rate-limit failure must not be reported as
      # "domain not found" - that is what the previous implementation did.
      echo "::error::Cloudflare Pages domain query returned HTTP $http for $DOMAIN."
      cat domain.json || true
      exit 1
    fi

    rc=0
    assert_domain_json domain.json || rc=$?
    if [ "$rc" -eq 0 ]; then
      break
    fi
    if [ "$rc" -ne 10 ]; then
      echo "::error::Custom domain verification failed. This is a configuration problem, not a propagation delay."
      exit 1
    fi

    echo "Attempt $attempt/$ATTEMPTS: $DOMAIN is not active yet."
    if [ "$attempt" -lt "$ATTEMPTS" ]; then
      sleep "$SLEEP_SECONDS"
    fi
  done

  if [ "$rc" -ne 0 ]; then
    echo "::error::$DOMAIN was still pending after $ATTEMPTS attempts (~$((ATTEMPTS * SLEEP_SECONDS))s). Cloudflare certificate issuance can take several hours."
    echo "::notice::The application is already deployed at https://$PROJECT.pages.dev/. Re-dispatch the 'Verify Production Domain' workflow once the certificate is issued - do NOT re-run the production deploy."
    exit 1
  fi

  rc=1
  for attempt in $(seq 1 "$SERVING_ATTEMPTS"); do
    rc=0
    verify_serving || rc=$?
    if [ "$rc" -eq 0 ]; then
      break
    fi
    echo "Serving check attempt $attempt/$SERVING_ATTEMPTS failed."
    if [ "$attempt" -lt "$SERVING_ATTEMPTS" ]; then
      sleep "$SERVING_SLEEP_SECONDS"
    fi
  done

  if [ "$rc" -ne 0 ]; then
    echo "::error::$DOMAIN reports active but is not serving the current production build."
    exit 1
  fi

  echo "Verified: $DOMAIN is attached, active, and serving the production deployment."
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
