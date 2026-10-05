# GFX Critic — Adversarial Observations

> **Authority boundary:** The Critic is an optional adversarial observation tool. Its prose, categories, and summaries cannot block, approve, reject, mutate, or route GFX Delivery. Objective routing comes only from fresh deterministic closed-code evidence; subjective acceptance comes only from trusted human approval bound to the exact integrated tree and render bundle.

The protocol for collecting independent observations about a **Preset**. The companion to [`docs/quality-rubric.md`](quality-rubric.md), [`docs/animation-rubric.md`](animation-rubric.md), and the **active Pack's aesthetic** (`docs/packs/<preset.pack>/aesthetic.md` per [ADR-0014](adr/0014-pack-preset-split.md); the legacy single `docs/aesthetic.md` is now a redirect). Background: [ADR-0001](adr/0001-critic-sub-agent-verification.md).

A **Producer** agent that has just authored or modified a Preset does **not** verify its own output. Producer self-verification has repeatedly returned plausible PASS observations against renders that obviously fail. The Critic exists because _framing_ is the load-bearing variable: when the same model is reframed as "find every problem with this render" instead of "verify against rubric," it reliably surfaces real defects. The Critic is the operational form of that reframing.

---

## When the Critic runs

Run the Critic when a human wants an independent adversarial reading of a Preset. It is optional context, not a completion or verification gate. Delivery separately requires the affected deterministic matrix and an exact-evidence-bound human aesthetic decision when rendering is affected.

### Pack aesthetics stay advisory

GFX is a **general motion-graphics engine** — "the engine is general, the look is not" (CLAUDE.md). A Pack supplies the channel's appearance; it does not define what the engine is allowed to do. Therefore:

- A Pack aesthetic or channel-fit observation is always classified `aesthetic-miss`.
- Never escalate a Pack style mismatch into a `pipeline-bug` or `default-too-permissive`. A suspected defect is a wrong pixel measurable against the R/Q/G rules, independent of any Pack.
- For a general engine-capability demo, record Pack-aesthetic observations as optional context. They never block, route, approve, reject, or mutate Delivery.

---

## How the Critic is invoked

The Critic is a **sub-agent spawned with fresh context.** The Producer (or the user) launches it via the Agent tool. The sub-agent sees:

- The target Preset's path under `src/lib/presets/`.
- The corpus-only route URL where the Preset renders (`http://localhost:7263/p/<slug>?source=builtin` on this repo's dev server). `source=builtin` bypasses a colliding User composition; the repo capture harness adds it automatically.
- The four binding docs: this file, the quality rubric, the animation rubric, and the Preset's Pack aesthetic at `docs/packs/<preset.pack>/aesthetic.md` (resolved from the Preset's required top-level `pack` field; a Preset without `pack` fails schema validation, so the Critic must never substitute another Pack).
- The glossary at [`docs/CONTEXT.md`](CONTEXT.md).

The sub-agent does **not** see the conversation that produced the Preset. The framing flip depends on a clean context.

### Spawn prompt template

```text
You are the Critic for the GFX preset at <preset-path>.

CAPTURE SETUP (this repo): the dev server is at http://localhost:7263 — corpus
route http://localhost:7263/p/<slug>?source=builtin. GFX renders via WICG
HTML-in-Canvas, which
needs Chrome launched with --enable-blink-features=CanvasDrawElement; a
flag-enabled Chrome runs on CDP port 9223 — start or confirm it with
`scripts/launch-cdp-chrome.sh` (idempotent). A normal/unflagged
browser (including the default chrome-devtools MCP browser unless it carries the
flag) captures a BLANK canvas — do not use one. Capture frames with the repo
harness: `CDP_SAMPLES=0,0.25,0.5,0.75,1 node scripts/cdp-capture.mjs <slug>`
(saves .tmp-baselines/<slug>/pX.XX.png at the native 4K render, clipped to the
canvas; it drives window.__gfxTimeline.seekProgress). The Preset renders at
its native target resolution (3840×2160 horizontal or 2160×3840 vertical). Also
capture the peak-amplitude frame of every focal mark and effect.

For every captured frame, run the R-protocol from quality-rubric.md.
Each R-line must include:
  - a named region described concretely,
  - the saved screenshot path,
  - the pixel coordinate of the inspected region in that screenshot,
  - for measurable rules (R3, R5, R6, Q4, Q9), the numeric output of the
    corresponding probe script — do not substitute prose for the number.

After R-rules, walk Q1–Q18, G-rules, and docs/packs/<preset.pack>/aesthetic.md. Classify every finding:

  - pipeline-bug         — shader / effect / render-pass defect (a wrong pixel)
  - default-too-permissive — pipeline works, the engine default is too lax
  - preset-choice        — this Preset picked wrong values
  - aesthetic-miss       — rule-clean but doesn't read as the bound Pack's aesthetic (NON-GATING)
  - rubric-gap           — the failure isn't covered by current rules

PACK AESTHETICS STAY ADVISORY (see § Pack aesthetics stay advisory): a Pack
style mismatch is `aesthetic-miss` only — never `pipeline-bug` or
`default-too-permissive`. Do not emit acceptance, rejection, rework, mutation,
or Delivery-routing recommendations.

Be brutal. The user's prior experience is that you find real problems when
asked "what's wrong" but plausibly invent PASS observations when asked "verify
against rubric." Behave like the former.

Output: see docs/critic.md § Output format.
```

