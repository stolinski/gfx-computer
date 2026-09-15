/**
 * Where a WebMCP tool's argument vocabulary comes from
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §5).
 *
 * Every enum an agent picks from — Surface, Block, Annotation, Overlay, Effect
 * and transition types, Pack slugs, Starter slugs, sound events, text effects,
 * orientations, rates, formats — is read here from the live registries and the
 * Zod composition schema. A tool that restates one of those lists has copied it,
 * and a copy goes stale silently: the registry gains a variant, the tool keeps
 * offering the old set, and the agent's refusal blames its own argument.
 *
 * Two mechanical guards make that detectable rather than arguable.
 * `readWebmcpSchemaDigest` folds the derived vocabulary and the operation
 * contract into one value the parity gate records, so a registry change that
 * leaves the digest still is a copy somewhere; `findWebmcpHandwrittenEnums`
 * reads a source file and names the enum it duplicated.
 */
import { hashObject } from '../utils/object';
import { NTSC_FRACTIONAL_FPS } from '../utils/composition-timing';
import { TEXT_EFFECT_IDS } from '../text-animations/catalog';
import { listSoundAssets } from './audio-assets';
import { availableCompositionExportFormats } from './composition-export-formats';
import {
	CAPTION_STYLES,
	CHART_MOTION_EASES,
	CHAT_MESSAGE_RECEIPTS,
	CHAT_MESSAGE_SIDES,
	CHAT_MESSAGE_TAPBACKS,
	ChartTypeSchema,
	DIAGRAM_ARROW_DIRECTIONS,
	DIAGRAM_KEYFRAME_CHANNELS,
	DIAGRAM_EDGE_ROUTES,
	DIAGRAM_INK_ROLES,
	DIAGRAM_LABEL_ROLES,
	DIAGRAM_LABEL_WRAP_MODES,
	DIAGRAM_NODE_FORMS,
	DIAGRAM_PRIMITIVE_TYPES,
	DIAGRAM_STAT_FORMATS,
	DIAGRAM_STROKE_KEYFRAME_CHANNELS,
	ENGINE_EASES,
	ENGINE_FONT_FAMILIES,
	KINETIC_WORD_HIERARCHIES,
	KINETIC_WORD_INK_ROLES,
	OVERLAY_KEYFRAME_CHANNELS,
	OVERLAY_PLACEMENT_ANCHORS,
	PresetSchema,
	SOUND_EVENTS,
	STAGE_CAMERA_MOVES,
	SURFACE_CHROME_MODES,
	SURFACE_KEYFRAME_CHANNELS,
	TEXT_ANIMATION_OVERLAY_SLOTS,
	TEXT_ANIMATION_SURFACE_SLOTS,
	TEXT_ANIMATION_TARGET_KINDS,
	WEB_DOCUMENT_SITES
} from './engine-schema';
import { listFixtures, listPresets } from './preset-catalog';
import { listSubstrateAssets } from './substrate-textures';
import { PACK_REGISTRY_SLUGS } from './packs/registry';
import {
	PIPELINE_DEFINITION_REGISTRY,
	REGISTERED_BLOCK_TYPES,
	REGISTERED_EFFECT_TYPES,
	REGISTERED_OVERLAY_TYPES,
	REGISTERED_SURFACE_TYPES
} from './pipelines/definition-registry';
import { STAGE_REGISTRY } from './pipelines/stage-registry';
import { transitionEffectTypes } from './pipelines/transition-definition-registry';
import {
	WEBMCP_ALWAYS_REGISTERED_CEILING,
	WEBMCP_CORE_REGISTERED_CEILING,
	WEBMCP_DISCLOSED_REGISTERED_CEILING,
	WEBMCP_MINIMUM_CHROME_MAJOR_VERSION,
	WEBMCP_ON_DEMAND_FAMILY_NAMES,
	WEBMCP_OPERATION_ERROR_CODES,
	WEBMCP_OPERATION_FAMILIES,
	WEBMCP_OPERATION_INVENTORY,
	WEBMCP_RESULT_CHARACTER_BUDGET,
	WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH,
	WEBMCP_TOOL_NAME_MAX_LENGTH,
	WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET
} from './webmcp-operation-inventory';

