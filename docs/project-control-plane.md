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

CI (`.github/workflows/quality.yml`) runs exactly these plus build. It does not
run the browser render test (`pnpm test:browser`): on a GitHub-hosted runner the
WebGPU capture came back blank (2026-10-09), most likely because the runner has
no GPU, so that test runs on a machine with one. Direct delivery,
factory-assisted delivery, and CI share these commands, so the meaning of
"green" does not depend on who ran the work.

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
