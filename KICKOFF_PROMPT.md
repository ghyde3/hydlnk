# HYDLNK — Claude Code kickoff

---

You're the lead engineer on HYDLNK. This first session sets up the project and its development harness so that later sessions — often unattended — can build features one at a time and prove each one works. **Don't build product features in this session.**

## Context

- **Product:** a multi-tenant link-in-bio platform (Linktree alternative) whose edge is design control: block layouts, a theme token system, saved themes. Open but unadvertised signup. Most users are on phones.
- **Read these fully before anything else:**
  - `docs/PLAN.md` — scope, architecture, data model, tenant theme tokens, analytics, milestones, monetization, cost control, risks, open decisions.
  - `docs/DESIGN.md` — the HYDLNK UI spec: tokens, responsive rules, components, screen inventory.
  - `design/mockups/` — the clickable mockups exported from the design canvas. Read them as annotated HTML for layout, copy, states and exact values; they use a proprietary runtime that isn't included, so don't run or port them.
- **Stack (decided):** Next.js App Router + TypeScript on Vercel · Supabase (Auth, Postgres + RLS, Storage, pg_cron) · Stripe Checkout + hosted customer portal · Zod · dnd-kit.



## How to work in this session

1. **Explore, then plan.** Read the docs and mockups, then present a plan: repo layout, tool choices with a one-line reason each, and every harness file you'll create. Wait for my approval before writing files.
2. **Ask blocking questions once, up front,** with the AskUserQuestion tool — e.g. package manager, Node version, whether Supabase/Vercel/Stripe dev projects exist yet, whether hydlnk.com is registered. For everything else pick a sensible default and list it under Assumptions in your final report.
3. **Don't trust memory for versions or config syntax.** Check current docs for Next.js, Supabase, Stripe, Playwright and Claude Code ([https://code.claude.com/docs](https://code.claude.com/docs) — memory, settings, hooks, sub-agents, skills, MCP, best practices) before writing config. Pin exact versions.
4. **Local start building locally then use the connections to get the whole project set up for production**
5. **Use subagents for wide reading** (docs, mockups) so the main context stays clean.



## What to set up



### 1. Scaffold (Milestone 0)

- Next.js (current stable), TypeScript strict, one formatter/linter setup (ESLint + Prettier, or Biome — pick one), path aliases, `src/` with route groups for marketing, the editor app and tenant pages.
- Host-based middleware stub per PLAN.md → Architecture: `hydlnk.com` → marketing, `app.*` → editor, `{handle}.*` → tenant page, other hosts → domain lookup (stubbed). Local dev must work at `localhost:3000`, `app.localhost:3000` and `mara.localhost:3000`; document it.
- Two separate token layers, never mixed: HYDLNK UI tokens from DESIGN.md as CSS variables (plus Tailwind theme mapping if you use Tailwind), and the tenant theme token model from PLAN.md (types + a resolver; no UI yet).
- Supabase local: first migration for the PLAN.md data model with RLS enabled on every table, seed data (reserved handles, system themes Noir/Ivory/Smoke, demo tenant `mara`), and a script that regenerates TypeScript types.
- Env: `.env.example` listing every variable; Zod-validated env that fails fast; the service-role key importable only from server code (enforce with `server-only`).
- Package scripts: `dev`, `build`, `typecheck`, `lint`, `test` (unit), `test:db` (RLS), `test:e2e`, `verify` (= typecheck + lint + unit + db), `db:reset`, `db:types`, `screens`.



### 2. Verification (the most important part)

Every later session must be able to prove its work without me.

- **Unit (Vitest):** first real tests for tenant token resolution (system → theme → page → block; block overrides limited to color, button style, radius) and the block/page Zod schemas.
- **Database:** RLS tests (pgTAP via `supabase test db`, or equivalent) proving tenant A can't read or write tenant B's rows, drafts are never publicly readable, `events` is server-insert only, and system themes are readable by everyone.
- **End to end (Playwright):** two projects — phone 390×844 and desktop 1440×900. Smoke tests: marketing page renders; `app.localhost` and `mara.localhost` route correctly.
- **Visual:** `pnpm screens <route>` (or equivalent) saves screenshots at both viewports to `tmp/screens/` for comparison with `design/mockups/`.
- `scripts/init.sh`**:** idempotent — install deps, start Supabase local, reset and seed the DB, start the dev server, run the smoke test, print a one-screen status. Every session starts with it.



### 3. Long-running harness

Follow Anthropic's initializer / coding-agent pattern ([https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).

