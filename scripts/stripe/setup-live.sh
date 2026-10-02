#!/usr/bin/env bash
#
# HYDLNK Stripe setup: products, prices, customer portal and webhook endpoint.
#
#   scripts/stripe/setup-live.sh --profile <stripe-cli-profile> [--live] [--apply]
#
# Default is a DRY RUN: it only reads from Stripe and prints what it would change.
# --apply performs the changes. Without --live it targets test mode (the sandbox);
# with --live it passes --live to every stripe call, prints the account it is about
# to change and asks you to type the account id first.
#
# Source of truth: scripts/stripe/catalog.json (products and prices). The webhook
# events, the portal settings and the URLs are constants below and mirror the code
# in src/lib/billing/ and src/app/(editor)/app/api/stripe/webhook/route.ts.
#
# Safe to run again: it only creates what is missing and only updates what differs.
# It never deletes anything. Prices are immutable in Stripe, so a price whose amount
# or interval differs gets a NEW price and the lookup key moves to it
# (transfer_lookup_key); the superseded price is deactivated unless a subscription
# still uses it.
#
# It never prints a secret: Stripe's webhook signing secret and API keys are not
# read, stored or shown (the signing secret is stripped from the create response
# before anything can see it). Needs the Stripe CLI and jq. Works with macOS's
# bash 3.2.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CATALOG="$SCRIPT_DIR/catalog.json"

# --- What the code expects (keep in sync with src/lib/billing) -------------------------------
APP_ORIGIN="https://app.hydlnk.com"
WEBHOOK_URL="$APP_ORIGIN/api/stripe/webhook"
PORTAL_RETURN_URL="$APP_ORIGIN/settings"
PORTAL_NAME="HYDLNK default"
PORTAL_HEADLINE="Manage your HYDLNK plan"
# Exactly the event types processWebhook() in src/lib/billing/webhook.ts acts on. Every other
# type is acknowledged and ignored, so subscribing to more only adds traffic.
WEBHOOK_EVENTS=(
  checkout.session.completed
  customer.subscription.created
  customer.subscription.deleted
  customer.subscription.updated
)
# The API version the app's Stripe SDK pins (STRIPE_API_VERSION in src/lib/billing/stripe.ts).
# A new webhook endpoint is created on the same version, so event payloads match the code.
WEBHOOK_API_VERSION="2026-09-30.endive"
VERCEL_SCOPE="ghyde3s-projects"
# The HYDLNK sandbox account. --live refuses it.
SANDBOX_ACCOUNT_ID="acct_1ULlVoPPBBbR7vbm"

