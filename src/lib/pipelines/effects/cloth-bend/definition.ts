import { z } from 'zod';
import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const ClothBendParamsSchema = z.object({
	seed: z.number().int().min(0).max(65535).default(512),
	pinnedEdge: z.enum(['top', 'left', 'both']).default('top'),
	gustAtSeconds: z.number().min(0).max(600).default(0.3),
	gust: z.number().min(-1).max(1).default(0.62),
	stiffness: z.number().min(0.5).max(20).default(7),
	damping: z.number().min(0.1).max(10).default(2.8),
	folds: z.number().min(1).max(16).default(5),
	perspective: z.number().min(0).max(0.3).default(0.08),
	shadow: z.number().min(0).max(1).default(0.32)
});

export type ClothBendParams = z.infer<typeof ClothBendParamsSchema>;

const ClothBendEffectSchema = z.object({
	type: z.literal('cloth-bend'),
	id: z.string(),
	params: ClothBendParamsSchema
});

export const clothBendEffectDefinition = {
	type: 'cloth-bend',
	label: 'Cloth bend',
	schema: ClothBendEffectSchema,
	// The seed and every input `resolveClothState` hands the fixed-step kernel:
	// the spring constants and the authored gust event (ADR-0063 §3).
	frozenParams: ['seed', 'gustAtSeconds', 'gust', 'stiffness', 'damping'],
	defaults: () => ({
		params: {
			seed: 512,
			pinnedEdge: 'top',
			gustAtSeconds: 0.3,
			gust: 0.62,
			stiffness: 7,
			damping: 2.8,
			folds: 5,
			perspective: 0.08,
			shadow: 0.32
		}
	})
} satisfies EffectPipelineDefinition<ClothBendParams>;
