# ADR-0054 — Lock the WebMCP operation, transaction, and security contract

## Status

**Canon (built).** **Amended 2026-08-31:** the body opens on gfx.computer going public, which [ADR-0052](0052-public-runtime-and-retention-architecture.md) descoped that day. Nothing in the operation, transaction, or security contract depends on that: a browser agent authors through `document.modelContext` on whichever origin serves the app. **Amended 2026-09-02:** Chrome 153 is now the minimum WebMCP host; registration and execution cancellation use its separate signals, Chrome annotation hints ship, direct time units and nested runtime objects supplement the storage-native arguments, and one prepared authoring family at a time joins a bounded core tool menu. **Amended 2026-09-02 (later the same day):** registration no longer waits on the CanvasDrawElement capability gate, so a headless WebMCP browser without the renderer flag gets the same tools.

Date: 2026-08-28

Builds on: [ADR-0032](0032-gui-agent-parity-authoring.md) (GUI ↔ agent parity over one composition model), [ADR-0034](0034-gui-design-authoring-interface.md) (the Workspace the agent shares), [ADR-0035](0035-generalized-keyframes-and-cascade.md) (the keyframe and Cascade grammar), [ADR-0045](0045-composition-media-library-and-video-track.md) (Media library and Video track), [ADR-0052](0052-public-runtime-and-retention-architecture.md) (the public Node/ffmpeg origin and zero retention), and [ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md) (the GFX namespace and the Public demo session)

## Context

gfx.computer goes public as a no-account authoring demo where a browser agent is a first-class author. WebMCP is the transport: the page registers tools on `document.modelContext`, and a supported browser's agent calls them.

The first measured surface was Chrome 152, protocol 1.3 ([`../standard-browser-rendering-probe.md`](../standard-browser-rendering-probe.md)). Chrome 152 coupled registration lifetime and execution cancellation and retained aborted names, so a reversible state change could strand a dynamically removed tool. Chrome 153 fixes that lifecycle: `registerTool(tool, { signal })` removes a registration while each `execute(args, { signal })` receives an independent caller-cancellation signal. GFX requires Chrome 153 for WebMCP; older browsers keep the full GUI and register no tools.

Three tempting shapes have to be rejected before anything is built, because each of them looks like progress and each of them ends somewhere we cannot return from.

**UI automation.** Tools named `click`, `open_panel`, `select_tab`. It demos in an afternoon and it is not authoring — it couples the agent to pixel positions and rail modes, it cannot report what changed, and it breaks on every layout change. WebMCP is a transport for decisions, not for gestures.

**One raw patch tool.** `gfx_apply_patch(pointer, value)` covers the whole schema in a single afternoon too. It is also the end of the contract: it has no preconditions, no ownership, no undo label, no bounded receipt, and no way to say "that Pack does not exist, here are the four that do". A schema is not an interface.

**A thin proof.** Three tools that create a composition, set a title, and export. It is honest about being a demo and it forecloses the actual product claim, which is that a person and an agent are co-equal authors over the same visible state.

So the decision here is the contract itself: which decisions exist, who owns each one, what a caller must prove before making one, what comes back, and what the page will never let an agent do.

One more constraint shapes all of it. This runs in the visitor's browser, on the visitor's origin, inside a Public demo session ([ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md)). A tool is reachable by any agent the visitor has attached to the page, and composition content is untrusted text that will pass through a model. The security decisions are not a hardening pass afterwards; they are part of the shape.

## Decision

### 1. Operations are the unit, and the inventory is the contract

An **operation** is one authoring decision — "set the orientation", "add an Overlay", "weld this entrance to that one". Every operation exists once, in [`../../src/lib/platform/webmcp-operation-inventory.ts`](../../src/lib/platform/webmcp-operation-inventory.ts), which records for each row: the family that owns it, the WebMCP tool that exposes it, the composition pointers it may write, the state in which its tool is registered, whether it needs the caller's observed revision, whether it is undoable, whether it is cancellable, the Workspace focus it must move, the **exposure** that says which transports reach it, and the GUI surface that owns the same decision.

That file is machine-readable on purpose. The bidirectional parity gate reads it and rejects a row reachable from fewer transports than its `exposure` promises; the WebMCP controller registers exactly its tools; the operation layer implements exactly its rows. A tool with no row has no contract, and a row with no tool is a gap unless the row declares an intended absence.

Both authoring transports run the same authoring operation. There is no WebMCP-only edit path, encoder, or authoring branch. The one `agent-context` row, `capability.prepare-authoring-family`, is not authoring: it changes only which tool descriptors the agent reads, never composition, Workspace, focus, history, or GUI state.

