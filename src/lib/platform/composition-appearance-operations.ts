/**
 * The `appearance` family: how the piece looks under its Pack
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * Binding a Pack is the whole-composition look decision. It writes `/pack` and
 * nothing else: every Pack-resolved Role re-dresses, and no composition content
 * changes, because a Pack is appearance only (ADR-0023). That is also why the
 * decision sits here rather than in `transport`, which frames and classifies
 * output rather than dressing it.
 *
 * Everything else in the family is a departure from what the Pack resolved —
 * an explicit type voice, a mark colour, an Effect's parameters, a dimensional
 * stage, a Surface backdrop that shows through. Each one is optional twice
 * over: a composition that states none of them looks like its Pack, and
 * removing one returns that decision to the Pack rather than to a hard-coded
 * value. That is what keeps a composition Pack-neutral (ADR-0039) while still
 * letting an author overrule the dressing where the piece needs it.
 *
 * Two boundaries the family does not cross:
 *
 * - **A single mark's colour is not a default.** `/state/marks/defaults` is the
 *   style's dressing and belongs here; one mark's departure from it sits at
 *   `/state/marks/timings/<index>`, which `motion` owns and writes beside that
 *   mark's window.
 * - **The background fill is not appearance.** Declaring one classifies the
 *   output as a full-frame piece, so `transport.set-background` owns it. The
 *   Surface's own `backgroundVisibility` — how much of what is behind the
 *   Surface shows through it — is dressing, and is written here.
 */
import {
	ANNOTATION_MARK_STYLES,
	type AnnotationMarkStyle
} from '../annotations/annotation-mark-styles';
import { compositionEditHistory } from './composition-edit-history';
import {
	isCompositionTimeDuration,
	resolveCompositionFractionTime
} from './composition-time-input';
import { describeCompositionSchemaFindings } from './composition-validation-findings';
import { packState } from './engine-state.svelte';
import {
	ENGINE_FONT_FAMILIES,
	resolveMarkForIndex,
	StageCameraSchema,
	StageFocusSchema,
	StageSchema,
	type FontFamily,
	type MarkAppearance,
	type MarksState,
	type Preset,
	type Stage
} from './engine-schema';
import { getPack, listRuntimeUserPacks, PACK_REGISTRY } from './packs/registry';
import { ensurePackLoaded } from './user-pack-runtime';
import { userPackStore } from './user-pack-store';
import { isRecord, readDottedPathValue } from '../utils/object';
import {
	getEffectDefinition,
	getSurfaceDefinition,
	REGISTERED_SURFACE_TYPES
} from './pipelines/definition-registry';
import { getStageRegistration, STAGE_REGISTRY } from './pipelines/stage-registry';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { refuseUnloadableCompositionRenderers } from './composition-renderer-readiness';
import { resolvePackRoleColor } from './packs/resolve';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';

import type { WebmcpOperationRow } from './webmcp-operation-inventory';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface SetCompositionPackRequest {
	expectedRevision: number;
	packSlug: string;
}

export interface SetCompositionTypographyRequest {
	expectedRevision: number;
	/** The type voice; a Pack that claims `font-treatment` still overrules it. */
	fontFamily?: string;
	/** An explicit paper hex that wins over the Pack; `null` returns the Pack's field. */
	paperColor?: string | null;
	inkColor?: string | null;
}

/**
 * A mark style's dressing. Both fields are optional so an author can move the
 * intensity without restating the colour; what is left out keeps the value the
 * style currently resolves to.
 */
export interface CompositionMarkAppearancePatch {
	color?: string;
	intensity?: number;
}

export interface SetCompositionMarkDefaultsRequest {
	expectedRevision: number;
	/** The styles to dress; `null` drops a style's default back to the Pack's. */
	defaults: Partial<Record<AnnotationMarkStyle, CompositionMarkAppearancePatch | null>>;
}

export interface SetCompositionEffectParamsRequest {
	expectedRevision: number;
	effectId: string;
	/** Validated against the schema the Effect's own Pipeline declares. */
	params: unknown;
}

export interface SetCompositionStageRequest {
	expectedRevision: number;
	/**
	 * The whole stage, or `null` to remove it and return the flat multiplane
	 * path. Written whole rather than merged, so an absent field means the
	 * stage schema's own default and never a value left over from before.
	 */
	stage: unknown;
}

