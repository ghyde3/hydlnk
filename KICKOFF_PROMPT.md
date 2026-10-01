# HYDLNK — Claude Code kickoff

---

You're the lead engineer on HYDLNK. This first session sets up the project, its development harness and its production environment, so that later sessions — often unattended — can build features one at a time and prove each one works. **Don't build product features in this session.**

## Context

- **Product:** a multi-tenant link-in-bio platform (Linktree alternative) whose edge is design control: block layouts, a theme token system, saved themes. Open but unadvertised signup. Most users are on phones.
- **Read these fully before anything else:**
  - `docs/PLAN.md` — scope, architecture, data model and access rules, tenant theme tokens, analytics, milestones, monetization, cost control, risks, decided and open items.
  - `docs/DESIGN.md` — the HYDLNK UI spec: tokens, responsive rules, components, screen inventory.
  - `design/mockups/` — the clickable mockups exported from the design canvas. Read them as annotated HTML for layout, copy, states and exact values; they use a proprietary runtime that isn't included, so they can't be run, rendered or ported.
- **Which source wins:** PLAN.md decides scope and behavior, DESIGN.md decides UI values, the mockups show layout. Where a mockup disagrees with the docs, the docs win.
- **Stack (decided):** Next.js 16 App Router + TypeScript on Vercel · Supabase (Auth, Postgres + RLS, Storage, pg_cron) · Stripe Checkout + hosted customer portal · Zod · dnd-kit · pnpm.

## Known as of 2026-10-01

Don't ask about these. Do re-check versions and syntax against current docs.

**Accounts**

- **GitHub:** `ghyde3/hydlnk`, public, `main` already pushed over SSH.
- **Domain:** `hydlnk.com`, registered through Vercel and on Vercel nameservers in the team "ghyde3's projects", so wildcard subdomains work.
- **Vercel:**
  - **Plan:** Hobby while Gary tests. That means no commercial use (Stripe stays in sandbox), no Spend Management, and at most 50 custom domains per project.
  - **Project:** `hydlnk` exists. It's connected to `ghyde3/hydlnk` with `main` as the production branch, uses Node 24.x, and has no framework preset yet.
  - **Domains:** `hydlnk.com` is primary and `www.hydlnk.com` redirects to it with a 308. `app.hydlnk.com` and `*.hydlnk.com` are also on the project. All are verified and serve valid SSL.
- **Supabase:**
  - **Project:** `hydlnk`, ref `pzcinnkzrlyrqkgyetqx`, us-east-1, free plan. It lives in its own Supabase org "HYDLNK", not the Vercel-managed one.
  - **Access:** the Supabase CLI is logged in and can reach it. The claude.ai Supabase connector can't see this org.
  - **Pausing:** free projects pause after 7 days of low activity.
  - **Vercel env vars:** the Supabase integration set the Production env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `POSTGRES_*`. It also added legacy `*ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET` vars; don't use those.
- **Auth:** set in the Supabase dashboard by Gary.
  - Email and Google sign-in are on.
  - Site URL is `https://app.hydlnk.com` and the redirect URL is `https://app.hydlnk.com/auth/callback`. Build the callback at that path.
  - The Google OAuth client lives in Google Cloud project "HYDLNK". It's in Testing, so only listed test users can sign in. Its redirect URIs include the local `http://127.0.0.1:54321/auth/v1/callback`.
  - Mirror these settings in `supabase/config.toml`. Diff before any `supabase config push` so the dashboard settings aren't overwritten.
- **Stripe:** use only the **HYDLNK sandbox**.
  - **Webhook:** an endpoint already exists at `https://app.hydlnk.com/api/stripe/webhook` for `checkout.session.completed` and `customer.subscription.created/updated/deleted`. Build the handler at that path.
  - **Keys:** the sandbox `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in Vercel Production.
  - **CLI:** the Stripe CLI profile `hydlnk` points at the sandbox. Always pass `--project-name hydlnk`.
  - **Off limits:** the connector can also see HYDLNK live and other businesses' live accounts; never touch those.
- **Email:** Supabase's built-in auth email only reaches the team's own addresses (about 2 per hour). That's enough while Gary is the only user. Custom SMTP is a Milestone 5 feature, not this session.

**Tech**

- **Next.js 16:**
  - `proxy.ts` replaces `middleware.ts` and runs on Node only.
  - `next lint` is gone; run ESLint (flat config) or Biome directly.
  - Turbopack is the default.
  - Publish invalidates the page's cache with `updateTag` inside its Server Action. `revalidateTag` now takes a profile as its second argument.
  - `*.localhost` dev hosts need no `allowedDevOrigins`.
- **Tailwind v4** is configured in CSS: the UI tokens map into an `@theme` block, not a config file.
- **Supabase keys** are publishable (`sb_publishable_…`) and secret (`sb_secret_…`). New projects have no anon or service-role keys.
  - The app uses `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, the names already set in Vercel.
  - Local values go into `.env.local` under the same names.
