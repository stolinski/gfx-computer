import { describe, expect, it } from 'vitest';

import { createDefaultEngineState } from './engine-schema';
import { getPresetBySlug } from './preset-catalog';
import {
	deriveDeterministicReadableContract,
	isDeterministicReadableIdentityMotionHidden
} from './deterministic-readable-contract';

function requirePresetState(slug: string) {
	const preset = getPresetBySlug(slug);
	if (!preset) throw new Error(`Missing built-in Preset ${slug}`);
	return preset.state;
}

function timestampAtProgress(durationSeconds: number, progress: number): number {
	return Math.round(durationSeconds * progress * 1_000_000);
}

describe('deterministic readable motion authority', () => {
	it('admits diagram labels only after each Block reaches its hold', () => {
		const state = requirePresetState('docu-flowchart');
		const timestamp = timestampAtProgress(state.transport.durationSeconds, 0.25);

		expect(
			isDeterministicReadableIdentityMotionHidden(state, timestamp, 'block:l-headline:text')
		).toBe(false);
		expect(
			isDeterministicReadableIdentityMotionHidden(state, timestamp, 'block:n-commit:text')
		).toBe(false);
		expect(
			isDeterministicReadableIdentityMotionHidden(state, timestamp, 'block:n-build:text')
		).toBe(true);
	});

	it('excludes surface and Block text during carrier enter and exit motion', () => {
		const state = requirePresetState('docu-flowchart');
		const start = timestampAtProgress(state.transport.durationSeconds, 0);
		const exit = timestampAtProgress(state.transport.durationSeconds, 0.91);

		expect(isDeterministicReadableIdentityMotionHidden(state, start, 'block:l-headline:text')).toBe(
			true
		);
		expect(isDeterministicReadableIdentityMotionHidden(state, exit, 'block:l-headline:text')).toBe(
			true
		);
	});

	it('publishes static Kinetic Words once with hierarchy-derived readable roles', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'plain';
		state.surface.content = { body: [] };
		state.surface.enter = undefined;
		state.surface.exit = undefined;
		state.surface.typeField = {
			words: [
				{
					type: 'kinetic-word',
					id: 'type',
					text: 'TYPE',
					hierarchy: 'display',
					ink: 'accent',
					position: { x: 0.4, y: 0.45 },
					scale: 1,
					rotation: 0
				},
				{
					type: 'kinetic-word',
					id: 'moves',
					text: 'MOVES',
					hierarchy: 'support',
					ink: 'ink',
					position: { x: 0.66, y: 0.58 },
					scale: 1,
					rotation: 0
				}
			],
			phrases: [{ id: 'opening', wordIds: ['type', 'moves'], focalWordId: 'type' }]
		};

		const contract = deriveDeterministicReadableContract(state, 0);
		expect(contract.status === 'available' ? contract.expected : []).toEqual([
			{ id: 'block:type:text', text: 'TYPE', role: 'surface-display' },
			{ id: 'block:moves:text', text: 'MOVES', role: 'surface-title' }
		]);
		expect(isDeterministicReadableIdentityMotionHidden(state, 0, 'block:type:text')).toBe(false);
	});

	it('expects a Kinetic Word only while it is shown and settled in its mask', () => {
		const state = requirePresetState('kinetic-type-field');
		const at = (seconds: number): string[] => {
			const contract = deriveDeterministicReadableContract(state, seconds * 1_000_000);
			return contract.status === 'available' ? contract.expected.map((entry) => entry.id) : [];
		};
		// At the move beat the first phrase reads; BECOME has not risen yet.
		expect(at(1)).toEqual(['block:type:text', 'block:can:text', 'block:move:text']);
		// Mid-swap MOVE is leaving its mask and BECOME is still rising: in motion.
		expect(at(2.15)).toEqual(['block:type:text', 'block:can:text']);
		expect(isDeterministicReadableIdentityMotionHidden(state, 2_150_000, 'block:move:text')).toBe(
			true
		);
		expect(at(4.5)).toEqual([
			'block:type:text',
			'block:is:text',
			'block:the:text',
			'block:composition:text'
		]);
	});

	it('publishes Overlay identities only during their readable hold', () => {
		const state = requirePresetState('lower-third');
		const beforeHold = deriveDeterministicReadableContract(
			state,
			timestampAtProgress(state.transport.durationSeconds, 0.2)
		);
		const hold = deriveDeterministicReadableContract(
			state,
			timestampAtProgress(state.transport.durationSeconds, 0.5)
		);
		const exit = deriveDeterministicReadableContract(
			state,
			timestampAtProgress(state.transport.durationSeconds, 0.9)
		);

		expect(beforeHold.status === 'available' ? beforeHold.expected : []).toHaveLength(0);
		expect(
			hold.status === 'available'
				? hold.expected.map((entry) => ({ id: entry.id, role: entry.role }))
				: []
		).toEqual([
			{ id: 'overlay:main:kicker', role: 'overlay-corner-secondary' },
			{ id: 'overlay:main:title', role: 'overlay-corner-primary' },
			{ id: 'overlay:main:subtitle', role: 'overlay-corner-secondary' }
		]);
		expect(exit.status === 'available' ? exit.expected : []).toHaveLength(0);
	});
});