export interface SetCompositionBackdropVisibilityRequest {
	expectedRevision: number;
	/** 0 hides the Surface's backdrop entirely; 1 shows all of it. */
	visibility: number;
}

/**
 * The Packs a composition can bind to right now: the live registry plus every
 * User Pack loaded into this engine (ADR-0055). Store packs not yet loaded join
 * through `listBindablePackSlugs`, which asks the store.
 */
export function listRegisteredPackSlugs(): readonly string[] {
	return [...Object.keys(PACK_REGISTRY), ...listRuntimeUserPacks().map((pack) => pack.slug)];
}

/** Registered plus stored: the alternatives a refused pack binding names. */
export async function listBindablePackSlugs(): Promise<readonly string[]> {
	const slugs = new Set(listRegisteredPackSlugs());
	try {
		for (const meta of await userPackStore.listUserPacks()) slugs.add(meta.slug);
	} catch (cause) {
		console.error('Failed to list User Packs for the pack alternatives.', cause);
	}
	return [...slugs];
}

/** The stages the engine composites on, derived from the live stage registry. */
export function listRegisteredStageTypes(): readonly string[] {
	return Object.keys(STAGE_REGISTRY);
}

/** The type voices the engine ships, derived from the engine's own font table. */
export function listEngineFontFamilies(): readonly string[] {
	return Object.keys(ENGINE_FONT_FAMILIES);
}

function refuseUnauthorableHex(
	row: WebmcpOperationRow,
	field: string,
	value: string
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'invalid_argument',
		`"${value}" is not a colour; ${field} takes a #RRGGBB hex.`,
		{ rejected: value, alternatives: ['#RRGGBB', 'null'] }
	);
}

function refuseUnauthorableFraction(
	row: WebmcpOperationRow,
	field: string,
	value: number
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'invalid_argument',
		`${field} runs from 0 through 1.`,
		{ rejected: String(value), alternatives: ['0', '1'] }
	);
}

function isFraction(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isEngineFontFamily(value: string): value is FontFamily {
	return Object.hasOwn(ENGINE_FONT_FAMILIES, value);
}

function isAnnotationMarkStyle(value: string): value is AnnotationMarkStyle {
	return ANNOTATION_MARK_STYLES.some((style) => style === value);
}

/** Bind the composition to a registered Pack; every Pack-resolved Role re-dresses. */
export async function runSetCompositionPackOperation(
	request: SetCompositionPackRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-pack');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	// Built-ins first, then the User Pack store (ADR-0055); an absent slug is
	// refused with the packs that would have worked, never substituted.
	const packResolution = await ensurePackLoaded(request.packSlug);
	if (packResolution.kind === 'missing') {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			packResolution.message,
			{ rejected: request.packSlug, alternatives: await listBindablePackSlugs() }
		);
	}

	// A Pack's chrome contributes Effects to a full-frame piece, so switching
	// Packs can require renderers the current bundle has never loaded. Resolving
	// the prospective document first is what keeps a re-dress from producing a
	// frame missing its chrome.
	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{ ...readOpenCompositionDocument(), pack: request.packSlug },
		`the ${request.packSlug} Pack`
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Pack',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			draft.pack = request.packSlug;
		}
	});
}

/**
 * Set the type voice and the paper / ink departures from the Pack.
 *
 * The colours are overrides rather than values (ADR-0038): absent, a Surface
 * resolves the active Pack's fill and ink treatments, so `null` here is how an
 * author gives a colour back to the Pack rather than freezing whatever it
 * happened to resolve to.
 */
export async function runSetCompositionTypographyOperation(
	request: SetCompositionTypographyRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-typography');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	if (
		request.fontFamily === undefined &&
		request.paperColor === undefined &&
		request.inkColor === undefined
	) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Name the type voice, the paper colour, or the ink colour to set.',
			{ alternatives: ['fontFamily', 'paperColor', 'inkColor'] }
		);
	}

	const fontFamily = request.fontFamily;
	if (fontFamily !== undefined && !isEngineFontFamily(fontFamily)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${fontFamily}" is not a type voice this engine ships.`,
			{ rejected: fontFamily, alternatives: listEngineFontFamilies() }
		);
	}

	for (const [field, value] of [
		['paperColor', request.paperColor],
		['inkColor', request.inkColor]
	] as const) {
		if (typeof value === 'string' && !HEX_COLOR_PATTERN.test(value)) {
			return refuseUnauthorableHex(row, field, value);
		}
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set typography',
		focus: { target: 'surface' },
		mutate: (draft) => {
			if (fontFamily !== undefined) draft.state.typography.fontFamily = fontFamily;
			if (request.paperColor !== undefined) {
				draft.state.typography.paperColor = request.paperColor ?? undefined;
			}
			if (request.inkColor !== undefined) {
				draft.state.typography.inkColor = request.inkColor ?? undefined;
			}
		}
	});
}

