/**
 * The `layer` family: which Layer entities exist, in what order, and which
 * registered variant each one is
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * This module covers the Surface, Overlay, Annotation, and Effect Layers plus
 * text animations; the Block Layer's own membership rows live beside the Blocks
 * in `composition-block-layer-operations.ts`.
 *
 * The family owns membership, not the contents of what it adds. Adding an
 * entity writes one entry with the Pipeline's declared defaults — its content,
 * placement, and motion arrive as part of that entry — and every later change
 * to those fields belongs to `content`, `placement`, or `motion`. Two
 * consequences are deliberate:
 *
 * - **A removal reports rather than repairs.** A Cascade weld or a
 *   text-animation target pointing at the entity lives at a pointer another
 *   family owns, so removal refuses and names what still refers to it
 *   (`composition-entity-references.ts`) instead of silently rewriting it.
 * - **Replacing the Surface keeps the document.** `layer.set-surface` writes
 *   the Surface's type, variant, site, and chrome and nothing else, so the
 *   authored content, motion, and appearance survive the swap. A Surface the
 *   current content cannot satisfy is refused by the transaction's own
 *   validation, naming the slot to write first.
 *
 * An Annotation Mark is the one entity whose existence is not a list entry.
 * The mark itself is a `[style]…[/style]` span inside the Surface content,
 * which `content` owns; `/state/marks/timings` is the Annotation Layer's list
 * of authored marks, indexed by the order those spans appear. So adding a mark
 * here means giving a declared-but-unauthored span its own entry, and removing
 * one returns that span to the Pack's defaults.
 */
import { createCompositionEntityId } from '../utils/composition-entity-id';
import {
	createMarkTiming,
	SurfaceTypeSchema,
	WEB_DOCUMENT_SITES,
	type Effect,
	type Overlay,
	type SurfaceChromeMode,
	type SurfaceState,
	type TextAnimation,
	type TextAnimationTarget
} from './engine-schema';
import { listSurfaceMarkInstances } from './surface-mark-instances';
import { CHART_SURFACE_TYPES } from './chart-validation';
import { KINETIC_TYPE_FIELD_SURFACE_TYPE } from './kinetic-type-field-validation';
import { compositionEditHistory } from './composition-edit-history';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	formatCompositionEntityReferences,
	listCompositionOverlayReferences,
	listCompositionMarkTimingReferences,
	listCompositionTextAnimationReferences
} from './composition-entity-references';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { refuseUnloadableCompositionRenderers } from './composition-renderer-readiness';
import {
	getEffectDefinition,
	getOverlayDefinition,
	getSurfaceDefinition,
	REGISTERED_EFFECT_TYPES,
	REGISTERED_OVERLAY_TYPES,
	REGISTERED_SURFACE_TYPES
} from './pipelines/definition-registry';
import { TEXT_EFFECT_IDS } from '../text-animations/catalog';
import { ANNOTATION_MARK_STYLES } from '../annotations/annotation-mark-styles';

import type { AnnotationMarkStyle } from '../annotations/annotation-mark-styles';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

export interface SetCompositionSurfaceRequest {
	expectedRevision: number;
	surfaceType: string;
	/** The Surface family's variant id, where the Surface declares variants. */
	variant?: string;
	/** The site a `web-document` Surface mocks. */
	site?: string;
	/** The chrome mode a Surface that declares one renders in. */
	chrome?: SurfaceChromeMode;
}

export interface AddCompositionOverlayRequest {
	expectedRevision: number;
	overlayType: string;
}

export interface RemoveCompositionOverlayRequest {
	expectedRevision: number;
	overlayId: string;
}

export interface ReorderCompositionOverlayRequest {
	expectedRevision: number;
	overlayId: string;
	/** The index the Overlay takes in the stack; later entries paint on top. */
	index: number;
}

export interface AddCompositionAnnotationMarkRequest {
	expectedRevision: number;
	markStyle: AnnotationMarkStyle;
}

