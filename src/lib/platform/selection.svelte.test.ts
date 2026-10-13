import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vite-plus/test';

import {
	createTimelineTrackId,
	createVideoClipSelectionId,
	type VideoClipSelectionId
} from './timeline-entity-identity.ts';
import {
	canvasElementSelection,
	deselectLayer,
	inspectorFocus,
	keyframeSelection,
	layerSelection,
	requestInspectorFocus,
	selectKeyframe,
	selectLayer,
	selectVideoClip,
	setCanvasElementSelection
} from './selection.svelte.ts';

describe('timeline selection', () => {
	afterEach(() => {
		deselectLayer();
	});

	it('selects a video clip by typed identity and clears entity-specific state', () => {
		const trackId = createTimelineTrackId({ kind: 'overlay', overlayId: 'hero' });
		selectKeyframe(trackId, 'opacity', 2);
		requestInspectorFocus('slot:title');
		const expectedSelectionId: VideoClipSelectionId = createVideoClipSelectionId('clip:launch/β');

		selectVideoClip('clip:launch/β');

		assert.equal(layerSelection.id, expectedSelectionId);
		assert.equal(keyframeSelection.id, null);
		assert.equal(inspectorFocus.target, null);
	});

	it('tracks compatible canvas peers while keeping one primary timeline selection', () => {
		const primaryTrack = createTimelineTrackId({ kind: 'overlay', overlayId: 'title' });
		selectLayer(primaryTrack);
		setCanvasElementSelection(['block:caption', 'overlay:title'], 'overlay:title');

		assert.deepEqual(canvasElementSelection.keys, ['block:caption', 'overlay:title']);
		assert.equal(canvasElementSelection.primaryKey, 'overlay:title');
		assert.equal(layerSelection.id, primaryTrack);

		selectLayer(createTimelineTrackId({ kind: 'block', blockId: 'caption' }));
		assert.deepEqual(canvasElementSelection.keys, []);
		assert.equal(canvasElementSelection.primaryKey, null);
	});

	it('deselects a selected video clip and clears related selection state', () => {
		const trackId = createTimelineTrackId({ kind: 'block', blockId: 'quote' });
		selectVideoClip('opening-clip');
		selectKeyframe(trackId, 'scale', 1);
		requestInspectorFocus('slot:quote');

		deselectLayer();

		assert.equal(layerSelection.id, null);
		assert.equal(keyframeSelection.id, null);
		assert.equal(inspectorFocus.target, null);
	});
});
