import type { OverlayRenderer } from '$lib/platform/pipelines/types';

import CanvasSource from './CanvasSource.svelte';
import Editor from './Editor.svelte';
import { multiplayerSessionOverlayDefinition, type MultiplayerSessionContent } from './definition';

export const multiplayerSessionOverlayRenderer: OverlayRenderer<MultiplayerSessionContent> = {
	...multiplayerSessionOverlayDefinition,
	CanvasSource,
	Editor
};
