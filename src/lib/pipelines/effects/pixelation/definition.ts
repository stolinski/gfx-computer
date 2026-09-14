import { z } from 'zod';
import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const PixelationParamsSchema = z.object({
	/** Square cell width and height in native composition pixels. */
	pixelSize: z.number().int().min(1).max(256).default(48)
});

export type PixelationParams = z.infer<typeof PixelationParamsSchema>;

const PixelationEffectSchema = z.object({
	type: z.literal('pixelation'),
	id: z.string(),
	params: PixelationParamsSchema
});

export const pixelationEffectDefinition = {
	type: 'pixelation',
	label: 'Pixelation',
	schema: PixelationEffectSchema,
	defaults: () => ({ params: { pixelSize: 48 } })
} satisfies EffectPipelineDefinition<PixelationParams>;
