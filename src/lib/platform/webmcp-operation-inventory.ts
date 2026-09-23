/**
 * The machine-readable GFX authoring operation inventory ratified by
 * [ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md).
 *
 * One row per operation, including the one non-authoring context control. Each
 * row names its family, tool, writes, registration state, transport exposure,
 * and GUI owner where one exists. The parity gate requires exactly the transports
 * each exposure declares, and a tool that is not a row here has no contract.
 *
 * This module is the contract, not the implementation. It deliberately carries
 * no runtime behavior — the operation layer, the WebMCP controller, and the
 * parity gate each read it and are each verified against it.
 */

/** The non-overlapping domains an authoring decision can belong to. */
export type WebmcpOperationFamilyName =
	| 'capability'
	| 'composition'
	| 'session'
	| 'transport'
	| 'layer'
	| 'content'
	| 'placement'
	| 'appearance'
	| 'motion'
	| 'sound'
	| 'media'
	| 'playhead'
	| 'validation'
	| 'verification'
	| 'delivery';

/**
 * What an operation changes. The kind fixes the transaction obligations the
 * inventory test enforces, so a row cannot quietly opt out of a revision check
 * or an undo entry.
 *
 * - `read` — returns state; changes nothing.
 * - `view` — moves ephemeral view state (the playhead); no document write.
 * - `context` — changes only which tool descriptors an agent reads.
 * - `write` — edits the open composition through the transaction core.
 * - `history` — replays a recorded edit (undo / redo).
 * - `lifecycle` — changes which composition is open, or the session store.
 * - `deliver` — produces a rendered artifact the visitor receives.
 */
export type WebmcpOperationEffectKind =
	'read' | 'view' | 'context' | 'write' | 'history' | 'lifecycle' | 'deliver';

/**
 * The condition under which a tool is registered on `document.modelContext`.
 * A tool that cannot succeed in the current state is unregistered, not
 * exposed-and-rejecting, so an agent never chooses an impossible verb.
 */
export type WebmcpOperationPrecondition =
	| 'always'
	| 'composition-open'
	| 'composition-editable'
	| 'forked-from-starter'
	| 'session-composition-present'
	| 'user-pack-store-served'
	| 'user-pack-present'
	| 'undo-available'
	| 'redo-available'
	| 'overlay-present'
	| 'effect-present'
	| 'mark-present'
	| 'text-animation-present'
	| 'diagram-present'
	| 'kinetic-word-addable'
	| 'kinetic-word-present'
	| 'chart-present'
	| 'captions-present'
	| 'chat-surface-active'
	| 'checklist-surface-active'
	| 'orientation-override-present'
	| 'keyframe-channel-present'
	| 'cascade-anchor-present'
	| 'transition-present'
	| 'audio-cue-present'
	| 'media-permitted'
	| 'media-entry-present'
	| 'video-clip-present';

/**
 * Which transports reach an authoring decision, and the one deliberate
 * exception.
 *
 * - `agent-tool` — an authoring decision is reachable from the GUI and WebMCP.
 * - `agent-context` — a WebMCP-only context change that touches no authored or
 *   visible state. Only preparing one on-demand family uses this.
 * - `internal-only` — the page runs this operation for itself and never hands it
 *   to an agent. The gate reads it as an intended absence rather than a
 *   one-transport defect, and the WebMCP controller refuses a tool definition
 *   that names such a row.
 *
 * Only rendered verification is `internal-only`: measuring real pixels serves
 * this project's own render gates, and no authoring decision needs it, so
 * exposing it would hand a caller a way to drive rendering work with nothing to
 * author at the end of it. The disposition is recorded here rather than inferred
 * from a missing tool, because "unexposed on purpose" and "not built yet" have
 * to be distinguishable by a machine.
 */
export type WebmcpOperationExposure = 'agent-tool' | 'agent-context' | 'internal-only';

/** How a family's tools enter the agent's active context. */
export type WebmcpOperationFamilyDisclosure = 'core' | 'on-demand' | 'internal';

/**
 * A Workspace selection an operation can leave focused, so a person watching the
 * screen sees what an agent just did.
 */
export type WebmcpOperationFocusTarget =
	| 'composition-root'
	| 'surface'
	| 'overlay'
	| 'block'
	| 'mark'
	| 'text-animation'
	| 'effect'
	| 'sound-cue'
	| 'captions'
	| 'media-library'
	| 'video-clip'
	| 'stage-camera'
	| 'stage-focus'
	| 'stage-body'
	| 'timeline-playhead'
	| 'session-catalog';

/**
 * A composition pointer a family may write. Ownership resolves by longest
 * pointer: a deeper pointer owned by another family wins inside its own
 * subtree. `membership` narrows the owner's authority to adding, removing,
 * reordering, and setting the identifying `type` / `id` of entries — never to
 * rewriting fields a deeper owner holds.
 */
export interface WebmcpOwnedCompositionPath {
	pointer: string;
	scope: 'membership' | 'value';
}

/** One domain of authoring decisions, and the composition subtrees it alone writes. */
export interface WebmcpOperationFamily {
	name: WebmcpOperationFamilyName;
	/** What an author decides here — the sentence that keeps families from overlapping. */
	domain: string;
	toolNamePrefix: string;
	/** Core tools stay visible; one on-demand family joins them at a time. */
	disclosure: WebmcpOperationFamilyDisclosure;
	ownedPaths: readonly WebmcpOwnedCompositionPath[];
}

/** One operation and the transports its exposure contract requires. */
export interface WebmcpOperationRow {
	id: string;
	family: WebmcpOperationFamilyName;
	toolName: string;
	/** The tool description an agent selects on. Bounded by WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH. */
	summary: string;
	effect: WebmcpOperationEffectKind;
	/** Composition pointers this operation may write; empty for every non-`write` kind. */
	writes: readonly string[];
	precondition: WebmcpOperationPrecondition;
	/** Whether the caller must supply the composition revision it read. */
	requiresExpectedRevision: boolean;
	undoable: boolean;
	/** Whether the operation accepts the caller's AbortSignal and can end as `cancelled`. */
	cancellable: boolean;
	/**
	 * Every Workspace selection this operation may leave focused. Most rows name
	 * exactly one. An operation whose subject can be more than one kind of
	 * element — a keyframe channel on the Surface, an Overlay, or a Block; a
	 * Cascade weld on any of the four anchorable entities — names each kind it can
	 * reveal, because §4 requires the focus to land on the entity the edit
	 * actually touched. Empty only for rows that change nothing a person could
	 * look at.
	 */
	focus: readonly WebmcpOperationFocusTarget[];
	/** Whether an agent reaches this decision at all, or the page keeps it to itself. */
	exposure: WebmcpOperationExposure;
	/**
	 * Repo-relative GUI owner of the same authoring decision. Null only for an
	 * `agent-context` row that changes tool disclosure rather than authored state.
	 */
	guiSurface: string | null;
}

