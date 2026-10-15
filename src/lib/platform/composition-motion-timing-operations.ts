/**
 * The `motion` family's clip timing: when each element enters, how long it
 * runs, and on what curve
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * Every window here is a fraction of the clip, so a piece keeps its shape when
 * the transport duration changes and the timeline draws one clip bar per
 * element. A window must land inside the clip: the cascade resolver clamps a
 * welded start into `[0, 1 - duration]`, so a window authored past the end would
 * silently move rather than play where it was written.
 *
 * Two boundaries are load-bearing rather than incidental:
 *
 * - **A retime carries the cue with it.** `sound` owns `/state/…/enter/sound`,
 *   the override that says what this one motion plays. Replacing a window keeps
 *   that override on the new window, which is both what "cues stay welded to
 *   their motion" means (ADR-0033 §4) and what stops this family from writing a
 *   pointer another one owns. Removing a window removes the motion, and the cue
 *   that rode it goes with it.
 * - **A mark's colour is not appearance.** `/state/marks/defaults` is the Pack's
 *   mark styling and belongs to `appearance`; a single mark's departure from
 *   those defaults sits at `/state/marks/timings/<index>`, which this family
 *   owns, so it is written beside that mark's window. Pointer ownership decides,
 *   not the field's name.
 */
import { CHART_MOTION_PHASE_NAMES, type ChartMotionPhaseName } from '../utils/chart-motion';
import { ENGINE_EASES, type ChartMotionPhase, type Ease, type Transition } from './engine-schema';
import { compositionEditHistory } from './composition-edit-history';
import { resolveCompositionFractionTime } from './composition-time-input';
import { replaceChartBlockMotion } from './chart-authoring';
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

import type { Preset, TextAnimationParams } from './engine-schema';
import type { CompositionTimeDuration } from './composition-time-input';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** The ease vocabulary, read off the engine's ease table rather than restated. */
export const COMPOSITION_MOTION_EASES = Object.keys(ENGINE_EASES) as readonly Ease[];

/**
 * A motion window as this family authors it: start and duration as fractions of
 * the clip, plus the curve. The cue the window emits is deliberately absent —
 * that is `sound.set-motion-override`'s decision, and it survives a retime here.
 */
export interface CompositionMotionWindow {
	start: CompositionTimeDuration;
	duration: CompositionTimeDuration;
	ease: Ease;
}

interface ResolvedCompositionMotionWindow {
	start: number;
	duration: number;
	ease: Ease;
}

export interface SetCompositionSurfaceTimingRequest {
	expectedRevision: number;
	/** The entrance window; `null` removes it, absent leaves it alone. */
	enter?: CompositionMotionWindow | null;
	exit?: CompositionMotionWindow | null;
}

export interface SetCompositionOverlayTimingRequest {
	expectedRevision: number;
	overlayId: string;
	enter?: CompositionMotionWindow | null;
	exit?: CompositionMotionWindow | null;
}

export interface SetCompositionBlockTimingRequest {
	expectedRevision: number;
	/** The diagram Block to retime. */
	blockId: string;
	enter?: CompositionMotionWindow | null;
	exit?: CompositionMotionWindow | null;
}

export interface SetCompositionMarkTimingRequest {
	expectedRevision: number;
	/** The Annotation Mark's index in `marks.timings`, in document order. */
	markIndex: number;
	start?: CompositionTimeDuration;
	duration?: CompositionTimeDuration;
	ease?: Ease;
	/** This mark's departure from the mark defaults; `null` returns it to them. */
	color?: string | null;
	intensity?: number | null;
}

export interface SetCompositionTextAnimationRequest {
	expectedRevision: number;
	textAnimationId: string;
	enter?: CompositionMotionWindow;
	exit?: CompositionMotionWindow | null;
	/** Effect parameters; a `null` value returns that one to the effect's default. */
	params?: Partial<Record<keyof TextAnimationParams, number | null>>;
}

