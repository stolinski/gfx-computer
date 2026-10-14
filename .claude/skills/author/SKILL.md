---
name: author
description: Spawn a fresh Producer sub-agent that reads a GFX Brief and writes the Preset (plus any Pipeline or ADR the Brief declares). Use when the user has a completed Brief, says "author it" or "write the preset," or types `/author SLUG`. Do not use to brainstorm a Brief or verify a result.
---

# GFX Author

The operational form of [ADR-0007](../../../docs/adr/0007-brainstorm-brief-system.md)'s Producer hand-off. Spawns a sub-agent with **fresh context** that reads `docs/briefs/<slug>.md` and authors the artifacts the Brief declares. The Brief stays after authoring; retirement is a classified Delivery change, never an effect of Critic output.

## When this skill fires

- The user types `/author <slug>` (the slash command at `.claude/commands/author.md` calls this same workflow).
- The user has just finished a `/brainstorm` and says "go author it," "write it," "make it."
- The user points at an existing `docs/briefs/<slug>.md` and asks for the implementation.

Do **not** invoke this skill if:

- `docs/briefs/<slug>.md` doesn't exist (run `/brainstorm <slug>` first).
- The Brief has remaining items in `## Open questions` (resume `/brainstorm <slug>` first).
- The user wants to run Delivery verification (use the deterministic affected render matrix; `/critic <slug>` is optional advisory follow-up).
- The user wants to address a human-selected Critic observation on an existing Preset (the Brief is still live; this skill handles that follow-up only when there's a live Brief).

## How to invoke

### Step 1 — resolve the target Brief

Parse `$ARGUMENTS` as the Brief's slug.

- Verify `docs/briefs/<slug>.md` exists. If it doesn't:
  - If `src/lib/presets/<slug>.json` exists, the slug is a _pre-Brief preset_ (see [`docs/briefs/README.md`](../../../docs/briefs/README.md) § Pre-Brief presets). Stop and tell the user that `/author` requires a Brief; suggest `/brainstorm <slug>` for a rewrite, or a separately classified change for human-selected advisory observations.
  - Otherwise, list available Briefs from `docs/briefs/*.md` (excluding `README.md`) and stop.
- Read the Brief. If `## Open questions` has any items, stop and tell the user: "Brief has N open questions — resume `/brainstorm <slug>` before authoring."
- Note the Brief's required `Pack:`, its `Kind:`, and (for `pipeline` / `domain`) `Verification preset:`. Stop if the Pack is absent or not registered in `PACK_REGISTRY`.

### Step 2 — spawn the Producer

Use the **Agent tool** with `subagent_type: "general-purpose"`. **Do not** pass the current conversation as context. The Producer reads only the Brief plus the binding docs.

### Spawn prompt template

Substitute `<slug>`, `<kind>`, `<pack>`, and (when applicable) `<verification-slug>` from the Brief metadata:

```
You are the GFX Producer for the Brief at `docs/briefs/<slug>.md`.

Read these docs in order before writing anything:

1. docs/briefs/<slug>.md — your authoritative direction. Treat every
   section as binding; intentional deviations are already captured in
   "Channel chrome notes" and must land in the Preset's `description`
   field so future human and advisory review retains that intent.
2. docs/briefs/README.md — the lifecycle and invariant you sit inside.
3. docs/CONTEXT.md — terminology. Use these terms precisely.
4. docs/preset-format.md — the `gfx@1` schema you must satisfy.
5. docs/engine-architecture.md — pipeline registry shape, only if Brief's
   `Kind:` is `pipeline` or `domain`.
6. docs/packs/<pack>/aesthetic.md — channel chrome, palette, type, motion
   vocabulary, resolved from the Brief's declared pack (the legacy
   `docs/aesthetic.md` is a redirect stub — do not bind to it).
   You should not need to deviate; if you do, capture the reason in the
   Preset's `description`.

Then author the artifacts the Brief's "What 'done' looks like" section
declares. For each:

- Preset JSON: write to `src/lib/presets/<slug>.json`. Validate by running
  `npm run verify-presets` — if it
  errors, fix the JSON, do not loosen the schema.
- Pipeline code: write under `src/lib/pipelines/<layer>/<variant>/`
  following the existing renderer pattern (see, e.g., the lower-third
  overlay pipeline for the OverlayRenderer + shaderPass shape from
  ADR-0005). Strict TypeScript, no `any`, explicit return types on exports.
- ADR: if the Brief's `ADR required?` field is `yes`, draft
  `docs/adr/<next-number>-<slug>.md` mirroring the format of existing ADRs
  (one paragraph statement of the decision, considered-options list with
  rejected reasons, consequences paragraph).
- Schema additions: if the Brief calls for new schema, update
  `src/lib/platform/engine-schema.ts` and regenerate the JSON schema with
  `npm run gen:schema`.

Constraints, all binding:

- Transparency is the default: keep `loadOp: 'clear'`, `clearValue:
  [0, 0, 0, 0]`, and canvas `alphaMode: 'premultiplied'`. Paint to the frame
  edges only when the composition declares a full-frame fill or stage.
- Frame-determinism: drive animation from explicit `timestamp` / `frame`.
  No wall-clock.
- Native resolution: 3840×2160 or 2160×3840. No upscaling.
- No TODOs, placeholder content, or no-op stubs. Wire it now or the work
  isn't done.
- Every text size and box size (width, height, padding) the Pipeline draws
  is settable on its own in the Preset, the Inspector, and a WebMCP
  operation — not only through a uniform `scale` (ADR-0070). A hard-coded
  number is the default, never the only value.
- No new utility folders. Shared helpers go in `src/lib/utils/`.
- Don't start a dev server — one runs at http://localhost:7263.

Do NOT:
- Claim verification. The Delivery deterministic matrix owns objective verification, and exact-evidence human approval owns subjective acceptance.
- Delete the Brief. Retirement is a separate classified Delivery change.
- Edit `docs/briefs/<slug>.md`. The Brief is frozen at hand-off; if the
  Brief is wrong, stop and tell the orchestrator.

Output: a short report listing every file you wrote or modified, and
the deterministic Delivery verification target (the Preset slug or, for
pipeline/domain Briefs, the declared verification slug).
```

### Step 3 — surface the Producer's report

Present the sub-agent's returned report to the user verbatim. Then tell the user the next step:

```
Authored: <list of paths>
Next: run deterministic Delivery verification for <verification-slug>; invoke /critic only if a human wants advisory observations.
Brief stays at docs/briefs/<slug>.md until its declared boundary is retired through Delivery.
```

Do **not** spawn the Critic yourself. Delivery verification is deterministic; a human may separately request optional Critic observations.

## Re-authoring with advisory Critic observations

If the Brief is still in `docs/briefs/`, `/author` can be re-invoked after a human explicitly chooses advisory Critic observations to address:

- The Producer sub-agent re-reads the Brief plus only the human-selected observations (pass them inline under a "Human-selected Critic observations to address" section).
- Producer applies selected `preset-choice` and `aesthetic-miss` changes to the Preset JSON. Suspected `pipeline-bug` and `default-too-permissive` observations are not authoring instructions (quality-rubric.md R8 binds).
- Producer does not edit the Brief itself.

Critic prose never decides whether to spawn the Producer. Verified deterministic failures use the objective Delivery route; human aesthetic rejection uses the exact-evidence human route.

## Anti-pattern: same-session producer

Never author from the Brief in the _current_ conversation (i.e. without spawning a sub-agent). The fresh-context Producer is load-bearing per [ADR-0007](../../../docs/adr/0007-brainstorm-brief-system.md) — same logic as the Critic's framing flip. If you're tempted to "just write the JSON quickly," stop and spawn the sub-agent.
