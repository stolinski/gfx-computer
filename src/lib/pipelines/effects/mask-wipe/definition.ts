import { z } from 'zod';
import type { TransitionEffectDefinition } from '$lib/platform/pipelines/definition-types';

const MaskWipeParamsSchema = z.object({
	direction: z.enum(['right', 'left', 'down', 'up']).default('right'),
	softness: z.number().min(0.0002).max(0.05).default(0.001)
});
export type MaskWipeParams = z.infer<typeof MaskWipeParamsSchema>;

export const maskWipeTransitionEffectDefinition = {
	type: 'mask-wipe' as const,
	label: 'Mask wipe',
	paramsSchema: MaskWipeParamsSchema,
	defaults: () => ({ params: { direction: 'right', softness: 0.001 } })
} satisfies TransitionEffectDefinition<MaskWipeParams>;