export interface RemoveCompositionAnnotationMarkRequest {
	expectedRevision: number;
	markIndex: number;
}

export interface AddCompositionEffectRequest {
	expectedRevision: number;
	effectType: string;
}

export interface RemoveCompositionEffectRequest {
	expectedRevision: number;
	effectId: string;
}

export interface ReorderCompositionEffectRequest {
	expectedRevision: number;
	effectId: string;
	/** The index the Effect takes in the chain; later entries run last. */
	index: number;
}

export interface AddCompositionTextAnimationRequest {
	expectedRevision: number;
	/** A registered text effect id, from the text-animation catalog. */
	effect: string;
	target: TextAnimationTarget;
}

export interface RemoveCompositionTextAnimationRequest {
	expectedRevision: number;
	textAnimationId: string;
}

/** The entrance a newly added text animation runs, before `motion` retimes it. */
const TEXT_ANIMATION_DEFAULT_ENTER = { start: 0.04, duration: 0.1, ease: 'smooth' } as const;

function refuseUnknownEntity(
	row: WebmcpOperationRow,
	subject: string,
	rejected: string,
	alternatives: readonly string[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`No ${subject} in this composition is named "${rejected}".`,
		{ rejected, alternatives }
	);
}

function refuseReferencedEntity(
	row: WebmcpOperationRow,
	subject: string,
	rejected: string,
	references: readonly { pointer: string; description: string }[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'precondition_unmet',
		`${subject} is still referenced: ${formatCompositionEntityReferences(references)}. Clear those references first.`,
		{ rejected, alternatives: references.map((reference) => reference.pointer) }
	);
}

function refuseIndexOutOfRange(
	row: WebmcpOperationRow,
	subject: string,
	index: number,
	length: number
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'invalid_argument',
		`${subject} index must be an integer from 0 through ${Math.max(0, length - 1)}.`,
		{ rejected: String(index), alternatives: [`0`, String(Math.max(0, length - 1))] }
	);
}

/** Move `id` to `index`, or raise the refusal the transaction turns into a failure. */
function moveEntryToIndex<T extends { id: string }>(entries: T[], id: string, index: number): void {
	const from = entries.findIndex((entry) => entry.id === id);
	if (from < 0) {
		throw new CompositionOperationError('unknown_target', `"${id}" is no longer in the list.`, {
			rejected: id
		});
	}
	const [entry] = entries.splice(from, 1);
	entries.splice(index, 0, entry);
}

// ---- Surface ----

/**
 * Replace the Surface with a registered Surface type, and set the variant,
 * site, or chrome mode that Surface declares.
 *
 * The authored content stays where it is: a Surface swap is a change of
 * presentation, not a new document. Fields the incoming Surface does not
 * declare are cleared rather than carried over, because a variant id from
 * another family resolves to nothing.
 */
