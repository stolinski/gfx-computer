/**
 * The `motion` family's authored-motion grammar: per-property keyframe channels
 * and Cascade welds
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2,
 * [ADR-0035](../../../docs/adr/0035-generalized-keyframes-and-cascade.md)).
 *
 * Declaring a channel is a transfer of ownership, not a tweak: the composition
 * takes the pen for that element and its Pipeline's intrinsic enter/exit form
 * stops running. Clearing the last channel hands the pen back. That is why
 * clearing is its own operation rather than "write an empty track" — an empty
 * track is a channel that renders nothing, which is a different picture.
 *
 * Both operations act on more than one kind of element, because both GUI
 * sections do: the Surface, an Overlay, and a Diagram Block can each carry
 * channels, and those three plus an Annotation Mark and a text animation can
 * each weld their entrance. So the focus lands on whichever element the edit
 * touched, and the inventory rows name every one of them.
 *
 * A chart Block is the deliberate exception. Its motion is the five ordered
 * phases its Pipeline runs, so it is anchorable — something else may weld to it
 * — but it owns neither channels nor a weld of its own, and naming one here
 * points the caller at `motion.set-chart-motion`.
 */
import { cascadeNodeKey } from './cascade-timing';
import {
	DIAGRAM_KEYFRAME_CHANNELS,
	DIAGRAM_STROKE_KEYFRAME_CHANNELS,
	KINETIC_WORD_KEYFRAME_CHANNELS,
	OVERLAY_KEYFRAME_CHANNELS,
	SURFACE_KEYFRAME_CHANNELS,
	type Cascade,
	type CascadeAnchor,
	type DiagramPrimitive,
	type EngineState,
	type Keyframe,
	type KineticWord,
	type KineticWordAnimation,
	type KineticWordSpatialChannelKeyframes,
	type OverlayAnimation,
	type SurfaceAnimation
} from './engine-schema';
import { compositionEditHistory } from './composition-edit-history';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import {
	isKineticWordSpatialChannel,
	resolveKineticWordGeometry
} from '$lib/utils/kinetic-word-geometry';

import type { CompositionWorkspaceFocus } from './composition-workspace-focus';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** The elements that can own authored property channels. */
export type CompositionKeyframeSubject =
	{ kind: 'surface' } | { kind: 'overlay'; overlayId: string } | { kind: 'block'; blockId: string };

/** The elements that can weld their entrance to another element's. */
export type CompositionCascadeSubject =
	| { kind: 'overlay'; overlayId: string }
	| { kind: 'mark'; markIndex: number }
	| { kind: 'text-animation'; textAnimationId: string }
	| { kind: 'block'; blockId: string };

/** Everything a weld can hang from: the timing root, plus every element that welds. */
export type CompositionCascadeAnchorKind = 'surface' | CompositionCascadeSubject['kind'];

/** The kinds of element that can own authored channels, as a caller names them. */
export const COMPOSITION_KEYFRAME_SUBJECT_KINDS: readonly CompositionKeyframeSubject['kind'][] = [
	'surface',
	'overlay',
	'block'
];

/**
 * The kinds of element that can weld their own entrance. The Surface is absent
 * because it is the timing root, and a chart Block because its motion is the
 * five phases its Pipeline runs.
 */
export const COMPOSITION_CASCADE_SUBJECT_KINDS: readonly CompositionCascadeSubject['kind'][] = [
	'overlay',
	'mark',
	'text-animation',
	'block'
];

export const COMPOSITION_CASCADE_ANCHOR_KINDS: readonly CompositionCascadeAnchorKind[] = [
	'surface',
	...COMPOSITION_CASCADE_SUBJECT_KINDS
];

export type CompositionKeyframeChannelScope = 'shared' | 'horizontal' | 'vertical';
export const COMPOSITION_KEYFRAME_CHANNEL_SCOPES: readonly CompositionKeyframeChannelScope[] = [
	'shared',
	'horizontal',
	'vertical'
];