Adapt the path tokens to the actual Preset under review.

---

## The Critic's protocol

### Capture phase

1. Capture through a Chrome with `--enable-blink-features=CanvasDrawElement` (WICG HTML-in-Canvas). A flag-enabled Chrome runs on CDP port 9223 — start or confirm it with `scripts/launch-cdp-chrome.sh`; the repo harness `scripts/cdp-capture.mjs` drives it and navigates to `/p/<slug>?source=builtin` so a colliding User composition cannot shadow the corpus Preset. Any browser lacking the flag captures a blank canvas and is invalid for verification.
2. The harness renders at the Preset's native target resolution (`docs/quality-rubric.md` R6) and clips the screenshot to the canvas. `CDP_SAMPLES=0,0.25,0.5,0.75,1 node scripts/cdp-capture.mjs <slug>` drives the **Timeline** to each progress sample. Also capture the peak-amplitude frame of every focal slot and every transition Mark.
   **Do not inspect the capture's outer edge as canvas evidence.** Fractional CSS-rect clipping can include page chrome in the outermost ~2–5 px along straight edges and up to ~11 px at rounded corners, from the same rounding family documented under R6. Inset edge/backstop samples beyond that strip or verify them against an interior reference patch before reporting a render defect.
3. Captures land at `.tmp-baselines/<preset-slug>/pX.XX.png`. The Critic's findings must cite these paths. (For sub-canvas-resolution detail — e.g. fine bokeh — `scripts/cdp-dof-detail.mjs` captures at a high device-pixel-ratio.)

### Inspection phase — R-rules first

R-rules from `docs/quality-rubric.md` are evaluated first. If an R-rule appears to fail, record the measured observation and stop this observation pass. This ordering grants no Delivery authority.

Every R-line in the report must follow this shape:

```
R<n> <topic>: At <zoom>% on <region> in <captures/...png> at (x, y),
observed: <description>. Probe: <script-output>. PASS / FAIL.
```

If no probe script exists yet for a given rule, the line is annotated `Probe: not yet implemented`; the rule is verified by prose alone for now, and a `rubric-gap` finding is filed noting the missing probe.

### Inspection phase — Q-rules, G-rules, aesthetic

After every R-line is PASS, walk Q1–Q18, the G-rules, and the active Pack's `docs/packs/<preset.pack>/aesthetic.md` in order. Each finding cites the screenshot path and frame label that surfaced it.

`Q15`, `Q14`, and aesthetic checks may legitimately be prose-only — they are judgment calls about composition and channel-fit, not pixel measurements.

---

## Output format

