import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { resolveIconOrbitRing, resolveIconOrbitScene } from './icon-orbit-scene';

const icons = [
	{ icon: 'storage', label: 'STORAGE', launch: 0, launchX: 0.3, angle: 0, height: 0.3 },
	{ icon: 'queue', label: 'QUEUE', launch: 0, launchX: 0.7, angle: 180, height: 0.3 }
];
const base = {
	icons,
	pass: 'all' as const,
	centerX: 0.5,
	radius: 0.3,
	turnDegreesPerSecond: 0,
	tilt: 0.2,
	iconSize: 10,
	glow: 1
};

describe('resolveIconOrbitScene', () => {
	it('draws front icons nearer, larger, and sharper than icons behind the subject', () => {
		const scene = resolveIconOrbitScene(base, 8, 10, 3840, 2160);
		const front = scene.find((item) => item.icon === 'storage');
		const behind = scene.find((item) => item.icon === 'queue');
		assert.ok(front && behind);
		assert.ok(front.size > behind.size);
		assert.ok(front.depthBlur < behind.depthBlur);
		assert.ok(front.y > behind.y, 'the tilted ring carries the front low and the back high');
		assert.equal(scene.at(-1)?.icon, 'storage', 'nearer icons paint last');
	});

	it('keeps only the icons on its side of the subject for a pass', () => {
		const behind = resolveIconOrbitScene({ ...base, pass: 'behind' }, 8, 10, 3840, 2160);
		const front = resolveIconOrbitScene({ ...base, pass: 'front' }, 8, 10, 3840, 2160);
		assert.deepEqual(
			behind.map((item) => item.icon),
			['queue']
		);
		assert.deepEqual(
			front.map((item) => item.icon),
			['storage']
		);
	});

	it('draws nothing before an icon launches', () => {
		const late = [{ ...icons[0], launch: 0.5 }];
		assert.equal(resolveIconOrbitScene({ ...base, icons: late }, 2, 10, 3840, 2160).length, 0);
	});
});

describe('resolveIconOrbitRing', () => {
	it('uses an orientation snapshot whole, and the shared ring otherwise', () => {
		const shared = { centerX: 0.5, radius: 0.3, tilt: 0.18, iconSize: 11 };
		const vertical = { centerX: 0.5, radius: 0.4, tilt: 0.12, iconSize: 13 };
		assert.equal(resolveIconOrbitRing(shared, { vertical }, 'vertical'), vertical);
		assert.equal(resolveIconOrbitRing(shared, { vertical }, 'horizontal'), shared);
	});
});
