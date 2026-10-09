import { d } from 'typegpu';
import { z } from 'zod';

import type { TransitionEffectRenderer } from './types';

/**
 * The cross-fade of a Film's `fade` Scene boundary
 * ([ADR-0068](../../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4):
 * `out × (1 − p) + in × p` per pixel, in premultiplied alpha, over the two live
 * Scene views of one boundary window frame. `p` is the window's progress, with
 * no ease. `src/lib/utils/premultiplied-cross-fade.ts` is the same formula in
 * TypeScript.
 *
 * It is written to the transition pass's contract (`./transition-pass.ts`: a
 * from-view, a to-view, and a `progress` uniform), so it compiles through
 * `compileTransitionEffect` and a boundary drives it exactly as it will drive a
 * registered transition Effect. It is deliberately NOT in
 * `transition-definition-registry.ts`. That registry is the vocabulary of
 * `transition.effect` on a legacy two-endpoint Preset and of the effect a
 * boundary may name; `fade` is a boundary kind of its own (ADR-0068 §4), and
 * registering it would offer it in the legacy transition picker and give one
 * boundary two spellings.
 */
const FilmBoundaryFadeUniforms = d.struct({
	progress: d.f32
});

// A fade has nothing to set: its one input is the window's progress.
const FilmBoundaryFadeParamsSchema = z.strictObject({});

export type FilmBoundaryFadeParams = z.infer<typeof FilmBoundaryFadeParamsSchema>;

export const filmBoundaryFadeEffectRenderer: TransitionEffectRenderer<FilmBoundaryFadeParams> = {
	type: 'fade',
	label: 'Fade',
	paramsSchema: FilmBoundaryFadeParamsSchema,
	defaults: () => ({ params: {} }),
	pass: {
		paramsStruct: FilmBoundaryFadeUniforms,
		// Both samples are premultiplied, so one mix over all four channels is the
		// cross-fade. The compiler returns `fromSample` at progress 0 and
		// `toSample` at progress 1 before this runs.
		fragmentBody: /* wgsl */ `
			return mix(fromSample, toSample, transitionProgress);
		`,
		pack: (_params, context) => ({ progress: context.progress })
	}
};