/**
 * The vocabularies a tool argument can be drawn from. Each name resolves to a
 * live registry or schema read in `readWebmcpDerivedEnums` — adding a name means
 * naming its source, never its members.
 */
export type WebmcpDerivedEnumName =
	| 'authoring-family'
	| 'surface-type'
	| 'web-document-site'
	| 'surface-chrome-mode'
	| 'block-type'
	| 'chart-block-type'
	| 'annotation-style'
	| 'overlay-type'
	| 'overlay-anchor'
	| 'effect-type'
	| 'transition-effect'
	| 'text-effect'
	| 'text-animation-target-kind'
	| 'text-animation-surface-slot'
	| 'text-animation-overlay-slot'
	| 'diagram-primitive-type'
	| 'diagram-node-form'
	| 'diagram-edge-route'
	| 'diagram-arrow-direction'
	| 'diagram-label-role'
	| 'diagram-label-wrap'
	| 'diagram-stat-format'
	| 'diagram-ink-role'
	| 'kinetic-word-hierarchy'
	| 'kinetic-word-ink-role'
	| 'chat-message-side'
	| 'chat-message-tapback'
	| 'chat-message-receipt'
	| 'stage-type'
	| 'stage-camera-move'
	| 'stage-backdrop-asset'
	| 'pack-slug'
	| 'starter-slug'
	| 'transition-endpoint-slug'
	| 'sound-event'
	| 'sound-asset'
	| 'caption-style'
	| 'font-family'
	| 'motion-ease'
	| 'chart-motion-ease'
	| 'delivery-orientation'
	| 'export-format'
	| 'composition-kind'
	| 'surface-keyframe-channel'
	| 'overlay-keyframe-channel'
	| 'keyframe-channel'
	| 'operation-error-code';

/** The JSON Schema fragment one tool argument is described by. */
export type WebmcpSchemaProperty =
	| {
			type: 'string';
			description: string;
			enum?: readonly string[];
			minLength?: number;
			maxLength?: number;
	  }
	| { type: 'integer' | 'number'; description: string; minimum?: number; maximum?: number }
	| { type: 'boolean'; description: string }
	/** The absence of a value, so a clearable field can say so rather than guess at an empty one. */
	| { type: 'null'; description: string }
	| {
			type: 'array';
			description: string;
			items: WebmcpSchemaProperty;
			minItems?: number;
			maxItems?: number;
	  }
	| {
			type: 'object';
			description: string;
			properties: Readonly<Record<string, WebmcpSchemaProperty>>;
			required?: readonly string[];
			additionalProperties: boolean;
	  }
	| { description: string; oneOf: readonly WebmcpSchemaProperty[] };

/** The argument object a registered WebMCP tool accepts. */
export interface WebmcpToolInputSchema {
	type: 'object';
	properties: Readonly<Record<string, WebmcpSchemaProperty>>;
	required: readonly string[];
	additionalProperties: false;
}

/** The input schema of a tool that decides everything from the state it reads. */
export const WEBMCP_NO_ARGUMENTS_SCHEMA: WebmcpToolInputSchema = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false
};

/** The Zod `kind` enum, unwrapped past the default the composition schema gives it. */
function readCompositionKinds(): readonly string[] {
	return PresetSchema.shape.kind.def.innerType.options;
}

/**
 * Every property channel any element declares, folded into one list. Which of
 * them a given subject actually declares is narrower — a Surface fades only, a
 * stroke-drawn diagram primitive fades only — and the operation answers that
 * with the subject's own channels. This is the menu an agent picks from before
 * it knows the subject.
 */
