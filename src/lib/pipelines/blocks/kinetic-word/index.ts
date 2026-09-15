import { KineticWordSchema, type KineticWord } from '$lib/platform/engine-schema';
import type { BlockRenderer } from '$lib/platform/pipelines/types';

import CanvasSource from './CanvasSource.svelte';
import { kineticWordBlockDefinition } from './definition';

/** One first-class word in an authored Type Field (ADR-0063). */
export const kineticWordBlockRenderer: BlockRenderer<KineticWord> = {
	...kineticWordBlockDefinition,
	schema: KineticWordSchema,
	CanvasSource
};
