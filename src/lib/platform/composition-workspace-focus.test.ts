import { describe, expect, it } from 'vite-plus/test';

import {
	COMPOSITION_WORKSPACE_FOCUS_TARGETS,
	moveCompositionWorkspaceFocus
} from './composition-workspace-focus';
import { inspectorRailMode } from './inspector-rail-mode.svelte';
import { inspectorFocus, layerSelection } from './selection.svelte';
import { WEBMCP_OPERATION_INVENTORY } from './webmcp-operation-inventory';

describe('composition workspace focus', () => {
	it('reveals the composition root by clearing the layer selection', () => {
		moveCompositionWorkspaceFocus({ target: 'overlay', overlayId: 'headline' });
		moveCompositionWorkspaceFocus({ target: 'composition-root' });

		expect(layerSelection.id).toBeNull();
		expect(inspectorRailMode.mode).toBe('inspector');
	});

	it('selects the timeline row that owns each focused entity', () => {
		moveCompositionWorkspaceFocus({ target: 'surface' });
		expect(layerSelection.id).toBe('surface');

		moveCompositionWorkspaceFocus({ target: 'overlay', overlayId: 'headline' });
		expect(layerSelection.id).toBe('overlay:headline');

		moveCompositionWorkspaceFocus({ target: 'block', blockId: 'node-1' });
		expect(layerSelection.id).toBe('block:node-1');

		moveCompositionWorkspaceFocus({ target: 'mark', markIndex: 2 });
		expect(layerSelection.id).toBe('mark:2');

		moveCompositionWorkspaceFocus({ target: 'text-animation', textAnimationId: 'anim-1' });
		expect(layerSelection.id).toBe('text-animation:anim-1');

		moveCompositionWorkspaceFocus({ target: 'captions' });
		expect(layerSelection.id).toBe('captions');

		moveCompositionWorkspaceFocus({ target: 'video-clip', clipId: 'clip-1' });
		expect(layerSelection.id).toBe('video-clip:clip-1');

		moveCompositionWorkspaceFocus({
			target: 'sound-cue',
			reference: { kind: 'manual', cueId: 'cue-1' }
		});
		expect(layerSelection.id).toBe('sound-reference:manual:cue-1');

		moveCompositionWorkspaceFocus({ target: 'stage-camera' });
		expect(layerSelection.id).toBe('stage-camera');

		moveCompositionWorkspaceFocus({ target: 'stage-focus' });
		expect(layerSelection.id).toBe('stage-focus');

		moveCompositionWorkspaceFocus({ target: 'stage-body', bodyId: 'screen' });
		expect(layerSelection.id).toBe('stage-body:screen');
	});

	it('reveals an Effect as a named row of the composition-root inspector', () => {
		moveCompositionWorkspaceFocus({ target: 'effect', effectId: 'paper-grain-1' });

		expect(layerSelection.id).toBeNull();
		expect(inspectorFocus.target).toBe('effect:paper-grain-1');
	});

	it('switches the rail to Media so a Media library focus is actually visible', () => {
		moveCompositionWorkspaceFocus({ target: 'media-library' });
		expect(inspectorRailMode.mode).toBe('media');

		moveCompositionWorkspaceFocus({ target: 'surface' });
		expect(inspectorRailMode.mode).toBe('inspector');
	});

	it('covers every focus a write or history operation declares', () => {
		const workspaceTargets = new Set<string>(COMPOSITION_WORKSPACE_FOCUS_TARGETS);
		for (const row of WEBMCP_OPERATION_INVENTORY.filter(
			(entry) => entry.effect === 'write' || entry.effect === 'history'
		)) {
			expect(row.focus.length, `${row.id} declares no focus`).toBeGreaterThan(0);
			for (const target of row.focus) {
				expect(
					workspaceTargets.has(target),
					`${row.id} focuses ${target}, which the Workspace cannot reveal`
				).toBe(true);
			}
		}
	});
});