export interface SetCompositionKeyframeChannelRequest {
	expectedRevision: number;
	subject: CompositionKeyframeSubject;
	/** A channel the subject declares, such as `opacity` or `x`. */
	channel: string;
	/** Kinetic Word spatial tracks may replace the shared group per orientation. */
	scope?: CompositionKeyframeChannelScope;
	/** Ordered keyframes, in ms from the element's resolved clip start. */
	keyframes: readonly Keyframe[];
}

export interface ClearCompositionKeyframeChannelRequest {
	expectedRevision: number;
	subject: CompositionKeyframeSubject;
	channel: string;
	scope?: CompositionKeyframeChannelScope;
}

export interface SetCompositionCascadeAnchorRequest {
	expectedRevision: number;
	subject: CompositionCascadeSubject;
	/** The element this entrance welds to, named the way the timeline rows are. */
	anchor: CascadeAnchor;
	/** Which edge of the anchor's entrance the weld hangs from. */
	event: Cascade['event'];
	/** Milliseconds after the anchor event; negative leads it. */
	offsetMs: number;
}

export interface ClearCompositionCascadeAnchorRequest {
	expectedRevision: number;
	subject: CompositionCascadeSubject;
}

/** The authored motion every channel owner carries, in the one shape they share. */
interface AuthoredElementMotion {
	channels?: Partial<Record<string, Keyframe[]>>;
	cascade?: Cascade;
	orientationOverrides?: Partial<
		Record<'horizontal' | 'vertical', KineticWordSpatialChannelKeyframes>
	>;
}

type KeyframeOwnerKind = 'surface' | 'overlay' | 'diagram' | 'kinetic-word';

interface CompositionKeyframeOwner {
	kind: KeyframeOwnerKind;
	channels: readonly string[];
	motion: AuthoredElementMotion | undefined;
	word?: KineticWord;
}

/** Which edge of the anchor's entrance a weld hangs from. */
export const COMPOSITION_CASCADE_EVENTS: readonly Cascade['event'][] = ['start', 'end'];

function keyframeSubjectFocus(subject: CompositionKeyframeSubject): CompositionWorkspaceFocus {
	if (subject.kind === 'surface') return { target: 'surface' };
	if (subject.kind === 'overlay') return { target: 'overlay', overlayId: subject.overlayId };
	return { target: 'block', blockId: subject.blockId };
}

function cascadeSubjectFocus(subject: CompositionCascadeSubject): CompositionWorkspaceFocus {
	switch (subject.kind) {
		case 'overlay':
			return { target: 'overlay', overlayId: subject.overlayId };
		case 'mark':
			return { target: 'mark', markIndex: subject.markIndex };
		case 'text-animation':
			return { target: 'text-animation', textAnimationId: subject.textAnimationId };
		case 'block':
			return { target: 'block', blockId: subject.blockId };
	}
}

/** The cascade-graph identity a subject welds as — the same key the anchors use. */
function cascadeSubjectKey(subject: CompositionCascadeSubject): string {
	switch (subject.kind) {
		case 'overlay':
			return `overlay:${subject.overlayId}`;
		case 'mark':
			return `mark:${subject.markIndex}`;
		case 'text-animation':
			return `textAnimation:${subject.textAnimationId}`;
		case 'block':
			return `block:${subject.blockId}`;
	}
}

function describeSubject(subject: CompositionKeyframeSubject | CompositionCascadeSubject): string {
	switch (subject.kind) {
		case 'surface':
			return 'the Surface';
		case 'overlay':
			return `Overlay "${subject.overlayId}"`;
		case 'mark':
			return `Mark ${subject.markIndex}`;
		case 'text-animation':
			return `text animation "${subject.textAnimationId}"`;
		case 'block':
			return `Block "${subject.blockId}"`;
	}
}

/** The channel names a Diagram primitive declares: a stroke draws, so it only fades. */
function diagramPrimitiveChannels(primitive: DiagramPrimitive): readonly string[] {
	return primitive.type === 'edge-arrow' || primitive.type === 'timeline-segment'
		? DIAGRAM_STROKE_KEYFRAME_CHANNELS
		: DIAGRAM_KEYFRAME_CHANNELS;
}

