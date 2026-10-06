import { evaluateNamedEase, type NamedEaseCurve } from './ease-curves';
import { evaluateKeyframeTrackAtMs } from '$lib/platform/keyframe-track-evaluation';
import type { Figure, FigureMove, FigurePin } from '$lib/platform/engine-schema';
import type { VideoOrientation } from './video-frame';

/**
 * Figure Move evaluation (ADR-0067 §6). Everything here is a pure function of
 * the declaration and explicit composition progress — never wall-clock — so
 * preview and export agree at every frame.
 */

/** The default ease of each Move when the declaration names none. */
const FIGURE_MOVE_DEFAULT_EASE: Readonly<Record<FigureMove['move'], NamedEaseCurve>> = {
	reveal: 'smooth',
	propagate: 'smooth',
	pulse: 'smooth',
	flow: 'smooth',
	advance: 'smooth',
	focus: 'smooth',
	annotate: 'smooth',
	exit: 'smooth'
};

/** How much of the reveal window one element's own entrance takes under cascade/grow. */
const FIGURE_CASCADE_SPAN = 0.4;
const FIGURE_GROW_SPAN = 0.5;
/** Opacity of Marks outside the current focus. */
export const FIGURE_FOCUS_DIM = 0.3;

function clamp01(value: number): number {
	return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** Linear 0–1 progress through a Move's window at composition progress `p`. */
export function figureMoveLinearProgress(move: FigureMove, progress: number): number {
	return clamp01((progress - move.start) / move.duration);
}

/** Eased progress through a Move's window; may overshoot 1 for settled/bouncy. */
export function figureMoveEasedProgress(move: FigureMove, progress: number): number {
	return evaluateNamedEase(
		move.ease ?? FIGURE_MOVE_DEFAULT_EASE[move.move],
		figureMoveLinearProgress(move, progress)
	);
}

type MoveOf<Name extends FigureMove['move']> = Extract<FigureMove, { move: Name }>;

function movesOf<Name extends FigureMove['move']>(figure: Figure, name: Name): MoveOf<Name>[] {
	return figure.moves.filter((move): move is MoveOf<Name> => move.move === name);
}

export interface FigureMotion {
	/** Whole-Figure alpha: 0 before the reveal starts, fading through a `fade` exit. */
	figureAlpha: number;
	/** Reveal progress (eased, may overshoot) for an element at structural `order` in [0, 1]. */
	reveal(order: number): number;
	/** Linear reveal progress for an element — never overshoots; use for quantities. */
	revealLinear(order: number): number;
	/** The reveal style in force. */
	revealStyle: MoveOf<'reveal'>['style'];
	/** Whether the reveal has fully completed. */
	revealDone: boolean;
	/** Opacity multiplier from focus for a Mark (1 when no focus is active). */
	focusDim(markId: string): number;
	/** 0–1 emphasis for a focused Mark. */
	focusEmphasis(markId: string): number;
	/** Treemap zoom: the zoomed Mark and 0–1 amount, or null. */
	zoom: { markId: string; amount: number } | null;
	/** 0–1 swell for a pulsed Mark. */
	pulse(markId: string): number;
	/** Active propagation: wave position in stages (fractional), or null when none is running. */
	propagation: { position: number; stageCount: number; path: readonly string[] | null } | null;
	/** Whether a propagate Move has finished (lit state holds afterwards). */
	propagationDone: boolean;
	/** Whether the Figure declares any propagate Move. */
	hasPropagation: boolean;
	/** Flow phase in cycles for a link Mark (and 0–1 visibility), or null. */
	flow(linkMarkId: string): { phase: number; visibility: number } | null;
	/** Current advance position (frame/period index or x), or null when the Figure has none. */
	advance: number | null;
	/** 0–1 visibility of an annotation or label Mark. */
	annotate(markId: string): number;
	/** Whether a Mark is named by any annotate Move. */
	isAnnotated(markId: string): boolean;
}

/** The structural stage count a propagate wave travels through for a Figure. */
export type FigureStageCounter = (path: readonly string[] | null) => number;

export function evaluateFigureMotion(
	figure: Figure,
	progress: number,
	stageCount: FigureStageCounter
): FigureMotion {
	const reveal = movesOf(figure, 'reveal')[0] ?? {
		move: 'reveal' as const,
		style: 'fade' as const,
		start: 0,
		duration: 0.0001
	};
	const exit = movesOf(figure, 'exit')[0];
	const revealLinear = figureMoveLinearProgress(reveal, progress);
	const revealEase = reveal.ease ?? FIGURE_MOVE_DEFAULT_EASE.reveal;
	const exitLinear = exit ? figureMoveLinearProgress(exit, progress) : 0;
	const exitEased = exit ? evaluateNamedEase('smooth', exitLinear) : 0;
	// A reverse exit runs the reveal backwards.
	const effectiveReveal =
		exit && exit.style === 'reverse' && progress >= exit.start ? 1 - exitEased : revealLinear;
	const started = progress >= reveal.start;
	const figureAlpha = !started ? 0 : exit && exit.style === 'fade' ? 1 - exitEased : 1;

	const span =
		reveal.style === 'cascade'
			? FIGURE_CASCADE_SPAN
			: reveal.style === 'grow'
				? FIGURE_GROW_SPAN
				: 1;
	const elementLinear = (order: number): number => {
		if (reveal.style === 'fade') return effectiveReveal;
		const local = (effectiveReveal - clamp01(order) * (1 - span)) / span;
		return clamp01(local);
	};

	// Focus: the latest started focus wins; its predecessor cross-fades out.
	const focuses = movesOf(figure, 'focus')
		.filter((move) => progress >= move.start)
		.sort((a, b) => a.start - b.start);
	const currentFocus = focuses[focuses.length - 1];
	const previousFocus = focuses[focuses.length - 2];
	const focusAmount = currentFocus ? clamp01(figureMoveEasedProgress(currentFocus, progress)) : 0;
	const exitRelease = exit ? exitEased : 0;
	const focusWeight = (move: MoveOf<'focus'> | undefined, markId: string): number =>
		move && move.targets.includes(markId) ? 1 : 0;
	const activeFocusTargets = (move: MoveOf<'focus'> | undefined): boolean =>
		move !== undefined && move.targets.length > 0;
	const focusDim = (markId: string): number => {
		const current = activeFocusTargets(currentFocus)
			? focusAmount * (1 - focusWeight(currentFocus, markId))
			: 0;
		const previous = activeFocusTargets(previousFocus)
			? (1 - focusAmount) * (1 - focusWeight(previousFocus, markId))
			: 0;
		const dim = Math.max(current, previous) * (1 - exitRelease);
		return 1 - dim * (1 - FIGURE_FOCUS_DIM);
	};
	const focusEmphasis = (markId: string): number =>
		(focusWeight(currentFocus, markId) * focusAmount +
			focusWeight(previousFocus, markId) * (1 - focusAmount)) *
		(1 - exitRelease);
	const zoomMove = focuses.filter((move) => move.zoom).pop();
	const zoom =
		zoomMove && zoomMove.targets.length === 1
			? {
					markId: zoomMove.targets[0],
					amount:
						zoomMove === currentFocus
							? focusAmount
							: currentFocus && currentFocus.start > zoomMove.start
								? 1 - focusAmount
								: 1
				}
			: null;

	const pulse = (markId: string): number => {
		let amount = 0;
		for (const move of movesOf(figure, 'pulse')) {
			if (!move.targets.includes(markId)) continue;
			const t = figureMoveLinearProgress(move, progress);
			if (t <= 0 || t >= 1) continue;
			amount = Math.max(amount, 0.5 - 0.5 * Math.cos(Math.PI * 2 * t * move.repeat));
		}
		return amount;
	};

	const propagates = movesOf(figure, 'propagate');
	const activePropagate = propagates.find(
		(move) => progress >= move.start && progress <= move.start + move.duration
	);
	let propagation: FigureMotion['propagation'] = null;
	if (activePropagate) {
		const stages = stageCount(activePropagate.path ?? null);
		const t = figureMoveEasedProgress(activePropagate, progress);
		const perRepeat = (t * activePropagate.repeat) % 1;
		const finished = t >= 1;
		// The wave overruns the last stage slightly so the final layer lights fully.
		const position = finished ? stages - 1 + 0.999 : perRepeat * stages - 0.5;
		propagation = { position, stageCount: stages, path: activePropagate.path ?? null };
	}
	const propagationDone = propagates.some((move) => progress > move.start + move.duration);

	const flowMoves = movesOf(figure, 'flow');
	const flow = (linkMarkId: string): { phase: number; visibility: number } | null => {
		for (const move of flowMoves) {
			if (move.targets && !move.targets.includes(linkMarkId)) continue;
			const t = figureMoveLinearProgress(move, progress);
			if (progress < move.start || t >= 1) continue;
			const edge = 0.12;
			const visibility = Math.min(clamp01(t / edge), clamp01((1 - t) / edge));
			return { phase: t * move.cycles, visibility };
		}
		return null;
	};

	const advances = movesOf(figure, 'advance').sort((a, b) => a.start - b.start);
	let advance: number | null = null;
	if (advances.length > 0) {
		advance = advances[0].from;
		for (const move of advances) {
			if (progress < move.start) break;
			// Without a declared ease an advance runs at a steady pace: a race or a
			// line drawing forward should not rush its first years.
			const t = clamp01(
				move.ease === undefined
					? figureMoveLinearProgress(move, progress)
					: figureMoveEasedProgress(move, progress)
			);
			advance = move.from + (move.to - move.from) * t;
		}
	}

	const annotates = movesOf(figure, 'annotate');
	const annotatedIds = new Set(annotates.flatMap((move) => move.targets));
	const annotate = (markId: string): number => {
		if (!annotatedIds.has(markId)) return clamp01((effectiveReveal - 0.6) / 0.4);
		let amount = 0;
		for (const move of annotates) {
			if (move.targets.includes(markId)) {
				amount = Math.max(amount, clamp01(figureMoveEasedProgress(move, progress)));
			}
		}
		return exit?.style === 'reverse' && progress >= (exit?.start ?? 1)
			? amount * (1 - exitEased)
			: amount;
	};

	return {
		figureAlpha,
		reveal: (order) => {
			const linear = elementLinear(order);
			return reveal.style === 'fade' ? linear : evaluateNamedEase(revealEase, linear);
		},
		revealLinear: elementLinear,
		revealStyle: reveal.style,
		revealDone: effectiveReveal >= 1,
		focusDim,
		focusEmphasis,
		zoom,
		pulse,
		propagation,
		propagationDone,
		hasPropagation: propagates.length > 0,
		flow,
		advance,
		annotate,
		isAnnotated: (markId) => annotatedIds.has(markId)
	};
}

/** The Pin in force for a Mark in an orientation: an orientation Pin beats a shared one. */
export function resolveFigurePin(
	figure: Figure,
	markId: string,
	orientation: VideoOrientation
): FigurePin | null {
	const pins = figure.pins ?? [];
	return (
		pins.find((pin) => pin.mark === markId && pin.orientation === orientation) ??
		pins.find((pin) => pin.mark === markId && pin.orientation === undefined) ??
		null
	);
}

/** A Pin's keyframed opacity and scale at composition time `atMs`. */
export function evaluateFigurePinChannels(
	pin: FigurePin | null,
	atMs: number
): { opacity: number; scale: number } {
	if (!pin?.channels) return { opacity: 1, scale: 1 };
	return {
		opacity: evaluateKeyframeTrackAtMs(pin.channels.opacity, atMs, 1),
		scale: evaluateKeyframeTrackAtMs(pin.channels.scale, atMs, 1)
	};
}
