import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { FIGURE_KINDS, FigureSchema, type Figure, type FigureKind } from './engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from './figure-target-declarations.fixture';
import { validateFigureGroupSemantics } from './figure-validation';

function parseTarget<Kind extends FigureKind>(kind: Kind): Extract<Figure, { kind: Kind }> {
	return FigureSchema.parse(FIGURE_TARGET_DECLARATIONS[kind]) as Extract<Figure, { kind: Kind }>;
}

function issuesFor(figure: Figure): string[] {
	return validateFigureGroupSemantics([figure], new Set()).map(
		(issue) => `${issue.path.join('.')}: ${issue.message}`
	);
}

describe('Figure target declarations (ADR-0067 §9)', () => {
	it('declares exactly one target per registered kind', () => {
		assert.deepEqual(Object.keys(FIGURE_TARGET_DECLARATIONS).sort(), [...FIGURE_KINDS].sort());
	});

	for (const kind of FIGURE_KINDS) {
		it(`${kind} parses and validates cleanly`, () => {
			const figure = parseTarget(kind);
			assert.equal(figure.kind, kind);
			assert.deepEqual(issuesFor(figure), []);
		});
	}
});

describe('validateFigureGroupSemantics', () => {
	it('rejects duplicate Figure ids and collisions with other Surface Blocks', () => {
		const tree = parseTarget('tree');
		const issues = validateFigureGroupSemantics([tree, tree], new Set(['languages']));
		assert.ok(issues.some((issue) => issue.message.includes('Duplicate Figure id')));
		assert.ok(issues.some((issue) => issue.message.includes('collides')));
	});

	it('requires exactly one reveal and keeps every Move inside it and the exit', () => {
		const figure = parseTarget('cycle');
		const noReveal: Figure = {
			...figure,
			moves: figure.moves.filter((move) => move.move !== 'reveal')
		};
		assert.ok(issuesFor(noReveal).some((issue) => issue.includes('exactly one reveal')));

		const early: Figure = {
			...figure,
			moves: [
				{ move: 'reveal', style: 'draw', start: 0.3, duration: 0.1 },
				{ move: 'flow', start: 0.1, duration: 0.1, cycles: 1 }
			]
		};
		assert.ok(issuesFor(early).some((issue) => issue.includes('before the reveal')));

		const late: Figure = {
			...figure,
			moves: [
				{ move: 'reveal', style: 'draw', start: 0, duration: 0.1 },
				{ move: 'flow', start: 0.2, duration: 0.6, cycles: 1 },
				{ move: 'exit', style: 'fade', start: 0.5, duration: 0.1 }
			]
		};
		assert.ok(issuesFor(late).some((issue) => issue.includes('before the exit')));
	});

	it('refuses overshooting eases on quantities but allows them on structure', () => {
		const race = parseTarget('bar-race');
		const bouncy: Figure = {
			...race,
			moves: [
				{ move: 'reveal', style: 'grow', start: 0, duration: 0.1, ease: 'bouncy' },
				{ move: 'advance', from: 0, to: 3, start: 0.1, duration: 0.5, ease: 'settled' }
			]
		};
		const issues = issuesFor(bouncy);
		assert.equal(issues.filter((issue) => issue.includes('overshooting')).length, 2);

		const net = parseTarget('neural-network');
		assert.equal(net.moves[0].ease, 'settled');
		assert.deepEqual(issuesFor(net), []);
	});

	it('checks advance ranges per kind', () => {
		const slope = parseTarget('slope');
		const outOfRange: Figure = {
			...slope,
			moves: [
				{ move: 'reveal', style: 'draw', start: 0, duration: 0.1 },
				{ move: 'advance', from: 0, to: 9, start: 0.1, duration: 0.5 }
			]
		};
		assert.ok(issuesFor(outOfRange).some((issue) => issue.includes('outside 0–4')));

		const tree = parseTarget('tree');
		const wrongKind: Figure = {
			...tree,
			moves: [
				{ move: 'reveal', style: 'grow', start: 0, duration: 0.1 },
				{ move: 'advance', from: 0, to: 1, start: 0.1, duration: 0.5 }
			]
		};
		assert.ok(issuesFor(wrongKind).some((issue) => issue.includes('advance is for')));
	});

	it('reports orphan Pins instead of dropping them', () => {
		const net = parseTarget('neural-network');
		const shrunk: Figure = {
			...net,
			data: {
				...net.data,
				layers: net.data.layers.map((layer) =>
					layer.id === 'out' ? { ...layer, size: 1, nodeLabels: ['3'] } : layer
				),
				activations: undefined
			},
			encoding: { ...net.encoding, nodeBrightness: 'uniform' }
		};
		const issues = issuesFor(shrunk);
		assert.ok(
			issues.some(
				(issue) =>
					issue.startsWith('figures.0.pins.0.mark') && issue.includes('no longer generates')
			)
		);
	});

	it('only lets node Marks take a Pin position', () => {
		const race = parseTarget('bar-race');
		const pinned: Figure = { ...race, pins: [{ mark: 'bar:us', position: { x: 0.5, y: 0.5 } }] };
		assert.ok(issuesFor(pinned).some((issue) => issue.includes('only node Marks')));
	});

	it('requires one root and no cycles in a hierarchy', () => {
		const tree = parseTarget('tree');
		const twoRoots: Figure = {
			...tree,
			data: { nodes: [...tree.data.nodes, { id: 'basque', label: 'Basque' }] }
		};
		assert.ok(issuesFor(twoRoots).some((issue) => issue.includes('exactly one root')));

		const looped: Figure = {
			...tree,
			data: {
				nodes: tree.data.nodes.map((node) =>
					node.id === 'germanic' ? { ...node, parent: 'english' } : node
				)
			}
		};
		assert.ok(issuesFor(looped).some((issue) => issue.includes('its own ancestor')));
	});

	it('rejects a cyclic Sankey and unknown link ends', () => {
		const sankey = parseTarget('sankey');
		const cyclic: Figure = {
			...sankey,
			data: {
				...sankey.data,
				links: [...sankey.data.links, { source: 'homes', target: 'gas', value: 1 }]
			}
		};
		assert.ok(issuesFor(cyclic).some((issue) => issue.includes('cycle')));

		const dangling: Figure = {
			...sankey,
			data: { ...sankey.data, links: [{ source: 'gas', target: 'nowhere', value: 1 }] }
		};
		assert.ok(issuesFor(dangling).some((issue) => issue.includes('Unknown node "nowhere"')));
	});

	it('needs treemap leaves to carry values and branches not to', () => {
		const treemap = parseTarget('treemap');
		const broken: Figure = {
			...treemap,
			data: {
				...treemap.data,
				nodes: treemap.data.nodes.map((node) =>
					node.id === 'defense'
						? { ...node, value: undefined }
						: node.id === 'mandatory'
							? { ...node, value: 1 }
							: node
				)
			}
		};
		const issues = issuesFor(broken);
		assert.ok(issues.some((issue) => issue.includes('Leaf "defense" needs a value')));
		assert.ok(issues.some((issue) => issue.includes('Branch "mandatory"')));
	});

	it('requires a network propagate path to follow links', () => {
		const network = parseTarget('network');
		const broken: Figure = {
			...network,
			moves: [
				{ move: 'reveal', style: 'cascade', start: 0, duration: 0.1 },
				{ move: 'propagate', path: ['hal', 'ada'], start: 0.1, duration: 0.2, repeat: 1 }
			]
		};
		assert.ok(issuesFor(broken).some((issue) => issue.includes('No link joins')));
	});

	it('keeps line points ascending and events inside the data', () => {
		const line = parseTarget('line');
		const broken: Figure = {
			...line,
			data: {
				...line.data,
				series: [
					{
						...line.data.series[0],
						points: [
							{ x: 2000, y: 1 },
							{ x: 1990, y: 2 }
						]
					}
				],
				events: [{ id: 'later', x: 2050, label: 'Later' }]
			},
			moves: [{ move: 'reveal', style: 'fade', start: 0, duration: 0.1 }]
		};
		const issues = issuesFor(broken);
		assert.ok(issues.some((issue) => issue.includes('strictly ascending')));
		assert.ok(issues.some((issue) => issue.includes('outside the data')));
	});

	it('rejects reserved separators in data ids at parse time', () => {
		const tree = structuredClone(FIGURE_TARGET_DECLARATIONS.tree) as {
			data: { nodes: { id: string }[] };
		};
		tree.data.nodes[1].id = 'bad:id';
		assert.equal(FigureSchema.safeParse(tree).success, false);
	});
});
