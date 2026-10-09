# Project control plane

How GFX keeps code, planning state, and automation honest. The control
plane is deliberately small: direct work in isolated linked worktrees,
deterministic repo checks, one planning-drift audit, an optional Delivery
factory, and one scheduled Sentry repair lane. Behavior lives in instructions,
stage definitions, prompts, and plain scripts — not in bespoke extension code.

## Deterministic checks

Every lane routes on the same repo-owned commands, run wherever the work
lives (usually an isolated worktree — the primary checkout's local state is
never an admission or verification concern):

| Command                 | Covers                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `pnpm check`            | svelte-check + eslint + discoverability and name-disposition rules  |
| `pnpm check:names`      | ADR-0053 name dispositions (below)                                  |
| `pnpm test`             | vitest unit suites                                                  |
| `pnpm test:structural`  | structural/discoverability node suites + planning + preset contract |
| `pnpm verify-presets`   | Preset schema/semantic/lint — `--affected` scoped to changed paths  |
| `pnpm audit:planning`   | planning-state drift audit (below)                                  |

CI (`.github/workflows/quality.yml`) runs exactly these plus build and the
browser render test. Direct delivery, factory-assisted delivery, and CI share
these commands, so the meaning of "green" does not depend on who ran the work.

## Type-check memory and time

Every type-aware tool builds its own full TypeScript program, and several
worktrees checking at once exhausted the 8 GB host. `pnpm check` therefore
builds exactly one: svelte-check's, on the native compiler with a cache. ESLint
runs without type information, and a suite that already passed on a tree is not
run on it twice (next section).

**Two TypeScript versions are installed on purpose.** `typescript` stays at 6
because SvelteKit, typescript-eslint, and the editor load it as a library.
`@typescript/native` is TypeScript 7 — the Go compiler — installed under that
alias (`npm:typescript@7.0.2`) because svelte-check looks for the native
compiler by that package name, then by `@typescript/native-preview`. Nothing
else imports it. There is no patch step: this project does not use a compiler
plugin, so the TypeScript 7 binary runs as published. Keep svelte-check at
4.7.6 or later: 4.7.2 looked only for `@typescript/native-preview`.

**`svelte-check --tsgo --incremental`** is what `pnpm check` and
`pnpm check:watch` run. `--tsgo` writes each `.svelte` file out as TypeScript
and hands the whole project to the TypeScript 7 binary instead of holding a
TypeScript 6 language service in Node. `--incremental` keeps those written
files and the compiler's build info in `.svelte-kit/.svelte-check/`, so the
next run rechecks only what changed. That directory is ignored with the rest of
`.svelte-kit`, belongs to one worktree, and is safe to delete — the next run is
a cold one. `check:watch` uses the same mode because the default watcher keeps
the language service resident (1.8 GB idle here, 2.9 GB after two edits) where
this one idles near 0.5 GB and starts the compiler per change.

Run it from the checkout's real path. Reached through a symlink, a type error
in a `.svelte` file is still reported and still fails the run, but it names the
generated `++Name.svelte.ts` file and that file's line instead of the source.

Measured on main at `ae085989`, on a 10-core Apple-silicon MacBook, with
`/usr/bin/time -l` — wall time and the peak resident memory of the largest
single process, not the sum of a step's processes:

| Step                                  | Before             | After              |
| ------------------------------------- | ------------------ | ------------------ |
| `svelte-kit sync`                     | 1 s / 0.4 GB       | unchanged          |
| `svelte-check`, nothing cached        | 12 s / 1.76 GB     | 5 s / 1.22 GB      |
| `svelte-check`, nothing changed       | 12 s / 1.76 GB     | 1.6 s / 0.46 GB    |
| `svelte-check`, after an edit         | 12 s / 1.76 GB     | 2–3 s / 0.5–1.2 GB |
| `eslint .`                            | 80–125 s / 3.05 GB | 17–25 s / 1.27 GB  |
| discoverability, names, spawn hygiene | 3 s / 0.18 GB      | unchanged          |
| `pnpm test`                           | 23 s / 1.17 GB     | unchanged          |
| `pnpm test:structural`                | 2 s / 0.21 GB      | unchanged          |
| `pnpm verify-presets`                 | 0.5 s / 0.21 GB    | unchanged          |
| `pnpm build`                          | 11 s / 2.2 GB      | unchanged          |