# --- Output helpers ---------------------------------------------------------------------------
say() { printf '%s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
step() { printf '\n%s\n' "$*"; }
# Masks anything that looks like a Stripe key or signing secret in text taken from the CLI.
redact() { sed -E 's/(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/\1_REDACTED/g'; }

usage() {
  cat <<'EOF'
Usage: scripts/stripe/setup-live.sh --profile <stripe-cli-profile> [--live] [--apply]

  --profile NAME  the Stripe CLI profile to use (stripe login --project-name NAME). Required.
  --live          target the LIVE account of that profile (default: test mode, the sandbox).
                  Every stripe call gets --live. With --apply you must first type the account id.
  --apply         perform the changes. Without it nothing is changed: the script reads from
                  Stripe and prints the plan (a dry run).
  -h, --help      this text

Examples:
  scripts/stripe/setup-live.sh --profile hydlnk                       # sandbox, dry run
  scripts/stripe/setup-live.sh --profile hydlnk --apply               # sandbox, apply
  scripts/stripe/setup-live.sh --profile hydlnk-live --live           # live, dry run
  scripts/stripe/setup-live.sh --profile hydlnk-live --live --apply   # live, apply
EOF
}

PROFILE=""
LIVE=0
APPLY=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      [[ $# -ge 2 ]] || die "--profile needs a value"
      PROFILE=$2
      shift 2
      ;;
    --profile=*)
      PROFILE=${1#--profile=}
      shift
      ;;
    --live)
      LIVE=1
      shift
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
done
[[ -n $PROFILE ]] || {
  usage >&2
  die "--profile is required"
}

command -v stripe >/dev/null 2>&1 || die "the Stripe CLI is not installed (https://docs.stripe.com/stripe-cli)"
command -v jq >/dev/null 2>&1 || die "jq is not installed (brew install jq)"
[[ -f $CATALOG ]] || die "missing $CATALOG"
# The CLI would use this key instead of the profile: the run could then hit another account.
[[ -z ${STRIPE_API_KEY:-} ]] || die "STRIPE_API_KEY is set in this shell. Unset it: this script uses the CLI profile only."

ERR_FILE=$(mktemp "${TMPDIR:-/tmp}/hydlnk-stripe-setup.XXXXXX")
trap 'rm -f "$ERR_FILE"' EXIT

# --- The one place the Stripe API is called -----------------------------------------------------
# Every call gets the profile, --confirm (so a live write does not stall on the CLI's own prompt:
# the typed confirmation below has already happened) and, in live mode, --live. The Stripe CLI
# exits 0 on API errors, so the JSON is checked here and the script stops on `error`. Anything
# printed from an error is redacted, and a `secret` field is dropped from every response.
api() {
  local method=$1 path=$2 out rc=0
  shift 2
  if [[ $LIVE -eq 1 ]]; then
    out=$(stripe -p "$PROFILE" "$method" "$path" "$@" --confirm --live 2>"$ERR_FILE") || rc=$?
  else
    out=$(stripe -p "$PROFILE" "$method" "$path" "$@" --confirm 2>"$ERR_FILE") || rc=$?
  fi
  if ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$out"; then
    die "stripe $method $path failed (exit $rc): $(head -c 300 "$ERR_FILE" | tr '\n' ' ' | redact)"
  fi
  if jq -e 'has("error")' >/dev/null <<<"$out"; then
    die "Stripe rejected $method $path: $(jq -r '.error.message // "unknown error"' <<<"$out" | redact)"
  fi
  jq -c 'del(.secret)' <<<"$out"
}

# Every object of a list endpoint as one JSON array (pages of 100, up to 50 pages).
list_all() {
  local path=$1 all='[]' page more last pages=0
  shift
  local -a after=()
  while :; do
    page=$(api get "$path" -l 100 "$@" ${after[@]+"${after[@]}"})
    all=$(jq -c --argjson page "$page" '. + $page.data' <<<"$all")
    more=$(jq -r '.has_more' <<<"$page")
    [[ $more == true ]] || break
    last=$(jq -r '.data[-1].id' <<<"$page")
    after=(-a "$last")
    pages=$((pages + 1))
    [[ $pages -lt 50 ]] || die "more than 5000 objects at $path: refusing to continue"
  done
  printf '%s' "$all"
}

# DARGS: the lines of $1 (key=value, one per line) as stripe `-d` arguments.
DARGS=()
to_dargs() {
  local line
  DARGS=()
  while IFS= read -r line; do
    if [[ -n $line ]]; then DARGS+=(-d "$line"); fi
  done <<<"$1"
}

PLANNED=0
change() {
  PLANNED=$((PLANNED + 1))
  say "  $1 $2"
}

# --- Catalog ------------------------------------------------------------------------------------
jq -e '
  (.pricesConfirmed | type == "boolean")
  and (.currency | test("^[a-z]{3}$"))
  and (.products | length > 0)
  and (.products | all(
        (.plan | test("^[a-z0-9_]+$")) and (.name | length > 0) and (.description | length > 0)
        and (.metadata.app == "hydlnk") and (.metadata.plan == .plan)
        and (.prices | length > 0)
        and (.prices | all(
              (.lookup_key | test("^[a-z0-9_]+$")) and (.env | test("^STRIPE_PRICE_[A-Z_]+$"))
              and (.unit_amount | type == "number" and . > 0 and . == floor)
              and (.interval == "month" or .interval == "year")
              and (.enabled | type == "boolean")))))
  and ([.products[].prices[].lookup_key] | (unique | length) == length)
' "$CATALOG" >/dev/null || die "$CATALOG is invalid (see its _howto field)"
CURRENCY=$(jq -r '.currency' "$CATALOG")
PRICES_CONFIRMED=$(jq -r '.pricesConfirmed' "$CATALOG")

# --- Which account, which mode --------------------------------------------------------------------
if [[ $LIVE -eq 1 ]]; then
  MODE_LABEL="LIVE"
  KEY_FIELD="live_mode_key"
else
  MODE_LABEL="test mode (sandbox)"
  KEY_FIELD="test_mode_key"
fi
# `stripe whoami` only reads the local CLI config (no API call, so no --live); it is piped
# straight into jq so that nothing but the one boolean is ever seen.
HAS_KEY=$(stripe -p "$PROFILE" whoami --format json 2>/dev/null | jq -r --arg f "$KEY_FIELD" '.[$f].available // false' 2>/dev/null) || HAS_KEY=false
if [[ $HAS_KEY != true ]]; then
  if [[ $LIVE -eq 1 ]]; then
    die "the Stripe CLI profile '$PROFILE' has no live-mode key. Run: stripe login --project-name $PROFILE   and choose the LIVE HYDLNK account."
  fi
  die "the Stripe CLI profile '$PROFILE' has no test-mode key. Run: stripe login --project-name $PROFILE"
fi

ACCOUNT=$(api get /v1/account)
ACCT_ID=$(jq -r '.id' <<<"$ACCOUNT")
ACCT_NAME=$(jq -r '[.business_profile.name, .settings.dashboard.display_name] | map(select(. != null and . != "")) | unique | join(" / ")' <<<"$ACCOUNT")
ACCT_LOWER=$(printf '%s' "$ACCT_NAME" | tr '[:upper:]' '[:lower:]')

case $ACCT_LOWER in
  *hydlnk*) ;;
  *)
    die "this is not a HYDLNK account: ${ACCT_ID} is named \"${ACCT_NAME:-(no name)}\". Set the public business name to HYDLNK in the Stripe Dashboard (Settings > Business > Public details) or pick the right profile."
    ;;
