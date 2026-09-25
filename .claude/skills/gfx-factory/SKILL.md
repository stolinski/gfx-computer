---
name: gfx-factory
description: >
  Drive the GFX Delivery factory (`gfx-factory`, a @swamp/software-factory
  instance) for one or more Dex work items: start work, advance stages, present
  aesthetic approvals, integrate, and complete Dex tasks. Use when the user says
  to work a Dex task/epic through the factory, asks for factory status, or wants
  Delivery work dispatched. Generic driving mechanics live in the pulled
  `software-factory` skill — read that first; this skill is the GFX binding.
---

# GFX Factory

One factory instance, `gfx-factory`, serves every work item concurrently.
A **work item is a Dex task id** (e.g. `xsly7zza`). Pick candidates with
`dex list --json` (ready leaves first); the human names which items to run.

## The machine

`implement → verify → (aesthetic-review when visual) → integrate → serve →
done`, with rework loop-backs into `implement`. Run `swamp model method run
gfx-factory describe` for the Mermaid when in doubt.

- **implement** — dispatches `gfx-agent` (`invokeAndParse`), which does all
  work in an isolated worktree `~/.worktrees/gfx-computer/gfx-computer-factory-<workItem>` created
  from `main`. The primary checkout's dirty state is irrelevant by
  construction — never treat it as a blocker, never "clean up" before starting.
- **verify** — `gfx-verify.run_checks` runs suites **scoped to the change**,
  derived deterministically from the change-summary's `filesChanged` (the
  policy is code: `deriveVerificationSuites` in
  `extensions/models/gfx-verify.ts`): swamp/meta-only changes run zero app
  suites, `extensions/` changes run the deno extension tests, and app changes
  run `pnpm check` + `pnpm test` plus `verify-presets --affected` (the
  script's own selector picks which presets — a CSS change typically selects
  none; `--all` never runs unless explicitly requested). Red routes back to
  implement with the stored failure bound into the retry prompt.
- **aesthetic-review** — only reached when the change-summary says
  `visualChange: true`. Never ask the human to "test the build": the approve
  gate requires a fresh `review-packet` artifact, so build it first from the
  change-summary's `reviewGuide` — captures of every affected preset/route
  (both orientations, ≥2 Packs where Pack-dependent), numbered checkpoints
  (what changed, where to look, what might have regressed), and a preview URL
  with exact paths for anything interactive. Present exactly that packet: one
  sentence of what changed, the checkpoints, the captures, the URL. The human
  judges in two minutes; they approve via the `aesthetic-approval` gate, and
  a rejection records their verbatim reason. Non-visual work ships with no
  human gate. To serve the worktree: `pnpm build && pnpm preview` inside it
  (port 4173) and capture via the CDP harness — the serving rule protects
  the supervised `:7263` production serve and the `:4173` review route, not
  a throwaway worktree preview on another port.
- **integrate** — `gfx-integration-git.cherry_pick` of the work item's
  commit onto `main` in the primary checkout. A real content conflict routes
  back to implement (the agent rebases and recommits). Unrelated dirty files
  in the primary checkout never block a cherry-pick. If it fails because of
  *uncommitted primary-checkout edits to the same files being landed*, stop —
  that is a genuine collision with the human's in-progress work: tell them
  and let them decide; do not loop the rework transition on it.
- **serve** — `gfx-verify.rebuild_and_smoke` rebuilds the primary checkout's
  production artifact (`pnpm build`), restarts the supervised `gfx` project
  through `local-dev-control`, and smokes `https://gfx.robo.online`: HTTP
  200, `/api/health` answering (200, or its designed low-scratch-disk 503),
  and the `gfx-release` meta equal to `gfx@<main HEAD>` — so the prod URL
  never silently serves stale main. A
  smoke failure is operational, not implementation: the run stays in `serve`
  with failed evidence for the human; there is no rework loop-back from here.

## Driving loop (per work item)

1. `swamp model method run gfx-factory start --input workItem=<dexId>`
   (resume with `status`, never restart).
2. `status` → do what the work spec says → `record_dispatch` → run the stage's
   method → `record_artifact` / `record_evidence` → `advance`.
3. After `done`: `dex complete <dexId> --result "<summary>" --commit <sha>`,
   remove the worktree (`git worktree remove ~/.worktrees/gfx-computer/gfx-computer-factory-<dexId>`),
   and run `summary`.

## Epics — one leaf at a time

Never start an epic id as a work item — that produces one giant worktree and
one giant commit. Expand it (`dex show <epicId> --expand --json`) and drive
each **ready leaf** as its own factory work item, in dependency order:
implement → … → integrate → `dex complete` the leaf, which unblocks the next.
A later leaf's worktree is created from `main` only after its prerequisites
integrated, so dependent work always builds on landed code. Complete the epic
in dex only when its last leaf lands, then stop at the epic boundary and
report per the roadmap's execution loop. Sequential is the default:
independent leaves may run as concurrent work items, but implement dispatches
serialize on `gfx-agent`'s per-model lock, so parallelism only pays when
lanes sit in different stages.

## GFX facts the stages rely on

- Worktree bootstrap: `SHARP_IGNORE_GLOBAL_LIBVIPS=1 CI=true pnpm install`
  (Homebrew libvips breaks sharp otherwise).
- Integration assumes the primary checkout is on `main`.
- **Coding-agent provider/model**: `gfx-agent`'s global arguments
  (`models/@mgreten/cli-agent/gfx-agent.yaml`) are the set-once default — used
  whenever nobody says otherwise (including the sentry cron). When the human
  names a provider or model for a work item ("run this on kimi"), pass it on
  that dispatch instead: `invokeAndParse` accepts `provider` and `model` args
  alongside the stage's inputs (pi models in `provider/id` form, e.g.
  `openrouter/moonshotai/kimi-k3`). Never make the human edit yaml for a
  one-off; the invocation record captures what actually ran either way.
  `sandboxMode: 'off'` is already set, so pi uses the host `~/.pi` config and
  normal auth. Pi ≥ 0.82 required.
- **Work on the swamp setup itself** (factory yaml, workflows, `gfx-verify.ts`,
  these skills) implements in a worktree like everything else, but `swamp
  … validate` only works in the primary checkout — `.swamp/` state is
  gitignored and does not exist in worktrees — so validate swamp config right
  after integration. One-line config tweaks (defaults, prompt wording) may be
  made directly in-session with a validate + commit; the factory is for
  feature work, not every keystroke.
- The sentry lane is separate: the `sentry-autofix` workflow (cron, every 6h)
  repairs one unresolved Sentry issue per run end to end. Failed attempts stay
  visible as open `Repair GFX-COMPUTER-<n> from Sentry evidence` Dex tasks —
  pre-rename attempts as `Repair SUPERS-<n> from Sentry evidence`. (The Sentry
  project slug was renamed to `gfx-computer` on 2026-08-31, re-prefixing every
  short id; recorded `SUPERS-<n>` citations are `historical` under ADR-0053.)