/**
 * Dress each Annotation mark style: the colour a mark of that style draws in and
 * how strongly it lands.
 *
 * A patch merges over what the style currently resolves to rather than over what
 * the composition happens to store, so setting only the intensity of a style the
 * Pack dresses keeps that Pack colour instead of dropping to an engine fallback.
 */
export async function runSetCompositionMarkDefaultsOperation(
	request: SetCompositionMarkDefaultsRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-mark-defaults');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const entries = Object.entries(request.defaults);
	if (entries.length === 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Name at least one Annotation mark style to dress.',
			{ alternatives: ANNOTATION_MARK_STYLES }
		);
	}

	const marks = readOpenCompositionDocument().state.marks;
	const resolved = new Map<AnnotationMarkStyle, MarkAppearance | null>();

	for (const [style, patch] of entries) {
		if (!isAnnotationMarkStyle(style)) {
			return refuseCompositionOperation(
				row,
				revision,
				'unsupported_variant',
				`"${style}" is not an Annotation Mark style this engine registers.`,
				{ rejected: style, alternatives: ANNOTATION_MARK_STYLES }
			);
		}
		if (patch === null || patch === undefined) {
			resolved.set(style, null);
			continue;
		}
		if (patch.color !== undefined && !HEX_COLOR_PATTERN.test(patch.color)) {
			return refuseUnauthorableHex(row, `the ${style} colour`, patch.color);
		}
		if (patch.intensity !== undefined && !isFraction(patch.intensity)) {
			return refuseUnauthorableFraction(row, `The ${style} intensity`, patch.intensity);
		}
		const current = readEffectiveMarkAppearance(style, marks);
		resolved.set(style, {
			color: patch.color ?? current.color,
			intensity: patch.intensity ?? current.intensity
		});
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set mark defaults',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			for (const [style, appearance] of resolved) {
				if (appearance === null) {
					delete draft.state.marks.defaults[style];
					continue;
				}
				draft.state.marks.defaults[style] = { ...appearance };
			}
		}
	});
}

/**
 * What a mark of `style` draws with today: the composition's own default where
 * it states one, and the Pack's mark Role where it does not. Reading past the
 * composition is what makes a partial patch keep the dressing the piece shows.
 */
function readEffectiveMarkAppearance(
	style: AnnotationMarkStyle,
	marks: MarksState
): MarkAppearance {
	const packColor =
		marks.defaults[style]?.color ??
		resolvePackRoleColor(getPack(packState.slug), `${style}.fill`, 'accent-treatment');
	// An index past the authored timings resolves the style's default rather than
	// any one mark's departure from it — exactly what an undressed mark renders.
	const resolved = resolveMarkForIndex(style, marks.timings.length, marks, packColor);
	return { color: resolved.color, intensity: resolved.intensity };
}