function readKeyframeChannels(): readonly string[] {
	return [
		...new Set<string>([
			...SURFACE_KEYFRAME_CHANNELS,
			...OVERLAY_KEYFRAME_CHANNELS,
			...DIAGRAM_KEYFRAME_CHANNELS,
			...DIAGRAM_STROKE_KEYFRAME_CHANNELS
		])
	];
}

/**
 * The live vocabulary, read fresh on every call. Nothing here is cached: a
 * cached copy is a copy, and the whole point of this module is that a registry
 * addition reaches an agent's tool list without anyone editing a list.
 */
export function readWebmcpDerivedEnums(): Readonly<
	Record<WebmcpDerivedEnumName, readonly string[]>
> {
	return {
		'authoring-family': WEBMCP_ON_DEMAND_FAMILY_NAMES,
		'surface-type': REGISTERED_SURFACE_TYPES,
		'web-document-site': WEB_DOCUMENT_SITES,
		'surface-chrome-mode': SURFACE_CHROME_MODES,
		'block-type': REGISTERED_BLOCK_TYPES,
		'chart-block-type': ChartTypeSchema.options,
		'annotation-style': Object.values(PIPELINE_DEFINITION_REGISTRY.annotations).map(
			(definition) => definition.style
		),
		'overlay-type': REGISTERED_OVERLAY_TYPES,
		'overlay-anchor': OVERLAY_PLACEMENT_ANCHORS,
		'effect-type': REGISTERED_EFFECT_TYPES,
		'transition-effect': transitionEffectTypes(),
		'text-effect': TEXT_EFFECT_IDS,
		'text-animation-target-kind': TEXT_ANIMATION_TARGET_KINDS,
		'text-animation-surface-slot': TEXT_ANIMATION_SURFACE_SLOTS,
		'text-animation-overlay-slot': TEXT_ANIMATION_OVERLAY_SLOTS,
		'diagram-primitive-type': DIAGRAM_PRIMITIVE_TYPES,
		'diagram-node-form': DIAGRAM_NODE_FORMS,
		'diagram-edge-route': DIAGRAM_EDGE_ROUTES,
		'diagram-arrow-direction': DIAGRAM_ARROW_DIRECTIONS,
		'diagram-label-role': DIAGRAM_LABEL_ROLES,
		'diagram-label-wrap': DIAGRAM_LABEL_WRAP_MODES,
		'diagram-stat-format': DIAGRAM_STAT_FORMATS,
		'diagram-ink-role': DIAGRAM_INK_ROLES,
		'kinetic-word-hierarchy': KINETIC_WORD_HIERARCHIES,
		'kinetic-word-ink-role': KINETIC_WORD_INK_ROLES,
		'chat-message-side': CHAT_MESSAGE_SIDES,
		'chat-message-tapback': CHAT_MESSAGE_TAPBACKS,
		'chat-message-receipt': CHAT_MESSAGE_RECEIPTS,
		'stage-type': Object.keys(STAGE_REGISTRY),
		'stage-camera-move': STAGE_CAMERA_MOVES,
		'stage-backdrop-asset': listSubstrateAssets(),
		'pack-slug': PACK_REGISTRY_SLUGS,
		'starter-slug': listPresets().map((entry) => entry.slug),
		// A transition wipes between any two catalogued compositions, fixtures
		// included, which is a wider set than the Starters a caller forks from.
		'transition-endpoint-slug': [...listPresets(), ...listFixtures()].map((entry) => entry.slug),
		'sound-event': SOUND_EVENTS,
		'sound-asset': listSoundAssets(),
		'caption-style': CAPTION_STYLES,
		'font-family': Object.keys(ENGINE_FONT_FAMILIES),
		'motion-ease': Object.keys(ENGINE_EASES),
		'chart-motion-ease': CHART_MOTION_EASES,
		'delivery-orientation': PresetSchema.shape.state.shape.transport.shape.orientation.options,
		// What this origin delivers, not what the schema declares: the hosted
		// origin offers WebM alone, and a tool must not offer a format it cannot
		// deliver (ADR-0054 §4).
		'export-format': availableCompositionExportFormats(),
		'composition-kind': readCompositionKinds(),
		'surface-keyframe-channel': SURFACE_KEYFRAME_CHANNELS,
		'overlay-keyframe-channel': OVERLAY_KEYFRAME_CHANNELS,
		'keyframe-channel': readKeyframeChannels(),
		'operation-error-code': WEBMCP_OPERATION_ERROR_CODES
	};
}

