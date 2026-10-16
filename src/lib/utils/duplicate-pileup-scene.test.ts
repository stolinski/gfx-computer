import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { resolveDuplicatePileupLayout, resolveDuplicatePileupScene } from './duplicate-pileup-scene';
import {
	DUPLICATE_PILEUP_DEFAULT_LAYOUT,
	DUPLICATE_PILEUP_DEFAULT_SIZES,
	type DuplicatePileupContent
} from '$lib/pipelines/overlays/duplicate-pileup/definition';

const DURATION = 10;

const content: DuplicatePileupContent = {
	panels: [
		{ kind: 'inbox', title: 'Primary', at: 0, item: 'Report', copies: [0.1, 0.3, 0.4] },
		{ kind: 'pull-requests', title: 'Pull requests', at: 0.2, item: 'Fix', number: 214, copies: [0.25, 0.45] }
	],
	restart: { label: 'process restarted', at: 0.2 },
	collapse: { label: 'runs once', at: 0.7 },
	...DUPLICATE_PILEUP_DEFAULT_LAYOUT,
	...DUPLICATE_PILEUP_DEFAULT_SIZES
};

function sceneAt(seconds: number) {
	return resolveDuplicatePileupScene(
		content,
		DUPLICATE_PILEUP_DEFAULT_LAYOUT,
		DUPLICATE_PILEUP_DEFAULT_SIZES,
		seconds,
		DURATION,
		3840,
		2160
	);
}

describe('resolveDuplicatePileupScene', () => {
	it('is a pure function of time', () => {
		assert.deepEqual(sceneAt(4.2), sceneAt(4.2));
	});

	it('shows a panel only once it appears', () => {
		assert.equal(sceneAt(1).panels.length, 1);
		assert.equal(sceneAt(3).panels.length, 2);
	});

	it('stacks copies newest on top, the later ones marked duplicate, and leans the panel', () => {
		const inbox = sceneAt(5).panels[0];
		assert.equal(inbox.count, 3);
		assert.deepEqual(
			inbox.rows.map((row) => row.isDuplicate),
			[true, true, false]
		);
		assert.ok(inbox.rows[0].y < inbox.rows[2].y);
		assert.notEqual(inbox.lean, 0);
	});

	it('highlights a duplicate as new when it lands, then lets the highlight fade', () => {
		assert.ok(sceneAt(3.05).panels[0].rows[0].fresh > 0.9);
		assert.equal(sceneAt(8).panels[0].rows[0].fresh, 0);
		assert.equal(sceneAt(5).panels[0].rows[2].fresh, 0);
	});

	it('counts pull request numbers up from the first', () => {
		const pulls = sceneAt(5).panels[1];
		assert.deepEqual(
			pulls.rows.map((row) => row.number),
			[215, 214]
		);
	});

	it('folds every duplicate into the real copy and straightens the panels', () => {
		const scene = sceneAt(9);
		for (const panel of scene.panels) {
			assert.equal(panel.isClean, true);
			assert.equal(panel.count, 1);
			assert.ok(panel.lean === 0);
			for (const row of panel.rows) {
				assert.ok(row.y === 0);
				assert.equal(row.opacity, row.isDuplicate ? 0 : 1);
			}
		}
		assert.ok(scene.collapse && scene.collapse.opacity === 1);
	});

	it('shows the restart stamp for a moment, then lets it go', () => {
		assert.ok(sceneAt(2.5).restart);
		assert.equal(sceneAt(6).restart, undefined);
	});
});

describe('resolveDuplicatePileupLayout', () => {
	it('uses an orientation’s own snapshot when it has one', () => {
		const vertical = { x: 0.1, y: 0.1, width: 0.8, height: 0.3, arrangement: 'column' as const };
		assert.equal(
			resolveDuplicatePileupLayout(DUPLICATE_PILEUP_DEFAULT_LAYOUT, { vertical }, 'vertical'),
			vertical
		);
	});
});