/** WebMCP tool names: lower snake case under the GFX namespace (ADR-0053). */
export const WEBMCP_TOOL_NAME_PATTERN = /^gfx_[a-z][a-z0-9_]*$/;

export const WEBMCP_TOOL_NAME_MAX_LENGTH = 48;

/** The first Chrome version with detachable registration and execution signals. */
export const WEBMCP_MINIMUM_CHROME_MAJOR_VERSION = 153;

/** Tool descriptions stay short enough that a full tool list fits an agent's budget. */
export const WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH = 320;

/** Default ceiling on a tool result's serialized characters. */
export const WEBMCP_RESULT_CHARACTER_BUDGET = 4000;

/**
 * The one documented exception to the result budget: a whole-document read.
 * Nothing else may return an unbounded composition body.
 */
export const WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET = 262144;

/**
 * How many tools may be registered before a composition is open. A cold page
 * must offer an agent a short, obvious menu rather than the whole inventory.
 *
 * The number counts everything a closed page can offer, not only the `always`
 * rows: the two `session-composition-present` rows are also reachable with
 * nothing open, because a returning visitor's session still holds work to list
 * and delete. That whole set is discovery, the four ways to start a composition,
 * and the session catalog — every other precondition needs an open document.
 */
export const WEBMCP_ALWAYS_REGISTERED_CEILING = 9;

/** Core operations visible with a composition open before a family is prepared. */
export const WEBMCP_CORE_REGISTERED_CEILING = 20;

/** Core operations plus the largest single on-demand authoring family. */
export const WEBMCP_DISCLOSED_REGISTERED_CEILING = 35;

/**
 * Corrective failure codes. Every failure names one of these, the exact target
 * it rejected, and the valid alternatives — never a bare "invalid input".
 */
export const WEBMCP_OPERATION_ERROR_CODES = [
	'stale_revision',
	'no_composition_open',
	'composition_read_only',
	'precondition_unmet',
	'invalid_argument',
	'unknown_target',
	'unsupported_variant',
	'schema_invalid',
	'semantic_invalid',
	'consent_required',
	'storage_unavailable',
	'quota_exceeded',
	'limit_exceeded',
	'cancelled',
	'render_failed',
	'export_failed'
] as const;

export type WebmcpOperationErrorCode = (typeof WEBMCP_OPERATION_ERROR_CODES)[number];

/**
 * Name fragments that mean a tool actuates the interface or patches raw JSON
 * instead of naming an authoring decision. Forbidden in every tool name.
 */
export const WEBMCP_FORBIDDEN_TOOL_NAME_FRAGMENTS = [
	'click',
	'tap',
	'press',
	'scroll',
	'hover',
	'drag',
	'keypress',
	'screenshot',
	'panel',
	'button',
	'menu',
	'tab',
	'dialog',
	'patch',
	'set_path',
	'set_field',
	'set_property',
	'apply_json',
	'eval',
	'execute_script'
] as const;