The two checkers were compared on the same tree: both report nothing on a clean
one, and with errors planted in a `.ts` module, a `.svelte.ts` module, a
`+server.ts` route, a component's script, its markup, and its styles — and with
an export renamed under four importing components — both report the same
diagnostics at the same lines and columns, compiler warnings included.

**ESLint runs without type information.** `eslint.config.js` used to set
`projectService` for the Svelte files, which built a second TypeScript program
on every run and cost about 70–110 s and 1.75 GB. Two enabled rules read it, and
dropping it changed both on purpose:

- `svelte/no-unused-props` reports nothing at all without types, so it is
  switched off by name rather than left enabled and silent. An unused prop is no
  longer reported by any check.
- `svelte/no-navigation-without-resolve` still runs. It can no longer accept a
  link because its value is _typed_ as a resolved pathname; it needs to see the
  `resolve()` call. The tree had no link that relied on the type, so the change
  reported nothing new.

Do not restore `projectService`, or add any rule that requires type information,
without weighing that cost. `eslint --cache` is not used.

## One run per tree

`pnpm check` and `pnpm test` go through `scripts/verified-suite-stamp.mjs`. A
suite that passes leaves a stamp, and the same suite asked for again on exactly
the same tree prints one line and exits 0 without running:

```
check: skipped — already passed on tree 793891a178c6 at 2026-10-09T17:20:11.000Z. …
```

This exists for one repeat in particular. The factory's implement stage runs
both suites until green and commits; its verify stage then asks for both again
on that commit. Because `gfx-verify.run_checks` calls `pnpm run check` and
`pnpm run test`, the stamp sits behind those two scripts and no factory or
workflow definition changes.

The stamp is reused only when all of these match the passing run:

- **The content of the worktree** as git would commit it now — tracked,
  modified, and untracked files, hashed through a throwaway copy of the index.
  Uncommitted work and the commit made from it share one key, which is what
  lets the verify stage reuse the implement stage's pass. Any edit, new file,
  deletion, or `pnpm-lock.yaml` change produces a different key.
- **The lockfile pnpm installed from** (`node_modules/.pnpm/lock.yaml`), so a
  worktree whose `node_modules` lags its lockfile never matches.
- **The suite, the Node version, the platform, and the worktree's path.** A
  passed `check` says nothing about `test`.

Only a pass is stamped, and only if the tree is still what it was when the suite
started. A failure or an interruption records nothing. Stamps live in
`node_modules/.cache/gfx-verified-suites/`, which is ignored and belongs to one
worktree.

The key does not cover ignored files (`.env`, build output) or environment
variables. To run a suite for real regardless of its stamp:

| To                           | Run                                               |
| ---------------------------- | ------------------------------------------------- |
| Force one real run           | `GFX_FORCE_SUITE_RUN=1 pnpm check`                |
| Call the suite with no stamp | `pnpm check:run`, `pnpm test:run`                 |
| Forget every stamp           | delete `node_modules/.cache/gfx-verified-suites/` |

CI always runs for real: with `CI` set the stamp is neither read nor written.
The same holds when extra arguments narrow the run, as in
`pnpm test src/lib/one.test.ts`. `pnpm test:structural` and
`pnpm verify-presets` are not stamped: together they take about three seconds,
so a stamp would save nothing worth the extra state.

## Planning-drift audit

`pnpm audit:planning` (`scripts/audit-planning-state.ts`; pure check logic in
`scripts/planning-state-checks.ts`, fixture-tested) reads `docs/roadmap.md`,
`docs/adr/`, `docs/briefs/`, `docs/ideas/`, the built-in Preset listing, and
`dex list --all --json`, and reports drift as JSON: stale shipped claims,
Briefs that outlived their work, open Dex tasks describing shipped work,
blocker contradictions, and co-equal strategic ready leaves. Gating findings
exit 1; advisories never gate. The `gfx-planning` skill runs it at the end
of every planning pass.

