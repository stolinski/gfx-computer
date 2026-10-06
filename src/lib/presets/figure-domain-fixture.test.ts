import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import fixtureJson from './figure-domain-fixture.json';
import { FIGURE_KINDS } from '../platform/engine-schema';
import { parsePresetIngress } from '../platform/preset-ingress';
import { listFixtures, listPresets } from '../platform/preset-catalog';
import { presetToWireFormat } from '../platform/preset-pure';
import { validatePresetSemantics } from '../platform/preset-validation';
import { prepareFigure } from '../utils/figure-scene-prepare';

const fixture = parsePresetIngress(fixtureJson);
const figures = fixture.state.surface.figures ?? [];

describe('figure-domain fixture', () => {
	it('stays an unlisted Pack-neutral full-frame fixture covering every Figure kind', () => {
		assert.equal(fixture.kind, 'fixture');
		assert.equal(fixture.state.backgroundFill, 'pack');
		assert.deepEqual(
			[...new Set(figures.map((figure) => figure.kind))].sort(),
			[...FIGURE_KINDS].sort()
		);
		assert.equal(
			listPresets().some((entry) => entry.slug === 'figure-domain-fixture'),
			false
		);
		assert.equal(
			listFixtures().some((entry) => entry.slug === 'figure-domain-fixture'),
			true
		);
		assert.equal(JSON.stringify(fixture).includes('#'), false);
		assert.deepEqual(validatePresetSemantics(fixture), []);
	});

	it('round-trips every Figure through the wire format', () => {
		const wire = presetToWireFormat(fixture) as { state: { surface: { figures?: unknown[] } } };
		assert.deepEqual(wire.state.surface.figures, JSON.parse(JSON.stringify(figures)));
	});

	it('shows exactly one Figure at a time', () => {
		const prepared = figures.map((figure) => prepareFigure(figure, 'horizontal'));
		for (let step = 0; step < 540; step += 1) {
			const progress = step / 540;
			const visible = prepared.filter((figure) => figure.scene(progress, 0).alpha > 0.01);
			assert.ok(visible.length <= 1, `${visible.length} Figures visible at ${progress}`);
		}
	});
});