### 2. Fifteen families, each owning its own subtrees

Tools are grouped into families, and a family is defined by **what an author decides**, not by which panel the control lives in:

| Family         | Decides                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `capability`   | What the engine can express, and the limits the public demo enforces         |
| `composition`  | Which composition exists and is open, and how the document identifies itself |
| `session`      | What the browser-scoped session holds, and how it is emptied                 |
| `transport`    | How the piece is framed and classified on output                             |
| `layer`        | Which Layer entities exist, in what order, as which registered variant       |
| `content`      | The words, values, and data an author writes into the piece                  |
| `placement`    | Where an element sits in the frame, at each orientation                      |
| `appearance`   | How the piece looks under its Pack                                           |
| `motion`       | When and how things move                                                     |
| `sound`        | What the piece plays                                                         |
| `media`        | The composition Media library and the Video track cut from it                |
| `playhead`     | Where the visible playhead sits, in exact frames                             |
| `validation`   | What is wrong with the composition without rendering it                      |
| `verification` | What the composition actually renders, measured on real pixels               |
| `delivery`     | Turning the composition into a file the visitor receives                     |

Non-overlap is mechanical, not editorial. Each family declares the composition pointers it owns, and **no two families declare the same pointer**. Where pointers nest, **the longest pointer wins**: `layer` owns `/state/overlays` and may add, remove, and reorder entries, while `placement` owns `/state/overlays/*/position` and `motion` owns `/state/overlays/*/enter`. A family whose ownership is marked `membership` may only add, remove, reorder, and set the identifying `type` / `id` of entries — never rewrite a field a deeper owner holds. An operation may write only pointers its own family owns.

Two boundary calls are worth recording, because both were genuinely ambiguous:

- **Pack belongs to `appearance`, not `transport`.** A Pack is appearance only ([ADR-0023](0023-pack-is-appearance-only.md)); `transport` is framing and output classification, which is why `backgroundFill` sits there — declaring one is what makes a piece a full-frame segment rather than a transparent overlay.
- **The dimensional stage belongs to `appearance`, not `placement`.** The stage is a whole-composition look decision — grade, key light, defocus. `placement` is per-element geometry. Splitting the stage across two families would have produced exactly the ambiguity the family model exists to prevent.

**`verification` is internal-only, by design.** Every family above is reachable over WebMCP except this one. Measuring real pixels — rendering an exact frame, auditing what it reads — serves this project's own render gates, and no authoring decision needs it: an agent repairs a piece from `validation`, which reads the document and costs nothing, and looks at a frame through `playhead`. Registering the rendered-verification operations would instead hand any attached agent a way to drive repeated full-frame render work with no authoring result at the end of it, on a public origin whose export limits are decided elsewhere ([ADR-0052](0052-public-runtime-and-retention-architecture.md)).

The operations still exist, still run in-process, and still name their GUI surface. The narrowing is **recorded rather than inferred**: both verification rows carry `exposure: 'internal-only'`, shared authoring carries `agent-tool`, and the transport-only family selector carries `agent-context` with no GUI surface. The parity gate therefore expects GUI-only, GUI-plus-agent, or agent-only reachability exactly as declared. Adding a row to either one-transport disposition means editing that field and this paragraph together.

### 3. Every edit is a revisioned, atomic transaction

The composition carries a monotonic **revision**. Every mutating operation takes the revision the caller last observed.

- **Stale revision fails.** A mismatch returns `stale_revision` with the current revision and a bounded summary of what moved, and applies nothing. An agent that read the composition, thought for ten seconds while the human dragged an Overlay, and then wrote, does not silently overwrite that drag.
- **Preflight, then apply.** The operation validates its arguments, resolves its targets, and runs schema and semantic validation on the prospective document **before** touching live state. A rejected edit leaves the composition byte-identical.
- **All or nothing.** An operation that writes several pointers writes all of them or none. There is no half-applied edit, including on cancellation.
- **One receipt.** A successful mutating operation returns the new revision, a bounded description of what changed, the validation findings that appeared or cleared, the undo label it recorded, and the focus it moved. The receipt is the only thing the agent needs in order to continue; it never has to re-read the whole document to learn what it just did.

Read-only operations carry no revision requirement and record no history. Destroying work is the exception: `composition.revert-to-starter`, `session.delete-composition`, undo, redo, and export all require the observed revision, because each one either discards or ships a specific version.

### 4. One history, one focus, one visible state

