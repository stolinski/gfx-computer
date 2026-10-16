import type { OverlayRenderer } from '$lib/platform/pipelines/types';

import CanvasSource from './CanvasSource.svelte';
import Editor from './Editor.svelte';
import { actionsRunOverlayDefinition, type ActionsRunContent } from './definition';

export const actionsRunOverlayRenderer: OverlayRenderer<ActionsRunContent> = {
	...actionsRunOverlayDefinition,
	CanvasSource,
	Editor
};
