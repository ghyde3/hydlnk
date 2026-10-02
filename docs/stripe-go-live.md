# Stripe go-live runbook

Gary's checklist for taking real payments. Do the steps in order. Plan on an hour or two, most of it waiting on Stripe's own checks.

Two rules for the whole thing: a Stripe secret never goes into chat, a file or the shell history (password manager, then straight into Vercel), and nothing here touches production code until step f.

What is already done: the code (Checkout, the portal, the webhook) and the sandbox. What this runbook adds: the live account setup, one script that creates the products, prices, portal and webhook the same way every time, and the switch.

## a. Before you start

- [ ] **Vercel is on Pro.** Hobby forbids commercial use. While you are there, set the spend alerts (PLAN.md, "Bandwidth and cost control").
- [ ] **Prices are final.** They are: Pro $9/mo or $60/yr, Studio $20/mo or $180/yr (in `docs/PLAN.md` and `scripts/stripe/catalog.json`, which the script reads). A price cannot be edited once it exists in Stripe, so change them on purpose only.
- [ ] **hydlnk.com shows its legal pages:** Privacy (`/privacy`), Terms (`/terms`) and the refund and cancellation policy (a section of Terms is fine). The marketing PR adds the first two. Stripe looks for these when it reviews a new account.

## b. Stripe Dashboard, live account

Use the live HYDLNK account (the switch at the top left says "Live", not "Sandbox"). Menu names move around, so use the search bar at the top of the Dashboard if a link is stale.

1. **Activate the account.** Business details, bank account for payouts, identity check: <https://dashboard.stripe.com/account/onboarding>. Live charges stay off until this is done.
2. **Public details** (Settings > Business > Public details): business name **HYDLNK** (the setup script refuses any account not named HYDLNK), support email, website `https://hydlnk.com`, statement descriptor **HYDLNK** and a short descriptor (also HYDLNK, it is what appears on card statements), terms of service `https://hydlnk.com/terms`, privacy policy `https://hydlnk.com/privacy`. The customer portal uses these two links.
3. **Branding** (Settings > Branding): HYDLNK icon and logo, brand colour **#1C1B1A** (HYDLNK's primary button colour, `--hl-ink` in `docs/DESIGN.md`) and accent colour **#B8914F** (the brass highlight). Check the preview of Checkout, the portal and receipts, and swap the two if it looks wrong.
4. **Customer emails** (Settings > Customer emails): turn on emails for **successful payments** and **refunds**.
5. **Failed payments** (Settings > Billing > Subscriptions and emails): turn on **Smart Retries**, turn on the failed-payment and expiring-card emails, and set what happens when the retries run out to **cancel the subscription**. The webhook then moves the account back to Free (`customer.subscription.deleted`). While Stripe is still retrying, the account keeps its paid plan (`past_due`).
6. **Tax: pick one.** You need to decide before step f, because each is a small code change. Tell Claude which.
   - **Stripe Tax.** You stay the seller. Stripe works out and adds the right tax at Checkout, but you register for tax in each place you owe it and file and pay it yourself (or hire someone to). Setup: Tax > Registrations, your head-office address, a default tax behaviour (tax on top of the price, or included in it). Code change: ask Checkout for automatic tax.
   - **Managed Payments.** Stripe becomes the seller of record. It handles sales tax, VAT and GST, fraud, disputes and customer support for each sale. It works only for subscriptions bought through Checkout or Payment Links, which is exactly how HYDLNK sells. Setup: enable it at <https://dashboard.stripe.com/settings/managed-payments> and accept its terms; Stripe reviews eligibility (HYDLNK is software, but your business location must be supported). Each product needs an eligible tax code: set `tax_code` in `scripts/stripe/catalog.json` (for example `txcd_10103000`, SaaS personal use, for Pro, and `txcd_10103001`, SaaS business use, for Studio; ask your accountant) and the script applies it. Code change: turn Managed Payments on for the Checkout Session. The Checkout call sends none of the options Managed Payments forbids. It covers new subscriptions only.
   - Fees differ and change: read the current numbers on Stripe's pricing pages (Tax, Managed Payments, and card processing) before you choose.

## c. The restricted live API key

The app uses one Stripe key. Make it a restricted key, so a leak cannot do much. Dashboard (Live) > Developers > API keys > **Create restricted key**, name it `hydlnk-app-production`. Leave everything at **None** except these four (this list comes from what the code calls):

| Permission | Level | Why |
| --- | --- | --- |
| Checkout Sessions | Write | starts the upgrade Checkout |
| Customers | Write | creates the Stripe customer for an account |
| Customer portal | Write | opens Manage billing and the plan-change and cancel screens |
| Subscriptions | Write | reads a subscription for a plan change; cancels subscriptions when an account is deleted |

- The webhook needs **no** API key: it only checks Stripe's signature with the signing secret (step e).
- The code never calls the Prices or Products endpoints and Stripe's permissions reference lists only Checkout Sessions for creating a Session, so they start at None. If the first live Checkout fails with a permission error, the message names what is missing: add that one as Read.
- **Prove the list in the sandbox first (optional, cheap):** create a restricted key with these four in the Sandbox, put it in `.env.local` as `STRIPE_SECRET_KEY`, and run an upgrade, Manage billing and a cancel. If it works there it works live.

Where it goes: Vercel > the hydlnk project > Settings > Environment Variables > add `STRIPE_SECRET_KEY`, environment **Production only**, tick **Sensitive**. Only Production changes: Preview and Development keep their sandbox keys. Save the key in your password manager too, because Stripe shows it once.