export async function runSetCompositionSurfaceOperation(
	request: SetCompositionSurfaceRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.set-surface');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const definition = getSurfaceDefinition(request.surfaceType);
	const parsedType = SurfaceTypeSchema.safeParse(request.surfaceType);
	if (!definition || !parsedType.success) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${request.surfaceType}" is not a Surface this engine registers.`,
			{ rejected: request.surfaceType, alternatives: REGISTERED_SURFACE_TYPES }
		);
	}
	const surfaceType = parsedType.data;

	const variantIds = definition.variantIds ?? [];
	if (request.variant !== undefined && !variantIds.includes(request.variant)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			variantIds.length === 0
				? `The ${definition.type} Surface declares no variants.`
				: `"${request.variant}" is not a variant of the ${definition.type} Surface.`,
			{ rejected: request.variant, alternatives: variantIds }
		);
	}

	const site = WEB_DOCUMENT_SITES.find((candidate) => candidate === request.site);
	if (request.site !== undefined) {
		if (!definition.controls.site) {
			return refuseCompositionOperation(
				row,
				revision,
				'unsupported_variant',
				`The ${definition.type} Surface renders no per-site mock.`,
				{ rejected: request.site, alternatives: [] }
			);
		}
		if (!site) {
			return refuseCompositionOperation(
				row,
				revision,
				'unsupported_variant',
				`"${request.site}" is not a site the web-document Surface mocks.`,
				{ rejected: request.site, alternatives: WEB_DOCUMENT_SITES }
			);
		}
	}

	if (request.chrome !== undefined && !definition.controls.chrome) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`The ${definition.type} Surface has one presentation and no chrome mode.`,
			{ rejected: request.chrome, alternatives: [] }
		);
	}

	// A chart group draws into the Surface's own substrate, so it cannot follow
	// the composition onto a Surface that owns its pixels. Naming the removal
	// operation is more use than the semantic finding the transaction would
	// otherwise return.
	const current = readOpenCompositionDocument();
	if (current.state.surface.chart && !CHART_SURFACE_TYPES.includes(surfaceType)) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`This composition carries chart Blocks, which only a ${CHART_SURFACE_TYPES.join(' or ')} Surface composites. Remove them first.`,
			{ rejected: request.surfaceType, alternatives: CHART_SURFACE_TYPES }
		);
	}
	if (current.state.surface.typeField && surfaceType !== KINETIC_TYPE_FIELD_SURFACE_TYPE) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`This composition carries Kinetic Word Blocks, which only the ${KINETIC_TYPE_FIELD_SURFACE_TYPE} Surface composites. Remove them first.`,
			{ rejected: request.surfaceType, alternatives: [KINETIC_TYPE_FIELD_SURFACE_TYPE] }
		);
	}

	const selection: CompositionSurfaceSelection = {
		type: surfaceType,
		variant: request.variant,
		site,
		chrome: request.chrome
	};
	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{
			...current,
			state: {
				...current.state,
				surface: applySurfaceSelection(current.state.surface, selection)
			}
		},
		`the ${definition.type} Surface`
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Surface',
		focus: { target: 'surface' },
		mutate: (draft) => {
			const next = applySurfaceSelection(draft.state.surface, selection);
			draft.state.surface.type = next.type;
			draft.state.surface.variant = next.variant;
			draft.state.surface.site = next.site;
			draft.state.surface.chrome = next.chrome;
		}
	});
}

/** The Surface's identifying fields, already checked against the registry. */
interface CompositionSurfaceSelection {
	type: SurfaceState['type'];
	variant: string | undefined;
	site: SurfaceState['site'];
	chrome: SurfaceChromeMode | undefined;
}

/**
 * The Surface's identifying fields after the request lands. An absent argument
 * keeps the current value where the incoming Surface still declares that field
 * and drops it where it does not — a variant id from another family resolves to
 * nothing. `chrome: 'window'` is stored as absent, which is how the schema
 * spells the default presentation.
 */
function applySurfaceSelection(
	surface: SurfaceState,
	selection: CompositionSurfaceSelection
): SurfaceState {
	const definition = getSurfaceDefinition(selection.type);
	const variantIds = definition?.variantIds ?? [];
	const keepsCurrent = surface.type === selection.type;

	const variant =
		selection.variant ??
		(keepsCurrent && surface.variant && variantIds.includes(surface.variant)
			? surface.variant
			: undefined);
	const site =
		selection.site ?? (definition?.controls.site && keepsCurrent ? surface.site : undefined);
	const chrome = selection.chrome ?? (definition?.controls.chrome ? surface.chrome : undefined);

	return {
		...surface,
		type: selection.type,
		variant,
		site,
		chrome: chrome === 'window' ? undefined : chrome
	};
}

// ---- Overlay ----