esac
if [[ $LIVE -eq 1 ]]; then
  [[ $ACCT_ID != "$SANDBOX_ACCOUNT_ID" ]] || die "$ACCT_ID is the HYDLNK sandbox, not the live account. Run stripe login --project-name $PROFILE and choose the live account."
  case $ACCT_LOWER in
    *sandbox*) die "the account name \"$ACCT_NAME\" says sandbox: refusing to treat it as the live account." ;;
  esac
fi

say "HYDLNK Stripe setup"
say "  account : $ACCT_NAME ($ACCT_ID)"
say "  mode    : $MODE_LABEL"
if [[ $APPLY -eq 1 ]]; then say "  run     : APPLY (changes Stripe)"; else say "  run     : DRY RUN (reads only, changes nothing)"; fi
say "  catalog : $CATALOG"

if [[ $LIVE -eq 1 && $APPLY -eq 1 ]]; then
  [[ $PRICES_CONFIRMED == true ]] || die "catalog.json has pricesConfirmed=false: confirm the prices first (see its _notice), then set it to true."
  [[ -t 0 ]] || die "--live --apply needs an interactive terminal for the typed confirmation."
  say ""
  say "About to CHANGE the LIVE Stripe account \"$ACCT_NAME\" ($ACCT_ID)."
  printf 'Type the account id to continue: '
  ANSWER=""
  { read -r ANSWER </dev/tty; } 2>/dev/null || die "no terminal to read the confirmation from."
  [[ $ANSWER == "$ACCT_ID" ]] || die "that is not the account id. Nothing was changed."
fi

# --- Read the current state ------------------------------------------------------------------------
PRODUCTS=$(list_all /v1/products -d active=true)
PRICES=$(list_all /v1/prices)

# Parallel arrays for the summary (one row per catalog price) and the portal's product list.
S_PLAN=()
S_LK=()
S_ENV=()
S_ID=()
S_STATE=()
PORTAL_PRODUCTS='[]'
PORTAL_PENDING=0
PRODUCT_ROWS=()