/** What a channel owner declares and currently carries, or `null` when it is not there. */
function findKeyframeOwner(
	state: EngineState,
	subject: CompositionKeyframeSubject
): CompositionKeyframeOwner | null {
	if (subject.kind === 'surface') {
		return {
			kind: 'surface',
			channels: SURFACE_KEYFRAME_CHANNELS,
			motion: state.surface.animation
		};
	}
	if (subject.kind === 'overlay') {
		const overlay = state.overlays.find((entry) => entry.id === subject.overlayId);
		return overlay
			? { kind: 'overlay', channels: OVERLAY_KEYFRAME_CHANNELS, motion: overlay.animation }
			: null;
	}
	const primitive = (state.surface.diagram ?? []).find((entry) => entry.id === subject.blockId);
	if (primitive) {
		return {
			kind: 'diagram',
			channels: diagramPrimitiveChannels(primitive),
			motion: primitive.animation
		};
	}
	const word = (state.surface.typeField?.words ?? []).find((entry) => entry.id === subject.blockId);
	return word
		? {
				kind: 'kinetic-word',
				channels: KINETIC_WORD_KEYFRAME_CHANNELS,
				motion: word.animation,
				word
			}
		: null;
}

/**
 * Write an element's authored motion back. The channel names were checked
 * against the shape the subject declares before the transaction opened, so the
 * assignment narrows a structurally identical record to the element's own
 * channel type.
 */
function writeElementMotion(
	state: EngineState,
	subject: CompositionKeyframeSubject | CompositionCascadeSubject,
	motion: AuthoredElementMotion | undefined
): boolean {
	if (subject.kind === 'surface') {
		state.surface.animation = motion as SurfaceAnimation | undefined;
		return true;
	}
	if (subject.kind === 'overlay') {
		const overlay = state.overlays.find((entry) => entry.id === subject.overlayId);
		if (!overlay) return false;
		overlay.animation = motion as OverlayAnimation | undefined;
		return true;
	}
	if (subject.kind !== 'block') return false;
	const diagram = state.surface.diagram ?? [];
	const index = diagram.findIndex((entry) => entry.id === subject.blockId);
	if (index >= 0) {
		diagram[index] = { ...diagram[index], animation: motion } as DiagramPrimitive;
		return true;
	}
	const word = (state.surface.typeField?.words ?? []).find((entry) => entry.id === subject.blockId);
	if (!word) return false;
	word.animation = motion as KineticWordAnimation | undefined;
	return true;
}

function cloneKeyframeChannels(
	channels: Partial<Record<string, Keyframe[]>> | undefined
): Partial<Record<string, Keyframe[]>> {
	return Object.fromEntries(
		Object.entries(channels ?? {}).map(([name, frames]) => [
			name,
			frames?.map((frame) => ({ ...frame }))
		])
	);
}

function cloneSpatialKeyframeChannels(
	owner: CompositionKeyframeOwner,
	scope: Exclude<CompositionKeyframeChannelScope, 'shared'>
): KineticWordSpatialChannelKeyframes {
	const existing = owner.motion?.orientationOverrides?.[scope];
	if (existing) return cloneKeyframeChannels(existing) as KineticWordSpatialChannelKeyframes;
	const shared = owner.motion?.channels;
	const geometry = owner.word ? resolveKineticWordGeometry(owner.word, scope) : null;
	return {
		x: shared?.x?.map((frame) => ({ ...frame })) ?? [{ atMs: 0, value: 0 }],
		y: shared?.y?.map((frame) => ({ ...frame })) ?? [{ atMs: 0, value: 0 }],
		scale: shared?.scale?.map((frame) => ({ ...frame })) ?? [
			{ atMs: 0, value: geometry?.scale ?? 1 }
		],
		rotation: shared?.rotation?.map((frame) => ({ ...frame })) ?? [
			{ atMs: 0, value: geometry?.rotation ?? 0 }
		]
	};
}

function cleanAuthoredElementMotion(
	motion: AuthoredElementMotion,
	ownerKind: KeyframeOwnerKind
): AuthoredElementMotion | undefined {
	const hasChannels = Object.keys(motion.channels ?? {}).length > 0;
	const hasOrientationOverrides = Object.keys(motion.orientationOverrides ?? {}).length > 0;
	if (hasChannels || hasOrientationOverrides) return motion;
	if (ownerKind !== 'kinetic-word' && motion.cascade) return { cascade: motion.cascade };
	return undefined;
}

