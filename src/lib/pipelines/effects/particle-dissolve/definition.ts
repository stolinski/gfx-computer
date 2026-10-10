import { z } from 'zod';
import type { TransitionEffectDefinition } from '$lib/platform/pipelines/definition-types';

const ParticleDissolveParamsSchema = z.object({
	seed: z.number().int().min(0).max(65535).default(2718),
	density: z.number().min(12).max(160).default(72),
	spread: z.number().min(0).max(0.25).default(0.055),
	direction: z.number().min(-180).max(180).default(-18),
	softness: z.number().min(0.01).max(0.3).default(0.08),
	luminanceBias: z.number().min(-1).max(1).default(0.2)
});
export type ParticleDissolveParams = z.infer<typeof ParticleDissolveParamsSchema>;

export const particleDissolveTransitionEffectDefinition = {
	type: 'particle-dissolve' as const,
	label: 'Particle dissolve',
	paramsSchema: ParticleDissolveParamsSchema,
	defaults: () => ({
		params: {
			seed: 2718,
			density: 72,
			spread: 0.055,
			direction: -18,
			softness: 0.08,
			luminanceBias: 0.2
		}
	})
} satisfies TransitionEffectDefinition<ParticleDissolveParams>;