**Order matters.** The code today refuses live keys on purpose. Vercel applies variable changes to the next deployment, so a live `STRIPE_SECRET_KEY` in Production plus any deploy before the switch in step f means the app fails its startup check and does not boot. Create the key now, keep it in the password manager, and add it to Vercel in step f when Claude says so. The price ids (step d) and `STRIPE_WEBHOOK_SECRET` (step e) are safe to add any time.

## d. Run the setup script

It creates or updates, in the live account: the two products, the four prices, the customer portal and the webhook endpoint. It only reads unless you say `--apply`, it never deletes, and it never prints a secret. Safe to run twice.

1. Log the Stripe CLI into the live account under its own profile (the sandbox keeps its own profile, `hydlnk`):

   ```sh
   stripe login --project-name hydlnk-live
   ```

   The browser opens: pick the **live HYDLNK account**, not the sandbox.
2. Dry run (reads only):

   ```sh
   scripts/stripe/setup-live.sh --profile hydlnk-live --live
   ```

   Check the account line names HYDLNK and your live account id, and that the plan lists 2 products, 4 prices, the portal and the webhook.
3. Apply. It prints the account again and asks you to type the account id:

   ```sh
   scripts/stripe/setup-live.sh --profile hydlnk-live --live --apply
   ```
4. Dry run once more. It should end with "No changes needed".
5. Put the four price ids in Vercel Production. The script prints the exact commands at the end (`vercel env rm ... --yes`, then `printf '%s' price_... | vercel env add ... production`). Run them from a checkout linked to the Vercel project (`vercel link --scope ghyde3s-projects`). The ids are not secrets. The app needs all four set.
6. If the script warns that the portal configuration is **not the default**: Dashboard > Settings > Billing > Customer portal, press Save once, run the script again. The app opens the portal without naming a configuration, so Stripe must have a default.

The script refuses to run if the profile has no live key, the account is not named HYDLNK or is the sandbox, or `STRIPE_API_KEY` is set in your shell. It refuses `--live --apply` if `pricesConfirmed` in the catalog is not true or there is no interactive terminal for the account-id confirmation.

## e. The webhook

The script finds `https://app.hydlnk.com/api/stripe/webhook` and checks it listens to exactly the four events the code acts on (`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`). If an earlier live endpoint exists with those events, it is kept. If it exists with other events, `--apply` corrects them. If it is missing, `--apply` creates it.

Reveal the signing secret yourself: Dashboard (Live) > Developers > Webhooks > the endpoint > **Signing secret > Reveal**. Add it to Vercel Production as `STRIPE_WEBHOOK_SECRET`, **Sensitive**. A live endpoint and a sandbox endpoint have different secrets.

## f. Tell Claude

Send: "Stripe live setup is done", the tax choice from step b.6, and nothing secret. Claude then:

1. Turns on the live-mode switch (an explicit setting that works in production only; today the app refuses live keys) and applies the tax choice to Checkout.
2. Checks the Billing screen's amounts match the catalog (`src/lib/billing/prices.ts`: $9, $60, $20, $180; yearly shown as $5/mo and $15/mo).
3. Ships it through `/release`, which asks you to approve.
4. Tells you the moment to add the live `STRIPE_SECRET_KEY` to Vercel Production (step c) and redeploy.

## g. Smoke test with a real card

Use a fresh account and your own card. Pro monthly is $9.

1. Sign up, open Settings and **upgrade to Pro (monthly)**. Pay on the Stripe page, which should show HYDLNK branding.
2. Back on Settings you see "Confirming your upgrade", and within about 30 seconds the plan reads **Pro**. Publish a page and check the "Made with HYDLNK" badge is **gone** (reload the public page).
3. Open **Manage billing**. You should see your invoice, the payment method, the Pro and Studio switches (monthly and yearly) and no quantity control. The back link returns to Settings.
4. Cancel in the portal (it asks why and cancels at the end of the period, so the plan stays Pro until then). To see the downgrade now, cancel the subscription immediately in the Dashboard (Customers > the customer > the subscription > Cancel); the plan returns to **Free** and the badge comes back.
5. **Refund the charge** in the Dashboard (Payments > the payment > Refund). Stripe may keep its processing fee on a refund.
6. Check Developers > Webhooks > the endpoint > recent deliveries: every event is **200**. If one is not, read the Vercel runtime logs for lines starting `[stripe]`.

## h. Rollback

If the live setup misbehaves before real customers have paid, point Vercel Production back at the sandbox and redeploy:

1. `STRIPE_SECRET_KEY`: a sandbox restricted key (`rk_test_...`), made the same way as in step c but in the Sandbox.
2. `STRIPE_WEBHOOK_SECRET`: the signing secret of the **sandbox** endpoint (Dashboard in Sandbox mode > Developers > Webhooks).
3. The four `STRIPE_PRICE_*`: the sandbox price ids. `scripts/stripe/setup-live.sh --profile hydlnk` prints them (as comments).
4. Redeploy (Vercel > Deployments > the latest > Redeploy). Sandbox keys are always accepted by the code, so nothing else changes.

Once a real customer has paid, do not roll back: their subscription lives in the live account and the sandbox would never tell the app about it. Fix forward, or cancel and refund them in the live Dashboard first.

## Reference

| Variable (Vercel, Production) | Where it comes from |
| --- | --- |
| `STRIPE_SECRET_KEY` | restricted live key, step c (secret) |
| `STRIPE_WEBHOOK_SECRET` | signing secret of the live endpoint, step e (secret) |
| `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_STUDIO_MONTHLY`, `STRIPE_PRICE_STUDIO_YEARLY` | printed by the setup script, step d (not secret) |

Files: `scripts/stripe/catalog.json` (products and prices), `scripts/stripe/setup-live.sh` (`--help` for options). The script's webhook events and portal settings mirror `src/lib/billing/` and the webhook route; change them together.
