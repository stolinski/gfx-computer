# Sentry dev flow

GFX reports captured errors, logs, and traces to Sentry (`scott-tolinski-projects/gfx-computer`) during local dev when the relevant DSN is configured. Agents use the `sentry` CLI as the primary way to inspect reported failures with stack, breadcrumbs, and trace context, alongside the dev-server console and browser log for uncaptured or disabled-SDK cases.

The project was renamed inside Sentry from `scott-tolinski-projects/supers` to `scott-tolinski-projects/gfx-computer` on 2026-08-31, which re-prefixed every issue short ID retroactively: every issue, old and new, answers only to `GFX-COMPUTER-<n>`, and the pre-rename `SUPERS-<n>` IDs no longer resolve. Recorded `SUPERS-<n>` citations — in code guards, tests, Dex task names, and history — are `historical` under [ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md): they name what the issue was called when written. Old-slug project lookups still redirect, and the DSN and release history were untouched; the release string is what carries the GFX namespace forward.

## What is instrumented

- **`src/hooks.server.ts`** — Sentry init + request tracing on every route (`sentryHandle`). Unexpected SSR failures flow through `handleErrorWithSentry`; every resolved 5xx response is also promoted by `logErrorResponses` with a bounded response body, including intentional `error(5xx)` HttpErrors that never reach `handleError`. **4xx responses are logs, not issues** — an absent poster or fork is a signal, and turning it into an issue would recreate the console-noise problem in Sentry.
- **`src/hooks.client.ts`** — browser error capture, pageload/navigation tracing, unhandled rejections.
- **Both sides** run `consoleLoggingIntegration`: every existing `console.warn` / `console.error` call site is a structured Sentry log with no code changes.
- DSN comes from `.env` (`SENTRY_DSN` server, `PUBLIC_SENTRY_DSN` client — same value). No DSN → the SDK is disabled and the app behaves identically; nothing in the codebase may _depend_ on Sentry being up.

## The fix-broken-code loop

```bash
sentry issue list --query "is:unresolved"   # what is broken right now
sentry issue view GFX-COMPUTER-<n>          # stack, breadcrumbs, event context
sentry issue explain GFX-COMPUTER-<n>       # Seer AI root-cause analysis
sentry issue plan GFX-COMPUTER-<n>          # Seer fix plan
# ...fix the code, verify by re-driving the flow...
sentry issue resolve GFX-COMPUTER-<n>
```

Org/project auto-detect from the DSN in `.env` — run the CLI from the repo root and scoping just works. Add `scott-tolinski-projects/gfx-computer` explicitly only if detection misfires.

After driving the app (captures, exports, Critic runs), check `sentry issue list --query "is:unresolved"` before calling the work verified — a flow that "looked fine" but threw upstream shows up there.

## Automated repair: the sentry-autofix workflow

The `sentry-autofix` swamp workflow runs every six hours (and on demand with
`swamp workflow run sentry-autofix`). Each run makes at most one bounded,
end-to-end repair attempt through the `gfx-agent` coding agent:

```text
observed Sentry error → sentry issue view/explain/plan → fix in isolated worktree
→ pnpm check + pnpm test → cherry-pick onto dev → sentry issue resolve → dex complete
```

- **The original event is enough evidence.** Runtime reproduction, a mandatory
  regression test, and no-recurrence waiting windows are not gates. Seer output
  (`explain`/`plan`) is advisory diagnostic text, never executable authority.
- **Every attempt is a Dex task** named `Repair GFX-COMPUTER-<n> from Sentry
  evidence`. Success completes it with the result and commit; failure leaves it
  open with what was learned — which is also the de-dupe: issues with an open
  repair task are skipped until a human looks. Pre-rename attempts named
  `Repair SUPERS-<n> from Sentry evidence` still count — the slug rename
  changed the prefix, never the counter `<n>`.
- **The primary checkout's state never blocks admission.** All work happens in
  a worktree created from `dev`; integration is a single cherry-pick onto
  `dev`. While the WebMCP Challenge runs, `main` is frozen and the lane never
  touches it; when the challenge ends, both return to `main`.