export type CompositionChartMotionPhaseInput = Omit<ChartMotionPhase, 'start' | 'duration'> & {
	start: CompositionTimeDuration;
	duration: CompositionTimeDuration;
};

export interface SetCompositionChartMotionRequest {
	expectedRevision: number;
	blockId: string;
	/** The phases to move; the ones left out keep the windows they hold. */
	phases: Partial<Record<ChartMotionPhaseName, CompositionChartMotionPhaseInput>>;
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isEngineEase(value: string): value is Ease {
	return Object.hasOwn(ENGINE_EASES, value);
}

function resolveMotionWindow(
	window: CompositionMotionWindow,
	document: Preset
): ResolvedCompositionMotionWindow {
	const grid = {
		durationSeconds: document.state.transport.durationSeconds,
		fps: document.state.transport.fps
	};
	return {
		start: resolveCompositionFractionTime(window.start, grid),
		duration: resolveCompositionFractionTime(window.duration, grid),
		ease: window.ease
	};
}

function resolveOptionalMotionWindow(
	window: CompositionMotionWindow | null | undefined,
	document: Preset
): ResolvedCompositionMotionWindow | null | undefined {
	return window ? resolveMotionWindow(window, document) : window;
}

/** Why a window is not authorable, or `null` when it is. */
function describeUnauthorableWindow(
	window: ResolvedCompositionMotionWindow,
	label: string
): string | null {
	if (!Number.isFinite(window.start) || window.start < 0 || window.start > 1) {
		return `The ${label} start is a fraction of the clip, from 0 through 1.`;
	}
	if (!Number.isFinite(window.duration) || window.duration < 0 || window.duration > 1) {
		return `The ${label} duration is a fraction of the clip, from 0 through 1.`;
	}
	if (window.start + window.duration > 1) {
		return `The ${label} window ends past the clip, at ${window.start + window.duration}.`;
	}
	if (!isEngineEase(window.ease)) {
		return `"${window.ease}" is not an ease this engine curves on.`;
	}
	return null;
}

function refuseUnauthorableWindows(
	row: WebmcpOperationRow,
	windows: readonly (readonly [string, ResolvedCompositionMotionWindow | null | undefined])[]
): CompositionOperationFailure | null {
	for (const [label, window] of windows) {
		if (!window) continue;
		const problem = describeUnauthorableWindow(window, label);
		if (problem) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'invalid_argument',
				problem,
				{
					rejected: `${label}: ${JSON.stringify(window)}`,
					alternatives: isEngineEase(window.ease) ? [] : COMPOSITION_MOTION_EASES
				}
			);
		}
	}
	return null;
}

/**
 * The window an edit leaves behind. An absent request field keeps the current
 * window; `null` removes it; a supplied one replaces the timing and carries the
 * cue override the motion already emitted.
 */
function retimeMotionWindow(
	current: Transition | undefined,
	next: ResolvedCompositionMotionWindow | null | undefined
): Transition | undefined {
	if (next === undefined) return current;
	if (next === null) return undefined;
	const retimed: Transition = { start: next.start, duration: next.duration, ease: next.ease };
	if (current?.sound) retimed.sound = { ...current.sound };
	return retimed;
}

function refuseEmptyTimingEdit(row: WebmcpOperationRow): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'invalid_argument',
		'Name at least one window to retime.',
		{ alternatives: ['enter', 'exit'] }
	);
}

/**
 * Set the Surface's entrance and exit windows. The Surface is the piece's timing
 * root — marks, text animations, and welded elements resolve against it — so
 * moving it moves everything anchored to it.
 */
export async function runSetCompositionSurfaceTimingOperation(
	request: SetCompositionSurfaceTimingRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-surface-timing');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	if (request.enter === undefined && request.exit === undefined) {
		return refuseEmptyTimingEdit(row);
	}
	const document = readOpenCompositionDocument();
	const enter = resolveOptionalMotionWindow(request.enter, document);
	const exit = resolveOptionalMotionWindow(request.exit, document);
	const windowRefusal = refuseUnauthorableWindows(row, [
		['Surface enter', enter],
		['Surface exit', exit]
	]);
	if (windowRefusal) return windowRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Surface timing',
		focus: { target: 'surface' },
		mutate: (draft) => {
			draft.state.surface.enter = retimeMotionWindow(draft.state.surface.enter, enter);
			draft.state.surface.exit = retimeMotionWindow(draft.state.surface.exit, exit);
		}
	});
}

