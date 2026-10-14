import type { DiagramCode } from '$lib/platform/engine-schema';
import type { BlockRenderer } from '$lib/platform/pipelines/types';

import CanvasSource from './CanvasSource.svelte';
import { codeBlockDefinition } from './definition';

// Code Block: a syntax-highlighted panel that walks through Code steps with a
// magic move between them. Mounted by DiagramMount; shape validated by the
// Preset schema's `surface.diagram[]` union.
export const codeBlockRenderer: BlockRenderer<DiagramCode> = {
	...codeBlockDefinition,
	CanvasSource
};