export const WEBMCP_OPERATION_FAMILIES: readonly WebmcpOperationFamily[] = [
	{
		name: 'capability',
		domain: 'What this engine can express, and the limits the public demo enforces.',
		toolNamePrefix: 'gfx_capability_',
		disclosure: 'core',
		ownedPaths: []
	},
	{
		name: 'composition',
		domain: 'Which composition exists and is open, and how the document identifies itself.',
		toolNamePrefix: 'gfx_composition_',
		disclosure: 'core',
		ownedPaths: [
			{ pointer: '/name', scope: 'value' },
			{ pointer: '/description', scope: 'value' },
			{ pointer: '/kind', scope: 'value' }
		]
	},
	{
		name: 'session',
		domain: 'The browser-scoped Public demo session: what it holds and how it is emptied.',
		toolNamePrefix: 'gfx_session_',
		disclosure: 'core',
		ownedPaths: []
	},
	{
		name: 'transport',
		domain:
			'How the piece is framed and classified on output: orientation, time, rate, format, background.',
		toolNamePrefix: 'gfx_transport_',
		disclosure: 'on-demand',
		ownedPaths: [
			{ pointer: '/state/transport', scope: 'value' },
			{ pointer: '/state/backgroundFill', scope: 'value' }
		]
	},
	{
		name: 'layer',
		domain: 'Which Layer entities exist, in what order, and which registered variant each one is.',
		toolNamePrefix: 'gfx_layer_',
		disclosure: 'on-demand',
		ownedPaths: [
			{ pointer: '/state/surface/type', scope: 'value' },
			{ pointer: '/state/surface/variant', scope: 'value' },
			{ pointer: '/state/surface/site', scope: 'value' },
			{ pointer: '/state/surface/chrome', scope: 'value' },
			{ pointer: '/state/overlays', scope: 'membership' },
			{ pointer: '/state/effects', scope: 'membership' },
			{ pointer: '/state/textAnimations', scope: 'membership' },
			{ pointer: '/state/marks/timings', scope: 'membership' },
			{ pointer: '/state/surface/diagram', scope: 'membership' },
			{ pointer: '/state/surface/chart', scope: 'membership' },
			{ pointer: '/state/surface/typeField', scope: 'membership' }
		]
	},
	{
		name: 'content',
		domain: 'The words, values, and data an author writes into the piece.',
		toolNamePrefix: 'gfx_content_',
		disclosure: 'on-demand',
		ownedPaths: [
			{ pointer: '/state/surface/content', scope: 'value' },
			{ pointer: '/state/surface/content/messages', scope: 'membership' },
			{ pointer: '/state/surface/content/items', scope: 'membership' },
			{ pointer: '/state/overlays/*/content', scope: 'value' },
			{ pointer: '/state/surface/diagram/*', scope: 'value' },
			{ pointer: '/state/surface/chart/items/*', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*', scope: 'value' },
			{ pointer: '/state/surface/typeField/phrases', scope: 'value' },
			{ pointer: '/state/captions', scope: 'value' }
		]
	},
	{
		name: 'placement',
		domain: 'Where an element sits in the frame, at each orientation.',
		toolNamePrefix: 'gfx_placement_',
		disclosure: 'on-demand',
		ownedPaths: [
			{ pointer: '/state/overlays/*/position', scope: 'value' },
			{ pointer: '/state/overlays/*/z', scope: 'value' },
			{ pointer: '/state/overlays/*/pose', scope: 'value' },
			{ pointer: '/state/surface/pageAnchor', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/position', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/from', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/to', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/control', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/scale', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/maxWidth', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/orientationOverrides', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/position', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/scale', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/rotation', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/orientationOverrides', scope: 'value' }
		]
	},
	{
		name: 'appearance',
		domain:
			'How the piece looks under its Pack: brand, type, mark styling, effect and stage treatment.',
		toolNamePrefix: 'gfx_appearance_',
		disclosure: 'on-demand',
		ownedPaths: [
			{ pointer: '/pack', scope: 'value' },
			{ pointer: '/state/typography', scope: 'value' },
			{ pointer: '/state/marks/defaults', scope: 'value' },
			{ pointer: '/state/effects/*/params', scope: 'value' },
			{ pointer: '/state/stage', scope: 'value' },
			{ pointer: '/state/stage/camera', scope: 'value' },
			{ pointer: '/state/stage/focus', scope: 'value' },
			{ pointer: '/state/surface/backgroundVisibility', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/hierarchy', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/ink', scope: 'value' }
		]
	},
	{
		name: 'motion',
		domain:
			'When and how things move: enter/exit windows, keyframe channels, Cascade welds, transitions.',
		toolNamePrefix: 'gfx_motion_',
		disclosure: 'on-demand',
		ownedPaths: [
			{ pointer: '/state/surface/enter', scope: 'value' },
			{ pointer: '/state/surface/exit', scope: 'value' },
			{ pointer: '/state/surface/animation', scope: 'value' },
			{ pointer: '/state/overlays/*/enter', scope: 'value' },
			{ pointer: '/state/overlays/*/exit', scope: 'value' },
			{ pointer: '/state/overlays/*/animation', scope: 'value' },
			{ pointer: '/state/marks/timings/*', scope: 'value' },
			{ pointer: '/state/textAnimations/*', scope: 'value' },
			{ pointer: '/state/surface/diagram/*/animation', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/animation', scope: 'value' },
			{ pointer: '/state/surface/typeField/words/*/glyphStagger', scope: 'value' },
			{ pointer: '/state/surface/chart/items/*/motion', scope: 'value' },
			{ pointer: '/transition', scope: 'value' }
		]
	},
	{
		name: 'sound',
		domain: 'What the piece plays: manual cues, the single bed, and per-motion cue overrides.',
		toolNamePrefix: 'gfx_sound_',
		disclosure: 'on-demand',
		ownedPaths: [
			{ pointer: '/state/audioCues', scope: 'membership' },
			{ pointer: '/state/audioCues/*', scope: 'value' },
			{ pointer: '/state/surface/enter/sound', scope: 'value' },
			{ pointer: '/state/surface/exit/sound', scope: 'value' },
			{ pointer: '/state/overlays/*/enter/sound', scope: 'value' },
			{ pointer: '/state/overlays/*/exit/sound', scope: 'value' },
			{ pointer: '/state/marks/timings/*/sound', scope: 'value' }
		]
	},
	{
		name: 'media',
		domain: 'The composition Media library and the primary Video track cut from it.',
		toolNamePrefix: 'gfx_media_',
		disclosure: 'on-demand',
		ownedPaths: [{ pointer: '/state/media', scope: 'value' }]
	},
	{
		name: 'playhead',
		domain: 'Where the visible playhead sits, in exact frames.',
		toolNamePrefix: 'gfx_playhead_',
		disclosure: 'core',
		ownedPaths: []
	},
	{
		name: 'validation',
		domain: 'What is wrong with the composition without rendering it.',
		toolNamePrefix: 'gfx_validation_',
		disclosure: 'on-demand',
		ownedPaths: []
	},
	{
		name: 'verification',
		domain: 'What the composition actually renders, measured on real pixels.',
		toolNamePrefix: 'gfx_verification_',
		disclosure: 'internal',
		ownedPaths: []
	},
	{
		name: 'delivery',
		domain: 'Turning the composition into a file the visitor receives.',
		toolNamePrefix: 'gfx_delivery_',
		disclosure: 'on-demand',
		ownedPaths: []
	}
];

/** The families exposed only after `gfx_capability_prepare_family` selects one. */
export const WEBMCP_ON_DEMAND_FAMILY_NAMES: readonly WebmcpOperationFamilyName[] =
	WEBMCP_OPERATION_FAMILIES.filter((family) => family.disclosure === 'on-demand').map(
		(family) => family.name
	);

/** Chrome hints derived from the operation contract rather than restated per tool. */
export interface WebmcpToolAnnotations {
	readOnlyHint: boolean;
	untrustedContentHint: boolean;
}

/**
 * Read operations do not change state. Every non-capability operation may return
 * authored names, content, filenames, or validation findings, so it is marked
 * untrusted before an agent decides whether to read its result.
 */
export function readWebmcpOperationAnnotations(row: WebmcpOperationRow): WebmcpToolAnnotations {
	return {
		readOnlyHint: row.effect === 'read',
		untrustedContentHint: row.family !== 'capability'
	};
}

export const WEBMCP_OPERATION_INVENTORY: readonly WebmcpOperationRow[] = [
	// ---- capability: always registered, so a cold page still answers "what can you do?" ----
	{
		id: 'capability.inspect-vocabulary',
		family: 'capability',
		toolName: 'gfx_capability_inspect_vocabulary',
		summary:
			'List the registered Surface, Block, Annotation, Overlay, Effect, transition, text-animation, Pack, Starter, and sound vocabulary, one section per call.',
		effect: 'read',
		writes: [],
		precondition: 'always',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/AddMenu.svelte'
	},
	{
		id: 'capability.inspect-limits',
		family: 'capability',
		toolName: 'gfx_capability_inspect_limits',
		summary:
			'Report the public demo limits that reject work before it starts: duration, rate, frame count, export size, session storage, and result character budgets.',
		effect: 'read',
		writes: [],
		precondition: 'always',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/Workspace.svelte'
	},
	{
		id: 'capability.prepare-authoring-family',
		family: 'capability',
		toolName: 'gfx_capability_prepare_family',
		summary:
			'Prepare one authoring family so its currently usable tools join the core menu. Preparing another family replaces it.',
		effect: 'context',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-context',
		guiSurface: null
	},

	// ---- composition: the document's existence and identity ----
	{
		id: 'composition.create-blank',
		family: 'composition',
		toolName: 'gfx_composition_create_blank',
		summary:
			'Create a new composition from the blank Preset in this browser session and open it for editing.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'always',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},
	{
		id: 'composition.create-from-starter',
		family: 'composition',
		toolName: 'gfx_composition_create_from_starter',
		summary:
			'Fork a named Starter template into a new editable session composition while preserving the original Starter.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'always',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},
	{
		id: 'composition.open',
		family: 'composition',
		toolName: 'gfx_composition_open',
		summary:
			'Open an existing session composition, or a Starter template read-only. The first edit to a Starter forks it automatically.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'always',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},
	{
		id: 'composition.import-json',
		family: 'composition',
		toolName: 'gfx_composition_import_json',
		summary:
			'Import a standalone composition JSON document, including a Legacy Supers one, as a new session composition. Invalid documents return findings instead of importing.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'always',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},
	{
		id: 'composition.inspect',
		family: 'composition',
		toolName: 'gfx_composition_inspect',
		summary:
			'Return a bounded summary of the open composition: revision, identity, transport, Pack, and Layer ids, kinds, and order.',
		effect: 'read',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TimelineOutline.svelte'
	},
	{
		id: 'composition.export-json',
		family: 'composition',
		toolName: 'gfx_composition_export_json',
		summary:
			'Return the open composition as one standalone JSON document. The only operation allowed past the default result budget.',
		effect: 'read',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/InterchangeSection.svelte'
	},
	{
		id: 'composition.set-identity',
		family: 'composition',
		toolName: 'gfx_composition_set_identity',
		summary: 'Set the composition name, description, and catalog kind.',
		effect: 'write',
		writes: ['/name', '/description', '/kind'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/RootInspector.svelte'
	},
	{
		id: 'composition.revert-to-starter',
		family: 'composition',
		toolName: 'gfx_composition_revert_to_starter',
		summary:
			'Discard this fork and return to the pristine Starter template it came from. Every edit since the fork is lost.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'forked-from-starter',
		requiresExpectedRevision: true,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},
	{
		id: 'composition.undo',
		family: 'composition',
		toolName: 'gfx_composition_undo',
		summary:
			'Undo the most recent edit, whoever made it. GUI and agent edits share one history in one order.',
		effect: 'history',
		writes: [],
		precondition: 'undo-available',
		requiresExpectedRevision: true,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/Workspace.svelte'
	},
	{
		id: 'composition.redo',
		family: 'composition',
		toolName: 'gfx_composition_redo',
		summary: 'Redo the most recently undone edit from the shared history.',
		effect: 'history',
		writes: [],
		precondition: 'redo-available',
		requiresExpectedRevision: true,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/Workspace.svelte'
	},

	// ---- session: the browser-scoped store, never an origin-side one ----
	{
		id: 'session.inspect',
		family: 'session',
		toolName: 'gfx_session_inspect',
		summary:
			'List the compositions held in this browser session with their revisions, plus storage availability and remaining quota.',
		effect: 'read',
		writes: [],
		precondition: 'always',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},
	{
		id: 'session.delete-composition',
		family: 'session',
		toolName: 'gfx_session_delete_composition',
		summary:
			'Permanently delete one composition from this browser session, which holds the only stored copy.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'session-composition-present',
		requiresExpectedRevision: true,
		undoable: false,
		cancellable: false,
		focus: ['session-catalog'],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},
	{
		id: 'session.clear',
		family: 'session',
		toolName: 'gfx_session_clear',
		summary:
			'Permanently delete every composition in this browser session after explicit confirmation.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'session-composition-present',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['session-catalog'],
		exposure: 'agent-tool',
		guiSurface: 'src/routes/+page.svelte'
	},

	// ---- transport: framing and output classification ----
	{
		id: 'transport.set-orientation',
		family: 'transport',
		toolName: 'gfx_transport_set_orientation',
		summary:
			'Set the delivery orientation to horizontal or vertical and reflow authored geometry into that frame.',
		effect: 'write',
		writes: ['/state/transport'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/Workspace.svelte'
	},
	{
		id: 'transport.set-timing',
		family: 'transport',
		toolName: 'gfx_transport_set_timing',
		summary:
			'Set the composition duration in seconds and the frame rate from the standard broadcast and web rates.',
		effect: 'write',
		writes: ['/state/transport'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/RootInspector.svelte'
	},
	{
		id: 'transport.set-format',
		family: 'transport',
		toolName: 'gfx_transport_set_format',
		summary: 'Set the composition delivery format to WebM or ProRes.',
		effect: 'write',
		writes: ['/state/transport'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/Workspace.svelte'
	},
	{
		id: 'transport.set-background',
		family: 'transport',
		toolName: 'gfx_transport_set_background',
		summary:
			'Declare or remove the background fill. Declaring one makes the piece a full-frame segment; removing it returns a transparent overlay.',
		effect: 'write',
		writes: ['/state/backgroundFill'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/RootInspector.svelte'
	},

	// ---- layer: membership, order, and registered variant ----
	{
		id: 'layer.set-surface',
		family: 'layer',
		toolName: 'gfx_layer_set_surface',
		summary:
			'Replace the Surface with a registered Surface type, and set its variant, site, or chrome mode where that Surface declares one.',
		effect: 'write',
		writes: [
			'/state/surface/type',
			'/state/surface/variant',
			'/state/surface/site',
			'/state/surface/chrome'
		],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SurfaceInspector.svelte'
	},
	{
		id: 'layer.add-overlay',
		family: 'layer',
		toolName: 'gfx_layer_add_overlay',
		summary: 'Add an Overlay of a registered Overlay type and return its new stable id.',
		effect: 'write',
		writes: ['/state/overlays'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/AddMenu.svelte'
	},
	{
		id: 'layer.remove-overlay',
		family: 'layer',
		toolName: 'gfx_layer_remove_overlay',
		summary:
			'Remove an Overlay by id. References to it from Cascade anchors are reported before the edit applies.',
		effect: 'write',
		writes: ['/state/overlays'],
		precondition: 'overlay-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TimelineOutline.svelte'
	},
	{
		id: 'layer.reorder-overlay',
		family: 'layer',
		toolName: 'gfx_layer_reorder_overlay',
		summary: 'Move an Overlay to a new index in the Overlay stack, changing paint order.',
		effect: 'write',
		writes: ['/state/overlays'],
		precondition: 'overlay-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TimelineOutline.svelte'
	},
	{
		id: 'layer.add-annotation-mark',
		family: 'layer',
		toolName: 'gfx_layer_add_annotation_mark',
		summary: 'Add an Annotation Mark of a registered mark style over the Surface content.',
		effect: 'write',
		writes: ['/state/marks/timings'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['mark'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/AddMenu.svelte'
	},
	{
		id: 'layer.remove-annotation-mark',
		family: 'layer',
		toolName: 'gfx_layer_remove_annotation_mark',
		summary: 'Remove an Annotation Mark by index.',
		effect: 'write',
		writes: ['/state/marks/timings'],
		precondition: 'mark-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/MarkInspector.svelte'
	},
	{
		id: 'layer.add-effect',
		family: 'layer',
		toolName: 'gfx_layer_add_effect',
		summary:
			'Append an Effect of a registered Effect type to the post-process chain and return its new id.',
		effect: 'write',
		writes: ['/state/effects'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['effect'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/EffectsChainSection.svelte'
	},
	{
		id: 'layer.remove-effect',
		family: 'layer',
		toolName: 'gfx_layer_remove_effect',
		summary: 'Remove an Effect from the chain by id.',
		effect: 'write',
		writes: ['/state/effects'],
		precondition: 'effect-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/EffectChainRow.svelte'
	},
	{
		id: 'layer.reorder-effect',
		family: 'layer',
		toolName: 'gfx_layer_reorder_effect',
		summary: 'Move an Effect to a new index, changing the order the chain runs in.',
		effect: 'write',
		writes: ['/state/effects'],
		precondition: 'effect-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['effect'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/EffectsChainSection.svelte'
	},
	{
		id: 'layer.add-text-animation',
		family: 'layer',
		toolName: 'gfx_layer_add_text_animation',
		summary:
			'Add a text animation binding a registered text effect to one content slot. One binding per target.',
		effect: 'write',
		writes: ['/state/textAnimations'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['text-animation'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/AddMenu.svelte'
	},
	{
		id: 'layer.remove-text-animation',
		family: 'layer',
		toolName: 'gfx_layer_remove_text_animation',
		summary: 'Remove a text animation by id.',
		effect: 'write',
		writes: ['/state/textAnimations'],
		precondition: 'text-animation-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TextAnimInspector.svelte'
	},
	{
		id: 'layer.add-diagram-primitive',
		family: 'layer',
		toolName: 'gfx_layer_add_diagram_primitive',
		summary:
			'Add a diagram primitive — node, edge arrow, label, stat callout, or timeline segment — to the Surface diagram group.',
		effect: 'write',
		writes: ['/state/surface/diagram'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/AddMenu.svelte'
	},
	{
		id: 'layer.remove-diagram-primitive',
		family: 'layer',
		toolName: 'gfx_layer_remove_diagram_primitive',
		summary:
			'Remove a diagram primitive by id. Edges anchored to a removed node are reported before the edit applies.',
		effect: 'write',
		writes: ['/state/surface/diagram'],
		precondition: 'diagram-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/BlockInspector.svelte'
	},
	{
		id: 'layer.add-kinetic-word',
		family: 'layer',
		toolName: 'gfx_layer_add_kinetic_word',
		summary:
			'Add one first-class Kinetic Word Block to the plain Surface Type Field with authored starter placement.',
		effect: 'write',
		writes: ['/state/surface/typeField'],
		precondition: 'kinetic-word-addable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TimelineAddMenu.svelte'
	},
	{
		id: 'layer.remove-kinetic-word',
		family: 'layer',
		toolName: 'gfx_layer_remove_kinetic_word',
		summary: 'Remove one Kinetic Word Block by id after semantic phrases stop referencing it.',
		effect: 'write',
		writes: ['/state/surface/typeField'],
		precondition: 'kinetic-word-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KineticWordInspector.svelte'
	},
	{
		id: 'layer.add-chart-block',
		family: 'layer',
		toolName: 'gfx_layer_add_chart_block',
		summary:
			'Add a chart Block of a registered chart type to the Surface chart group and set whether the group shows one chart or a sequence.',
		effect: 'write',
		writes: ['/state/surface/chart'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/AddMenu.svelte'
	},
	{
		id: 'layer.remove-chart-block',
		family: 'layer',
		toolName: 'gfx_layer_remove_chart_block',
		summary: 'Remove a chart Block from the Surface chart group by id.',
		effect: 'write',
		writes: ['/state/surface/chart'],
		precondition: 'chart-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/ChartInspector.svelte'
	},

	// ---- content: the authored words, values, and data ----
	{
		id: 'content.set-surface-content',
		family: 'content',
		toolName: 'gfx_content_set_surface_content',
		summary:
			'Write the Surface content slots the active Surface declares: title, body, kicker, counterpoint, source, author, and the rest.',
		effect: 'write',
		writes: ['/state/surface/content'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SurfaceDocumentSection.svelte'
	},
	{
		id: 'content.set-chat-transcript',
		family: 'content',
		toolName: 'gfx_content_set_chat_transcript',
		summary: 'Replace the ordered chat transcript the message Surface renders.',
		effect: 'write',
		writes: ['/state/surface/content/messages'],
		precondition: 'chat-surface-active',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SurfaceMessagesSection.svelte'
	},
	{
		id: 'content.set-checklist-entries',
		family: 'content',
		toolName: 'gfx_content_set_checklist_entries',
		summary: 'Replace the ordered checklist entries and their checked state.',
		effect: 'write',
		writes: ['/state/surface/content/items'],
		precondition: 'checklist-surface-active',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SurfaceChecklistSection.svelte'
	},
	{
		id: 'content.set-overlay-content',
		family: 'content',
		toolName: 'gfx_content_set_overlay_content',
		summary:
			"Write one Overlay's content against the schema its registered Overlay Pipeline declares.",
		effect: 'write',
		writes: ['/state/overlays/*/content'],
		precondition: 'overlay-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/OverlayInspector.svelte'
	},
	{
		id: 'content.set-diagram-primitive',
		family: 'content',
		toolName: 'gfx_content_set_diagram_primitive',
		summary:
			"Write one diagram primitive's authored body: its text, form, route, arrow direction, and label role.",
		effect: 'write',
		writes: ['/state/surface/diagram/*'],
		precondition: 'diagram-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/BlockTypeSection.svelte'
	},
	{
		id: 'content.set-kinetic-word-text',
		family: 'content',
		toolName: 'gfx_content_set_kinetic_word_text',
		summary: 'Set the trimmed single-token text carried by one Kinetic Word Block.',
		effect: 'write',
		writes: ['/state/surface/typeField/words/*'],
		precondition: 'kinetic-word-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KineticWordInspector.svelte'
	},
	{
		id: 'content.set-kinetic-phrases',
		family: 'content',
		toolName: 'gfx_content_set_kinetic_phrases',
		summary:
			'Replace the ordered semantic phrases, including each phrase word order and one focal display word.',
		effect: 'write',
		writes: ['/state/surface/typeField/phrases'],
		precondition: 'kinetic-word-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KineticWordInspector.svelte'
	},
	{
		id: 'content.set-chart-block',
		family: 'content',
		toolName: 'gfx_content_set_chart_block',
		summary:
			"Write one chart Block's data, domain, labels, layout, normalization, highlights, callouts, and source note as one strict unit.",
		effect: 'write',
		writes: ['/state/surface/chart/items/*'],
		precondition: 'chart-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/ChartDataSection.svelte'
	},
	{
		id: 'content.set-captions',
		family: 'content',
		toolName: 'gfx_content_set_captions',
		summary:
			'Write the caption track: its style, accent, band position, scale, and the timed cues themselves.',
		effect: 'write',
		writes: ['/state/captions'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['captions'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/CaptionsInspector.svelte'
	},
	{
		id: 'content.clear-captions',
		family: 'content',
		toolName: 'gfx_content_clear_captions',
		summary: 'Remove the caption track entirely.',
		effect: 'write',
		writes: ['/state/captions'],
		precondition: 'captions-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/CaptionsInspector.svelte'
	},

	// ---- placement: where things sit, per orientation ----
	{
		id: 'placement.set-overlay-placement',
		family: 'placement',
		toolName: 'gfx_placement_set_overlay_placement',
		summary:
			"Set one Overlay's anchor, offset, rect, scale, and static rotation — either the shared placement or one complete orientation snapshot.",
		effect: 'write',
		writes: ['/state/overlays/*/position'],
		precondition: 'overlay-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/OverlayPositionSection.svelte'
	},
	{
		id: 'placement.clear-orientation-override',
		family: 'placement',
		toolName: 'gfx_placement_clear_orientation_override',
		summary:
			"Drop one Overlay's horizontal or vertical placement snapshot so that orientation falls back to the shared placement.",
		effect: 'write',
		writes: ['/state/overlays/*/position'],
		precondition: 'orientation-override-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/OverlayPositionSection.svelte'
	},
	{
		id: 'placement.set-overlay-depth',
		family: 'placement',
		toolName: 'gfx_placement_set_overlay_depth',
		summary:
			"Set one Overlay's depth: 0 at the Surface plane, 1 at the backdrop, negative lifted toward the camera. A depth stage or depth-of-field Effect activates its plane.",
		effect: 'write',
		writes: ['/state/overlays/*/z'],
		precondition: 'overlay-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/OverlayPositionSection.svelte'
	},
	{
		id: 'placement.set-overlay-pose',
		family: 'placement',
		toolName: 'gfx_placement_set_overlay_pose',
		summary:
			"Turn one Overlay's own plane on the depth stage — yaw, pitch, and roll in degrees about its rendered centre — or remove the pose. A posed Overlay rides its own plane, lit and shadowed with the scene.",
		effect: 'write',
		writes: ['/state/overlays/*/pose'],
		precondition: 'overlay-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/OverlayPositionSection.svelte'
	},
	{
		id: 'placement.set-surface-page-anchor',
		family: 'placement',
		toolName: 'gfx_placement_set_surface_page_anchor',
		summary:
			'Choose which point of a captured page sits at frame centre when the website-screenshot Surface is framed filmed, or return to the page centre.',
		effect: 'write',
		writes: ['/state/surface/pageAnchor'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/WebsiteCaptureFields.svelte'
	},
	{
		id: 'placement.set-diagram-geometry',
		family: 'placement',
		toolName: 'gfx_placement_set_diagram_geometry',
		summary:
			"Set one diagram primitive's composition-space position, endpoints, control point, scale, and label width, per orientation.",
		effect: 'write',
		writes: [
			'/state/surface/diagram/*/position',
			'/state/surface/diagram/*/from',
			'/state/surface/diagram/*/to',
			'/state/surface/diagram/*/control',
			'/state/surface/diagram/*/scale',
			'/state/surface/diagram/*/maxWidth',
			'/state/surface/diagram/*/orientationOverrides'
		],
		precondition: 'diagram-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/BlockGeometrySection.svelte'
	},
	{
		id: 'placement.set-kinetic-word-placement',
		family: 'placement',
		toolName: 'gfx_placement_set_kinetic_word_placement',
		summary:
			"Set one Kinetic Word's complete centre, scale, and rotation for shared placement or one orientation snapshot.",
		effect: 'write',
		writes: [
			'/state/surface/typeField/words/*/position',
			'/state/surface/typeField/words/*/scale',
			'/state/surface/typeField/words/*/rotation',
			'/state/surface/typeField/words/*/orientationOverrides'
		],
		precondition: 'kinetic-word-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KineticWordInspector.svelte'
	},

	// ---- appearance: Pack and look ----
	{
		id: 'appearance.set-pack',
		family: 'appearance',
		toolName: 'gfx_appearance_set_pack',
		summary:
			'Bind the composition to a registered Pack or User Pack, re-dressing every Pack-resolved Role while preserving content.',
		effect: 'write',
		writes: ['/pack'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/RootInspector.svelte'
	},
	// User Packs (ADR-0055): store documents, not the open composition. Their
	// revision is the document contentHash a save or delete must name; the two
	// store-answered preconditions keep every row off a browser-scoped host and
	// off a cold page.
	{
		id: 'appearance.inspect-user-pack-store',
		family: 'appearance',
		toolName: 'gfx_appearance_inspect_user_pack_store',
		summary:
			'Inspect the User Pack store: every pack it holds with its label and revision (contentHash), and which one the open composition wears.',
		effect: 'read',
		writes: [],
		precondition: 'user-pack-store-served',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/PackSection.svelte'
	},
	{
		id: 'appearance.fork-user-pack',
		family: 'appearance',
		toolName: 'gfx_appearance_fork_user_pack',
		summary:
			'Fork a built-in Pack into the store as a new editable User Pack (its cores, chrome, and fonts). The composition stays bound where it is.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'user-pack-store-served',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/PackSection.svelte'
	},
	{
		id: 'appearance.save-user-pack',
		family: 'appearance',
		toolName: 'gfx_appearance_save_user_pack',
		summary:
			'Save a User Pack against the contentHash you read: a whole manifest, or label, description, role, and font changes. Validated and font-materialized, or refused with the issues named.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'user-pack-present',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/UserPackEditor.svelte'
	},
	{
		id: 'appearance.delete-user-pack',
		family: 'appearance',
		toolName: 'gfx_appearance_delete_user_pack',
		summary:
			'Delete a User Pack from the store against the contentHash you read; it goes to trash. Refused while the open composition wears it.',
		effect: 'lifecycle',
		writes: [],
		precondition: 'user-pack-present',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/UserPackEditor.svelte'
	},
	{
		id: 'appearance.validate-user-pack',
		family: 'appearance',
		toolName: 'gfx_appearance_validate_user_pack',
		summary:
			'Return the structural, Google Fonts catalog, and catalog-shadowing issues a User Pack save would need corrected.',
		effect: 'read',
		writes: [],
		precondition: 'user-pack-store-served',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/UserPackEditor.svelte'
	},
	{
		id: 'appearance.set-typography',
		family: 'appearance',
		toolName: 'gfx_appearance_set_typography',
		summary:
			"Set the type family, and optionally override the Pack's paper and ink colours with explicit hexes.",
		effect: 'write',
		writes: ['/state/typography'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SurfaceAppearanceSection.svelte'
	},
	{
		id: 'appearance.set-kinetic-word-appearance',
		family: 'appearance',
		toolName: 'gfx_appearance_set_kinetic_word_appearance',
		summary:
			"Set one Kinetic Word's display/support hierarchy and Pack-owned ink/accent role selection.",
		effect: 'write',
		writes: ['/state/surface/typeField/words/*/hierarchy', '/state/surface/typeField/words/*/ink'],
		precondition: 'kinetic-word-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KineticWordInspector.svelte'
	},
	{
		id: 'appearance.set-mark-defaults',
		family: 'appearance',
		toolName: 'gfx_appearance_set_mark_defaults',
		summary: 'Set the default colour and intensity for each Annotation mark style.',
		effect: 'write',
		writes: ['/state/marks/defaults'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/MarkDefaultsSection.svelte'
	},
	{
		id: 'appearance.set-effect-params',
		family: 'appearance',
		toolName: 'gfx_appearance_set_effect_params',
		summary:
			"Set one Effect's parameters against the schema its registered Effect Pipeline declares.",
		effect: 'write',
		writes: ['/state/effects/*/params'],
		precondition: 'effect-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['effect'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/EffectChainRow.svelte'
	},
	{
		id: 'appearance.set-stage',
		family: 'appearance',
		toolName: 'gfx_appearance_set_stage',
		summary:
			'Set or remove the dimensional stage: its type, camera move, camera pose and travel (with a vertical pose and travel for the tall frame), focus plane and aperture, backdrop treatment, and the physical screen model whose glass the Surface plane is.',
		effect: 'write',
		writes: ['/state/stage'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/DepthStageSection.svelte'
	},
	{
		id: 'appearance.set-stage-camera',
		family: 'appearance',
		toolName: 'gfx_appearance_set_stage_camera',
		summary:
			'Set the stage camera alone, leaving the rest of the stage as it is: the legacy move, the rest pose (yaw, pitch, roll, distance, aim), its one travel, and the vertical pose and travel for the tall frame. Refused when the composition has no stage.',
		effect: 'write',
		writes: ['/state/stage/camera'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['stage-camera'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/StageCameraInspector.svelte'
	},
	{
		id: 'appearance.set-stage-focus',
		family: 'appearance',
		toolName: 'gfx_appearance_set_stage_focus',
		summary:
			'Set the stage focus alone, leaving the rest of the stage as it is: the focal plane, the aperture, the sharp band, and the rack focus with its window. Refused when the composition has no stage.',
		effect: 'write',
		writes: ['/state/stage/focus'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['stage-focus'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/StageFocusInspector.svelte'
	},
	{
		id: 'appearance.set-backdrop-visibility',
		family: 'appearance',
		toolName: 'gfx_appearance_set_backdrop_visibility',
		summary: "Set how much of the Surface's own backdrop shows through, from hidden to full.",
		effect: 'write',
		writes: ['/state/surface/backgroundVisibility'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SurfaceAppearanceSection.svelte'
	},

	// ---- motion: when and how things move ----
	{
		id: 'motion.set-surface-timing',
		family: 'motion',
		toolName: 'gfx_motion_set_surface_timing',
		summary: "Set the Surface's enter and exit windows: start, duration, and ease.",
		effect: 'write',
		writes: ['/state/surface/enter', '/state/surface/exit'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SurfaceTextMotionSection.svelte'
	},
	{
		id: 'motion.set-overlay-timing',
		family: 'motion',
		toolName: 'gfx_motion_set_overlay_timing',
		summary: "Set one Overlay's enter and exit windows: start, duration, and ease.",
		effect: 'write',
		writes: ['/state/overlays/*/enter', '/state/overlays/*/exit'],
		precondition: 'overlay-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TimelineClipBar.svelte'
	},
	{
		id: 'motion.set-mark-timing',
		family: 'motion',
		toolName: 'gfx_motion_set_mark_timing',
		summary:
			"Set one Annotation Mark's start, duration, ease, and its colour and intensity departure from the mark defaults.",
		effect: 'write',
		writes: ['/state/marks/timings/*'],
		precondition: 'mark-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['mark'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/MarkInspector.svelte'
	},
	{
		id: 'motion.set-text-animation',
		family: 'motion',
		toolName: 'gfx_motion_set_text_animation',
		summary:
			"Set one text animation's effect parameters and its timing window against the effect's declared schema.",
		effect: 'write',
		writes: ['/state/textAnimations/*'],
		precondition: 'text-animation-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['text-animation'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TextAnimInspector.svelte'
	},
	{
		id: 'motion.set-keyframe-channel',
		family: 'motion',
		toolName: 'gfx_motion_set_keyframe_channel',
		summary:
			'Author one property channel on the Surface, an Overlay, a diagram primitive, or a Kinetic Word as ordered keyframes with per-segment eases.',
		effect: 'write',
		writes: [
			'/state/surface/animation',
			'/state/overlays/*/animation',
			'/state/surface/diagram/*/animation',
			'/state/surface/typeField/words/*/animation'
		],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface', 'overlay', 'block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KeyframesSection.svelte'
	},
	{
		id: 'motion.set-kinetic-word-position-keyframe',
		family: 'motion',
		toolName: 'gfx_motion_set_kinetic_word_position_keyframe',
		summary:
			'Upsert one Kinetic Word X/Y position keyframe atomically for a shared or orientation-specific spatial path.',
		effect: 'write',
		writes: ['/state/surface/typeField/words/*/animation'],
		precondition: 'kinetic-word-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/CanvasEditingOverlay.svelte'
	},
	{
		id: 'motion.set-kinetic-word-glyph-stagger',
		family: 'motion',
		toolName: 'gfx_motion_set_kinetic_word_glyph_stagger',
		summary:
			"Set or clear the per-glyph delay one Kinetic Word's masked reveal track plays with, and its glyph order.",
		effect: 'write',
		writes: ['/state/surface/typeField/words/*/glyphStagger'],
		precondition: 'kinetic-word-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KineticWordInspector.svelte'
	},
	{
		id: 'motion.clear-keyframe-channel',
		family: 'motion',
		toolName: 'gfx_motion_clear_keyframe_channel',
		summary:
			"Remove one authored property channel so the element's intrinsic motion form runs again; clearing an orientation-scoped Kinetic Word spatial channel removes that complete replacement group.",
		effect: 'write',
		writes: [
			'/state/surface/animation',
			'/state/overlays/*/animation',
			'/state/surface/diagram/*/animation',
			'/state/surface/typeField/words/*/animation'
		],
		precondition: 'keyframe-channel-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['surface', 'overlay', 'block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/KeyframesSection.svelte'
	},
	{
		id: 'motion.set-cascade-anchor',
		family: 'motion',
		toolName: 'gfx_motion_set_cascade_anchor',
		summary:
			"Weld one element's entrance to another element's, with an offset. Cycles and missing anchors are rejected before the edit applies.",
		effect: 'write',
		writes: [
			'/state/overlays/*/animation',
			'/state/marks/timings/*',
			'/state/textAnimations/*',
			'/state/surface/diagram/*/animation'
		],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay', 'mark', 'text-animation', 'block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/CascadeSection.svelte'
	},
	{
		id: 'motion.clear-cascade-anchor',
		family: 'motion',
		toolName: 'gfx_motion_clear_cascade_anchor',
		summary: "Unweld one element's entrance so it times from the composition start again.",
		effect: 'write',
		writes: [
			'/state/overlays/*/animation',
			'/state/marks/timings/*',
			'/state/textAnimations/*',
			'/state/surface/diagram/*/animation'
		],
		precondition: 'cascade-anchor-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['overlay', 'mark', 'text-animation', 'block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/CascadeSection.svelte'
	},
	{
		id: 'motion.set-chart-motion',
		family: 'motion',
		toolName: 'gfx_motion_set_chart_motion',
		summary: "Set one chart Block's motion phases and their windows.",
		effect: 'write',
		writes: ['/state/surface/chart/items/*/motion'],
		precondition: 'chart-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['block'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/ChartMotionSection.svelte'
	},
	{
		id: 'motion.set-composition-transition',
		family: 'motion',
		toolName: 'gfx_motion_set_composition_transition',
		summary:
			'Declare the two-state transition recipe: the two composition slugs, the registered transition Effect, its duration, and its parameters.',
		effect: 'write',
		writes: ['/transition'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TransitionRecipeSection.svelte'
	},
	{
		id: 'motion.clear-composition-transition',
		family: 'motion',
		toolName: 'gfx_motion_clear_composition_transition',
		summary: 'Remove the transition recipe and return to an ordinary single-state composition.',
		effect: 'write',
		writes: ['/transition'],
		precondition: 'transition-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/TransitionWindowSection.svelte'
	},

	// ---- sound: cues and per-motion overrides ----
	{
		id: 'sound.set-cue',
		family: 'sound',
		toolName: 'gfx_sound_set_cue',
		summary:
			'Add or update a free-standing sound cue, or the single music bed, naming a bundled audio asset and its window.',
		effect: 'write',
		writes: ['/state/audioCues', '/state/audioCues/*'],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['sound-cue'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/AudioCueSection.svelte'
	},
	{
		id: 'sound.remove-cue',
		family: 'sound',
		toolName: 'gfx_sound_remove_cue',
		summary: 'Remove a free-standing sound cue or the bed by id.',
		effect: 'write',
		writes: ['/state/audioCues'],
		precondition: 'audio-cue-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SoundCueInspector.svelte'
	},
	{
		id: 'sound.set-motion-override',
		family: 'sound',
		toolName: 'gfx_sound_set_motion_override',
		summary:
			'Override the cue one motion emits — a different event, an explicit sample, or silence. The cue stays welded to that motion through any retiming.',
		effect: 'write',
		writes: [
			'/state/surface/enter/sound',
			'/state/surface/exit/sound',
			'/state/overlays/*/enter/sound',
			'/state/overlays/*/exit/sound',
			'/state/marks/timings/*/sound'
		],
		precondition: 'composition-editable',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['sound-cue'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/SoundSection.svelte'
	},

	// ---- media: library entries and the Video track ----
	{
		id: 'media.inspect-library',
		family: 'media',
		toolName: 'gfx_media_inspect_library',
		summary:
			'List Media library entries and Video clips with durations and availability, including an explicit unreachable status.',
		effect: 'read',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/MediaInspector.svelte'
	},
	{
		id: 'media.add-library-entry',
		family: 'media',
		toolName: 'gfx_media_add_library_entry',
		// ADR-0054 §7 also names a bundled demo-asset source. The engine bundles no
		// demo video yet, so this summary names only the source that exists today:
		// a description promising a catalog an agent cannot reach is a defect.
		summary:
			'Add a video from a grant the visitor already gave this page to the composition Media library.',
		effect: 'write',
		writes: ['/state/media'],
		precondition: 'media-permitted',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: true,
		focus: ['media-library'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/MediaInspector.svelte'
	},
	{
		id: 'media.remove-library-entry',
		family: 'media',
		toolName: 'gfx_media_remove_library_entry',
		summary:
			'Remove a Media library entry. Clips referencing it are reported before the edit applies.',
		effect: 'write',
		writes: ['/state/media'],
		precondition: 'media-entry-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['media-library'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/MediaInspector.svelte'
	},
	{
		id: 'media.add-video-clip',
		family: 'media',
		toolName: 'gfx_media_add_video_clip',
		summary:
			'Cut a Media library entry into the primary Video track at an exact frame, as a non-overlapping clip.',
		effect: 'write',
		writes: ['/state/media'],
		precondition: 'media-entry-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['video-clip'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/VideoTimelineTrack.svelte'
	},
	{
		id: 'media.update-video-clip',
		family: 'media',
		toolName: 'gfx_media_update_video_clip',
		summary: 'Move, trim, or slip one Video clip on exact frame boundaries.',
		effect: 'write',
		writes: ['/state/media'],
		precondition: 'video-clip-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['video-clip'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/VideoClipInspector.svelte'
	},
	{
		id: 'media.remove-video-clip',
		family: 'media',
		toolName: 'gfx_media_remove_video_clip',
		summary: 'Remove one Video clip, leaving a transparent gap in the track.',
		effect: 'write',
		writes: ['/state/media'],
		precondition: 'video-clip-present',
		requiresExpectedRevision: true,
		undoable: true,
		cancellable: false,
		focus: ['composition-root'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/VideoTimelineTrack.svelte'
	},

	// ---- playhead: exact frames, no document write ----
	{
		id: 'playhead.inspect',
		family: 'playhead',
		toolName: 'gfx_playhead_inspect',
		summary:
			'Report where the visible playhead sits, and the exact frame count, rate, and duration it moves within.',
		effect: 'read',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/CanvasControlsBar.svelte'
	},
	{
		id: 'playhead.seek-frame',
		family: 'playhead',
		toolName: 'gfx_playhead_seek_frame',
		summary:
			'Move the visible playhead to an exact frame. The Workspace shows that frame; nothing about the composition changes.',
		effect: 'view',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: ['timeline-playhead'],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/CanvasControlsBar.svelte'
	},

	// ---- validation and verification: read-only evidence ----
	//
	// The split is the whole point of two families. Validation reads the document
	// and an agent repairs what it names, so it is a tool. Verification measures
	// real pixels for this project's own render gates, which is work no authoring
	// decision needs, so both of its rows are `internal-only` and neither is
	// registered.
	{
		id: 'validation.inspect-findings',
		family: 'validation',
		toolName: 'gfx_validation_inspect_findings',
		summary:
			'Return the schema, semantic, and static-linter findings for the open composition, each naming the exact field and the correction. Messages quote untrusted composition content.',
		effect: 'read',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: false,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/InterchangeSection.svelte'
	},
	{
		id: 'verification.render-frame',
		family: 'verification',
		toolName: 'gfx_verification_render_frame',
		summary:
			'Render one exact frame and report its measured size, output class, alpha coverage, and whether it is blank. Long renders honour cancellation.',
		effect: 'read',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: true,
		focus: [],
		exposure: 'internal-only',
		guiSurface: 'src/lib/platform/InterchangeSection.svelte'
	},
	{
		id: 'verification.inspect-readable-text',
		family: 'verification',
		toolName: 'gfx_verification_inspect_readable_text',
		summary:
			'Report what the rendered frame actually reads: readable text, unreadable regions, and unintentional overlaps. Output is untrusted composition content.',
		effect: 'read',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: false,
		undoable: false,
		cancellable: true,
		focus: [],
		exposure: 'internal-only',
		guiSurface: 'src/lib/platform/InterchangeSection.svelte'
	},

	// ---- delivery: one call, one receipt, one real download ----
	{
		id: 'delivery.export-video',
		family: 'delivery',
		toolName: 'gfx_delivery_export_video',
		summary:
			'Export the open composition in a supported format and return a receipt only after the browser download really finishes. Cancellation stops render, encode, and download.',
		effect: 'deliver',
		writes: [],
		precondition: 'composition-open',
		requiresExpectedRevision: true,
		undoable: false,
		cancellable: true,
		focus: [],
		exposure: 'agent-tool',
		guiSurface: 'src/lib/platform/Workspace.svelte'
	}
];