- `docs/features.json`**:** expand PLAN.md milestones 1–5 into small, independently testable features (expect roughly 80–150). Each has `id`, `milestone`, `area`, `title`, `acceptance` (concrete steps a person or Playwright can check, including the 390px check), and `passes: false`. Rule, stated in the file and in CLAUDE.md: features are only ever added or have `passes` flipped with evidence — never deleted, reworded or weakened.
- `PROGRESS.md`**:** session log, newest first — date, feature ids touched, what changed, evidence, next step, known issues. Keep each entry short.
- **Git:** initialize, `.gitignore`, conventional commits, one commit per feature with its id in the message, a branch per milestone, PRs via `gh`.



### 4. Claude Code configuration

Verify the syntax of each file against the current Claude Code docs before writing it.

- `CLAUDE.md` — under ~120 lines; only what Claude can't infer from the code: a short product summary, commands, a directory-level repo map, the invariants below, the definition of done, the session start/end ritual, and pointers (not `@` imports) to PLAN.md, DESIGN.md, features.json and PROGRESS.md. Add a compaction instruction: always preserve the current feature id, modified files and test commands. Put area-specific rules in `.claude/rules/` (e.g. Supabase migrations, tenant pages, editor) instead of growing CLAUDE.md.
- `.claude/settings.json` (committed; personal overrides go in `settings.local.json`):
  - Permissions — allow the package scripts, git (no force push), `gh`, the local Supabase CLI and Playwright. Deny reading `.env*` secrets, `supabase db push`/`link` to remote, production deploys, `rm -rf`, `git push --force`.
  - Hooks — **PostToolUse** on Edit/Write: format and lint only the touched file. **PreToolUse:** block edits to already-applied migrations (write a new one) and to `.env`*. **Stop:** when source files changed since the last commit (skip otherwise, so questions and plan-only turns aren't blocked), run the fast checks (`typecheck` + `lint` + unit) and block finishing while they fail, with a cap (e.g. allow stop after 3 consecutive blocks) so it can't loop. **SessionStart** (startup/resume): print the top of PROGRESS.md and the next 3 failing features.
- `.claude/agents/`**:**
  - `reviewer` — fresh-context review of the current diff against the feature's acceptance criteria and PLAN.md. Reports only correctness and requirement gaps, not style.
  - `security-reviewer` — tenancy and RLS, service-role leakage into client bundles, open redirects in `/r/[blockId]`, XSS from tenant content (links, embeds, fonts, bio), SSRF via custom domains or OG image fetches, rate limits on `/api/e` and `/r`, Stripe webhook signature checks.
  - `design-verifier` — runs the screenshot script at 390 and 1440, compares against the matching mockup and DESIGN.md, and lists concrete differences (spacing, type, color, states, 44px targets, focus rings).
- `.claude/skills/` (short SKILL.md each):
  - `feature-loop` (manual only, `disable-model-invocation: true`): run init.sh → pick the next failing feature → plan → implement with tests → verify (unit, db, e2e at both viewports, screenshots) → `reviewer` (and `security-reviewer` when auth, data, routing or payments are touched) → flip `passes` with evidence → update PROGRESS.md → commit. One feature per session.
  - `add-block-type`: Zod schema, one renderer shared by preview and public page, editor form, analytics block id, tests.
  - `db-change`: new migration, RLS policy and policy test in the same change, regenerate types, never edit an applied migration.
- `.mcp.json` (project scope, no secrets inline): Playwright MCP for interactive browser checks. Supabase MCP only read-only and pointed at the local/dev project. Prefer CLIs (`gh`, `supabase`, `stripe`, `vercel`) for everything else.
- **CI (GitHub Actions) on every PR:** install, typecheck, lint, unit, db tests against a local Supabase, Playwright at both viewports; upload screenshots and traces as artifacts.



## Invariants (copy into CLAUDE.md)

- Public reads return `published` only, never `draft`, through server-only queries.
- The service-role key never reaches client code.
- Every table has RLS on; every new table ships with policies and a policy test in the same change.
- Plan limits (pages, domains, upload bytes) are enforced server-side on write, never only in the UI.
- Tenant content is untrusted: validate URLs (http/https only), escape all text, embeds only from an allowlist (YouTube, Spotify).
- HYDLNK UI tokens and tenant theme tokens are separate systems.
- Mobile first: nothing passes until it works at 390px with touch targets of at least 44px.



## Definition of done (every feature)

Acceptance steps pass in Playwright at 390 and 1440 · unit/db tests added · `verify` green · `reviewer` reports no correctness gaps · screenshots checked against the mockup · `passes: true` with evidence in PROGRESS.md · one commit.

## Finish

Stop once the harness and the Milestone 0 skeleton are in place — don't start Milestone 1. Then report:

1. What you created, as a tree (no file contents).
2. Evidence: the output of `scripts/init.sh` and `verify`, and the smoke tests at both viewports.
3. Assumptions you made, and blockers that need me — name each blocker and stop; no suggestions for work I already track.
4. The first five features from `features.json` you'd take next.