/**
 * Whether a caller's string names a vocabulary. The `capability` family lets an
 * agent ask for a section by name, so this is the boundary where that name stops
 * being arbitrary text.
 */
export function isWebmcpDerivedEnumName(value: string): value is WebmcpDerivedEnumName {
	return Object.hasOwn(readWebmcpDerivedEnums(), value);
}

/** Every vocabulary a caller can ask for, read from the record rather than listed. */
export function readWebmcpVocabularySections(): readonly WebmcpDerivedEnumName[] {
	return Object.keys(readWebmcpDerivedEnums()).filter(isWebmcpDerivedEnumName);
}

/** One tool argument drawn from a live vocabulary rather than a restated list. */
export function webmcpDerivedEnumProperty(
	name: WebmcpDerivedEnumName,
	description: string
): WebmcpSchemaProperty {
	const members = readWebmcpDerivedEnums()[name];
	if (members.length === 0) {
		throw new TypeError(`The WebMCP vocabulary "${name}" resolved to no members.`);
	}
	return { type: 'string', description, enum: members };
}

/**
 * The stable id of an entity already in the composition — an Overlay, an Effect,
 * a Block, a text animation.
 *
 * Deliberately a free string rather than an enum. Ids are made as entities are
 * added, and a tool's schema is built once when the controller starts, so a list
 * of ids would be a snapshot of a composition the caller has since edited. The
 * operation answers an unknown id by naming the ids the composition holds right
 * now, which is the correction a frozen list could not give.
 */
export function webmcpEntityIdProperty(description: string): WebmcpSchemaProperty {
	return { type: 'string', description, minLength: 1 };
}

/**
 * A runtime-variant object whose exact fields are validated by its owning
 * Pipeline or Block schema. Keeping this open lets an agent send a nested object
 * directly instead of JSON text inside the outer tool arguments.
 */
export function webmcpRuntimeObjectProperty(description: string): WebmcpSchemaProperty {
	return {
		type: 'object',
		description,
		properties: {},
		additionalProperties: true
	};
}

/** A nested runtime object with the JSON-text form retained for compatibility. */
export function webmcpRuntimeObjectOrJsonTextProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			webmcpRuntimeObjectProperty('A nested JSON object.'),
			{
				type: 'string',
				description: 'Legacy JSON text containing the object.',
				minLength: 1
			}
		]
	};
}

/** A nested runtime array with the JSON-text form retained for compatibility. */
export function webmcpRuntimeArrayOrJsonTextProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			{
				type: 'array',
				description: 'A nested JSON array.',
				items: webmcpRuntimeObjectProperty('One array entry.')
			},
			{
				type: 'string',
				description: 'Legacy JSON text containing the array.',
				minLength: 1
			}
		]
	};
}

/** A value on the engine's 0-through-1 scale: a clip fraction, an intensity, a depth. */
export function webmcpFractionProperty(description: string): WebmcpSchemaProperty {
	return { type: 'number', description, minimum: 0, maximum: 1 };
}