- **Resolution is honest.** The issue is resolved only after checks pass and
  the commit lands. A later event reopens it in Sentry and the next run treats
  it as a fresh regression.

## Logs and metrics

```bash
sentry log list --follow                    # live tail of client+server logs
sentry log list --query "severity:error"    # errors only
sentry trace list --period 1h               # recent requests with durations
sentry trace view <trace-id>                # span tree for one request
sentry span list <trace-id>                 # spans (export encode, API calls)
```

Request tracing is on at 100% sample (local single-user dev — there is no volume to shed). Route transactions give per-endpoint duration series for free; use `sentry explore` or a dashboard when a question needs aggregates (e.g. p95 of `/api/export/sessions/*/complete`).

### Export spans

Every export is its own transaction (`export.webm` / `export.prores`, op `export`). `export.encode` spans the local export-session lifecycle and contains `export.render-frames`, the serial render/PNG-upload loop. Attributes carry `export.route` (`/p/<slug>` — the per-composition dimension), fps, frames, duration, opacity, and audio presence; server session requests add generic encoder/output measurements such as `export.audio_bytes`, `export.ffmpeg_ms`, and `export.output_bytes`.

Video-track exports add only bounded aggregate operational context: whether Video clips participated, clip count, Timeline coverage, audio-enabled count, and authored Source-time/gain summaries. This context deliberately excludes Media library IDs and names, asset URLs/content hashes, original/local filenames, source byte size, codec/probe metadata, and decoded creator content. Do not attach the stable `state.media` records themselves. Sentry should answer whether the Video path participated and where export time went, not identify creator media. Reference read from the first verified trace of the historical singular foundation: a 6s blank WebM export = 79s total, of which 6.4s render and 73s VP9-lossless encode — exports are encode-bound, so encode settings are where export-speed work pays off.

### Versions

Every event and span carries a release: **`gfx@<git sha>`**. Events captured
before the namespace rename carry **`supers@<git sha>`** and stay queryable
forever — the release string is `accept-old / write-new`, so only new releases
take the GFX spelling ([ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)).

- **Server:** `src/lib/platform/git-version.server.ts` resolves HEAD per request
  (mtime-cached reads of `.git/HEAD` + the branch ref), so the long-running
  launchd dev server attributes events to the commit the working tree is ON —
  not the commit it booted with. The SDK-level release is fixed at process
  start; the always-current value rides the `git.release` tag.
- **Client:** the app shell carries `<meta name="gfx-release">` (injected by
  the server per request); `hooks.client.ts` inits from it. A loaded page runs
  the code it was served, so its release stays correct for the page's lifetime.
- **Release registration:** `scripts/git-hooks/post-commit` registers each
  commit as a Sentry release with its commit list (suspect-commit attribution),
  detached and best-effort — no CLI or no auth never blocks a commit. Wired via
  `git config core.hooksPath scripts/git-hooks` (machine-local config — re-run
  that once on a fresh clone).

Slice anything by version: `sentry issue list --query "release:gfx@<sha>"`
(pre-rename commits answer to `release:supers@<sha>`), `firstRelease:` /
`lastRelease:` queries, and the dashboard's by-release tables.

### Dashboard

**Supers Dev** — <https://scott-tolinski-projects.sentry.io/dashboard/8615767/>: error/export KPIs, export duration + render-vs-encode trends, error and error-log time series, a routes-by-p95 table, and by-release tables (errors, export p95). Widget CLI gotchas: reference the dashboard by bare ID or exact title (an `org/project/id` path silently fails with "did you mean"), the `issue` dataset does not support `big_number`, and `sentry api --data` takes inline JSON only (no `@file`).

## Conventions

- **Do not leave test issues unresolved.** If you throw a deliberate error to verify capture, `sentry issue resolve` it immediately.
- **4xx = log, 5xx = issue.** Keep it that way when adding endpoints; capture explicitly only what a human should act on.
- **`.env` is gitignored and machine-local.** If the DSN is ever rotated: `sentry project view scott-tolinski-projects/gfx-computer` shows it, or mint keys via `sentry api /api/0/projects/scott-tolinski-projects/gfx-computer/keys/`.
