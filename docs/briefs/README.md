# GFX Briefs

A **Brief** is the markdown directive for one not-yet-shipped **Preset**, **Pipeline**, or content domain. One file per in-flight idea. Authored by the **Brainstorm** agent (`/brainstorm <slug>`) and read by the **Producer** sub-agent (`/author <slug>`). Critic observations never authorize Brief deletion.

Background: [ADR-0007](../adr/0007-brainstorm-brief-system.md). Glossary entry: [`CONTEXT.md` § Brief](../CONTEXT.md).

## Invariant

> If `docs/briefs/<slug>.md` exists, its declared implementation and documentation boundary remains active.

Brief retirement is a classified implementation/documentation change. It is governed by planning audit and the human-bound Delivery record, never by Critic prose.

The folder is the current in-flight surface of *newly authored* work, not a complete record of every preset.

## Pre-Brief presets

Existing presets are grandfathered. The rules:

- **`/critic <existing-slug>`** — works as before. Critic never reads a Brief.
- **`/author <existing-slug>`** — errors. Authoring requires a Brief. If you want to *rewrite* an existing preset, run `/brainstorm <existing-slug>` first; the skill will detect the JSON and ask whether this is a new variant slug, a rewrite (which creates a Brief and the rewrite then follows the standard lifecycle), or a misnamed slug.
- **A retroactive Brief** is never required. Critic observations do not create, retire, or mutate Briefs.

## Lifecycle

```
/brainstorm <slug>    → Brief drafted at docs/briefs/<slug>.md
                      ↓
                      (grilling continues until "Open questions" is empty)
                      ↓
/author <slug>        → Fresh Producer sub-agent reads the Brief; writes the
                        Preset (and any Pipeline / ADR the Brief declares).
                        Brief stays put through this step.
                      ↓
deterministic Delivery → Closed objective checks verify the integrated tree.
                      ↓
human aesthetic gate  → Human decision binds the exact render evidence.
                      ↓
retirement change     → Brief deletion lands as a classified documentation
                        change after its declared boundary is complete.
```

For a `pipeline` or `domain` Brief, the landing change closes the declared documentation boundary only after the shipped code, planning audit, and human-bound Delivery record agree. Do not add an active-Brief catalog here; the files present in this folder are the live inventory.

## Where Briefs sit relative to existing docs

| Folder | When | Lifetime |
|---|---|---|
| [`docs/ideas/`](../ideas/) | Speculative product surface — a thing that *might* be built someday (CLI, transcript flow). | Indefinite. |
| [`docs/roadmap.md`](../roadmap.md) | The backlog — *designed or wanted, not yet built* (incl. starter templates). | Until built (then an ADR). |
| [`docs/briefs/`](.) | A thing *about to be built*. | Until its declared implementation/documentation boundary is retired through Delivery. |

If a Brief stalls — open questions can't resolve, or the idea no longer fits — delete the Brief manually with a one-line commit explaining why. Stalled Briefs are not allowed to linger.

## Template

Copy this when starting a new Brief by hand. The `/brainstorm` skill writes the same shape and skips sections that aren't relevant to the Brief's `kind`.

```markdown
# <Brief title — the human name for the thing>

**Kind:** preset | pipeline | domain
**Slug:** <kebab-case slug; must match the filename>
**Pack:** <required slug from PACK_REGISTRY; there is no implicit default>
**Verification preset:** <slug>   ← required for `pipeline` and `domain`; omit for `preset`

## Pitch

One paragraph: what is this and why does it land for the channel?

## Surface(s) involved

Which registered **Surface** this lives on. Read `SurfaceTypeSchema` and the
Pipeline registry for the current catalog rather than copying a list here.
For `pipeline` / `domain` Briefs: which Surface(s) need to be added or extended.

## Content sample

Real or representative copy. For `preset` Briefs, this is the text that ships
in the Preset JSON's `surface.content` and any overlay content. Quote
verbatim — don't paraphrase.

## Motion plan

Which moves from `docs/packs/<pack>/aesthetic.md` § Motion Vocabulary the composition uses
(brightness-reveal, halo-bloom-up, focal-dim-others, stroke-draw, tear-on,
tape-down, settled-place, substrate-darken). Note the timeline shape
(entry → reveal → exit) and the **focal slot**(s).

If a "lean out" move is being used deliberately, name it and the reason.

## Channel chrome notes

Which signature elements from the selected `docs/packs/<pack>/aesthetic.md` this carries. Enumerate the Pack's own vocabulary; do not import another Pack's chrome.

Note any *intentional* omissions. The Producer will carry these into the
Preset's `description` field so future human and optional advisory review retains
that intent.

## Engine work required

For `kind: preset`: usually "none — composes from the existing Registry."
For `kind: pipeline` / `kind: domain`: enumerate the Pipelines, schema
additions, and shader passes that need to land. Reference existing patterns
(e.g. ADR-0005's `shaderPass`).

## ADR required?

`yes` | `no` | `already-filed: <NNNN-slug>`. If `yes`, the ADR is part of the
ship and the Producer drafts it during authoring.

## Open questions

Bullet list of items still unresolved. The Brief is `ready to /author` when
this section is empty. Each item should be answerable; "we'll figure it out
during authoring" is not allowed.

## What 'done' looks like

The concrete deliverables and the gate. For `kind: preset`:
"`src/lib/presets/<slug>.json` passes the deterministic affected render matrix at native horizontal (3840×2160) and vertical (2160×3840), and its exact evidence bundle receives human aesthetic approval, with no orientation-specific sibling Preset."
For `kind: pipeline` / `kind: domain`: list every artifact (pipeline files,
ADR, preset) and name the verification Preset covered by deterministic Delivery and the exact-evidence human gate. List every text size, box size, icon size, and part colour the Pipeline draws and the Preset field, Inspector control, and WebMCP operation that sets each one ([ADR-0070](../adr/0070-every-visible-size-is-authorable.md)); a size with no field is not done. Every Brief's acceptance section must explicitly require both native
horizontal and vertical renders, even when orientation was otherwise irrelevant
to the discussion.
```
