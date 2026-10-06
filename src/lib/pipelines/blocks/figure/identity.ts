import type { IdentitySpec } from '$lib/platform/pipelines/identity';

// Stable Figure identity (ADR-0067). Appearance concedes to the active Pack
// through the chart Roles; generated geometry, Moves, and honest-motion rules
// remain intrinsic to the Pipeline and its scene builders.
function figureRoleDimension(
	name: string,
	viaPack: string,
	definition: string
): IdentitySpec['dimensions'][number] {
	return {
		name,
		viaPack,
		definition,
		probe: {
			kind: 'named-observation',
			region: 'figure',
			expectation: `Appearance resolves through ${viaPack}; no Preset literal or Pack-specific sibling decides it.`
		}
	};
}

export const figureIdentity: IdentitySpec = {
	kind: 'graphic',
	claim:
		'a generated figure — network, tree, flow, race, line, slope, or treemap — whose marks are laid out deterministically from validated inline data and moved by named Moves',
	dimensions: [
		figureRoleDimension('mark-voice', 'chart.mark', 'Primary data and node voice.'),
		figureRoleDimension('signal-voice', 'chart.annotation', 'Signals, focus, and annotations.'),
		figureRoleDimension('axis-treatment', 'chart.axis', 'Axes and baselines.'),
		figureRoleDimension('grid-treatment', 'chart.grid', 'Reference grid and period rules.'),
		figureRoleDimension('label-treatment', 'chart.label', 'Labels, values, and node ink.'),
		{
			name: 'generated-layout',
			implementation:
				'src/lib/utils/figure-scene-prepare.ts prepareFigure — one deterministic layout per declaration and orientation (d3-hierarchy, seeded fixed-tick d3-force, d3-sankey, layered, circular, Cartesian); Pins override single Marks.',
			definition: 'Generated, deterministic, Pin-overridable Mark geometry.',
			probe: { kind: 'script', path: 'src/lib/utils/figure-scene-prepare.test.ts' }
		},
		{
			name: 'factual-integrity',
			implementation:
				'src/lib/platform/figure-validation.ts validateFigureGroupSemantics — references, hierarchy, acyclic flow, Move/kind compatibility, honest-motion eases, and orphan Pins fail closed before rendering.',
			definition: 'Fail-closed Figure contract; quantities never overshoot.',
			probe: { kind: 'script', path: 'src/lib/platform/figure-validation.test.ts' }
		}
	]
};