/** An element's motion with one scoped channel replaced, or with it dropped. */
function withKeyframeChannel(
	owner: CompositionKeyframeOwner,
	channel: string,
	scope: CompositionKeyframeChannelScope,
	track: readonly Keyframe[] | null
): AuthoredElementMotion | undefined {
	const motion: AuthoredElementMotion = {
		...owner.motion,
		channels: cloneKeyframeChannels(owner.motion?.channels)
	};
	if (owner.kind === 'kinetic-word' && owner.motion?.orientationOverrides) {
		motion.orientationOverrides = Object.fromEntries(
			Object.entries(owner.motion.orientationOverrides).map(([orientation, channels]) => [
				orientation,
				cloneKeyframeChannels(channels)
			])
		);
	}

	if (scope === 'shared') {
		const channels = (motion.channels ??= {});
		if (track === null) delete channels[channel];
		else channels[channel] = track.map((frame) => ({ ...frame }));
		if (Object.keys(channels).length === 0) motion.channels = undefined;
		return cleanAuthoredElementMotion(motion, owner.kind);
	}

	const orientationOverrides = (motion.orientationOverrides ??= {});
	if (track === null) {
		delete orientationOverrides[scope];
	} else {
		const spatial = cloneSpatialKeyframeChannels(owner, scope);
		spatial[channel as keyof KineticWordSpatialChannelKeyframes] = track.map((frame) => ({
			...frame
		}));
		orientationOverrides[scope] = spatial;
	}
	if (Object.keys(orientationOverrides).length === 0) motion.orientationOverrides = undefined;
	return cleanAuthoredElementMotion(motion, owner.kind);
}

function scopedKeyframeTrack(
	owner: CompositionKeyframeOwner,
	channel: string,
	scope: CompositionKeyframeChannelScope
): readonly Keyframe[] | undefined {
	if (scope === 'shared') return owner.motion?.channels?.[channel];
	const channels = owner.motion?.orientationOverrides?.[scope] as
		Partial<Record<string, Keyframe[]>> | undefined;
	return channels?.[channel];
}

/** The refusal for a channel subject the composition does not hold. */
function refuseMissingKeyframeSubject(
	row: WebmcpOperationRow,
	state: EngineState,
	subject: CompositionKeyframeSubject
): CompositionOperationFailure {
	if (
		subject.kind === 'block' &&
		(state.surface.chart?.items ?? []).some((item) => item.id === subject.blockId)
	) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`Chart Block "${subject.blockId}" runs its five ordered motion phases instead of authored channels.`,
			{ rejected: subject.blockId, alternatives: ['motion.set-chart-motion'] }
		);
	}
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`This composition holds no ${describeSubject(subject)}.`,
		{
			rejected:
				subject.kind === 'overlay'
					? subject.overlayId
					: subject.kind === 'block'
						? subject.blockId
						: 'surface',
			alternatives:
				subject.kind === 'overlay'
					? state.overlays.map((entry) => entry.id)
					: [
							...(state.surface.diagram ?? []).map((entry) => entry.id),
							...(state.surface.typeField?.words ?? []).map((entry) => entry.id)
						]
		}
	);
}

function refuseUndeclaredChannel(
	row: WebmcpOperationRow,
	subject: CompositionKeyframeSubject,
	channel: string,
	declared: readonly string[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unsupported_variant',
		`${describeSubject(subject)} declares no "${channel}" channel.`,
		{ rejected: channel, alternatives: declared }
	);
}