```text
Critic report — <preset-slug> — <timestamp>

Captures:
  - .tmp-baselines/<preset-slug>/p0.00.png
  - .tmp-baselines/<preset-slug>/p0.25.png
  - ...

R-rule observations:
  R1 (text sharpness): At 200% on <region> in .tmp-baselines/.../p0.50.png
     at (1240, 800), observed: stroke edges are crisp single-pixel transitions.
     Probe: probe-text-edge.ts → max-step=0.93. PASS.
  R3 (shadow falloff): At 400% on shadow edge of <element> in
     .tmp-baselines/.../p0.50.png at (1840, 1120), observed: alpha falls off
     over 18 px with no visible bands. Probe: probe-banding.ts → max-step=0.04,
     band-count=0. PASS.
  ...

Findings:
  [pipeline-bug] <one-line description>
    Where: <file:line or shader/effect name>
    Evidence: <screenshot path>:(x,y)
    Proposed fix: <one or two sentences>

  [default-too-permissive] <one-line description>
    Where: <engine default location, e.g. src/lib/platform/engine-schema.ts>
    Evidence: <screenshot path>:(x,y)
    Proposed tightening: <one sentence>

  [preset-choice] <one-line description>
    Where: <preset JSON path and field>
    Evidence: <screenshot path>:(x,y)
    Suggested value: <one sentence>

  [aesthetic-miss] <one-line description>
    Where: <preset element or composition aspect>
    Evidence: <screenshot path>:(x,y)
    Aesthetic-doc reference: docs/packs/<preset.pack>/aesthetic.md § <section>

  [rubric-gap] <one-line description>
    Where: <which rule should cover this and doesn't>
    Suggested rule: <one sentence>

Advisory summary: observations only; no Delivery recommendation or transition authority
```

Critic classifications are observations only. They do not authorize acceptance, rework, implementation fixes, repository writes, tracker writes, or Factory transitions. A human may use them as context while making the exact-bundle aesthetic decision.

---

## Probe scripts

Probe scripts at `scripts/probe-*.ts` read a captured screenshot and return numeric measurements. The Critic invokes them and quotes their output verbatim. Because the numbers come from the scripts, they cannot be fabricated.

The first three probes to implement (highest leverage):