/** Set one Overlay's entrance and exit windows. */
export async function runSetCompositionOverlayTimingOperation(
	request: SetCompositionOverlayTimingRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-overlay-timing');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const document = readOpenCompositionDocument();
	const overlays = document.state.overlays;
	if (!overlays.some((overlay) => overlay.id === request.overlayId)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`No Overlay in this composition is named "${request.overlayId}".`,
			{ rejected: request.overlayId, alternatives: overlays.map((overlay) => overlay.id) }
		);
	}
	if (request.enter === undefined && request.exit === undefined) {
		return refuseEmptyTimingEdit(row);
	}
	const enter = resolveOptionalMotionWindow(request.enter, document);
	const exit = resolveOptionalMotionWindow(request.exit, document);
	const windowRefusal = refuseUnauthorableWindows(row, [
		['Overlay enter', enter],
		['Overlay exit', exit]
	]);
	if (windowRefusal) return windowRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Overlay timing',
		focus: { target: 'overlay', overlayId: request.overlayId },
		mutate: (draft) => {
			const overlay = draft.state.overlays.find((entry) => entry.id === request.overlayId);
			if (!overlay) {
				throw new CompositionOperationError(
					'unknown_target',
					`Overlay "${request.overlayId}" is no longer in the composition.`,
					{ rejected: request.overlayId }
				);
			}
			overlay.enter = retimeMotionWindow(overlay.enter, enter);
			overlay.exit = retimeMotionWindow(overlay.exit, exit);
		}
	});
}

/** Set one diagram Block's entrance and exit windows. */
export async function runSetCompositionBlockTimingOperation(
	request: SetCompositionBlockTimingRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-block-timing');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const document = readOpenCompositionDocument();
	const diagram = document.state.surface.diagram ?? [];
	if (!diagram.some((entry) => entry.id === request.blockId)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`No diagram Block in this composition is named "${request.blockId}".`,
			{ rejected: request.blockId, alternatives: diagram.map((entry) => entry.id) }
		);
	}
	if (request.enter === undefined && request.exit === undefined) {
		return refuseEmptyTimingEdit(row);
	}
	const enter = resolveOptionalMotionWindow(request.enter, document);
	const exit = resolveOptionalMotionWindow(request.exit, document);
	const windowRefusal = refuseUnauthorableWindows(row, [
		['Block enter', enter],
		['Block exit', exit]
	]);
	if (windowRefusal) return windowRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Block timing',
		focus: { target: 'block', blockId: request.blockId },
		mutate: (draft) => {
			const primitive = (draft.state.surface.diagram ?? []).find(
				(entry) => entry.id === request.blockId
			);
			if (!primitive) {
				throw new CompositionOperationError(
					'unknown_target',
					`Block "${request.blockId}" is no longer on the Surface.`,
					{ rejected: request.blockId }
				);
			}
			primitive.enter = retimeMotionWindow(primitive.enter, enter);
			primitive.exit = retimeMotionWindow(primitive.exit, exit);
		}
	});
}

/**
 * Set one Annotation Mark's draw-on window and its departure from the mark
 * defaults. The mark must already hold an Annotation Layer entry — a
 * declared-but-unauthored span rides the shared fallback timing until
 * `layer.add-annotation-mark` gives it one, and creating that entry is
 * membership, which this family does not own.
 */