- **Supabase auth and database:**
  - `@supabase/ssr` handles auth, and the proxy refreshes sessions with `getClaims()`.
  - pg_cron has to be enabled in a migration.
  - RLS tests use pgTAP via `supabase test db` with basejump `supabase_test_helpers`.
  - The local stack has an MCP endpoint at `http://localhost:54321/mcp`.
- **Stripe:**
  - Pin API version `2026-09-30.endive`.
  - Local webhooks go through `stripe listen --forward-to`.
- **Custom-domain DNS records** come from the Vercel API for this project; each project gets its own CNAME target. Never hard-code Vercel IPs or CNAME targets.

## How to work in this session

1. **Explore, then plan.** Use subagents to read the docs and mockups, so the main context stays clean. Then present a plan for approval before writing any files. It should cover:
   - the repo layout;
   - tool choices, with a one-line reason each;
   - every harness file you'll create;
   - the production steps.
2. **Ask blocking questions once, up front,** with the AskUserQuestion tool. Only ask what isn't answered above; pick sensible defaults for the rest and list them under Assumptions in your final report.
3. **Don't trust memory for versions or config syntax.** Check current docs before writing config:
   - Next.js, Supabase, Stripe, Playwright and Vercel;
   - Claude Code at [https://code.claude.com/docs](https://code.claude.com/docs): memory, settings, hooks, sub-agents, skills, MCP, permission modes and best practices.

   Pin exact versions.
4. **Local first, then production.** Get everything green locally, then set up production as described in section 5.

## What to set up

### 1. Scaffold (Milestone 0)

- **Project setup:** Next.js 16 (current stable) with TypeScript strict. Pick one formatter/linter setup: ESLint flat config + Prettier, or Biome. Add path aliases and a `src/` folder with route groups for marketing, the editor app and tenant pages.
- **Host routing stub in `proxy.ts`,** per PLAN.md → Architecture:
  - `hydlnk.com` → marketing, and `www.hydlnk.com` redirects to it.
  - `app.*` → the editor. This is the only host that sets auth cookies.
  - `{handle}.*` → a tenant page.
  - Any other host → domain lookup (stubbed).

  Local dev must work at `localhost:3000`, `app.localhost:3000` and `mara.localhost:3000`; document how. Chrome and Firefox resolve `*.localhost` themselves; Safari may need `/etc/hosts` entries.
- **Two token systems, never mixed:**
  - HYDLNK UI tokens from DESIGN.md, as CSS variables mapped into Tailwind's `@theme` if you use Tailwind.
  - The tenant theme token model from PLAN.md: types plus a resolver, no UI yet.
- **Local Supabase:**
  - The first migration covers the whole PLAN.md data model, with RLS on every table and the access rules from PLAN.md → Data model.
  - Reserved handles and the system themes (Noir, Ivory, Smoke) go in a migration so they reach production.
  - `seed.sql` holds local demo data only (tenant `mara`).
  - A script regenerates the TypeScript types.
- **Env:**
  - `.env.example` lists every variable under the Vercel-injected names.
  - Env is Zod-validated and fails fast.
  - The secret key can only be imported from server code (enforce with `server-only`).
- **Package scripts:** `dev`, `build`, `typecheck`, `lint`, `test` (unit), `test:db` (RLS), `test:e2e`, `verify` (= typecheck + lint + unit + db), `db:reset`, `db:types`, `screens`.

### 2. Verification (the most important part)

Every later session must be able to prove its work without me.

- **Unit (Vitest):** first real tests for:
  - tenant token resolution (system → theme → page → block, with block overrides limited to color, button style and radius);
  - the block and page Zod schemas.
- **Database (pgTAP):** RLS tests proving that:
  - tenant A can't read or write tenant B's rows;
  - drafts are never publicly readable;
  - a user can't change their own plan, Stripe customer id or suspension;
  - a user can't write `published` or `published_at` directly, or change any page column except `draft`;
  - a user can't create pages, saved themes or domains past their plan limit, and can't mark a domain verified;
  - clients can't access `events` or `reserved_handles` at all;
  - everyone can read the system themes.
- **End to end (Playwright):** two projects, phone at 390×844 and desktop at 1440×900.
  - Smoke tests check that the marketing page renders and that `app.localhost` and `mara.localhost` route correctly.
  - A separate config runs the same smoke checks against production.
- **Visual:** `pnpm screens <route>` saves screenshots at both viewports to `tmp/screens/`. The mockups can't be rendered, so check the screenshots against the mockup HTML and DESIGN.md values.
- **`scripts/init.sh`:** every session starts with it. It must be safe to run repeatedly, and it:
  1. installs dependencies;
  2. starts local Supabase and writes `.env.local` from `supabase status`;
  3. resets and seeds the database;
  4. starts the dev server and runs the smoke test;
  5. prints a one-screen status.

### 3. Long-running harness

Follow Anthropic's initializer / coding-agent pattern ([https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).

- **`docs/features.json`:**
  - **Scope:** expand PLAN.md milestones 1–5 into small, independently testable features, roughly 80–150. Milestone 0 is this session and isn't listed. Include the pre-launch items from PLAN.md → Open, such as custom SMTP before signup opens.
  - **Fields:** each feature has `id`, `milestone`, `area`, `title`, `acceptance` and `passes: false`. Acceptance steps must be concrete enough for a person or Playwright to check, and include the 390px check.
  - **Rule,** stated in the file and in CLAUDE.md: once the list is committed, features are only ever added or have `passes` flipped with evidence. They are never deleted, reworded or weakened.
- **`PROGRESS.md`:** a session log, newest first. Each short entry has the date, feature ids touched, what changed, evidence, next step and known issues.
- **Git:**
  - Conventional commits, one per feature, with the feature id in the message.
  - One branch per milestone. Open a draft PR with `gh` as soon as the branch exists, so CI runs on every push.
  - Unattended sessions never merge. Merging to `main` deploys production, and goes through the `release` skill.

### 4. Claude Code configuration

Check each file's syntax against the current Claude Code docs before writing it.

- **`CLAUDE.md`:** under about 120 lines, holding only what Claude can't infer from the code:
  - a short product summary and the commands;
  - a directory-level repo map;
  - the invariants below and the definition of done;
  - the session start and end ritual, and how unattended sessions are launched;
  - pointers (not `@` imports) to PLAN.md, DESIGN.md, features.json and PROGRESS.md;
  - this line: "When compacting, always preserve the current feature id, modified files and test commands."

  Area-specific rules go in `.claude/rules/` with `paths:` frontmatter (for example Supabase migrations, tenant pages, the editor) instead of growing CLAUDE.md.
- **`.claude/settings.json`:** committed. Personal overrides go in `settings.local.json`, which is git-ignored.
  - **Allow:** the package scripts, git (no force push), `gh`, the local Supabase CLI and Playwright.
  - **Ask:** `supabase db push`, `supabase link`, `gh pr merge`, and the write tools of the Supabase, Vercel and Stripe connectors (check their exact tool names first). "Ask" means interactive sessions prompt Gary and unattended runs are refused.
  - **Deny:**
    - reading `.env`, `.env.local` and `.env.*.local` (`.env.example` stays readable and editable);
    - `vercel deploy --prod`;
    - `rm -rf`;
    - `git push --force`.
  - **PostToolUse hook** on `Edit|Write`: format and lint only the touched file.
  - **PreToolUse hook:** block:
    - edits to migrations that are already committed (write a new one instead);
    - edits to secret env files;
    - any Stripe connector call that is in live mode or targets an account other than HYDLNK sandbox.
  - **Stop hook:** if source files changed since the last commit, run typecheck + lint + unit and block finishing while they fail. Skip it when nothing changed, so questions and plan-only turns aren't blocked. Use the hook input's `consecutive_block_count` to allow stopping after 3 consecutive blocks.
  - **SessionStart hook** (`startup`, `resume`, `compact`): print the top of PROGRESS.md, the current branch and the next 3 failing features.
- **`.claude/agents/`:**
  - **`reviewer`:** a fresh-context review of the current diff against the feature's acceptance criteria and PLAN.md. It reports only correctness and requirement gaps, not style.
  - **`security-reviewer`** checks:
    - tenancy and RLS, including a user escalating their own access through the publishable key;
    - secret-key leakage into client bundles;
    - auth cookies scoped to `app.*` only;
    - open redirects in `/r/[pageId]/[blockId]`;
    - XSS from tenant content (links, embeds, fonts, bio);
    - SSRF via custom domains or OG image fetches;
    - rate limits on `/api/e` and `/r`;
    - Stripe webhook signature checks.
  - **`design-verifier`:** runs the screenshot script at 390 and 1440, then compares against the matching mockup HTML and DESIGN.md (the docs win on conflicts). It lists concrete differences: spacing, type, color, states, 44px targets, focus rings.
- **`.claude/skills/`** (a short SKILL.md each):
  - **`feature-loop`** (manual only, `disable-model-invocation: true`). One feature per session:
    1. Run init.sh.
    2. Pick the next failing feature and plan it.
    3. Implement it with tests.
    4. Verify: unit, db, e2e at both viewports, screenshots.
    5. Run `reviewer`, plus `security-reviewer` when auth, data, routing or payments are touched.
    6. Flip `passes` with evidence and update PROGRESS.md.
    7. Commit and push the milestone branch.
  - **`release`** (manual only). The only path to production:
    1. Check that `verify` and CI are green.
    2. Run `supabase db push --dry-run` against production and show what it will apply.
    3. Push the migrations.
    4. Merge the PR to `main`, which makes Vercel deploy.
    5. Run the production smoke test and log the release in PROGRESS.md.
  - **`add-block-type`:** Zod schema, one renderer shared by preview and public page, editor form, analytics block id, tests.
  - **`db-change`:** a new migration, with its RLS policy and policy test in the same change; regenerate types; never edit a committed migration.
- **`.mcp.json`** (project scope, no secrets inline):
  - The local Supabase MCP endpoint.
  - No Playwright MCP: interactive browser checks use gstack `/browse` (Gary's global rule), and Playwright is only the test runner.
  - Prefer CLIs (`gh`, `supabase`, `stripe`, `vercel`) for everything else.
- **Unattended runs:** document the launch command in CLAUDE.md, for example `claude -p "/feature-loop" --permission-mode dontAsk`. Check it against the permission-modes docs first: project settings can't set the `auto` or `bypassPermissions` modes, so the mode has to come from the command line.
- **CI (GitHub Actions) on every PR push:**
  - install, typecheck, lint, unit tests;
  - db tests against a local Supabase;
  - Playwright at both viewports;
  - upload screenshots and traces as artifacts.

### 5. Production (after local is green)

The accounts, domains, env vars, Google sign-in and Stripe webhook are already set up (see "Known as of 2026-10-01"). Re-check them, then finish the rest in order. Steps marked **Gary** need him: stop and ask at that point, and never handle a secret key yourself.

1. **Vercel project settings:**
   - Set the framework preset to Next.js.
   - Turn off preview deployments for branches other than `main`; check the current `vercel.json` syntax. Previews would share the production database, and `*.vercel.app` hosts don't fit the host routing.
2. **Link the Supabase CLI** to `pzcinnkzrlyrqkgyetqx`. **Gary** enters the database password in his own terminal if the CLI asks for it.
3. **Check the auth settings:**
   - Before mirroring the dashboard auth settings in `config.toml`, confirm the remote auth config matches "Known" (Site URL, redirect URL, Google provider).
   - **Gary:** put the Google client secret for local dev into a git-ignored env file.
4. **Push migrations the `release` way,** with Gary approving the push.
5. **Stripe, HYDLNK sandbox only:**
   - Create Pro and Studio products with placeholder monthly and yearly prices.
   - Configure the customer portal settings.
   - Put the price ids (not secret) into Vercel env vars.
6. **Deploy and smoke test:** deploy `main`, then run the production smoke test. `hydlnk.com`, `app.hydlnk.com` and an unknown `*.hydlnk.com` handle must all answer correctly over HTTPS, and `www.hydlnk.com` must redirect to the apex.

## Invariants (copy into CLAUDE.md)

- **RLS is the permission system.** Anything RLS allows, a user can do with the publishable key and curl. Server code that writes with the secret key checks ownership itself.
- **Published only.** Public reads return `published` only, never `draft`, through server-only queries.
- **Secret key stays on the server.** It never reaches client code.
- **RLS everywhere.** Every table has RLS on. Every new table ships with policies and a policy test in the same change.
- **Limits on write.** Plan limits (pages, saved themes, domains, upload bytes) are enforced on write, in the database or server-only code, never only in the UI.
- **Tenant content is untrusted.** Validate URLs (http/https only), escape all text, and allow embeds only from an allowlist (YouTube, Spotify).
- **Two token systems.** HYDLNK UI tokens and tenant theme tokens never mix.
- **Auth on `app.*` only.** Auth cookies live there, and tenant subdomains never see them.
- **Production only through `release`.** Production changes go through the `release` skill, with Gary's approval. Unattended sessions never touch production, live Stripe or other projects.
- **Mobile first.** Nothing passes until it works at 390px, with touch targets of at least 44px.

## Definition of done (every feature)

- Acceptance steps pass in Playwright at 390 and 1440.
- Unit and db tests are added.
- `verify` is green.
- `reviewer` reports no correctness gaps.
- Screenshots are checked against the mockup.
- `passes: true`, with evidence in PROGRESS.md.
- One commit.

## Finish

Stop once the harness, the Milestone 0 skeleton and production are in place. Don't start Milestone 1. Then report:

1. What you created, as a tree (no file contents).
2. Evidence: the output of `scripts/init.sh` and `verify`, the smoke tests at both viewports, and the production smoke test.
3. Assumptions you made, and blockers that need me. Name each blocker and stop; no suggestions for work I already track.
4. The first five features from `features.json` you'd take next.
