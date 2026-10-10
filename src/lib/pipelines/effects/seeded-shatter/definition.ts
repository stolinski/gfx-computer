import { z } from 'zod';
import type { TransitionEffectDefinition } from '$lib/platform/pipelines/definition-types';

const SeededShatterParamsSchema = z.object({
	seed: z.number().int().min(0).max(65535).default(1337),
	columns: z.number().int().min(4).max(32).default(14),
	scatter: z.number().min(0).max(0.4).default(0.13),
	rotation: z.number().min(0).max(1).default(0.55),
	depth: z.number().min(0).max(1).default(0.6),
	shadow: z.number().min(0).max(1).default(0.35)
});
export type SeededShatterParams = z.infer<typeof SeededShatterParamsSchema>;

export const seededShatterTransitionEffectDefinition = {
	type: 'seeded-shatter' as const,
	label: 'Seeded shatter',
	paramsSchema: SeededShatterParamsSchema,
	defaults: () => ({
		params: { seed: 1337, columns: 14, scatter: 0.13, rotation: 0.55, depth: 0.6, shadow: 0.35 }
	})
} satisfies TransitionEffectDefinition<SeededShatterParams>;