function refuseInvalidKeyframeScope(
	row: WebmcpOperationRow,
	subject: CompositionKeyframeSubject,
	owner: CompositionKeyframeOwner,
	channel: string,
	scope: CompositionKeyframeChannelScope
): CompositionOperationFailure | null {
	if (!COMPOSITION_KEYFRAME_CHANNEL_SCOPES.includes(scope)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`"${scope}" is not a keyframe channel scope.`,
			{ rejected: scope, alternatives: COMPOSITION_KEYFRAME_CHANNEL_SCOPES }
		);
	}
	if (scope === 'shared') return null;
	if (owner.kind !== 'kinetic-word' || !isKineticWordSpatialChannel(channel)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`${describeSubject(subject)} can author "${channel}" only in shared scope. Orientation scopes belong only to Kinetic Word spatial channels.`,
			{ rejected: scope, alternatives: ['shared'] }
		);
	}
	return null;
}

/**
 * Author one property channel as ordered keyframes. Declaring any channel means
 * the composition owns this element's motion, so its Pipeline's intrinsic
 * enter/exit form stops running (ADR-0035 §2).
 */
export async function runSetCompositionKeyframeChannelOperation(
	request: SetCompositionKeyframeChannelRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-keyframe-channel');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	const owner = findKeyframeOwner(state, request.subject);
	if (!owner) return refuseMissingKeyframeSubject(row, state, request.subject);
	if (!owner.channels.includes(request.channel)) {
		return refuseUndeclaredChannel(row, request.subject, request.channel, owner.channels);
	}
	const scope = request.scope ?? 'shared';
	const scopeRefusal = refuseInvalidKeyframeScope(
		row,
		request.subject,
		owner,
		request.channel,
		scope
	);
	if (scopeRefusal) return scopeRefusal;
	if (request.keyframes.length === 0) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'A declared channel needs at least one keyframe; clear the channel to hand motion back to the Pipeline.',
			{ rejected: request.channel, alternatives: ['motion.clear-keyframe-channel'] }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Set ${request.channel} keyframes`,
		focus: keyframeSubjectFocus(request.subject),
		mutate: (draft) => {
			const current = findKeyframeOwner(draft.state, request.subject);
			if (
				!current ||
				!writeElementMotion(
					draft.state,
					request.subject,
					withKeyframeChannel(current, request.channel, scope, request.keyframes)
				)
			) {
				throw new CompositionOperationError(
					'unknown_target',
					`${describeSubject(request.subject)} is no longer in the composition.`
				);
			}
		}
	});
}

/** Remove one authored channel so the element's intrinsic motion form runs again. */
export async function runClearCompositionKeyframeChannelOperation(
	request: ClearCompositionKeyframeChannelRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.clear-keyframe-channel');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	const owner = findKeyframeOwner(state, request.subject);
	if (!owner) return refuseMissingKeyframeSubject(row, state, request.subject);
	if (!owner.channels.includes(request.channel)) {
		return refuseUndeclaredChannel(row, request.subject, request.channel, owner.channels);
	}
	const scope = request.scope ?? 'shared';
	const scopeRefusal = refuseInvalidKeyframeScope(
		row,
		request.subject,
		owner,
		request.channel,
		scope
	);
	if (scopeRefusal) return scopeRefusal;
	const scopedTrack = scopedKeyframeTrack(owner, request.channel, scope);
	const authored = Object.entries(
		scope === 'shared'
			? (owner.motion?.channels ?? {})
			: (owner.motion?.orientationOverrides?.[scope] ?? {})
	)
		.filter(([, track]) => track !== undefined && track.length > 0)
		.map(([name]) => name);
	if (!scopedTrack || scopedTrack.length === 0) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`${describeSubject(request.subject)} authors no "${request.channel}" channel.`,
			{ rejected: request.channel, alternatives: authored }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Clear ${request.channel} keyframes`,
		focus: keyframeSubjectFocus(request.subject),
		mutate: (draft) => {
			const current = findKeyframeOwner(draft.state, request.subject);
			if (
				!current ||
				!writeElementMotion(
					draft.state,
					request.subject,
					withKeyframeChannel(current, request.channel, scope, null)
				)
			) {
				throw new CompositionOperationError(
					'unknown_target',
					`${describeSubject(request.subject)} is no longer in the composition.`
				);
			}
		}
	});
}

// ---- Cascade welds ----

