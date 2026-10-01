import { z } from 'zod';
import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const TiledDeformationParamsSchema = z
	.object({
		topology: z.enum(['grid', 'hex']).default('grid'),
		seed: z.number().int().min(0).max(65535).default(901),
		columns: z.number().min(3).max(48).default(12),
		lift: z.number().min(0).max(1).default(0.42),
		bevel: z.number().min(0).max(1).default(0.3),
		perspective: z.number().min(0).max(0.2).default(0.045),
		revealFrom: z.number().min(0).max(1).default(0.12),
		revealTo: z.number().min(0).max(1).default(0.62),
		lightAngle: z.number().min(-180).max(180).default(-35)
	})
	.refine((params) => params.revealTo > params.revealFrom, {
		path: ['revealTo'],
		message: 'revealTo must be greater than revealFrom'
	});

export type TiledDeformationParams = z.infer<typeof TiledDeformationParamsSchema>;

const TiledDeformationEffectSchema = z.object({
	type: z.literal('tiled-deformation'),
	id: z.string(),
	params: TiledDeformationParamsSchema
});

export const tiledDeformationEffectDefinition = {
	type: 'tiled-deformation',
	label: 'Tiled deformation',
	schema: TiledDeformationEffectSchema,
	// The seed feeds the per-tile hash; there is no fixed-step kernel (ADR-0063 §3).
	frozenParams: ['seed'],
	defaults: () => ({
		params: {
			topology: 'grid',
			seed: 901,
			columns: 12,
			lift: 0.42,
			bevel: 0.3,
			perspective: 0.045,
			revealFrom: 0.12,
			revealTo: 0.62,
			lightAngle: -35
		}
	})
} satisfies EffectPipelineDefinition<TiledDeformationParams>;
