import type { OverlayRenderer } from '$lib/platform/pipelines/types';

import CanvasSource from './CanvasSource.svelte';
import Editor from './Editor.svelte';
import { terminalRunOverlayDefinition, type TerminalRunContent } from './definition';

export const terminalRunOverlayRenderer: OverlayRenderer<TerminalRunContent> = {
	...terminalRunOverlayDefinition,
	CanvasSource,
	Editor
};