/** Add an Overlay of a registered Overlay type; its new id rides the receipt's focus. */
export async function runAddCompositionOverlayOperation(
	request: AddCompositionOverlayRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-overlay');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const definition = getOverlayDefinition(request.overlayType);
	if (!definition) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`"${request.overlayType}" is not an Overlay this engine registers.`,
			{ rejected: request.overlayType, alternatives: REGISTERED_OVERLAY_TYPES }
		);
	}

	const current = readOpenCompositionDocument();
	const defaults = definition.defaults();
	const overlay: Overlay = {
		type: definition.type,
		id: createCompositionEntityId(
			definition.type,
			current.state.overlays.map((entry) => entry.id)
		),
		content: defaults.content,
		position: defaults.position,
		enter: defaults.enter,
		exit: defaults.exit
	};

	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{ ...current, state: { ...current.state, overlays: [...current.state.overlays, overlay] } },
		`the ${definition.type} Overlay`
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Add ${definition.label}`,
		focus: { target: 'overlay', overlayId: overlay.id },
		mutate: (draft) => {
			requireFreeEntityId(overlay.id, draft.state.overlays);
			draft.state.overlays.push(structuredClone(overlay));
		}
	});
}

/** Remove an Overlay by id, once nothing else points at it. */
export async function runRemoveCompositionOverlayOperation(
	request: RemoveCompositionOverlayRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-overlay');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	if (!state.overlays.some((overlay) => overlay.id === request.overlayId)) {
		return refuseUnknownEntity(
			row,
			'Overlay',
			request.overlayId,
			state.overlays.map((overlay) => overlay.id)
		);
	}

	const references = listCompositionOverlayReferences(state, request.overlayId);
	if (references.length > 0) {
		return refuseReferencedEntity(
			row,
			`Overlay "${request.overlayId}"`,
			request.overlayId,
			references
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove Overlay',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const index = draft.state.overlays.findIndex(
				(overlay) => overlay.id === request.overlayId
			);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Overlay "${request.overlayId}" is no longer in the composition.`,
					{ rejected: request.overlayId }
				);
			}
			draft.state.overlays.splice(index, 1);
		}
	});
}

/** Move an Overlay to a new index in the stack, changing paint order. */
export async function runReorderCompositionOverlayOperation(
	request: ReorderCompositionOverlayRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.reorder-overlay');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const overlays = readOpenCompositionDocument().state.overlays;
	if (!overlays.some((overlay) => overlay.id === request.overlayId)) {
		return refuseUnknownEntity(
			row,
			'Overlay',
			request.overlayId,
			overlays.map((overlay) => overlay.id)
		);
	}
	if (!Number.isSafeInteger(request.index) || request.index < 0 || request.index >= overlays.length) {
		return refuseIndexOutOfRange(row, 'Overlay', request.index, overlays.length);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Reorder Overlay',
		focus: { target: 'overlay', overlayId: request.overlayId },
		mutate: (draft) => {
			moveEntryToIndex(draft.state.overlays, request.overlayId, request.index);
		}
	});
}

// ---- Annotation Mark ----

/**
 * Author the next Mark of `markStyle` the Surface content declares.
 *
 * The span is content; this gives it an entry in the Annotation Layer's timing
 * list so it can carry its own colour, window, and weld. Timings are indexed by
 * the order the spans appear, so authoring the third span also materialises the
 * two before it at the engine's default window — the same pixels either way,
 * and the only way to address the third by index.
 */
