# One schema-checked element edit replaces per-field agent tools

## Status

**Designed, not built (decided 2026-10-14).** Scott agreed the design on 2026-10-14 and asked that it wait until his current batch of Presets is finished. Dex carries the epic; this ADR becomes Canon when the epic closes. Amends [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md): the operation, transaction, revision, receipt, and security contract stay; the shape of the agent's authoring tools changes.

## Context

ADR-0054 rejected "one raw patch tool" because a bare `apply_patch(pointer, value)` has no preconditions, no ownership, no undo label, no bounded receipt, and no corrective refusal. Each authoring decision became its own operation and tool instead. By 2026-10-14 that meant 118 tools, with one or more added for every new field. The filmed-flowchart work that day showed the cost: diagram Block timing, Block cue overrides, and clearing a node's words each needed a new tool or argument, and the one new tool pushed the disclosed-tool ceiling from 42 to 43. Fields that never got a tool simply could not be authored by an agent. Scott called it a mess that grows with every feature.

The objections ADR-0054 raised are now answered by machinery the engine already has. Every operation runs through one edit transaction that applies a mutation to a draft, parses the whole document against the Preset schema, reports schema findings with the exact path, records one undo entry, checks the observed revision, and returns a bounded receipt of changed pointers. The engine's enums are derived from live registries. What is missing is a front door that lets an agent use that transaction on any field without a hand-written tool per field.

## Decision

1. **A composition is made of elements.** An element is one addressable unit of the selected Scene: the Surface, an Overlay, a diagram Block, a Chart Block, a Figure, a Kinetic Word, an Effect, a Text Animation, an Annotation Mark, a sound cue, a Motion Beat, a video clip, the Stage, the Stage camera, the Stage focus, the transport, the typography, and a Scene boundary. An **element registry** (one module) names each kind, how to find an element of that kind in the document (by id, or by index where the format has no id), its Zod schema, and its locked fields (identity: `id`, `type`, and any field whose change would make it another element).
2. **Five agent tools act on elements.**
   - `inspect_element` returns the element's current JSON, the JSON Schema of its kind derived from the live Zod schema, and the live value lists its fields draw from (Packs, Effects, eases, sound events, and so on).
   - `edit_element` applies a JSON Merge Patch (RFC 7396) to one element: a present field replaces its value, `null` removes an optional field, and an array is replaced whole. Locked fields are refused. Fields shaped as motion windows accept the same seconds, milliseconds, and frames the per-field tools accept today and are normalised to clip fractions.
   - `add_element`, `remove_element`, and `reorder_element` change membership, using the same default factories the GUI's add menus use.
3. **The transaction is unchanged.** An element edit takes the observed Composition revision, applies atomically or not at all, records one undo entry named for the element ("Edit node n-step-2"), moves the Workspace focus to that element, and returns the bounded receipt with `sceneId`. A refusal names the field path, the reason, and the allowed values when the field is an enum or a registry reference.
4. **Per-field tools are retired family by family** once the element tools cover them, with the agent evals moved first. Tools that are not plain element edits stay: creating, opening, importing, and exporting compositions; Scene membership and selection; undo and redo; the playhead; validation, verification renders, and readable text; video export; the User Pack store; the media library; and figure data import.
5. **Ownership moves from pointer families to element kinds.** The security boundary of ADR-0054 is kept: an element edit can reach only the selected Scene's elements, never the stored-composition record, store paths, the Pack registry, or another Scene. The family pointer-ownership check is replaced by the element registry's locked-field and reach checks.
6. **The Inspector follows later.** A separate Dex task makes Inspector fields come from the same element schemas, so the GUI stops being hand-built one field at a time. It changes the GUI and goes through Scott's visual review.

## Considered options

- **Keep adding a tool per field** — rejected: it is the mess this ADR exists to end, and it leaves fields no tool reaches.
- **A bare pointer patch** — still rejected for the reasons ADR-0054 gives. Element addressing gives every edit a target the agent can inspect, an undo label, a focus, and locked identity; the pointer form gives none of these.
- **Keep both the element tools and the per-field tools** — rejected by Scott on 2026-10-14: two ways to do everything is the same mess with more tools.

## Consequences

- Adding a field to the schema makes it authorable by agents with no new tool. ADR-0070's "settable through a WebMCP operation" is met by the schema itself.
- The tool count falls from 118 to about 45, and far fewer are registered at once; `WEBMCP_DISCLOSED_REGISTERED_CEILING` comes back down when the last per-field family is retired.
- The agent selection and safety evals and `pnpm eval:webmcp` are rewritten around element tools before any per-field tool is removed.
- The CLAUDE.md binding rule on agent authoring is rewritten when the epic closes: authoring stays an Operation, and a field edit goes through the element tools rather than a new per-field tool.