/** Every element a weld may anchor to, by the key the timeline rows use. */
export function listCompositionCascadeAnchorKeys(state: EngineState): readonly string[] {
	return [
		'surface',
		...state.overlays.map((overlay) => `overlay:${overlay.id}`),
		...state.marks.timings.map((_timing, index) => `mark:${index}`),
		...state.textAnimations.map((entry) => `textAnimation:${entry.id}`),
		...(state.surface.diagram ?? []).map((primitive) => `block:${primitive.id}`),
		...(state.surface.chart?.items ?? []).map((item) => `block:${item.id}`)
	];
}

/** The weld each element already carries, keyed the way the anchors are. */
function collectCascadeEdges(state: EngineState): ReadonlyMap<string, string> {
	const edges = new Map<string, string>();
	for (const overlay of state.overlays) {
		const cascade = overlay.animation?.cascade;
		if (cascade) edges.set(`overlay:${overlay.id}`, cascadeNodeKey(cascade.anchor));
	}
	state.marks.timings.forEach((timing, index) => {
		if (timing.cascade) edges.set(`mark:${index}`, cascadeNodeKey(timing.cascade.anchor));
	});
	for (const entry of state.textAnimations) {
		if (entry.cascade) edges.set(`textAnimation:${entry.id}`, cascadeNodeKey(entry.cascade.anchor));
	}
	for (const primitive of state.surface.diagram ?? []) {
		const cascade = primitive.animation?.cascade;
		if (cascade) edges.set(`block:${primitive.id}`, cascadeNodeKey(cascade.anchor));
	}
	return edges;
}

/**
 * The chain from `anchorKey` back to `subjectKey`, or `null` when welding the
 * two closes no loop. Each element has at most one outgoing weld, so a plain
 * walk settles it — and reporting the chain is what makes the refusal
 * correctable rather than a bare "cycle".
 */
function findCascadeCycle(
	state: EngineState,
	subjectKey: string,
	anchorKey: string
): readonly string[] | null {
	const edges = collectCascadeEdges(state);
	const chain: string[] = [subjectKey];
	const seen = new Set<string>();
	let node: string | undefined = anchorKey;
	while (node !== undefined) {
		chain.push(node);
		if (node === subjectKey) return chain;
		if (seen.has(node)) return null;
		seen.add(node);
		node = edges.get(node);
	}
	return null;
}

/** The weld a cascade subject carries, or `null` when the composition holds no such element. */
function findSubjectCascade(
	state: EngineState,
	subject: CompositionCascadeSubject
): { cascade: Cascade | undefined } | null {
	switch (subject.kind) {
		case 'overlay': {
			const overlay = state.overlays.find((entry) => entry.id === subject.overlayId);
			return overlay ? { cascade: overlay.animation?.cascade } : null;
		}
		case 'mark': {
			const timing = state.marks.timings[subject.markIndex];
			return timing ? { cascade: timing.cascade } : null;
		}
		case 'text-animation': {
			const entry = state.textAnimations.find(
				(candidate) => candidate.id === subject.textAnimationId
			);
			return entry ? { cascade: entry.cascade } : null;
		}
		case 'block': {
			const primitive = (state.surface.diagram ?? []).find((entry) => entry.id === subject.blockId);
			return primitive ? { cascade: primitive.animation?.cascade } : null;
		}
	}
}

function writeSubjectCascade(
	state: EngineState,
	subject: CompositionCascadeSubject,
	cascade: Cascade | undefined
): boolean {
	if (subject.kind === 'mark') {
		const timing = state.marks.timings[subject.markIndex];
		if (!timing) return false;
		timing.cascade = cascade;
		return true;
	}
	if (subject.kind === 'text-animation') {
		const entry = state.textAnimations.find(
			(candidate) => candidate.id === subject.textAnimationId
		);
		if (!entry) return false;
		entry.cascade = cascade;
		return true;
	}
	const owner = findKeyframeOwner(state, subject);
	if (!owner) return false;
	const channels = owner.motion?.channels;
	const hasChannels = channels !== undefined && Object.keys(channels).length > 0;
	const motion: AuthoredElementMotion | undefined =
		cascade === undefined
			? hasChannels
				? { channels }
				: undefined
			: hasChannels
				? { channels, cascade }
				: { cascade };
	return writeElementMotion(state, subject, motion);
}