**Undo and redo are shared.** Agent edits record into the same `CompositionEditHistory` the GUI uses, in one order. `gfx_composition_undo` undoes the most recent edit whoever made it. A separate agent history would let the two authors disagree about what "the last thing" was.

**Every mutating operation moves the Workspace focus** to the entity it touched — the Overlay it added, the Mark it retimed, the chart Block it filled. This is not decoration. It is how a person watching the screen sees what the agent did, and it is why the inventory requires a focus target on every `write` row. An operation whose subject can be more than one kind of element — a keyframe channel on the Surface, an Overlay, or a Block; a Cascade weld on any of the four anchorable entities — lists every target it may reveal, and the transaction core refuses one the row does not list. Listing one target for a multi-subject operation would force it to reveal an element it did not touch, which is the opposite of what this rule is for.

**Progressive enhancement is one-directional.** With WebMCP absent or its Permissions Policy denied, the Workspace behaves exactly as it does today. Nothing in the GUI may depend on a tool being registered.

### 5. Registration is state-aware and derived, never handwritten

Tools are registered against `document.modelContext` by a controller that owns the whole lifecycle:

- **Feature and version detection first.** No `document.modelContext`, or Chrome earlier than 153, means no registration and no console noise; the refusal is published on `window.__gfxWebmcpExposureRefusal` so a harness can read what the console does not say.
- **The renderer is not a registration input** (amended 2026-09-02). The CanvasDrawElement capability gate decides whether the Workspace mounts, not whether tools exist: a WebMCP browser without the renderer flag — a headless agent browser — registers the same tools behind the gate notice and can create, read, and edit a composition through them. Only operations that render need the flagged browser, and `pnpm eval:webmcp` proves both browsers.
- **Dynamic membership.** A tool is registered only in a state where it can succeed. `gfx_layer_remove_overlay` does not exist until an Overlay does; `gfx_composition_undo` exists only while history holds an edit to replay.
- **Progressive family disclosure.** `capability`, `composition`, `session`, and `playhead` form the core menu. `transport`, `layer`, `content`, `placement`, `appearance`, `motion`, `sound`, `media`, `validation`, and `delivery` are on-demand. `gfx_capability_prepare_family` selects one on-demand family; its currently usable tools join the core and replace the previous family. `validation` and `delivery` moved on demand in the 2026-09-15 amendment so the static Kinetic Word capabilities could join their owning families without exceeding the 35-tool disclosure ceiling. This is agent context management, not a GUI gesture or authoring decision.
- **Three hard ceilings.** A cold page stays within `WEBMCP_ALWAYS_REGISTERED_CEILING`; an open core stays within `WEBMCP_CORE_REGISTERED_CEILING`; core plus one family stays within `WEBMCP_DISCLOSED_REGISTERED_CEILING`. The controller rejects an overrun instead of truncating the menu.
- **Chrome 153 signal separation.** Registration uses the second `registerTool` argument. Execution receives Chrome's independent signal. Cancellable GFX operations combine caller cancellation with registration lifetime, so user cancellation, route changes, and teardown stop long work. Aborting a registration does not rely on cancelling an in-flight execution.
- **Schemas are derived, never restated.** Every closed enum is generated from live registries and Zod. Runtime-variant objects stay open in the WebMCP schema and validate strictly in their owning operation. Existing JSON-text and storage-native numeric forms remain accepted; direct nested objects, seconds, milliseconds, frames, and editor timecode let the operation do deterministic conversion instead of asking the agent to calculate it.

### 6. Budgets, because tool text is context

- Tool names: `gfx_<family>_<operation>`, lower snake case, at most `WEBMCP_TOOL_NAME_MAX_LENGTH` characters.
- Descriptions: at most `WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH` characters, saying what the operation decides and what it costs — never how to click anything.
- Active descriptors: at most the applicable cold, core-open, or one-family ceiling from §5.
- Results: at most `WEBMCP_RESULT_CHARACTER_BUDGET` characters. Lists are bounded and report their true total and whether they were truncated.
- The single exception is `gfx_composition_export_json`, capped at `WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET`. `gfx_composition_inspect` returns structure — ids, kinds, order, counts, revision — not the document body, so the ordinary "what am I working on" call stays cheap.

### 7. Security, consent, and untrusted content

