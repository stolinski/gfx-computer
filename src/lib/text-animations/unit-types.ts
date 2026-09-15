import type { VariableWeightTreatment } from '$lib/platform/packs/variable-weight-treatment';

/**
 * The unit produced by SplitText (or the hand-rolled fallback). One per
 * animated glyph / word / line, plus one synthetic unit for `whole` effects.
 * The renderer owns the DOM `element` and writes inline styles into it on
 * every tween tick.
 */
export interface TextAnimationResolvedUnit {
	/** Stable per-slot ordinal — what the marks-coupling lookup keys on. */
	index: number;
	/** The DOM element SplitText (or the fallback) produced for this unit. */
	element: HTMLElement;
	/** The visible text contents of this unit (used by tests and debug). */
	text: string;
	/** Initial Pack-owned `wght` coordinates; the writer refreshes them on Pack changes. */
	variableWeightTreatment: VariableWeightTreatment | null;
}

/**
 * The per-unit alpha multiplier the marks-coupling layer reads. The compiler
 * writes the resolved opacity for every animated unit into this map every time
 * GSAP ticks; consumers (the per-frame draw loop in
 * `src/lib/annotations/annotation-marks.ts`) sample by unit index.
 *
 * The writer signature is `(unitIndex, alpha) => void`. Implementations live
 * in `manager.svelte.ts`; the compiler is pure and only invokes the callback.
 */
export type TextAnimationUnitAlphaWriter = (unitIndex: number, alpha: number) => void;