/** The refusal for a weld subject the composition does not hold. */
function refuseMissingCascadeSubject(
	row: WebmcpOperationRow,
	state: EngineState,
	subject: CompositionCascadeSubject
): CompositionOperationFailure {
	if (
		subject.kind === 'block' &&
		(state.surface.chart?.items ?? []).some((item) => item.id === subject.blockId)
	) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`Chart Block "${subject.blockId}" times from its own phases; other elements may weld to it, but it welds to nothing.`,
			{ rejected: subject.blockId, alternatives: ['motion.set-chart-motion'] }
		);
	}
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`This composition holds no ${describeSubject(subject)}.`,
		{
			rejected: cascadeSubjectKey(subject),
			alternatives: listCompositionCascadeAnchorKeys(state)
		}
	);
}

/**
 * Weld one element's entrance to another element's, with an offset in
 * milliseconds so a 120 ms stagger stays 120 ms when the piece is re-timed.
 */
export async function runSetCompositionCascadeAnchorOperation(
	request: SetCompositionCascadeAnchorRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-cascade-anchor');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const state = readOpenCompositionDocument().state;
	if (!findSubjectCascade(state, request.subject)) {
		return refuseMissingCascadeSubject(row, state, request.subject);
	}

	const anchorKeys = listCompositionCascadeAnchorKeys(state);
	const anchorKey = cascadeNodeKey(request.anchor);
	const subjectKey = cascadeSubjectKey(request.subject);
	if (!anchorKeys.includes(anchorKey)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unknown_target',
			`This composition holds no element to anchor to at "${anchorKey}".`,
			{ rejected: anchorKey, alternatives: anchorKeys }
		);
	}
	if (anchorKey === subjectKey) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'An entrance cannot weld to itself.',
			{ rejected: anchorKey, alternatives: anchorKeys.filter((key) => key !== subjectKey) }
		);
	}
	if (!COMPOSITION_CASCADE_EVENTS.includes(request.event)) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			`"${request.event}" is not an edge of the anchor's entrance.`,
			{ rejected: request.event, alternatives: COMPOSITION_CASCADE_EVENTS }
		);
	}
	if (!Number.isFinite(request.offsetMs)) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'A Cascade offset is a finite number of milliseconds; negative leads the anchor.',
			{ rejected: String(request.offsetMs) }
		);
	}
	const cycle = findCascadeCycle(state, subjectKey, anchorKey);
	if (cycle) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			`Cascade cycle: ${cycle.join(' → ')}. Anchor chains must end at an element without a weld.`,
			{ rejected: anchorKey, alternatives: anchorKeys.filter((key) => !cycle.includes(key)) }
		);
	}

	const cascade: Cascade = {
		anchor: request.anchor,
		event: request.event,
		offsetMs: request.offsetMs
	};

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Weld Cascade anchor',
		focus: cascadeSubjectFocus(request.subject),
		mutate: (draft) => {
			if (!writeSubjectCascade(draft.state, request.subject, { ...cascade })) {
				throw new CompositionOperationError(
					'unknown_target',
					`${describeSubject(request.subject)} is no longer in the composition.`,
					{ rejected: subjectKey }
				);
			}
		}
	});
}

/** Unweld one entrance so it times from its own authored start again. */
export async function runClearCompositionCascadeAnchorOperation(
	request: ClearCompositionCascadeAnchorRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.clear-cascade-anchor');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const state = readOpenCompositionDocument().state;
	const subject = findSubjectCascade(state, request.subject);
	if (!subject) return refuseMissingCascadeSubject(row, state, request.subject);

	if (!subject.cascade) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`${describeSubject(request.subject)} already times from its own start.`,
			{ rejected: cascadeSubjectKey(request.subject) }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Clear Cascade anchor',
		focus: cascadeSubjectFocus(request.subject),
		mutate: (draft) => {
			if (!writeSubjectCascade(draft.state, request.subject, undefined)) {
				throw new CompositionOperationError(
					'unknown_target',
					`${describeSubject(request.subject)} is no longer in the composition.`,
					{ rejected: cascadeSubjectKey(request.subject) }
				);
			}
		}
	});
}
