import type { DiagramNodeHighlight } from '$lib/platform/engine-schema';

import { evaluateNamedEase } from './ease-curves';
import { clampNumber } from './math';

/** The visible part of a node's highlighter band, as fractions of its width. */
export interface DiagramNodeHighlightSpan {
	from: number;
	to: number;
}

function easedWindowProgress(
	window: { start: number; duration: number; ease: DiagramNodeHighlight['ease'] },
	progress: number
): number {
	if (window.duration <= 0) return progress >= window.start ? 1 : 0;
	return evaluateNamedEase(
		window.ease,
		clampNumber((progress - window.start) / window.duration, 0, 1)
	);
}

/**
 * The highlighter band at composition `progress`: it draws on left to right
 * over its window, holds, and when a `lift` is authored wipes off left to
 * right over that window, the way a swipe leaves the page. Eases that
 * overshoot are clamped so the band never runs past the text.
 */
export function diagramNodeHighlightSpanAt(
	highlight: DiagramNodeHighlight,
	progress: number
): DiagramNodeHighlightSpan {
	const to = clampNumber(easedWindowProgress(highlight, progress), 0, 1);
	const from = highlight.lift
		? clampNumber(easedWindowProgress(highlight.lift, progress), 0, 1)
		: 0;
	return { from: Math.min(from, to), to };
}
