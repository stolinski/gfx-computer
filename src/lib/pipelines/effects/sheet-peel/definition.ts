import { z } from 'zod';
import type { TransitionEffectDefinition } from '$lib/platform/pipelines/definition-types';

const SheetPeelParamsSchema = z.object({
	direction: z.enum(['right', 'left', 'down', 'up']).default('right'),
	curl: z.number().min(0.04).max(0.35).default(0.16),
	perspective: z.number().min(0).max(1).default(0.55),
	shadow: z.number().min(0).max(1).default(0.42),
	highlight: z.number().min(0).max(1).default(0.35)
});
export type SheetPeelParams = z.infer<typeof SheetPeelParamsSchema>;

export const sheetPeelTransitionEffectDefinition = {
	type: 'sheet-peel' as const,
	label: 'Sheet peel',
	paramsSchema: SheetPeelParamsSchema,
	defaults: () => ({
		params: { direction: 'right', curl: 0.16, perspective: 0.55, shadow: 0.42, highlight: 0.35 }
	})
} satisfies TransitionEffectDefinition<SheetPeelParams>;
