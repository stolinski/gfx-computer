import FigureCanvasSource from './CanvasSource.svelte';
import type { Figure } from '$lib/platform/engine-schema';
import type { BlockRenderer } from '$lib/platform/pipelines/types';
import { figureBlockDefinition } from './definition';

export const figureBlockRenderer: BlockRenderer<Figure> = {
	...figureBlockDefinition,
	CanvasSource: FigureCanvasSource
};
