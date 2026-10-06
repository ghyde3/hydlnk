---
name: release
description: "The only path to production. Confirms verify and CI are green, shows the production migration plan, pushes migrations, merges the PR to main (Vercel deploys), waits for the deployment, runs the production smoke test and logs the release. Runs in interactive sessions under Gary's standing release approval (2026-10-03); never in unattended runs."
---

# Release to production

Merging to `main` deploys production. Gary gave standing approval (2026-10-03) for the orchestrator to run this skill for each green wave in an interactive session: tell him before starting and report after. Anything destructive in a migration, or anything touching live Stripe, still needs his explicit yes first. If this is not an interactive session with Gary, stop now: unattended sessions never touch production. The full browser suite (`pnpm test:e2e`) is deferred until Waves E–H and marketing v3 have landed (Gary, 2026-10-03); until then step 2 is `pnpm verify` + CI. Migrations go through the `release-migrations.yml` workflow (`gh workflow run release-migrations.yml -f ref=<branch> -f apply=false`, then `apply=true`) instead of a local `supabase db push`, which hangs on the Mac keychain.

Production is Supabase project ref `pzcinnkzrlyrqkgyetqx`, Vercel project `hydlnk`, Stripe live (a release never touches Stripe itself). Never print or handle secret keys. Never run `vercel deploy --prod`; deployment happens only by merging to `main`.

## Steps

1. **Preconditions.** Working tree clean. `git branch --show-current` is the milestone branch. `gh pr view --json number,isDraft,state,mergeable,statusCheckRollup` shows an open PR. If it is a draft, tell Gary and run `gh pr ready` only after he agrees.
2. **Green locally and in CI.** Run `pnpm verify` and `pnpm test:e2e`. Run `gh pr checks`. Every check must pass. Any failure: stop and report, do not continue.
3. **Check the link.** The Supabase CLI must be linked to `pzcinnkzrlyrqkgyetqx` (`jq -r .ref supabase/.temp/linked-project.json`). If not, ask Gary to run `supabase link --project-ref pzcinnkzrlyrqkgyetqx` in his own terminal (he enters the database password; never ask for it in chat).
4. **Plan the migrations.** Run `supabase db push --dry-run` and show Gary the exact list of migrations it would apply. Call out anything destructive (drops, type changes, backfills) and anything that touches auth.
   **Never run `supabase config push` here, and never while `supabase/config.toml` holds local values.** It does today: `site_url = "http://app.localhost:3000"` and `additional_redirect_urls = ["http://app.localhost:3000/auth/callback"]`. A push would overwrite production's Site URL and redirect allow list, which Gary set in the dashboard (Site URL `https://app.hydlnk.com`, redirect `https://app.hydlnk.com/auth/callback`) and which production sign-in depends on. Production auth settings change only in the Supabase dashboard, or through a `config.toml` `[remotes.*]` override if one is ever set up deliberately with Gary's approval. If the PR changed `config.toml` auth settings, do not push them: list the differences for Gary so he applies the production equivalents in the dashboard.
5. **Push the migrations** with `supabase db push` (Gary approves the prompt). Skip when there is nothing to apply. If it fails partway, stop and report; do not retry blindly.
6. **Merge.** `gh pr merge <number> --merge` (Gary approves the prompt; a merge commit keeps the one-commit-per-feature history). Never pass `--admin`. Vercel now deploys `main`.
7. **Wait for the deployment.** Poll until Vercel's commit status for the merge commit is `success`:
   `gh api repos/ghyde3/hydlnk/commits/$(git ls-remote origin main | cut -f1)/status --jq '.statuses[] | select(.context | test("Vercel"; "i")) | {state, target_url}'`
   On `failure` or `error`, stop and report with the deployment URL. Do not redeploy or roll back yourself; Gary decides.
8. **Production smoke test.** `pnpm test:e2e:prod`. It checks `hydlnk.com`, `app.hydlnk.com`, an unknown `*.hydlnk.com` handle, and that `www.hydlnk.com` redirects to the apex, over HTTPS.
9. **Log it.** Add a PROGRESS.md entry: date, "Release", PR number, merge commit, migrations applied (names), deployment URL, smoke test result, known issues. Do not push to `main`: commit the entry on the next milestone branch, or on a `docs/release-<date>` branch with a PR if none exists.

## If production smoke fails
Report which check failed with the output. Offer options (a revert PR for the merge, or Gary rolls back in Vercel), but do not act without his decision. Keep the failure in PROGRESS.md.
