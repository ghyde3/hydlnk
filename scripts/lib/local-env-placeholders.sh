#!/usr/bin/env bash
#
# Local placeholder values for the Milestone 4 services, shared by scripts/init.sh and CI so the two
# never drift. Source it, then call: ensure_local_env_placeholders <env file>
#
# Appends a line for every variable below that the file does not already define, and never touches
# one that is there (a real sandbox key from `stripe listen` stays). Every value is a placeholder for
# the local stubs the e2e specs run, never a real key or token:
#   * STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET pass validation but are not Stripe credentials;
#   * the price ids are placeholders for the local stub (not secret): the Pro ones are the HYDLNK
#     sandbox's earlier ids, the Studio yearly one is invented. The amounts the app shows come from
#     src/lib/billing/prices.ts, never from these ids;
#   * STRIPE_API_HOST points the Stripe SDK at the stub the billing specs start on 127.0.0.1:12111;
#   * VERCEL_API_BASE_URL points the Vercel client at the stub Playwright starts on 127.0.0.1:12112;
#   * CRON_SECRET / VISITOR_HASH_SECRET are fake local values: the first is the bearer token the cron
#     routes check, the second salts the daily visitor hash. Production sets its own on Vercel;
#   * NEXT_PUBLIC_GOOGLE_CLIENT_ID is a placeholder client id (public, not secret): it makes the Google
#     button render so the Playwright specs, which stub Google's script, can exercise it. Google's
#     real script answers it with an error, so use a real id only to try the real popup.
# STRIPE_API_HOST and VERCEL_API_BASE_URL are test-only: env validation refuses both when
# VERCEL_ENV=production, and a missing VERCEL_API_TOKEN / VERCEL_PROJECT_ID makes a domain removal
# fail closed, so production never talks to a stub and never skips the call.
#
# Prints how many lines it added (0 when the file already had everything) and returns 0.

ensure_local_env_placeholders() {
  local file=$1 name value added=0
  [ -f "$file" ] || {
    echo 0
    return 0
  }
  while IFS='=' read -r name value; do
    [ -n "$name" ] || continue
    if ! grep -Eq "^${name}=" "$file"; then
      printf '%s=%s\n' "$name" "$value" >>"$file"
      added=$((added + 1))
    fi
  done <<'EOF_PLACEHOLDERS'
STRIPE_SECRET_KEY=sk_test_local_placeholder_not_a_real_key
STRIPE_WEBHOOK_SECRET=whsec_local_placeholder_for_signature_tests
STRIPE_PRICE_PRO_MONTHLY=price_1ULqSqPPBBbR7vbm09BzBmao
STRIPE_PRICE_PRO_YEARLY=price_1ULqSsPPBBbR7vbmjrKneiN5
STRIPE_PRICE_STUDIO_MONTHLY=price_1ULqSuPPBBbR7vbmITbiFb3y
STRIPE_PRICE_STUDIO_YEARLY=price_local_studio_yearly_placeholder
STRIPE_API_HOST=127.0.0.1:12111
VERCEL_API_TOKEN=local_placeholder_not_a_real_token
VERCEL_PROJECT_ID=prj_local_placeholder
VERCEL_TEAM_ID=team_local_placeholder
VERCEL_API_BASE_URL=http://127.0.0.1:12112
CRON_SECRET=local-placeholder-cron-secret-not-a-real-secret
VISITOR_HASH_SECRET=local-placeholder-visitor-hash-secret-not-real
NEXT_PUBLIC_GOOGLE_CLIENT_ID=local-placeholder-client-id.apps.googleusercontent.com
EOF_PLACEHOLDERS
  chmod 600 "$file"
  echo "$added"
}
