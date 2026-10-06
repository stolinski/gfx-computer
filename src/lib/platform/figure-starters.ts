import type { Figure, FigureKind } from './engine-schema';

/**
 * The Figure a GUI author starts from when adding a kind (ADR-0067 §7): a small,
 * complete, valid declaration with a reveal and the kind's signature Move.
 * Agents normally write a full declaration instead; data is then replaced by
 * file import or an agent.
 */
export function createStarterFigure(kind: FigureKind, id: string): Figure {
	const base = { type: 'figure' as const, id };
	switch (kind) {
		case 'neural-network':
			return {
				...base,
				kind,
				title: 'Neural network',
				data: {
					layers: [
						{ id: 'input', label: 'Input', size: 3 },
						{ id: 'hidden', label: 'Hidden', size: 4 },
						{ id: 'output', label: 'Output', size: 2, nodeLabels: ['Yes', 'No'] }
					],
					activations: [
						[0.9, 0.3, 0.6],
						[0.2, 0.8, 0.5, 0.7],
						[0.86, 0.14]
					],
					weightSeed: 1
				},
				layout: { direction: 'right', nodeScale: 1 },
				layoutOrientationOverrides: { vertical: { direction: 'down', nodeScale: 1 } },
				encoding: { nodeBrightness: 'activation', linkWidth: 'weight', linkColor: 'sign' },
				moves: [
					{ move: 'reveal', style: 'cascade', start: 0.05, duration: 0.25 },
					{ move: 'propagate', start: 0.35, duration: 0.4, repeat: 1 }
				]
			};
		case 'tree':
			return {
				...base,
				kind,
				title: 'Tree',
				data: {
					nodes: [
						{ id: 'root', label: 'Root' },
						{ id: 'left', label: 'Left', parent: 'root' },
						{ id: 'right', label: 'Right', parent: 'root' },
						{ id: 'left-a', label: 'Left A', parent: 'left' },
						{ id: 'left-b', label: 'Left B', parent: 'left' },
						{ id: 'right-a', label: 'Right A', parent: 'right' }
					]
				},
				layout: { direction: 'down', nodeScale: 1 },
				layoutOrientationOverrides: { vertical: { direction: 'right', nodeScale: 1 } },
				encoding: { nodeColor: 'branch' },
				moves: [{ move: 'reveal', style: 'grow', start: 0.05, duration: 0.4 }]
			};
		case 'network':
			return {
				...base,
				kind,
				title: 'Network',
				data: {
					nodes: [
						{ id: 'a', label: 'A', value: 4 },
						{ id: 'b', label: 'B', value: 2 },
						{ id: 'c', label: 'C', value: 3 },
						{ id: 'd', label: 'D', value: 1 },
						{ id: 'e', label: 'E', value: 2 }
					],
					links: [
						{ source: 'a', target: 'b' },
						{ source: 'a', target: 'c' },
						{ source: 'c', target: 'd' },
						{ source: 'b', target: 'e' },
						{ source: 'd', target: 'e' }
					]
				},
				layout: { seed: 1, spread: 1, labels: 'all' },
				encoding: { nodeSize: 'value', nodeColor: 'uniform', linkWidth: 'uniform' },
				moves: [{ move: 'reveal', style: 'cascade', start: 0.05, duration: 0.3 }]
			};
		case 'cycle':
			return {
				...base,
				kind,
				title: 'Cycle',
				data: {
					steps: [
						{ id: 'plan', label: 'Plan' },
						{ id: 'build', label: 'Build' },
						{ id: 'measure', label: 'Measure' },
						{ id: 'learn', label: 'Learn' }
					]
				},
				layout: { startAngle: 0, direction: 'clockwise', aspect: 'circle' },
				encoding: { stepColor: 'sequence' },
				moves: [
					{ move: 'reveal', style: 'draw', start: 0.05, duration: 0.3 },
					{ move: 'flow', start: 0.4, duration: 0.5, cycles: 3 }
				]
			};
		case 'bar-race':
			return {
				...base,
				kind,
				title: 'Race',
				data: {
					entities: [
						{ id: 'a', label: 'A' },
						{ id: 'b', label: 'B' },
						{ id: 'c', label: 'C' },
						{ id: 'd', label: 'D' }
					],
					frames: [
						{
							label: '2020',
							values: [
								{ entityId: 'a', value: 40 },
								{ entityId: 'b', value: 30 },
								{ entityId: 'c', value: 20 },
								{ entityId: 'd', value: 10 }
							]
						},
						{
							label: '2024',
							values: [
								{ entityId: 'a', value: 45 },
								{ entityId: 'b', value: 60 },
								{ entityId: 'c', value: 25 },
								{ entityId: 'd', value: 50 }
							]
						}
					],
					valueFormat: { precision: 0 }
				},
				layout: { visibleCount: 4 },
				encoding: { barColor: 'entity' },
				moves: [
					{ move: 'reveal', style: 'grow', start: 0.05, duration: 0.15 },
					{ move: 'advance', from: 0, to: 1, start: 0.25, duration: 0.6 }
				]
			};
		case 'line':
			return {
				...base,
				kind,
				title: 'Trend',
				data: {
					series: [
						{
							id: 'value',
							label: 'Value',
							points: [
								{ x: 2020, y: 12 },
								{ x: 2021, y: 18 },
								{ x: 2022, y: 15 },
								{ x: 2023, y: 24 },
								{ x: 2024, y: 31 }
							]
						}
					],
					xFormat: 'year',
					yFormat: { precision: 0 }
				},
				layout: { baseline: 'zero' },
				encoding: { seriesColor: 'series' },
				moves: [
					{ move: 'reveal', style: 'fade', start: 0.05, duration: 0.1 },
					{ move: 'advance', from: 2020, to: 2024, start: 0.15, duration: 0.6 }
				]
			};
		case 'slope':
			return {
				...base,
				kind,
				title: 'Before and after',
				data: {
					periods: [
						{ id: 'before', label: 'Before' },
						{ id: 'after', label: 'After' }
					],
					entities: [
						{ id: 'a', label: 'A', values: [30, 50] },
						{ id: 'b', label: 'B', values: [45, 35] },
						{ id: 'c', label: 'C', values: [20, 25] }
					],
					valueFormat: { precision: 0 }
				},
				layout: { mode: 'value' },
				encoding: { lineColor: 'entity' },
				moves: [
					{ move: 'reveal', style: 'fade', start: 0.05, duration: 0.1 },
					{ move: 'advance', from: 0, to: 1, start: 0.2, duration: 0.5 }
				]
			};
		case 'sankey':
			return {
				...base,
				kind,
				title: 'Flow',
				data: {
					nodes: [
						{ id: 'a', label: 'Source A' },
						{ id: 'b', label: 'Source B' },
						{ id: 'hub', label: 'Hub' },
						{ id: 'x', label: 'Use X' },
						{ id: 'y', label: 'Use Y' }
					],
					links: [
						{ source: 'a', target: 'hub', value: 6 },
						{ source: 'b', target: 'hub', value: 4 },
						{ source: 'hub', target: 'x', value: 7 },
						{ source: 'hub', target: 'y', value: 3 }
					],
					valueFormat: { precision: 0 }
				},
				layout: { direction: 'right', nodeAlign: 'justify' },
				layoutOrientationOverrides: { vertical: { direction: 'down', nodeAlign: 'justify' } },
				encoding: { linkColor: 'source' },
				moves: [
					{ move: 'reveal', style: 'grow', start: 0.05, duration: 0.3 },
					{ move: 'flow', start: 0.4, duration: 0.5, cycles: 3 }
				]
			};
		case 'treemap':
			return {
				...base,
				kind,
				title: 'Breakdown',
				data: {
					nodes: [
						{ id: 'total', label: 'Total' },
						{ id: 'group-a', label: 'Group A', parent: 'total' },
						{ id: 'group-b', label: 'Group B', parent: 'total' },
						{ id: 'a1', label: 'A1', parent: 'group-a', value: 40 },
						{ id: 'a2', label: 'A2', parent: 'group-a', value: 25 },
						{ id: 'b1', label: 'B1', parent: 'group-b', value: 20 },
						{ id: 'b2', label: 'B2', parent: 'group-b', value: 15 }
					],
					valueFormat: { precision: 0 }
				},
				layout: { padding: 'airy', labels: 'leaves' },
				encoding: { color: 'top-level' },
				moves: [{ move: 'reveal', style: 'grow', start: 0.05, duration: 0.3 }]
			};
	}
}