- **Same-origin, top-level, secure context only.** Tools are registered only in gfx.computer's own top-level document. Never in a cross-origin frame, never on another origin's behalf. The public response carries a Permissions Policy that grants `tools` to self only.
- **No tool fetches a URL the caller supplies.** There is no agent-reachable request to an arbitrary address. The site-capture surface stays development-only, as [ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md) classifies it.
- **No tool opens a file picker, and no tool reads the disk.** `gfx_media_add_library_entry` accepts a bundled demo asset or a handle the visitor has already granted this page through their own gesture. An agent may ask the person to grant one; it may not grant it for them. A missing grant returns `consent_required`.
- **Export waits for the real outcome.** `gfx_delivery_export_video` returns a receipt only after the browser download actually completes. A cancelled or failed export returns `cancelled` or `export_failed` — never a success receipt for a file that does not exist.
- **Composition content is untrusted.** Text, captured document bodies, media filenames, validation finding messages, and rendered readable-text audits are the visitor's content, not instructions. Results still label it explicitly, and every registered descriptor also carries Chrome's `readOnlyHint` and `untrustedContentHint` derived from its operation row before the agent chooses it.
- **Nothing leaves the browser.** Composition JSON is never sent to the origin, never logged, and never attached to telemetry. The Export session receives rendered frames only, and destroys itself ([ADR-0052](0052-public-runtime-and-retention-architecture.md)).
- **Failures are corrective.** Every failure names one code from `WEBMCP_OPERATION_ERROR_CODES`, the exact target it rejected, and the valid alternatives. `unsupported_variant` says which variants exist. `stale_revision` says which revision is current. "Invalid input" on its own is a defect.

### 8. What is forbidden

- **UI verbs.** No tool clicks, taps, scrolls, drags, focuses an element, opens a panel, switches a rail mode, or takes a screenshot. Enforced on tool names by `WEBMCP_FORBIDDEN_TOOL_NAME_FRAGMENTS`, and in review on behavior.
- **Raw patching.** No `apply_json_patch`, no `set_field(pointer, value)`, no expression evaluation. Every write goes through a named operation that owns its pointers.
- **Direct reactive writes.** A tool handler never assigns to engine state. It calls the operation layer, which owns preflight, atomicity, history, autosave, and focus.
- **Silent partial success.** An operation either applies and reports, or fails and reports. There is no "applied most of it".

## Alternatives rejected

- **A generic patch tool over the Zod schema.** Total coverage in one tool, and no preconditions, no ownership, no undo labels, no corrective errors, no way to hide an impossible verb. Rejected in §Context; the inventory exists so that coverage does not have to mean genericity.
- **UI-actuation tools.** Rejected as not-authoring: coupled to layout, unable to describe its own effect, and permanently behind the GUI.
- **A separate agent edit history.** Simpler to implement and it makes "undo the last thing" ambiguous for both authors. Rejected for one shared stack.
- **Registering the whole inventory at all times.** Simplest lifecycle, worst agent behavior: an open composition would expose dozens of individually correct tools at once. Rejected for state-aware registration plus a bounded core and one explicitly prepared authoring family.
- **An export progress-polling tool.** Invites a busy loop and gives an agent a second way to ask about work it already started. Rejected: one call, one AbortSignal, one receipt.
- **Family-per-inspector-panel.** Would have made the boundaries obvious to whoever wrote the panels and meaningless to an agent, and it would break the moment the GUI reorganizes. Rejected for ownership by composition subtree.

## Consequences

- Implementation stops re-deciding. The operation layer, the WebMCP controller, the tool registrations, the agent evals, and the parity gate all read one inventory; a change to the authoring surface is a change to that file plus its two implementations.
- The parity gate becomes mechanical. Shared authoring promises GUI plus agent, verification promises GUI only, and context control promises agent only. It runs as [`../../scripts/audit-webmcp-operation-parity.ts`](../../scripts/audit-webmcp-operation-parity.ts) (`pnpm audit:webmcp-parity`) and records schema, registry, and tool digests for release acceptance.
- Adding an authoring capability still costs a row with an owning family, precondition, operation, and GUI path. Agent context control is explicitly non-authoring and gets no GUI path.
- Non-overlap is testable. Family pointer ownership is checked in [`../../src/lib/platform/webmcp-operation-inventory.test.ts`](../../src/lib/platform/webmcp-operation-inventory.test.ts), so a new operation cannot quietly reach into another family's subtree.
- The registered tool set changes with composition state and the prepared family. Chrome 153 can remove and later re-register the same name. Cancellable calls stop on caller cancellation or expired registration; quick atomic calls finish truthfully.
- Two things stay outside this contract on purpose: how the standard-browser fallback renders frames, and what the public origin's export limits are. Both are decided elsewhere ([ADR-0052](0052-public-runtime-and-retention-architecture.md) and the browser-rendering lane) and surface here only through `gfx_capability_inspect_limits` and the corrective codes.