export async function runAddCompositionAnnotationMarkOperation(
	request: AddCompositionAnnotationMarkRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-annotation-mark');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	if (!ANNOTATION_MARK_STYLES.includes(request.markStyle)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${request.markStyle}" is not an Annotation Mark style this engine registers.`,
			{ rejected: request.markStyle, alternatives: ANNOTATION_MARK_STYLES }
		);
	}

	const state = readOpenCompositionDocument().state;
	const instances = listSurfaceMarkInstances(state.surface);
	const authoredCount = state.marks.timings.length;
	const markIndex = instances.findIndex(
		(instance, index) => index >= authoredCount && instance.style === request.markStyle
	);
	if (markIndex < 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`The Surface content declares no unauthored ${request.markStyle} Mark. Write a [${request.markStyle}]…[/${request.markStyle}] span into the content first.`,
			{
				rejected: request.markStyle,
				alternatives: [
					...new Set(
						instances.slice(authoredCount).map((instance) => instance.style)
					)
				]
			}
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Add ${request.markStyle} Mark`,
		focus: { target: 'mark', markIndex },
		mutate: (draft) => {
			while (draft.state.marks.timings.length <= markIndex) {
				draft.state.marks.timings.push(createMarkTiming());
			}
		}
	});
}

/** Drop a Mark's authored timing; the span returns to the Pack's defaults. */
export async function runRemoveCompositionAnnotationMarkOperation(
	request: RemoveCompositionAnnotationMarkRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-annotation-mark');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	const timings = state.marks.timings;
	if (
		!Number.isSafeInteger(request.markIndex) ||
		request.markIndex < 0 ||
		request.markIndex >= timings.length
	) {
		return refuseIndexOutOfRange(row, 'Mark', request.markIndex, timings.length);
	}

	const references = listCompositionMarkTimingReferences(state, request.markIndex);
	if (references.length > 0) {
		return refuseReferencedEntity(
			row,
			`Mark ${request.markIndex}`,
			String(request.markIndex),
			references
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove Mark',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			draft.state.marks.timings.splice(request.markIndex, 1);
		}
	});
}

// ---- Effect ----

/** Append an Effect of a registered Effect type to the post-process chain. */
export async function runAddCompositionEffectOperation(
	request: AddCompositionEffectRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-effect');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const definition = getEffectDefinition(request.effectType);
	if (!definition) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`"${request.effectType}" is not an Effect this engine registers.`,
			{ rejected: request.effectType, alternatives: REGISTERED_EFFECT_TYPES }
		);
	}

	const current = readOpenCompositionDocument();
	const effect: Effect = {
		type: definition.type,
		id: createCompositionEntityId(
			definition.type,
			current.state.effects.map((entry) => entry.id)
		),
		params: definition.defaults().params
	};

	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{ ...current, state: { ...current.state, effects: [...current.state.effects, effect] } },
		`the ${definition.type} Effect`
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Add ${definition.label}`,
		focus: { target: 'effect', effectId: effect.id },
		mutate: (draft) => {
			requireFreeEntityId(effect.id, draft.state.effects);
			draft.state.effects.push(structuredClone(effect));
		}
	});
}

/** Remove an Effect from the chain by id. */
export async function runRemoveCompositionEffectOperation(
	request: RemoveCompositionEffectRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-effect');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const effects = readOpenCompositionDocument().state.effects;
	if (!effects.some((effect) => effect.id === request.effectId)) {
		return refuseUnknownEntity(
			row,
			'Effect',
			request.effectId,
			effects.map((effect) => effect.id)
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove Effect',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const index = draft.state.effects.findIndex((effect) => effect.id === request.effectId);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Effect "${request.effectId}" is no longer in the chain.`,
					{ rejected: request.effectId }
				);
			}
			draft.state.effects.splice(index, 1);
		}
	});
}

/** Move an Effect to a new index, changing the order the chain runs in. */
export async function runReorderCompositionEffectOperation(
	request: ReorderCompositionEffectRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.reorder-effect');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const effects = readOpenCompositionDocument().state.effects;
	if (!effects.some((effect) => effect.id === request.effectId)) {
		return refuseUnknownEntity(
			row,
			'Effect',
			request.effectId,
			effects.map((effect) => effect.id)
		);
	}
	if (!Number.isSafeInteger(request.index) || request.index < 0 || request.index >= effects.length) {
		return refuseIndexOutOfRange(row, 'Effect', request.index, effects.length);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Reorder Effect',
		focus: { target: 'effect', effectId: request.effectId },
		mutate: (draft) => {
			moveEntryToIndex(draft.state.effects, request.effectId, request.index);
		}
	});
}