function webmcpDirectTimeQuantityProperties(): readonly WebmcpSchemaProperty[] {
	return [
		{
			type: 'object',
			description: 'A direct value in seconds.',
			properties: { seconds: { type: 'number', description: 'Seconds.', minimum: 0 } },
			required: ['seconds'],
			additionalProperties: false
		},
		{
			type: 'object',
			description: 'A direct value in milliseconds.',
			properties: {
				milliseconds: { type: 'number', description: 'Milliseconds.', minimum: 0 }
			},
			required: ['milliseconds'],
			additionalProperties: false
		},
		{
			type: 'object',
			description: 'A direct value in whole frames.',
			properties: { frames: { type: 'integer', description: 'Whole frames.', minimum: 0 } },
			required: ['frames'],
			additionalProperties: false
		}
	];
}

/** A stored fraction or a direct unit the operation converts to that fraction. */
export function webmcpFractionTimeProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			webmcpFractionProperty('A legacy fraction of the composition duration.'),
			...webmcpDirectTimeQuantityProperties()
		]
	};
}

/** A legacy frame count or a direct duration resolved onto the frame grid. */
export function webmcpFrameDurationProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			{ type: 'integer', description: 'A whole-frame duration.', minimum: 0 },
			...webmcpDirectTimeQuantityProperties()
		]
	};
}

/** An exact frame or a direct timeline unit the operation resolves to one. */
export function webmcpFrameTimeProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			{ type: 'integer', description: 'A zero-based exact frame.', minimum: 0 },
			...webmcpDirectTimeQuantityProperties(),
			{
				type: 'object',
				description: 'A non-drop or drop-frame editor timecode.',
				properties: {
					timecode: {
						type: 'string',
						description: 'HH:MM:SS:FF or drop-frame HH:MM:SS;FF.',
						minLength: 11,
						maxLength: 11
					}
				},
				required: ['timecode'],
				additionalProperties: false
			}
		]
	};
}

/**
 * Text a caller can also remove. `null` is spelled out rather than implied by an
 * empty string, because a slot holding `""` and a slot the document does not
 * carry are different compositions.
 */
export function webmcpClearableTextProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			{ type: 'string', description: 'The text to write.' },
			{ type: 'null', description: 'Remove this value from the composition.' }
		]
	};
}

/**
 * A number a caller can also remove, so the field returns to whatever the engine
 * or the Pack resolves for it. `null` is spelled out for the same reason it is
 * on text: an absent argument leaves the value alone, and a cleared one is a
 * different composition.
 */
export function webmcpClearableNumberProperty(
	description: string,
	bounds: { minimum?: number; maximum?: number } = {}
): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			{ type: 'number', description: 'The value to author.', ...bounds },
			{ type: 'null', description: 'Remove this value from the composition.' }
		]
	};
}

/**
 * The frame rate argument, derived from the transport schema's own two accepted
 * shapes: a whole rate, or one of the NTSC fractional rates an edit can carry.
 */
export function webmcpTransportRateProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			{ type: 'integer', description: 'A whole frame rate.', minimum: 1, maximum: 120 },
			{
				type: 'number',
				description: `An NTSC fractional rate: ${NTSC_FRACTIONAL_FPS.join(', ')}.`,
				minimum: Math.min(...NTSC_FRACTIONAL_FPS),
				maximum: Math.max(...NTSC_FRACTIONAL_FPS)
			}
		]
	};
}

/**
 * The revision argument every mutating, history, and destructive operation
 * takes. Derived from the transaction contract rather than restated per tool, so
 * one wording reaches every agent (ADR-0054 §3).
 */
export function webmcpObservedRevisionProperty(): WebmcpSchemaProperty {
	return {
		type: 'integer',
		description:
			'The Composition revision you last observed. A mismatch fails with stale_revision and applies nothing.',
		minimum: 0
	};
}

/**
 * The whole input schema of an operation whose only argument is the version of
 * the composition it acts on — the one revert and undo and redo discard or
 * replay, and the one an export ships. Built once so the four cannot drift apart
 * on the one argument they share.
 */
