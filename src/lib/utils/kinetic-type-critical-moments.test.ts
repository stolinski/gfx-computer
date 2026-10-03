import { describe, expect, it } from 'vitest';

import motionFixture from '$lib/presets/kinetic-type-field-motion-fixture.json';
import { parsePresetIngress } from '$lib/platform/preset-ingress';
import {
	KINETIC_TYPE_CRITICAL_MOMENT_LIMIT,
	listKineticTypeCriticalMoments
} from './kinetic-type-critical-moments';

describe('Kinetic Type critical moments', () => {
	it('lists every beat and each word envelope where values actually change', () => {
		const preset = parsePresetIngress(motionFixture);
		const moments = listKineticTypeCriticalMoments(
			preset.state.surface.typeField,
			preset.state.motionBeats
		);
		expect(moments.filter((moment) => moment.kind === 'beat').map((moment) => moment.id)).toEqual([
			'beat:open',
			'beat:move',
			'beat:swap',
			'beat:become',
			'beat:turn',
			'beat:composition',
			'beat:out'
		]);
		const move = moments.filter((moment) => moment.wordId === 'move');
		// MOVE rises (reveal, tracking, and weight overlap into one envelope),
		// leaves through its mask, then drops its opacity once hidden.
		expect(move.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
			[760, 1600],
			[2000, 2260],
			[2380, 2400]
		]);
		expect(moments.length).toBeLessThanOrEqual(KINETIC_TYPE_CRITICAL_MOMENT_LIMIT);
		const sorted = [...moments].sort((left, right) => left.startMs - right.startMs);
		expect(moments.map((moment) => moment.startMs)).toEqual(sorted.map((moment) => moment.startMs));
	});

	it('lists nothing for a composition without a Type Field', () => {
		expect(listKineticTypeCriticalMoments(undefined, [{ id: 'a', atMs: 10 }])).toEqual([]);
	});
});