// ---- Text animation ----

/** Bind a registered text effect to one content slot; one binding per target. */
export async function runAddCompositionTextAnimationOperation(
	request: AddCompositionTextAnimationRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-text-animation');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	if (!TEXT_EFFECT_IDS.includes(request.effect)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unsupported_variant',
			`"${request.effect}" is not a text effect this engine registers.`,
			{ rejected: request.effect, alternatives: TEXT_EFFECT_IDS }
		);
	}

	const state = readOpenCompositionDocument().state;
	const target = request.target;
	if (
		target.kind === 'overlay' &&
		!state.overlays.some((overlay) => overlay.id === target.overlayId)
	) {
		return refuseUnknownEntity(
			row,
			'Overlay',
			target.overlayId,
			state.overlays.map((overlay) => overlay.id)
		);
	}

	const targetKey = describeTextAnimationTarget(target);
	const bound = state.textAnimations.find(
		(entry) => describeTextAnimationTarget(entry.target) === targetKey
	);
	if (bound) {
		return refuseCompositionOperation(
			row,
			revision,
			'precondition_unmet',
			`Text animation "${bound.id}" already animates ${targetKey}; one binding per target.`,
			{ rejected: targetKey, alternatives: [bound.id] }
		);
	}

	const textAnimation: TextAnimation = {
		id: createCompositionEntityId(
			'text-anim',
			state.textAnimations.map((entry) => entry.id)
		),
		target: request.target,
		effect: request.effect,
		enter: { ...TEXT_ANIMATION_DEFAULT_ENTER }
	};

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Add text animation',
		focus: { target: 'text-animation', textAnimationId: textAnimation.id },
		mutate: (draft) => {
			requireFreeEntityId(textAnimation.id, draft.state.textAnimations);
			draft.state.textAnimations.push(structuredClone(textAnimation));
		}
	});
}

/** Remove a text animation by id, once nothing cascades from it. */
export async function runRemoveCompositionTextAnimationOperation(
	request: RemoveCompositionTextAnimationRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-text-animation');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	if (!state.textAnimations.some((entry) => entry.id === request.textAnimationId)) {
		return refuseUnknownEntity(
			row,
			'text animation',
			request.textAnimationId,
			state.textAnimations.map((entry) => entry.id)
		);
	}

	const references = listCompositionTextAnimationReferences(state, request.textAnimationId);
	if (references.length > 0) {
		return refuseReferencedEntity(
			row,
			`Text animation "${request.textAnimationId}"`,
			request.textAnimationId,
			references
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Remove text animation',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const index = draft.state.textAnimations.findIndex(
				(entry) => entry.id === request.textAnimationId
			);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Text animation "${request.textAnimationId}" is no longer in the composition.`,
					{ rejected: request.textAnimationId }
				);
			}
			draft.state.textAnimations.splice(index, 1);
		}
	});
}

/** The slot a text animation binds, in the words the one-binding rule reads. */
function describeTextAnimationTarget(target: TextAnimationTarget): string {
	return target.kind === 'surface'
		? `the Surface ${target.slot}`
		: `Overlay "${target.overlayId}" ${target.slot}`;
}

/**
 * Guard the id chosen from the preflight document against the draft the
 * transaction actually captured. The revision check makes a collision
 * impossible in practice; raising here is what keeps "impossible" from meaning
 * "silently produces a duplicate id".
 */
function requireFreeEntityId(id: string, entries: readonly { id: string }[]): void {
	if (!entries.some((entry) => entry.id === id)) return;
	throw new CompositionOperationError('precondition_unmet', `The id "${id}" was just taken.`, {
		rejected: id
	});
}