export function webmcpObservedRevisionOnlySchema(): WebmcpToolInputSchema {
	return {
		type: 'object',
		properties: { expectedRevision: webmcpObservedRevisionProperty() },
		required: ['expectedRevision'],
		additionalProperties: false
	};
}

/**
 * The digest the parity gate records. It folds the live vocabulary together with
 * the operation contract and the text budgets, so a registry gaining a variant
 * moves it — and a tool list that did not move alongside a registry change is
 * carrying a copy.
 */
export function readWebmcpSchemaDigest(): string {
	return hashObject({
		vocabulary: readWebmcpDerivedEnums(),
		families: WEBMCP_OPERATION_FAMILIES.map((family) => ({
			name: family.name,
			disclosure: family.disclosure
		})),
		operations: WEBMCP_OPERATION_INVENTORY.map((row) => ({
			id: row.id,
			toolName: row.toolName,
			effect: row.effect,
			precondition: row.precondition,
			exposure: row.exposure,
			requiresExpectedRevision: row.requiresExpectedRevision,
			cancellable: row.cancellable,
			focus: row.focus,
			writes: row.writes
		})),
		browser: { minimumChromeMajorVersion: WEBMCP_MINIMUM_CHROME_MAJOR_VERSION },
		budgets: {
			toolName: WEBMCP_TOOL_NAME_MAX_LENGTH,
			description: WEBMCP_TOOL_DESCRIPTION_MAX_LENGTH,
			result: WEBMCP_RESULT_CHARACTER_BUDGET,
			wholeDocument: WEBMCP_WHOLE_DOCUMENT_CHARACTER_BUDGET,
			coldPageCeiling: WEBMCP_ALWAYS_REGISTERED_CEILING,
			coreOpenCeiling: WEBMCP_CORE_REGISTERED_CEILING,
			disclosedOpenCeiling: WEBMCP_DISCLOSED_REGISTERED_CEILING
		}
	});
}

/** A vocabulary a source file restated instead of reading from its registry. */
export interface WebmcpHandwrittenEnumFinding {
	enumName: WebmcpDerivedEnumName;
	/** The members the file spelled out, in the order they appeared. */
	duplicated: readonly string[];
}

/**
 * How many members of one vocabulary a literal list may share before it is a
 * copy rather than a coincidence. Two unrelated string literals landing in one
 * array is a coincidence; two members of the same registry is a restated enum.
 */
const HANDWRITTEN_ENUM_MEMBER_THRESHOLD = 2;

/** Array literals whose entries are nothing but quoted strings. */
const STRING_ARRAY_LITERAL_PATTERN =
	/\[\s*(?:'[^'\n]*'|"[^"\n]*")\s*(?:,\s*(?:'[^'\n]*'|"[^"\n]*")\s*)*,?\s*\]/g;

const QUOTED_STRING_PATTERN = /'([^'\n]*)'|"([^"\n]*)"/g;

/**
 * The vocabularies a source file spells out. Reads array literals only: a
 * description that happens to name two Overlay types is prose an author wrote
 * on purpose, while `['lowerThird', 'watermark']` is the registry, copied.
 */
export function findWebmcpHandwrittenEnums(
	source: string
): readonly WebmcpHandwrittenEnumFinding[] {
	const vocabulary = readWebmcpDerivedEnums();
	const findings: WebmcpHandwrittenEnumFinding[] = [];

	for (const literal of source.match(STRING_ARRAY_LITERAL_PATTERN) ?? []) {
		const entries = [...literal.matchAll(QUOTED_STRING_PATTERN)].map(
			(match) => match[1] ?? match[2]
		);
		for (const [name, members] of Object.entries(vocabulary)) {
			const duplicated = entries.filter((entry) => members.includes(entry));
			if (duplicated.length >= HANDWRITTEN_ENUM_MEMBER_THRESHOLD) {
				findings.push({ enumName: name as WebmcpDerivedEnumName, duplicated });
			}
		}
	}

	return findings;
}
