import { z } from 'zod';
import {
	CompleteOpticalRegionSchema,
	createOrientationParamOverridesSchema,
	resolveOpticalRegionSnapshot,
	DEFAULT_REFRACTIVE_LENS_REGION,
	NormalizedOpticalRegionSchema,
	OpticalShapeSchema
} from '$lib/utils/optical-geometry';
import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const RefractiveLensParamsSchema = z.object({
	shape: OpticalShapeSchema.default('rounded-rect'),
	region: NormalizedOpticalRegionSchema.default(DEFAULT_REFRACTIVE_LENS_REGION),
	magnification: z.number().min(1).max(2.4).default(1.24),
	thickness: z.number().min(0).max(1).default(0.45),
	refraction: z.number().min(0).max(1).default(0.32),
	roughness: z.number().min(0).max(1).default(0.08),
	dispersion: z.number().min(0).max(1).default(0.12),
	reflection: z.number().min(0).max(1).default(0.18),
	rimLight: z.number().min(0).max(1).default(0.32),
	tint: z.string().regex(HEX_COLOR_PATTERN).default('#dbeafe'),
	tintStrength: z.number().min(0).max(1).default(0.08),
	edgeFlatness: z.number().min(0).max(1).default(0.45),
	bevel: z.number().min(0.02).max(1).default(0.28),
	// The lens placed anew for one orientation (ADR-0039 §4).
	orientationOverrides: createOrientationParamOverridesSchema(
		z.strictObject({ region: CompleteOpticalRegionSchema })
	)
});

export type RefractiveLensParams = z.infer<typeof RefractiveLensParamsSchema>;

const RefractiveLensEffectSchema = z.object({
	type: z.literal('refractive-lens'),
	id: z.string(),
	params: RefractiveLensParamsSchema
});

export const refractiveLensEffectDefinition = {
	type: 'refractive-lens',
	label: 'Refractive lens',
	schema: RefractiveLensEffectSchema,
	orientationParams: ['region'],
	resolveOrientationSnapshot: resolveOpticalRegionSnapshot,
	defaults: () => ({
		params: {
			shape: 'rounded-rect',
			region: { ...DEFAULT_REFRACTIVE_LENS_REGION },
			magnification: 1.24,
			thickness: 0.45,
			refraction: 0.32,
			roughness: 0.08,
			dispersion: 0.12,
			reflection: 0.18,
			rimLight: 0.32,
			tint: '#dbeafe',
			tintStrength: 0.08,
			edgeFlatness: 0.45,
			bevel: 0.28
		}
	})
} satisfies EffectPipelineDefinition<RefractiveLensParams>;
