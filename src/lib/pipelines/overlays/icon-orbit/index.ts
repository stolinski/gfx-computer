import type { OverlayRenderer } from '$lib/platform/pipelines/types';

import CanvasSource from './CanvasSource.svelte';
import Editor from './Editor.svelte';
import { iconOrbitOverlayDefinition, type IconOrbitContent } from './definition';

export const iconOrbitOverlayRenderer: OverlayRenderer<IconOrbitContent> = {
	...iconOrbitOverlayDefinition,
	CanvasSource,
	Editor
};
