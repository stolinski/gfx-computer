import { z } from 'zod';
import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const FluidRippleParamsSchema = z.object({
	seed: z.number().int().min(0).max(65535).default(8128),
	impulseAtSeconds: z.number().min(0).max(600).default(0.35),
	impulseX: z.number().min(0).max(1).default(0.5),
	impulseY: z.number().min(0).max(1).default(0.5),
	impulseStrength: z.number().min(0).max(1).default(0.72),
	radius: z.number().min(0.02).max(0.6).default(0.18),
	damping: z.number().min(0.1).max(8).default(1.8),
	waveSpeed: z.number().min(0.1).max(8).default(2.4),
	refraction: z.number().min(0).max(0.08).default(0.018),
	highlights: z.number().min(0).max(1).default(0.28)
});

export type FluidRippleParams = z.infer<typeof FluidRippleParamsSchema>;

const FluidRippleEffectSchema = z.object({
	type: z.literal('fluid-ripple'),
	id: z.string(),
	params: FluidRippleParamsSchema
});

export const fluidRippleEffectDefinition = {
	type: 'fluid-ripple',
	label: 'Fluid ripple',
	schema: FluidRippleEffectSchema,
	// The seed and every input `resolveFluidState` hands the fixed-step kernel:
	// the step constants and the authored impulse event (ADR-0063 §3).
	frozenParams: [
		'seed',
		'impulseAtSeconds',
		'impulseX',
		'impulseY',
		'impulseStrength',
		'damping',
		'waveSpeed'
	],
	defaults: () => ({
		params: {
			seed: 8128,
			impulseAtSeconds: 0.35,
			impulseX: 0.5,
			impulseY: 0.5,
			impulseStrength: 0.72,
			radius: 0.18,
			damping: 1.8,
			waveSpeed: 2.4,
			refraction: 0.018,
			highlights: 0.28
		}
	})
} satisfies EffectPipelineDefinition<FluidRippleParams>;
