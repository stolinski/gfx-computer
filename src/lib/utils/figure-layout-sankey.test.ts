import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { FigureSchema, type SankeyFigure } from '$lib/platform/engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from '$lib/platform/figure-target-declarations.fixture';
import { figureSankeyRibbonPath, layoutFigureSankey } from './figure-layout-sankey';

const sankey = FigureSchema.parse(FIGURE_TARGET_DECLARATIONS.sankey) as SankeyFigure;
const box = { x: 200, y: 300, width: 3200, height: 1400 };
const options = { nodeAlign: 'justify', nodeThickness: 36, nodeGap: 40 } as const;

describe('layoutFigureSankey', () => {
	it('flows left to right with ribbon widths proportional to value', () => {
		const layout = layoutFigureSankey(sankey.data.nodes, sankey.data.links, box, {
			...options,
			direction: 'right'
		});
		const gas = layout.nodes.find((node) => node.id === 'gas');
		const grid = layout.nodes.find((node) => node.id === 'grid');
		assert.ok(gas && grid && gas.rect.x < grid.rect.x);
		const lost = layout.links.find((link) => link.target === 'lost');
		const homes = layout.links.find((link) => link.target === 'homes');
		assert.ok(lost && homes);
		assert.ok(Math.abs(lost.width / homes.width - 24 / 5) < 0.01);
		assert.equal(layout.layerCount, 3);
	});

	it('flows top to bottom when direction is down, and stays deterministic', () => {
		const layout = layoutFigureSankey(sankey.data.nodes, sankey.data.links, box, {
			...options,
			direction: 'down'
		});
		const gas = layout.nodes.find((node) => node.id === 'gas');
		const grid = layout.nodes.find((node) => node.id === 'grid');
		assert.ok(gas && grid && gas.rect.y < grid.rect.y);
		assert.deepEqual(
			layout,
			layoutFigureSankey(sankey.data.nodes, sankey.data.links, box, {
				...options,
				direction: 'down'
			})
		);
	});

	it('draws ribbons as closed paths, partially by progress', () => {
		const layout = layoutFigureSankey(sankey.data.nodes, sankey.data.links, box, {
			...options,
			direction: 'right'
		});
		const path = figureSankeyRibbonPath(layout.links[0], 'right', 0.5);
		assert.ok(path.startsWith('M') && path.endsWith('Z'));
	});
});