export async function runSetCompositionMarkTimingOperation(
	request: SetCompositionMarkTimingRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-mark-timing');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const document = readOpenCompositionDocument();
	const timings = document.state.marks.timings;
	const timing = timings[request.markIndex];
	if (!timing) {
		return refuseCompositionOperation(
			row,
			revision,
			'unknown_target',
			timings.length === 0
				? 'This composition holds no authored Annotation Mark; add one first.'
				: `Mark ${request.markIndex} is outside the ${timings.length} authored Annotation Marks.`,
			{
				rejected: String(request.markIndex),
				alternatives: timings.map((_entry, index) => String(index))
			}
		);
	}

	if (
		request.start === undefined &&
		request.duration === undefined &&
		request.ease === undefined &&
		request.color === undefined &&
		request.intensity === undefined
	) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Name at least one of the Mark start, duration, ease, colour, or intensity.',
			{ alternatives: ['start', 'duration', 'ease', 'color', 'intensity'] }
		);
	}

	const grid = {
		durationSeconds: document.state.transport.durationSeconds,
		fps: document.state.transport.fps
	};
	const start =
		request.start === undefined ? undefined : resolveCompositionFractionTime(request.start, grid);
	const duration =
		request.duration === undefined
			? undefined
			: resolveCompositionFractionTime(request.duration, grid);
	const windowRefusal = refuseUnauthorableWindows(row, [
		[
			`Mark ${request.markIndex}`,
			{
				start: start ?? timing.start,
				duration: duration ?? timing.duration,
				ease: request.ease ?? timing.ease
			}
		]
	]);
	if (windowRefusal) return windowRefusal;

	if (typeof request.color === 'string' && !HEX_COLOR_PATTERN.test(request.color)) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			`"${request.color}" is not a mark colour; use a #RRGGBB hex, or null to take the mark defaults.`,
			{ rejected: request.color, alternatives: ['#RRGGBB', 'null'] }
		);
	}
	if (
		typeof request.intensity === 'number' &&
		!(Number.isFinite(request.intensity) && request.intensity >= 0 && request.intensity <= 1)
	) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Mark intensity runs from 0 through 1.',
			{ rejected: String(request.intensity), alternatives: ['0', '1', 'null'] }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Mark timing',
		focus: { target: 'mark', markIndex: request.markIndex },
		mutate: (draft) => {
			const target = draft.state.marks.timings[request.markIndex];
			if (!target) {
				throw new CompositionOperationError(
					'unknown_target',
					`Mark ${request.markIndex} is no longer in the composition.`,
					{ rejected: String(request.markIndex) }
				);
			}
			if (start !== undefined) target.start = start;
			if (duration !== undefined) target.duration = duration;
			if (request.ease !== undefined) target.ease = request.ease;
			if (request.color !== undefined) target.color = request.color ?? undefined;
			if (request.intensity !== undefined) target.intensity = request.intensity ?? undefined;
		}
	});
}

/**
 * Set one text animation's timing windows and its effect parameters. The
 * parameters are validated by the composition schema, which is where each text
 * effect declares what it accepts, so a parameter the effect does not honour is
 * refused with the path that rejected it rather than stored where nothing reads
 * it.
 */
