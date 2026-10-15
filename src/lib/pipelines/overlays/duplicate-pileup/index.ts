import type { OverlayRenderer } from '$lib/platform/pipelines/types';

import CanvasSource from './CanvasSource.svelte';
import Editor from './Editor.svelte';
import { duplicatePileupOverlayDefinition, type DuplicatePileupContent } from './definition';

export const duplicatePileupOverlayRenderer: OverlayRenderer<DuplicatePileupContent> = {
	...duplicatePileupOverlayDefinition,
	CanvasSource,
	Editor
};
