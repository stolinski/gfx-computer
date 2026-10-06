import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { FigureSchema, type TreeFigure, type TreemapFigure } from '$lib/platform/engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from '$lib/platform/figure-target-declarations.fixture';
import { layoutFigureTree, layoutFigureTreemap } from './figure-layout-hierarchy';

const tree = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS.tree) as TreeFigure;
const treemap = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS.treemap) as TreemapFigure;
const box = { x: 200, y: 300, width: 3200, height: 1400 };

function inside(point: { x: number; y: number }): boolean {
	return (
		point.x >= box.x - 0.01 &&
		point.x <= box.x + box.width + 0.01 &&
		point.y >= box.y - 0.01 &&
		point.y <= box.y + box.height + 0.01
	);
}

describe('layoutFigureTree', () => {
	for (const direction of ['down', 'right', 'radial'] as const) {
		it(`keeps every node inside the box (${direction}) and is deterministic`, () => {
			const layout = layoutFigureTree(tree.data.nodes, box, direction);
			assert.equal(layout.nodes.length, tree.data.nodes.length);
			assert.ok(layout.nodes.every((node) => inside(node.center)));
			assert.deepEqual(layout, layoutFigureTree(tree.data.nodes, box, direction));
		});
	}

	it('puts the root at depth 0 and names each node’s branch', () => {
		const layout = layoutFigureTree(tree.data.nodes, box, 'down');
		const root = layout.nodes.find((node) => node.id === 'pie');
		assert.equal(root?.depth, 0);
		assert.equal(layout.nodes.find((node) => node.id === 'english')?.branchId, 'germanic');
		assert.equal(layout.maxDepth, 3);
	});
});

describe('layoutFigureTreemap', () => {
	it('gives leaves areas proportional to value', () => {
		const cells = layoutFigureTreemap(treemap.data.nodes, box, 8, 60);
		const leaves = cells.filter((cell) => cell.isLeaf);
		const ratio = (cell: (typeof leaves)[number]): number =>
			(cell.rect.width * cell.rect.height) / cell.value;
		const ss = leaves.find((cell) => cell.id === 'social-security');
		const medicaid = leaves.find((cell) => cell.id === 'medicaid');
		assert.ok(ss && medicaid);
		// Padding skews small cells slightly; area per value stays within 25%.
		assert.ok(Math.abs(ratio(ss) / ratio(medicaid) - 1) < 0.25);
		assert.ok(cells.every((cell) => inside(cell.rect)));
		assert.deepEqual(cells, layoutFigureTreemap(treemap.data.nodes, box, 8, 60));
	});

	it('never strands a small sibling as a sliver among a few skewed ones', () => {
		const nodes = [
			{ id: 'root', label: 'Root' },
			{ id: 'group', label: 'Group', parent: 'root' },
			{ id: 'big', label: 'Big', parent: 'group', value: 10490 },
			{ id: 'mid', label: 'Mid', parent: 'group', value: 6896 },
			{ id: 'small', label: 'Small', parent: 'group', value: 818 }
		];
		const cells = layoutFigureTreemap(nodes, { x: 0, y: 0, width: 3000, height: 1500 }, 16, 60);
		const small = cells.find((cell) => cell.id === 'small');
		assert.ok(small);
		const aspect =
			Math.max(small.rect.width, small.rect.height) / Math.min(small.rect.width, small.rect.height);
		// Squarify alone strands this cell as a ~1:24 strip; balanced tiling keeps it under half that.
		assert.ok(aspect < 12, `aspect ${aspect}`);
	});
});
