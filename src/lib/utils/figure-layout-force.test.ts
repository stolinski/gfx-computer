import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { FigureSchema, type NetworkFigure } from '$lib/platform/engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from '$lib/platform/figure-target-declarations.fixture';
import { layoutFigureForce } from './figure-layout-force';

const network = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS.network) as NetworkFigure;
const box = { x: 300, y: 300, width: 3200, height: 1500 };
const nodes = network.data.nodes.map((node) => ({ id: node.id, radius: 40 }));

describe('layoutFigureForce', () => {
	it('is deterministic for a seed and changes with the seed', () => {
		const a = layoutFigureForce(nodes, network.data.links, box, {
			seed: 11,
			spread: 1,
			labelReserve: 60
		});
		const b = layoutFigureForce(nodes, network.data.links, box, {
			seed: 11,
			spread: 1,
			labelReserve: 60
		});
		const c = layoutFigureForce(nodes, network.data.links, box, {
			seed: 12,
			spread: 1,
			labelReserve: 60
		});
		assert.deepEqual([...a.entries()], [...b.entries()]);
		assert.notDeepEqual([...a.entries()], [...c.entries()]);
	});

	it('fits every node and its label inside the box', () => {
		const positions = layoutFigureForce(nodes, network.data.links, box, {
			seed: 11,
			spread: 1,
			labelReserve: 60
		});
		for (const point of positions.values()) {
			assert.ok(point.x - 40 >= box.x - 1 && point.x + 40 <= box.x + box.width + 1);
			assert.ok(point.y - 40 >= box.y - 1 && point.y + 100 <= box.y + box.height + 1);
		}
	});
});