/** Set one Effect's parameters against the schema its registered Pipeline declares. */
export async function runSetCompositionEffectParamsOperation(
	request: SetCompositionEffectParamsRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-effect-params');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const effects = readOpenCompositionDocument().state.effects;
	const effect = effects.find((entry) => entry.id === request.effectId);
	if (!effect) {
		return refuseCompositionOperation(
			row,
			revision,
			'unknown_target',
			`No Effect in this chain is named "${request.effectId}".`,
			{ rejected: request.effectId, alternatives: effects.map((entry) => entry.id) }
		);
	}

	const definition = getEffectDefinition(effect.type);
	if (!definition) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`Effect "${effect.id}" is a ${effect.type}, which this engine no longer registers.`,
			{ rejected: effect.type }
		);
	}

	// A param that carries keyframes is owned by its channel (ADR-0063 §10): the
	// GUI edits it only through its keyframe row, and so does an agent.
	const channelOwned = Object.entries(effect.animation?.channels ?? {})
		.filter(([, track]) => track.length > 0)
		.map(([path]) => path)
		.filter(
			(path) =>
				readDottedPathValue(request.params, path) !== readDottedPathValue(effect.params, path)
		);
	if (channelOwned.length > 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`Effect "${effect.id}" animates ${channelOwned.join(', ')} with keyframes; change those through its keyframe channel, or clear the channel first.`,
			{
				rejected: channelOwned.join(', '),
				alternatives: ['motion.set-keyframe-channel', 'motion.clear-keyframe-channel']
			}
		);
	}

	// An Effect Pipeline declares the schema of the whole Effect entry rather than
	// of its params alone, so the prospective entry is what gets parsed. Its
	// findings then land on `params.<field>`, which is the field a caller fixes.
	const parsed = definition.schema.safeParse({ ...effect, params: request.params });
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			revision,
			'schema_invalid',
			`The ${definition.type} Effect rejects these parameters.`,
			{ rejected: request.effectId, findings: describeCompositionSchemaFindings(parsed.error) }
		);
	}
	const params = isRecord(parsed.data) ? parsed.data.params : undefined;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Set ${definition.label} parameters`,
		focus: { target: 'effect', effectId: effect.id },
		mutate: (draft) => {
			const target = draft.state.effects.find((entry) => entry.id === request.effectId);
			if (!target) {
				throw new CompositionOperationError(
					'unknown_target',
					`Effect "${request.effectId}" is no longer in the chain.`,
					{ rejected: request.effectId }
				);
			}
			target.params = structuredClone(params);
		}
	});
}

/** A rack focus window given in seconds, milliseconds, or frames becomes the fraction the schema stores. */
function normalizeStageFocusTimeInputs(focus: unknown, document: Preset): unknown {
	if (!isRecord(focus)) return focus;
	const normalized = structuredClone(focus);
	if (!isRecord(normalized.pull)) return normalized;
	const pull = normalized.pull;
	const grid = {
		durationSeconds: document.state.transport.durationSeconds,
		fps: document.state.transport.fps
	};
	if (isCompositionTimeDuration(pull.start)) {
		pull.start = resolveCompositionFractionTime(pull.start, grid);
	}
	if (isCompositionTimeDuration(pull.duration)) {
		pull.duration = resolveCompositionFractionTime(pull.duration, grid);
	}
	return normalized;
}

function normalizeStageTimeInputs(stage: unknown, document: Preset): unknown {
	if (!isRecord(stage)) return stage;
	const normalized = structuredClone(stage);
	normalized.focus = normalizeStageFocusTimeInputs(normalized.focus, document);
	return normalized;
}

export interface SetCompositionStageCameraRequest {
	expectedRevision: number;
	/** The whole camera: the move, the pose, the travel, the vertical camera. Written whole, like the stage. */
	camera: unknown;
}

export interface SetCompositionStageFocusRequest {
	expectedRevision: number;
	/** The whole focus: the plane, the aperture, the band, the rack focus. Written whole, like the stage. */
	focus: unknown;
}

/**
 * Set the stage camera alone (ADR-0060 §5): the decision a person makes by
 * orbiting on the canvas or editing the Camera inspector, and an agent makes
 * in one call, without restating the rest of the stage. The camera is written
 * whole; a composition without a stage has no camera to set.
 */
export async function runSetCompositionStageCameraOperation(
	request: SetCompositionStageCameraRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-stage-camera');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const document = readOpenCompositionDocument();
	if (!document.state.stage) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			'This composition carries no dimensional stage, so it has no camera to set. Set the stage first.'
		);
	}
	const parsed = StageCameraSchema.safeParse(request.camera);
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			revision,
			'schema_invalid',
			'This is not a camera the stage films through.',
			{ findings: describeCompositionSchemaFindings(parsed.error) }
		);
	}
	const camera = parsed.data;
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set stage camera',
		focus: { target: 'stage-camera' },
		mutate: (draft) => {
			if (!draft.state.stage) {
				throw new CompositionOperationError(
					'precondition_unmet',
					'The dimensional stage left the composition while the camera was being set.'
				);
			}
			draft.state.stage.camera = structuredClone(camera);
		}
	});
}

/**
 * Set the stage focus alone (ADR-0060 §5): the focal plane, the aperture, the
 * sharp band, and the rack focus whose window the Focus row's clip is. A rack
 * focus window may be given in seconds, milliseconds, or frames.
 */
export async function runSetCompositionStageFocusOperation(
	request: SetCompositionStageFocusRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-stage-focus');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const document = readOpenCompositionDocument();
	if (!document.state.stage) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			'This composition carries no dimensional stage, so it has no focus to set. Set the stage first.'
		);
	}
	const parsed = StageFocusSchema.safeParse(normalizeStageFocusTimeInputs(request.focus, document));
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			revision,
			'schema_invalid',
			'This is not a focus the stage lens renders.',
			{ findings: describeCompositionSchemaFindings(parsed.error) }
		);
	}
	const focus = parsed.data;
	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set stage focus',
		focus: { target: 'stage-focus' },
		mutate: (draft) => {
			if (!draft.state.stage) {
				throw new CompositionOperationError(
					'precondition_unmet',
					'The dimensional stage left the composition while the focus was being set.'
				);
			}
			draft.state.stage.focus = structuredClone(focus);
		}
	});
}

/**
 * Declare or remove the dimensional stage: the camera move, the focal plane and
 * its aperture, and the backdrop the far plane carries.
 *
 * The stage is written whole. Every field it leaves out takes the stage schema's
 * own default, so a caller reading back what it sent sees the stage the engine
 * composites rather than a merge of this call and whatever came before — the
 * same rule that makes an orientation placement snapshot unambiguous.
 *
 * A stage cannot ride a composition carrying Video clips: the stage is a
 * synthetic-camera construct, and footage does not reproject on it.
 */
export async function runSetCompositionStageOperation(
	request: SetCompositionStageRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-stage');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const document = readOpenCompositionDocument();
	if (request.stage === null || request.stage === undefined) {
		if (!document.state.stage) {
			return refuseCompositionOperation(
				row,
				revision,
				'precondition_unmet',
				'This composition carries no dimensional stage.'
			);
		}
		return runCompositionEditTransaction({
			operationId: row.id,
			expectedRevision: request.expectedRevision,
			undoLabel: 'Remove depth stage',
			focus: { target: 'composition-root' },
			mutate: (draft) => {
				draft.state.stage = undefined;
			}
		});
	}

	const parsed = StageSchema.safeParse(normalizeStageTimeInputs(request.stage, document));
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			revision,
			'schema_invalid',
			'This is not a stage the engine composites on.',
			{ findings: describeCompositionSchemaFindings(parsed.error) }
		);
	}

	const stage: Stage = parsed.data;
	if (!getStageRegistration(stage.type)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${stage.type}" is not a stage this engine registers.`,
			{ rejected: stage.type, alternatives: listRegisteredStageTypes() }
		);
	}

	if (document.state.media.videoTrack.clips.length > 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			'The dimensional stage is a synthetic-camera construct and cannot carry Video clips. Remove the clips first.',
			{ rejected: stage.type }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set depth stage',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			draft.state.stage = structuredClone(stage);
		}
	});
}