export async function runSetCompositionTextAnimationOperation(
	request: SetCompositionTextAnimationRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-text-animation');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const document = readOpenCompositionDocument();
	const entries = document.state.textAnimations;
	if (!entries.some((entry) => entry.id === request.textAnimationId)) {
		return refuseCompositionOperation(
			row,
			revision,
			'unknown_target',
			`No text animation in this composition is named "${request.textAnimationId}".`,
			{
				rejected: request.textAnimationId,
				alternatives: entries.map((entry) => entry.id)
			}
		);
	}
	if (request.enter === undefined && request.exit === undefined && request.params === undefined) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Name at least one of the text animation enter window, exit window, or parameters.',
			{ alternatives: ['enter', 'exit', 'params'] }
		);
	}
	const enter = resolveOptionalMotionWindow(request.enter, document);
	const exit = resolveOptionalMotionWindow(request.exit, document);
	const windowRefusal = refuseUnauthorableWindows(row, [
		['Text animation enter', enter],
		['Text animation exit', exit]
	]);
	if (windowRefusal) return windowRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set text animation',
		focus: { target: 'text-animation', textAnimationId: request.textAnimationId },
		mutate: (draft) => {
			const entry = draft.state.textAnimations.find(
				(candidate) => candidate.id === request.textAnimationId
			);
			if (!entry) {
				throw new CompositionOperationError(
					'unknown_target',
					`Text animation "${request.textAnimationId}" is no longer in the composition.`,
					{ rejected: request.textAnimationId }
				);
			}
			const nextEnter = retimeMotionWindow(entry.enter, enter);
			if (!nextEnter) {
				throw new CompositionOperationError(
					'invalid_argument',
					'A text animation always has an enter window; retime it rather than removing it.',
					{ rejected: 'enter' }
				);
			}
			entry.enter = nextEnter;
			entry.exit = retimeMotionWindow(entry.exit, exit);
			if (request.params) {
				const params: TextAnimationParams = { ...entry.params };
				for (const [name, value] of Object.entries(request.params)) {
					const key = name as keyof TextAnimationParams;
					if (value === null || value === undefined) delete params[key];
					else params[key] = value;
				}
				entry.params = Object.keys(params).length > 0 ? params : undefined;
			}
		}
	});
}

/**
 * Retime one chart Block's motion phases. The five phases are replaced as a set
 * rather than one at a time: a caller shifting the whole run later would
 * otherwise collide with a phase the same edit is about to move.
 */
export async function runSetCompositionChartMotionOperation(
	request: SetCompositionChartMotionRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-chart-motion');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const document = readOpenCompositionDocument();
	const items = document.state.surface.chart?.items ?? [];
	const block = items.find((item) => item.id === request.blockId);
	if (!block) {
		return refuseCompositionOperation(
			row,
			revision,
			'unknown_target',
			`No chart Block in this composition is named "${request.blockId}".`,
			{ rejected: request.blockId, alternatives: items.map((item) => item.id) }
		);
	}

	const requested = Object.keys(request.phases);
	if (requested.length === 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			'Name at least one chart motion phase to retime.',
			{ alternatives: CHART_MOTION_PHASE_NAMES }
		);
	}
	const phaseNames: readonly string[] = CHART_MOTION_PHASE_NAMES;
	for (const name of requested) {
		if (!phaseNames.includes(name)) {
			return refuseCompositionOperation(
				row,
				revision,
				'invalid_argument',
				`"${name}" is not a chart motion phase.`,
				{ rejected: name, alternatives: CHART_MOTION_PHASE_NAMES }
			);
		}
	}
	const grid = {
		durationSeconds: document.state.transport.durationSeconds,
		fps: document.state.transport.fps
	};
	const phases: Partial<Record<ChartMotionPhaseName, ChartMotionPhase>> = {};
	for (const phaseName of CHART_MOTION_PHASE_NAMES) {
		const phase = request.phases[phaseName];
		if (!phase) continue;
		phases[phaseName] = {
			...phase,
			start: resolveCompositionFractionTime(phase.start, grid),
			duration: resolveCompositionFractionTime(phase.duration, grid)
		};
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set chart motion',
		focus: { target: 'block', blockId: request.blockId },
		mutate: (draft) => {
			const target = draft.state.surface.chart?.items.find((item) => item.id === request.blockId);
			if (!target) {
				throw new CompositionOperationError(
					'unknown_target',
					`Chart Block "${request.blockId}" is no longer on the Surface.`,
					{ rejected: request.blockId }
				);
			}
			const motion = { ...target.motion };
			for (const phaseName of CHART_MOTION_PHASE_NAMES) {
				const phase = phases[phaseName];
				if (phase) motion[phaseName] = { ...phase };
			}
			if (!replaceChartBlockMotion(draft.state.surface, request.blockId, motion)) {
				throw new CompositionOperationError(
					'invalid_argument',
					'Chart phases must stay positive, ordered, inside the clip, and clear of the Blocks either side.',
					{ rejected: request.blockId, alternatives: CHART_MOTION_PHASE_NAMES }
				);
			}
		}
	});
}