| Probe                                       | Returns                                     | Used by                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe-dimensions.ts <png>`                 | `{ width, height }`                         | R6 (resolution)                                                                                                                                                                                                                                                                                                                                |
| `probe-banding.ts <png> --region <x,y,w,h>` | `{ max-step, band-count, peak-falloff-px }` | R3 (shadow), R5 (banding)                                                                                                                                                                                                                                                                                                                      |
| `probe-hue-count.ts <png> [--downsample n]` | `{ saturated-hues: [hsl,...], count }`      | Q4 (palette restraint). Pass `--downsample 4` whenever a mask/subpixel-structure Effect is in the chain (`crt-tube`, `crt-scanline` material, `ntsc-signal`): Q4 governs the perceptual palette at viewing distance, and per-pixel counting reads phosphor triads / chroma fringing as a dozen fake hues. `--region` stays in full-res pixels. |

Follow-on probes when failure patterns demand them:

| Probe                                         | Returns                                                                                                                                                         | Used by                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `probe-text-edge.ts <png> --region <x,y,w,h>` | `{ luma_range, max_step, max_step_normalized, fringing_px, transition_count }` — `max_step_normalized` (not `max_step`) is the crispness verdict; < 0.3 = fuzzy | R1, R2 (text sharpness, resampling) |
| `probe-ink-coverage.ts <png>`                 | `{ inkRatio }`                                                                                                                                                  | Q9 (negative space ≥ 30%)           |
| `probe-edge-aa.ts <png> --region <x,y,w,h>`   | `{ hard_stairsteps, smooth_pixels, coverage_ratio, polarity }` — polarity-agnostic (columns of either edge direction)                                           | R4 (edge AA)                        |

Each probe is ~30 lines of canvas / `image-data` inspection. Implementations don't live in this doc; the contract above is the binding contract.

**Two-Pack pixel-diff lock (ADR-0038).** `npx tsx scripts/probe-pack-diff.ts` is the regression lock for full Pack buy-in: for every non-immune Pipeline in `IDENTITY_REGISTRY` it renders a representative corpus Preset at one deterministically pinned frame under two Packs (default: the Preset's own vs `editorial-mono`; `--packs a,b` to override, e.g. `--packs syntax,crt-terminal`) and requires the two canvas captures to visibly differ — ≥ 0.25% changed pixels, calibrated ~8× above the re-capture noise floor (≤ 0.03%) and ~3× below the smallest real re-skin measured (0.78%). Preset-authored `typography.paperColor`/`inkColor` are lifted during both captures so the `override ?? packRole` seam resolves on the Pack side. A **FAIL means partial Pack buy-in regressed**: a Pipeline's pixels no longer respond to the active Pack (a baked literal or unwired Role) — an `IMPLEMENTATION-FIX-REQUIRED`-class defect, never fixable by editing the Preset. Pipelines present in the runtime-derived `PACK_IMMUNE_PIPELINE_KEYS` set are exempt because their artifact is verisimilar by contract — their regions are instead held to the stability ceiling; a PARTIALLY immune pipeline (ADR-0039 §2, e.g. the newspaper) stays in the must-change set with a chrome-scale expected delta, so its representative must exercise the claimable chrome (the kicker chip). Pipelines with no covering Preset are reported as coverage-gap warnings. Paired captures + `pack-diff-results.json` land in `docs/critic-captures/pack-diff/`.

**Export decode verification.** `node --experimental-strip-types scripts/probe-export-decode.ts <export.mov> [--frames N | --all]` verifies the _actual exported file_ — not the captured DOM frames. It decodes the export back to RGBA PNGs with ffmpeg (the same binary the ProRes route uses server-side) and feeds the frames to `probe-frame-diff.ts`, asserting the sequence **animates** (consecutive frames differ) and **carries alpha** (transparent-output contract). Export a **ProRes 4444** (`yuva444p10le`) piece for this check: it round-trips alpha and is byte-deterministic, unlike VP9 hardware encode. A 4K all-frames decode is multiple GB, so it samples evenly-spaced frames by default (`--all` for the literal every-frame decode). Output is the `probe-frame-diff` JSON wrapped with decode provenance; exit is forwarded verbatim — `0` pass, `1` fail, `2` usage. **Opaque full-frame pieces fail the alpha clause by design** — that's the `--opaque` luma mode, not this probe; alpha-preserving native-4K capture of opaque pieces is not planned.

**Temporal energy coherence.** `node --experimental-strip-types scripts/probe-temporal-energy.ts <frame.png> <frame.png> <frame.png> [...] --region <x,y,w,h>` catches what the stills protocol cannot: a focal feature that **blinks out** mid-transition and pops back. Feed it the frames of an authored optical transition (rack focus, resolve-into-focus, a lift settling) in timeline order (≥ 3) with a region over the focal feature. It tracks the region's alpha-weighted luminance and **FAILS a non-monotonic dip deeper than 25% of the settled value** (exit 1); a smooth resolve in either direction passes. Use it whenever a Preset authors an optical transition — a still-frame sweep sampled the type-hero accent-rule blink as fine.

---

## Human-selected advisory follow-up

Critic classifications do not select a lane, an actor, or a change. If a human chooses a named observation for follow-up, these locations can help scope a separately classified task:

| Classification           | Possible follow-up location                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `pipeline-bug`           | The relevant Pipeline implementation                                |
| `default-too-permissive` | The relevant Pipeline parameter defaults                            |
| `preset-choice`          | The Preset JSON under `src/lib/presets/`                            |
| `aesthetic-miss`         | The Preset or, for a recurring pattern, its Pack aesthetic guidance |
| `rubric-gap`             | `docs/quality-rubric.md` or `docs/animation-rubric.md`              |

R8 from the quality rubric still binds: a suspected `pipeline-bug` is **never** hidden by tweaking the Preset to avoid the broken code path. The Critic may describe the suspected defect, but only verified closed objective evidence can route automatic rework.

---

## Anti-anti-gaming

The Critic itself can still produce vague or unsupported observations. The structural guardrails:

- Every R-line cites a saved screenshot path and pixel coordinate. A bare `PASS` is invalid.
- Every measurable R-line cites the probe's numeric output. Prose is not a substitute for the number.
- Captures are saved to disk, not only described. The user can re-open any capture and check the named observation.
- Probe outputs are reproducible. Re-running a probe on the same capture yields the same number.

If a Critic report makes an acceptance or routing claim, ignore that claim. Retain only schema-valid advisory observations and independently run the deterministic verification matrix.

---

## Non-goals

- The Critic does not author Presets. If a human selects observations for follow-up, that work runs through its classified lane.
- The Critic does not adjudicate intent. `aesthetic-miss` findings are surfaced; the user decides whether the Preset deliberately deviates.
- The Critic does not run on commits or PRs. A human may invoke it at any time for advisory context.
