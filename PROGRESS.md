# HYDLNK progress log

Session log, newest first. Every session reads the top entry before starting and adds one at the end. Keep entries short: the date and title, the feature ids touched, what changed, the evidence (commands and results, test names, screenshot paths), the next step, and known issues. Evidence for a feature's `passes: true` lives here, not in `docs/features.json`. Do not rewrite old entries; add a new one.

## 2026-10-01 — Milestone 0 setup

- **Features:** none (Milestone 0 is not listed in `docs/features.json`, which holds 146 features, all `passes: false`).
- **Changed:** branch `m0-setup` (draft PR #1). Next.js 16.3.8 + TypeScript strict + Tailwind 4 scaffold with route groups `(marketing)`, `(editor)/app`, `(tenant)/t|sites`. Host routing in `src/proxy.ts` (`classifyHost`: root, www 308, app, `{handle}`, custom-domain stub). Zod-validated env, typed Supabase clients (server, browser, admin with `server-only`). Local Supabase: two migrations (full data model with RLS on every table, plan limits on write, reserved handles, Noir/Ivory/Smoke system themes), seed (tenant `mara`), 248 pgTAP tests, generated types. Tenant token resolver and Zod schemas. Playwright at 390x844 and 1440x900, `pnpm screens`, `scripts/init.sh`, `scripts/db-types.sh`, `scripts/lib/docker-env.sh`. Claude Code harness (CLAUDE.md, `.claude/` rules, agents, skills, hooks, `.mcp.json`) and GitHub Actions CI.
- **Evidence** (all on the local stack, Node 24.18, Supabase CLI 2.109.0):
  - `scripts/init.sh` from a clean state (`supabase stop --no-backup`, `.next` and `tmp/` removed): exit 0 in 83s, `smoke PASS (3 skipped, 17 passed)`; rerun with the stack up: exit 0 in 37s, same result. Status screen printed branch, Supabase URLs, dev URLs, smoke result and the next three features.
  - `pnpm verify`: typecheck clean, eslint clean, Vitest 7 files / 272 tests passed (204 theme+schemas, 68 `classifyHost`), `supabase test db` 7 files / 248 tests, `Result: PASS`.
  - `pnpm test:e2e`: 20 tests, 17 passed, 3 skipped (the 3 phone-layout tests run on the phone project only). Phone: 10 passed (host routing, claim-form handoff, www 308, unknown handle 404, internal path 404, no horizontal scroll and 44px tap targets on `/`, `app.localhost`, `mara.localhost`). Desktop: 7 passed. The overflow and tap-target helpers were checked against a deliberately bad page and do fail on it.
  - `pnpm build` (with `.env.local`): green, Turbopack, 11 routes plus the proxy. The local secret key does not appear in `.next/static`.
  - `pnpm screens /`, `/ --host app`, `/ --host mara`: `tmp/screens/{root,app,mara}-index-{390,1440}.png`, all HTTP 200. The 390 shots show no sideways overflow and styles applied (the round "N" badge in them is the Next.js dev indicator, dev mode only).
  - Typed clients: a throwaway file with `@ts-expect-error` on unknown tables for all three clients and on a non-awaited `createServerSupabase()` typechecks, so the types are live.
  - `pnpm db:types` output is byte-identical to the committed `database.types.ts`.
  - CI on PR #1, first run https://github.com/ghyde3/hydlnk/actions/runs/36915034871: green in 8m24s on the five code commits (typecheck, lint, unit 272, db 248, e2e 17 passed / 3 skipped, Playwright report artifact). That run's screens artifact was empty because CI did not generate screenshots; the next commit adds a `pnpm screens` step so the artifact holds the six PNGs.
  - Production smoke (`pnpm test:e2e:prod`, 12 tests listed) was not run: production deploys only through `/release`.
- **Next:** review of the PR, then the production release (steps for Gary in KICKOFF_PROMPT.md section 5). After that Milestone 1, starting with M1-01 (handle rules), M1-02 (availability endpoint), M1-03 (log in page), M1-04 (auth callback), M1-05 (account row on first sign-in).
- **Known issues:**
  - Hooks were activated after review (`.claude/settings.pending.json` renamed to `.claude/settings.json`); they did not fire during the build.
  - Docker Desktop's credential helper (`docker-credential-desktop get`) can hang on this Mac and stall `supabase start` and `supabase gen types`. `scripts/lib/docker-env.sh` probes it with a 5s limit and falls back to an empty `DOCKER_CONFIG` (`tmp/docker-config`) plus the Docker Desktop socket; it is a no-op on Linux and CI, and `~/.docker` is untouched. The hang was not reproducible after the leftover `docker-credential-desktop get` processes were killed, so the fallback was verified with a fake hanging helper instead. Restarting Docker Desktop fixes it for good.
  - `NEXT_PUBLIC_ROOT_DOMAIN=hydlnk.com` must be added to the Vercel Production environment before the first deploy; the env validation fails the build without it. Locally `init.sh` writes `localhost:3000`.
  - Google sign-in is disabled in the local stack until Gary puts the Google client secret in a git-ignored env file (KICKOFF_PROMPT.md section 5, step 3).
  - Supabase CLI 2.119.0 is available; the repo and CI pin 2.109.0.
