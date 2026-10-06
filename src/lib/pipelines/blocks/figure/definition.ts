import { FigureSchema } from '$lib/platform/engine-schema';
import type { BlockPipelineDefinition } from '$lib/platform/pipelines/definition-types';

// The single Figure Block Pipeline (ADR-0067 §2). Every kind renders through
// it; `kind` selects the scene builder in src/lib/utils/figure-scene-prepare.ts.
export const figureBlockDefinition = {
	type: 'figure',
	schema: FigureSchema
} satisfies BlockPipelineDefinition<'figure'>;
