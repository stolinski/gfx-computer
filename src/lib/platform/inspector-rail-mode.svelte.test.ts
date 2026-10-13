import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { createInspectorRailModeManager } from './inspector-rail-mode.svelte';

describe('InspectorRailModeManager', () => {
	it('defaults to Inspector mode', () => {
		const manager = createInspectorRailModeManager();

		assert.equal(manager.mode, 'inspector');
	});

	it('switches explicitly between Inspector and Media modes', () => {
		const manager = createInspectorRailModeManager();

		manager.switchToMedia();
		assert.equal(manager.mode, 'media');

		manager.switchToInspector();
		assert.equal(manager.mode, 'inspector');
	});
});