## Documentation and planning sync

Documentation updates are part of implementation, not a follow-up request. Every
delivery path uses the dispatcher in `AGENTS.md` to identify the governing docs
and updates affected reference docs, ADRs, Briefs, roadmap entries, and Dex state
in the same change. `pnpm audit:planning` and the structural checks catch the
machine-checkable drift; the implementing agent must also resolve narrative
documentation impact before reporting the change as complete.

## Name-disposition check

`pnpm check:names` (`scripts/check-legacy-name-dispositions.mjs`,
fixture-tested) enforces the classification in
[ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md): every
current file may spell a Legacy Supers name only where a declared surface
records its disposition. It reports three things and no more — an occurrence no
declared surface covers, a `rename-now` value that came back, and current
documentation that spells a legacy name without saying under which disposition.
The declared-surface table in that module is the executable mirror of the ADR
matrix, so a new legacy surface owes a matrix row and a table row together.
Records the ADR never rewrites — `docs/adr/`, `docs/history/`, `.dex/`, and the
fixtures of the control plane removed on 2026-08-28 — are not scanned at all.

## Release acceptance

The checks above route one change. `pnpm seal:release-acceptance` asks the
separate question — whether one commit was shown to pass everything at once —
by binding every verifier's evidence file to a single release identity and
refusing a stale or missing one. It is not in the table because it runs nothing
itself and gates no lane; it reads what the producers already wrote. The release
identity is a commit in this repository plus the image built from it, never a
deployed URL, because public deployment is descoped and there is no origin to
interrogate. See [`release-acceptance.md`](release-acceptance.md).

## Direct and factory-assisted delivery

Direct delivery with the user is the default. Implementation happens in an
isolated linked worktree; affected docs travel with the implementation;
`gfx-verify.run_checks` runs the relevant deterministic suites; human approval
gates only visual changes; and integration onto `main` stays serialized.

`gfx-factory` is the optional unattended, queued, or batch lane. It is a
`@swamp/software-factory` instance whose definition lives in
`models/@swamp/software-factory/gfx-factory.yaml` (~6 stages). Its work items are
Dex task ids, and it applies the same completion contract as direct delivery.
The `gfx-verify.run_checks` implementation in `extensions/models/gfx-verify.ts`
derives suites from `filesChanged` — swamp-only changes run no app suites, and
preset verification runs `--affected`, never `--all`. Factory integration is a
serialized cherry-pick onto `main` via `gfx-integration-git`. Use the
`gfx-factory` skill only when the user opts into this lane.

## Sentry repair lane

The `sentry-autofix` workflow (`workflows/workflow-sentry-autofix.yaml`,
cron every 6h) makes at most one end-to-end repair attempt per run from
Sentry event evidence alone — see [`docs/sentry-dev-flow.md`](sentry-dev-flow.md).
Failed attempts persist as open `Repair GFX-COMPUTER-<n> from Sentry evidence`
Dex tasks, which is both the human escalation surface and the de-dupe —
pre-rename tasks named `Repair SUPERS-<n> from Sentry evidence` still count,
because the 2026-08-31 Sentry slug rename changed the short-id prefix, never
the counter. The `GFX-COMPUTER-<n>` short id is how Sentry itself cites the
issue, so the task name quotes it verbatim; recorded `SUPERS-<n>` citations are
`historical` under
[ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md).

## History

The previous generation of this control plane (26 swamp models, 32 workflows,
~61k lines of custom extension code: repo audits, policy sweeps, dispatch
outboxes, reproduction transports) was removed on 2026-08-28 in favor of the
above. Its design lessons that survived: worktree isolation from `main`,
deterministic verification as the only automatic routing authority, human
approval only for aesthetics, and Sentry events as sufficient repair evidence.
