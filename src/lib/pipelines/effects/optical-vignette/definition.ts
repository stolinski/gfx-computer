import { z } from 'zod';

import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';
import { createOrientationParamOverridesSchema } from '$lib/utils/optical-geometry';

/** Stops of exposure the farthest frame corner loses at the default strength. */
export const DEFAULT_OPTICAL_VIGNETTE_EXPOSURE_LOSS = 1;

const OpticalVignetteCenterSchema = z.object({
	x: z.number().min(0).max(1).default(0.5),
	y: z.number().min(0).max(1).default(0.5)
});

// An orientation snapshot replaces the optical centre as one unit (ADR-0039 §4),
// so it never inherits a coordinate from the shared centre.
const CompleteOpticalVignetteCenterSchema = z.strictObject({
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1)
});

const OpticalVignetteParamsSchema = z.object({
	/**
	 * Stops of exposure, in linear light, lost at the farthest frame corner
	 * from the optical centre. Every other pixel loses less, so this is the
	 * deepest the effect ever darkens. 0 is an exact identity pass.
	 */
	exposureLoss: z.number().min(0).max(3).default(DEFAULT_OPTICAL_VIGNETTE_EXPOSURE_LOSS),
	/**
	 * Radius where the falloff takes hold, as a fraction of the distance from
	 * the optical centre to the farthest corner. Inside it the frame keeps
	 * nearly full exposure.
	 */
	onset: z.number().min(0).max(0.8).default(0.3),
	/** How gradually the falloff takes hold around `onset`. Low is a tighter shoulder. */
	feather: z.number().min(0.1).max(1).default(0.45),
	/** 1 is the circular image of a real lens; 0 stretches the falloff to the frame's ellipse. */
	roundness: z.number().min(0).max(1).default(1),
	/** Optical centre in fractions of the frame. */
	center: OpticalVignetteCenterSchema.default({ x: 0.5, y: 0.5 }),
	// The optical centre placed anew for one orientation (ADR-0039 §4).
	orientationOverrides: createOrientationParamOverridesSchema(
		z.strictObject({ center: CompleteOpticalVignetteCenterSchema })
	)
});

export type OpticalVignetteParams = z.infer<typeof OpticalVignetteParamsSchema>;

const OpticalVignetteEffectSchema = z.object({
	type: z.literal('optical-vignette'),
	id: z.string(),
	params: OpticalVignetteParamsSchema
});

export const opticalVignetteEffectDefinition = {
	type: 'optical-vignette',
	label: 'Optical vignette',
	schema: OpticalVignetteEffectSchema,
	orientationParams: ['center'],
	defaults: () => ({
		params: {
			exposureLoss: DEFAULT_OPTICAL_VIGNETTE_EXPOSURE_LOSS,
			onset: 0.3,
			feather: 0.45,
			roundness: 1,
			center: { x: 0.5, y: 0.5 }
		}
	})
} satisfies EffectPipelineDefinition<OpticalVignetteParams>;