/**
 * Set how much of the Surface's own backdrop shows through it — the dim floor a
 * Surface composites its substrate against, from hidden to full.
 *
 * Only a Surface whose Pipeline declares the control renders it, so a Surface
 * that paints its own opaque plate refuses and names the Surfaces that do.
 */
export async function runSetCompositionBackdropVisibilityOperation(
	request: SetCompositionBackdropVisibilityRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-backdrop-visibility');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const surface = readOpenCompositionDocument().state.surface;
	if (!getSurfaceDefinition(surface.type)?.controls.backgroundVisibility) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`The ${surface.type} Surface composites no backdrop of its own to show through.`,
			{ rejected: surface.type, alternatives: listSurfacesWithBackdropVisibility() }
		);
	}
	if (!isFraction(request.visibility)) {
		return refuseUnauthorableFraction(row, 'Backdrop visibility', request.visibility);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set backdrop visibility',
		focus: { target: 'surface' },
		mutate: (draft) => {
			draft.state.surface.backgroundVisibility = request.visibility;
		}
	});
}

/** The Surfaces whose Pipeline declares a backdrop, so a refusal names where to go. */
function listSurfacesWithBackdropVisibility(): readonly string[] {
	return REGISTERED_SURFACE_TYPES.filter(
		(type) => getSurfaceDefinition(type)?.controls.backgroundVisibility === true
	);
}