# --- 1/3 Products -------------------------------------------------------------------------------------
# Finds the product of a catalog entry (metadata app+plan first, then plan+name, then name),
# creates it when missing and brings its name, description, tax code and metadata in line.
process_product() {
  local prod=$1 plan name description tax_code meta matches found n_meta pid lines resp
  plan=$(jq -r '.plan' <<<"$prod")
  name=$(jq -r '.name' <<<"$prod")
  description=$(jq -r '.description' <<<"$prod")
  tax_code=$(jq -r '.tax_code // ""' <<<"$prod")
  meta=$(jq -c '.metadata' <<<"$prod")

  matches=$(jq -c --arg plan "$plan" --arg name "$name" '
      ([.[] | select(.metadata.app == "hydlnk" and .metadata.plan == $plan)]
       + [.[] | select(.metadata.plan == $plan and .name == $name)]
       + [.[] | select(.name == $name)])' <<<"$PRODUCTS")
  found=$(jq -c '.[0] // empty' <<<"$matches")
  n_meta=$(jq --arg plan "$plan" '[.[] | select(.metadata.app == "hydlnk" and .metadata.plan == $plan)] | length' <<<"$PRODUCTS")
  if [[ $n_meta -gt 1 ]]; then
    say "  !  $n_meta active products are tagged app=hydlnk plan=$plan: using the first listed. Archive the extras in the Dashboard."
  fi

  pid=""
  if [[ -z $found ]]; then
    change "+" "create product \"$name\""
    PRODUCT_ROWS+=("$name||would create")
    if [[ $APPLY -eq 1 ]]; then
      lines=$(jq -rn --arg name "$name" --arg d "$description" --arg tc "$tax_code" --argjson meta "$meta" '
          ["name=\($name)", "description=\($d)"]
          + (if $tc != "" then ["tax_code=\($tc)"] else [] end)
          + ($meta | to_entries | map("metadata[\(.key)]=\(.value)")) | .[]')
      to_dargs "$lines"
      resp=$(api post /v1/products "${DARGS[@]}")
      pid=$(jq -r '.id' <<<"$resp")
      say "      -> $pid"
      PRODUCT_ROWS[${#PRODUCT_ROWS[@]} - 1]="$name|$pid|created"
    fi
  else
    pid=$(jq -r '.id' <<<"$found")
    lines=$(jq -r --arg name "$name" --arg d "$description" --arg tc "$tax_code" --argjson meta "$meta" '
        . as $p
        | (if $p.name != $name then "name=\($name)" else empty end),
          (if ($p.description // "") != $d then "description=\($d)" else empty end),
          (if $tc != "" and ($p.tax_code // "") != $tc then "tax_code=\($tc)" else empty end),
          ($meta | to_entries[] | select(($p.metadata[.key] // null) != .value) | "metadata[\(.key)]=\(.value)")' <<<"$found")
    if [[ -z $lines ]]; then
      say "  ok $name ($pid)"
      PRODUCT_ROWS+=("$name|$pid|ok")
    else
      change "~" "update product \"$name\" ($pid): $(printf '%s' "$lines" | tr '\n' ' ' | sed -E 's/ +$//')"
      PRODUCT_ROWS+=("$name|$pid|update")
      if [[ $APPLY -eq 1 ]]; then
        to_dargs "$lines"
        api post "/v1/products/$pid" "${DARGS[@]}" >/dev/null
        PRODUCT_ROWS[${#PRODUCT_ROWS[@]} - 1]="$name|$pid|updated"
      fi
    fi
  fi

  process_prices "$prod" "$pid"
}

# --- 1/3 Prices ---------------------------------------------------------------------------------------
# One price per catalog entry, matched by lookup_key. A price that matches (product, amount,
# currency, interval, active) is kept and only its metadata is reconciled. Otherwise a NEW price
# is created and the lookup key is transferred to it; the superseded price is deactivated unless
# a subscription still uses it. Disabled catalog prices are never created.
process_prices() {
  local prod=$1 pid=$2 plan n i price lk env nickname amount interval enabled note
  local held held_id held_active match meta_all lines resp new_id ids='[]' retiring='[]' pending=0 others
  plan=$(jq -r '.plan' <<<"$prod")
  n=$(jq '.prices | length' <<<"$prod")
  for ((i = 0; i < n; i++)); do
    price=$(jq -c ".prices[$i]" <<<"$prod")
    lk=$(jq -r '.lookup_key' <<<"$price")
    env=$(jq -r '.env' <<<"$price")
    nickname=$(jq -r '.nickname // ""' <<<"$price")
    amount=$(jq -r '.unit_amount' <<<"$price")
    interval=$(jq -r '.interval' <<<"$price")
    enabled=$(jq -r '.enabled' <<<"$price")
    note=$(jq -r '.note // ""' <<<"$price")
    meta_all=$(jq -c --arg iv "$interval" '.metadata + {interval: $iv}' <<<"$prod")

    held=$(jq -c --arg lk "$lk" '[.[] | select(.lookup_key == $lk)][0] // empty' <<<"$PRICES")
    held_id=""
    held_active=false
    if [[ -n $held ]]; then
      held_id=$(jq -r '.id' <<<"$held")
      held_active=$(jq -r '.active' <<<"$held")
    fi

    if [[ $enabled != true ]]; then
      if [[ -n $held_id && $held_active == true ]]; then
        say "  !  $lk is disabled in the catalog but price $held_id is live under that key: left untouched."
      else
        say "  -  $lk skipped (disabled in the catalog: $note)"
      fi
      S_PLAN+=("$plan"); S_LK+=("$lk"); S_ENV+=("$env"); S_ID+=(""); S_STATE+=("disabled")
      continue
    fi

    match=false
    if [[ -n $held ]] && jq -e --arg pid "$pid" --argjson amt "$amount" --arg cur "$CURRENCY" --arg iv "$interval" '
        .active == true and .product == $pid and .unit_amount == $amt and .currency == $cur
        and .type == "recurring" and .recurring.interval == $iv and .recurring.interval_count == 1
        and .billing_scheme == "per_unit" and .recurring.usage_type == "licensed"' <<<"$held" >/dev/null; then
      match=true
    fi

    local row_state="ok" row_id=""
    if [[ $match == true ]]; then
      row_id=$held_id
      lines=$(jq -r --argjson want "$meta_all" '
          . as $p | $want | to_entries[] | select(($p.metadata[.key] // null) != .value) | "metadata[\(.key)]=\(.value)"' <<<"$held")
      if [[ -z $lines ]]; then
        say "  ok $lk ($held_id): $(format_amount "$amount") / $interval"
      else
        change "~" "update price $lk ($held_id): $(printf '%s' "$lines" | tr '\n' ' ' | sed -E 's/ +$//')"
        row_state="update"
        if [[ $APPLY -eq 1 ]]; then
          to_dargs "$lines"
          api post "/v1/prices/$held_id" "${DARGS[@]}" >/dev/null
          row_state="updated"
        fi
      fi
    else
      local why="" old_amount old_interval has_held=false
      if [[ -n $held_id ]]; then
        has_held=true
        old_amount=$(jq -r '.unit_amount // 0' <<<"$held")
        old_interval=$(jq -r '.recurring.interval // "?"' <<<"$held")
        why=" (replaces $held_id, $(format_amount "$old_amount") / $old_interval"
        if [[ $held_active != true ]]; then why="$why, inactive"; fi
        why="$why; the lookup key moves to the new price)"
      fi
      change "+" "create price $lk: $(format_amount "$amount") / $interval$why"
      row_state="would create"
      if [[ $APPLY -eq 1 && -n $pid ]]; then
        lines=$(jq -rn --arg pid "$pid" --arg cur "$CURRENCY" --arg amt "$amount" --arg iv "$interval" \
          --arg lk "$lk" --arg nick "$nickname" --argjson held "$has_held" \
          --argjson meta "$meta_all" '
            ["product=\($pid)", "currency=\($cur)", "unit_amount=\($amt)", "recurring[interval]=\($iv)", "lookup_key=\($lk)"]
            + (if $nick != "" then ["nickname=\($nick)"] else [] end)
            + (if $held then ["transfer_lookup_key=true"] else [] end)
            + ($meta | to_entries | map("metadata[\(.key)]=\(.value)")) | .[]')
        to_dargs "$lines"
        resp=$(api post /v1/prices "${DARGS[@]}")
        new_id=$(jq -r '.id' <<<"$resp")
        say "      -> $new_id"
        row_id=$new_id
        row_state="created"
      fi
      if [[ -n $held_id && $held_active == true ]]; then
        queue_retire "$held_id"
        retiring=$(jq -c --arg id "$held_id" '. + [$id]' <<<"$retiring")
      fi
    fi

    S_PLAN+=("$plan"); S_LK+=("$lk"); S_ENV+=("$env"); S_ID+=("$row_id"); S_STATE+=("$row_state")
    if [[ -n $row_id ]]; then
      ids=$(jq -c --arg id "$row_id" '. + [$id]' <<<"$ids")
    else
      pending=1
    fi
  done

  if [[ -n $pid ]]; then
    others=$(jq -r --arg pid "$pid" --argjson keep "$ids" --argjson skip "$retiring" '
        [.[] | select(.product == $pid and .active == true and ((.id | IN($keep[])) | not) and ((.id | IN($skip[])) | not)) | .id] | join(", ")' <<<"$PRICES")
    if [[ -n $others ]]; then
      say "  i  other active prices on $pid that are not in the catalog: $others (deactivate them in the Dashboard if nothing uses them)"
    fi
  fi

  if [[ $(jq 'length' <<<"$ids") -gt 0 || $pending -eq 1 ]]; then
    if [[ -n $pid && $pending -eq 0 ]]; then
      PORTAL_PRODUCTS=$(jq -c --arg p "$pid" --argjson ids "$ids" '. + [{product: $p, prices: ($ids | sort)}]' <<<"$PORTAL_PRODUCTS")
    else
      PORTAL_PENDING=1
    fi
  fi
}

# A superseded price is deactivated (never deleted) unless a subscription still uses it. The
# decision is made while planning, so a dry run shows it; the deactivation itself runs after the
# portal configuration has moved to the new prices (RETIRE_QUEUE, see retire_queued).
RETIRE_QUEUE=()
queue_retire() {
  local id=$1 subs
  subs=$(api get /v1/subscriptions -d "price=$id" -l 1)
  if [[ $(jq '.data | length' <<<"$subs") -eq 0 ]]; then
    change "~" "deactivate superseded price $id (no subscription uses it)"
    if [[ $APPLY -eq 1 ]]; then RETIRE_QUEUE+=("$id"); fi
  else
    say "  !  superseded price $id is still used by a subscription: it stays active. Its subscribers keep paying the old amount and the app will not recognize that price id."
  fi
}

retire_queued() {
  local id
  [[ ${#RETIRE_QUEUE[@]} -gt 0 ]] || return 0
  step "Superseded prices"
  for id in "${RETIRE_QUEUE[@]}"; do
    api post "/v1/prices/$id" -d active=false >/dev/null
    say "  deactivated $id"
  done
}

format_amount() {
  awk -v c="$1" 'BEGIN { if (c % 100 == 0) printf "$%d", c / 100; else printf "$%.2f", c / 100 }'
}

step "1/3  Products and prices"
N_PRODUCTS=$(jq '.products | length' "$CATALOG")
for ((P = 0; P < N_PRODUCTS; P++)); do
  process_product "$(jq -c ".products[$P]" "$CATALOG")"
done

# --- 2/3 Customer portal configuration --------------------------------------------------------------------
# The app opens portal sessions WITHOUT a configuration id (src/lib/billing/portal.ts), so Stripe
# uses the account's DEFAULT portal configuration. `is_default` cannot be set through the API:
# the default is the configuration the Dashboard edits. So this updates the default one in place
# and only creates a configuration when the account has none.
# shellcheck disable=SC2016  # jq programs: the $ variables are jq's, not the shell's
JQ_FLAT='
def flat($p):
  if type == "object" then
    to_entries[] | .key as $k | .value | flat(if $p == "" then $k else "\($p)[\($k)]" end)
  elif type == "array" then
    if all(.[]; type != "object" and type != "array") then
      .[] | "\($p)[]=\(.)"
    else
      to_entries[] | .key as $i | .value | flat("\($p)[\($i)]")
    end
  else
    "\($p)=\(.)"
  end;
flat("")'

# The fields this script manages, from a request-shaped or response-shaped configuration.
# shellcheck disable=SC2016
JQ_PORTAL_NORM='{
  name: .name,
  app: (.metadata.app // null),
  default_return_url: .default_return_url,
  headline: .business_profile.headline,
  customer_update: {
    enabled: .features.customer_update.enabled,
    allowed_updates: ((.features.customer_update.allowed_updates // []) | sort)
  },
  invoice_history: .features.invoice_history.enabled,
  payment_method_update: .features.payment_method_update.enabled,
  subscription_cancel: {
    enabled: .features.subscription_cancel.enabled,
    mode: .features.subscription_cancel.mode,
    proration_behavior: .features.subscription_cancel.proration_behavior,
    reasons_enabled: .features.subscription_cancel.cancellation_reason.enabled,
    reasons: ((.features.subscription_cancel.cancellation_reason.options // []) | sort)
  },
  subscription_update: {
    enabled: .features.subscription_update.enabled,
    default_allowed_updates: ((.features.subscription_update.default_allowed_updates // []) | sort),
    proration_behavior: .features.subscription_update.proration_behavior,
    billing_cycle_anchor: .features.subscription_update.billing_cycle_anchor,
    products: ([(.features.subscription_update.products // [])[]
                | {product: (.product | if type == "object" then .id else . end),
                   prices: ((.prices // []) | map(if type == "object" then .id else . end) | sort),
                   quantity_adjustable: (.adjustable_quantity.enabled // false)}]
               | sort_by(.product))
  }
}'

PORTAL_ID=""
PORTAL_DEFAULT=""
# The id of the default portal configuration, else of one this script tagged app=hydlnk, else "".
find_portal() {
  local id
  id=$(api get /v1/billing_portal/configurations -d is_default=true -d active=true | jq -r '.data[0].id // empty')
  if [[ -z $id ]]; then
    id=$(list_all /v1/billing_portal/configurations -d active=true | jq -r '[.[] | select(.metadata.app == "hydlnk")][0].id // empty')
  fi
  printf '%s' "$id"
}

ensure_portal() {
  local want want_norm cid cfg cur_norm diff resp
  step "2/3  Customer portal configuration"
  if [[ $PORTAL_PENDING -eq 1 ]]; then
    cid=$(find_portal)
    if [[ -n $cid ]]; then
      PORTAL_ID=$cid
      change "~" "update portal configuration $cid: its price list changes once the prices above exist"
    else
      PORTAL_ID="(would create)"
      change "+" "create portal configuration \"$PORTAL_NAME\" once the prices above exist"
    fi
    return 0
  fi

  want=$(jq -nc --arg ret "$PORTAL_RETURN_URL" --arg name "$PORTAL_NAME" --arg head "$PORTAL_HEADLINE" \
    --argjson products "$PORTAL_PRODUCTS" '{
      name: $name,
      metadata: {app: "hydlnk"},
      default_return_url: $ret,
      business_profile: {headline: $head},
      features: {
        customer_update: {enabled: true, allowed_updates: ["email", "name", "address"]},
        invoice_history: {enabled: true},
        payment_method_update: {enabled: true},
        subscription_cancel: {
          enabled: true, mode: "at_period_end", proration_behavior: "none",
          cancellation_reason: {
            enabled: true,
            options: ["too_expensive", "missing_features", "switched_service", "unused", "other"]
          }
        },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          proration_behavior: "create_prorations",
          billing_cycle_anchor: "unchanged",
          products: ($products | map({product: .product, prices: .prices, adjustable_quantity: {enabled: false}}))
        }
      }
    }')
  want_norm=$(jq -c "$JQ_PORTAL_NORM" <<<"$want")
  to_dargs "$(jq -r "$JQ_FLAT" <<<"$want")"

  cid=$(find_portal)

  if [[ -z $cid ]]; then
    change "+" "create portal configuration \"$PORTAL_NAME\""
    PORTAL_ID="(would create)"
    if [[ $APPLY -eq 1 ]]; then
      resp=$(api post /v1/billing_portal/configurations "${DARGS[@]}")
      PORTAL_ID=$(jq -r '.id' <<<"$resp")
      PORTAL_DEFAULT=$(jq -r '.is_default' <<<"$resp")
      say "      -> $PORTAL_ID"
    fi
  else
    PORTAL_ID=$cid
    cfg=$(api get "/v1/billing_portal/configurations/$cid" -e features.subscription_update.products)
    PORTAL_DEFAULT=$(jq -r '.is_default' <<<"$cfg")
    cur_norm=$(jq -c "$JQ_PORTAL_NORM" <<<"$cfg")
    if [[ $cur_norm == "$want_norm" ]]; then
      say "  ok $cid: already matches (default: $PORTAL_DEFAULT)"
    else
      diff=$(jq -rn --argjson a "$cur_norm" --argjson b "$want_norm" '[$b | to_entries[] | select(.value != $a[.key]) | .key] | join(", ")')
      change "~" "update portal configuration $cid, differing: $diff"
      if [[ $APPLY -eq 1 ]]; then
        resp=$(api post "/v1/billing_portal/configurations/$cid" "${DARGS[@]}")
        PORTAL_DEFAULT=$(jq -r '.is_default' <<<"$resp")
      fi
    fi
  fi
  if [[ $PORTAL_DEFAULT == false ]]; then
    local dash_prefix="https://dashboard.stripe.com"
    [[ $LIVE -eq 1 ]] || dash_prefix="$dash_prefix/test"
    say "  !  $PORTAL_ID is NOT the default portal configuration. The app opens portal sessions without a configuration id, so Stripe would use the default one instead."
    say "     Fix: open $dash_prefix/settings/billing/portal, press Save once (that creates the default), then run this script again."
  fi
}
ensure_portal
retire_queued

# --- 3/3 Webhook endpoint ----------------------------------------------------------------------------------
WEBHOOK_ID=""
WEBHOOK_STATE=""
ensure_webhook() {
  local events_json endpoints ep n_same ep_events ep_status ep_version resp
  step "3/3  Webhook endpoint"
  events_json=$(printf '%s\n' "${WEBHOOK_EVENTS[@]}" | jq -R . | jq -sc 'sort')
  endpoints=$(list_all /v1/webhook_endpoints)
  n_same=$(jq --arg url "$WEBHOOK_URL" '[.[] | select(.url == $url)] | length' <<<"$endpoints")
  ep=$(jq -c --arg url "$WEBHOOK_URL" '[.[] | select(.url == $url)][0] // empty' <<<"$endpoints")
  [[ $n_same -le 1 ]] || say "  !  $n_same endpoints point at $WEBHOOK_URL: using the first listed. Remove the duplicates in the Dashboard."

  if [[ -z $ep ]]; then
    change "+" "create webhook endpoint $WEBHOOK_URL with $(jq 'length' <<<"$events_json") events (API version $WEBHOOK_API_VERSION)"
    WEBHOOK_ID="(would create)"
    WEBHOOK_STATE="would create"
    if [[ $APPLY -eq 1 ]]; then
      to_dargs "$(jq -rn --arg url "$WEBHOOK_URL" --arg v "$WEBHOOK_API_VERSION" --argjson ev "$events_json" '
          ["url=\($url)", "api_version=\($v)", "description=HYDLNK billing: plan changes from Checkout and the customer portal"]
          + ($ev | map("enabled_events[]=\(.)")) | .[]')"
      # api() drops the `secret` field, so the signing secret is never held or shown.
      resp=$(api post /v1/webhook_endpoints "${DARGS[@]}")
      WEBHOOK_ID=$(jq -r '.id' <<<"$resp")
      WEBHOOK_STATE="created"
      say "      -> $WEBHOOK_ID"
    fi
    return 0
  fi

  WEBHOOK_ID=$(jq -r '.id' <<<"$ep")
  ep_events=$(jq -c '.enabled_events | sort' <<<"$ep")
  ep_status=$(jq -r '.status' <<<"$ep")
  ep_version=$(jq -r '.api_version // "account default"' <<<"$ep")
  WEBHOOK_STATE="ok"
  if [[ $ep_events == "$events_json" && $ep_status == enabled ]]; then
    say "  ok $WEBHOOK_ID: $WEBHOOK_URL, $(jq 'length' <<<"$events_json") events, enabled"
  else
    change "~" "update webhook endpoint $WEBHOOK_ID (events now: $(jq -r 'join(" ")' <<<"$ep_events"); status: $ep_status) to exactly: $(jq -r 'join(" ")' <<<"$events_json"), enabled"
    WEBHOOK_STATE="update"
    if [[ $APPLY -eq 1 ]]; then
      to_dargs "$(jq -rn --argjson ev "$events_json" '($ev | map("enabled_events[]=\(.)")) + ["disabled=false"] | .[]')"
      api post "/v1/webhook_endpoints/$WEBHOOK_ID" "${DARGS[@]}" >/dev/null
      WEBHOOK_STATE="updated"
    fi
  fi
  if [[ $ep_version != "$WEBHOOK_API_VERSION" ]]; then
    say "  i  this endpoint sends events on API version $ep_version; the app's SDK pins $WEBHOOK_API_VERSION. The version of an endpoint cannot be edited. The app reads the event fields defensively, so this is fine; to match exactly, create a new endpoint in the Dashboard and remove the old one."
  fi
}
ensure_webhook

# --- Summary ---------------------------------------------------------------------------------------------------
step "Summary: $ACCT_NAME ($ACCT_ID), $MODE_LABEL"
for row in "${PRODUCT_ROWS[@]}"; do
  IFS='|' read -r r_name r_id r_state <<<"$row"
  printf '  %-9s %-22s %-34s %s\n' "product" "$r_name" "${r_id:--}" "$r_state"
done
for ((K = 0; K < ${#S_LK[@]}; K++)); do
  printf '  %-9s %-22s %-34s %s\n' "price" "${S_LK[$K]}" "${S_ID[$K]:--}" "${S_STATE[$K]}"
done
PORTAL_LABEL="pending"
if [[ -n $PORTAL_DEFAULT ]]; then PORTAL_LABEL="default: $PORTAL_DEFAULT"; fi
printf '  %-9s %-22s %-34s %s\n' "portal" "$PORTAL_NAME" "${PORTAL_ID:--}" "$PORTAL_LABEL"
printf '  %-9s %-22s %-34s %s\n' "webhook" "app.hydlnk.com" "${WEBHOOK_ID:--}" "${WEBHOOK_STATE:--}"

say ""
if [[ $PLANNED -eq 0 ]]; then
  say "No changes needed: Stripe already matches the catalog."
elif [[ $APPLY -eq 1 ]]; then
  say "Applied $PLANNED change(s). Run it again without --apply to confirm that nothing is left."
else
  say "DRY RUN: $PLANNED change(s) would be made. Nothing was changed. Run again with --apply to perform them."
fi

# --- What to do with the result --------------------------------------------------------------------------------
KNOWN_ALL=1
for ((K = 0; K < ${#S_LK[@]}; K++)); do
  if [[ -z ${S_ID[$K]} && ${S_STATE[$K]} != disabled ]]; then KNOWN_ALL=0; fi
done

step "Vercel: the price ids (not secret)"
if [[ $KNOWN_ALL -eq 0 ]]; then
  say "  The price ids are not all known yet: run with --apply first."
else
  if [[ $LIVE -eq 1 ]]; then
    say "  Run from a checkout linked to the Vercel project (vercel link --scope $VERCEL_SCOPE)."
    say "  Remove a variable first only if it already exists (vercel env ls production):"
    PFX=""
  else
    say "  SANDBOX ids, for the shape only. Do not put these in Production after go-live; they are"
    say "  printed as comments so they cannot be pasted by accident."
    PFX="# "
  fi
  for ((K = 0; K < ${#S_LK[@]}; K++)); do
    if [[ ${S_STATE[$K]} == disabled ]]; then
      say "# ${S_ENV[$K]}: ${S_LK[$K]} is disabled in the catalog, so there is no price id. The app (src/lib/env/server-schema.ts)"
      say "# still requires this variable to be non-empty, so set a clearly fake value and hide the option in the UI:"
      say "${PFX}vercel env rm ${S_ENV[$K]} production --scope $VERCEL_SCOPE --yes"
      say "${PFX}printf '%s' price_${S_LK[$K]}_not_set | vercel env add ${S_ENV[$K]} production --scope $VERCEL_SCOPE"
    else
      say "${PFX}vercel env rm ${S_ENV[$K]} production --scope $VERCEL_SCOPE --yes"
      say "${PFX}printf '%s' ${S_ID[$K]} | vercel env add ${S_ENV[$K]} production --scope $VERCEL_SCOPE"
    fi
  done
fi

step "Two secrets only you can set (this script never reads or prints them)"
if [[ $LIVE -eq 1 ]]; then DASH="https://dashboard.stripe.com"; else DASH="https://dashboard.stripe.com/test"; fi
if [[ $LIVE -eq 1 ]]; then KEY_KIND="rk_live_"; else KEY_KIND="rk_test_"; fi
say "  STRIPE_SECRET_KEY      a RESTRICTED key (${KEY_KIND}...) with the permissions in docs/stripe-go-live.md."
say "                         Create it at $DASH/apikeys and paste it straight into Vercel (Production,"
say "                         tick Sensitive). Never into chat, a file or the shell history."
if [[ -n $WEBHOOK_ID && $WEBHOOK_ID != \(* ]]; then
  say "  STRIPE_WEBHOOK_SECRET  the signing secret (whsec_...) of $WEBHOOK_ID. Reveal it at"
  say "                         $DASH/webhooks/$WEBHOOK_ID (Signing secret > Reveal), then paste it into"
  say "                         Vercel the same way."
else
  say "  STRIPE_WEBHOOK_SECRET  the signing secret (whsec_...) of the webhook endpoint: after --apply, open"
  say "                         $DASH/webhooks, choose the endpoint, Signing secret > Reveal, and paste it"
  say "                         into Vercel (Production, Sensitive)."
fi
