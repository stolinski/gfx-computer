import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import {
	runSetCompositionBackgroundOperation,
	runSetCompositionFormatOperation,
	runSetCompositionOrientationOperation,
	runSetCompositionTimingOperation
} from './composition-transport-operations';
import { engineState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the transport edit applied.');
	}
	return outcome;
}

function expectChangedPointers(outcome: CompositionOperationOutcome): readonly string[] {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome.changed.pointers;
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('transport orientation', () => {
	it('reflows the piece to the other orientation', async () => {
		const changed = expectChangedPointers(
			await runSetCompositionOrientationOperation({ expectedRevision: 0, orientation: 'vertical' })
		);

		expect(changed).toEqual(['/state/transport/orientation']);
		expect(engineState.transport.orientation).toBe('vertical');
	});

	it('refuses an orientation the engine does not render', async () => {
		const failure = expectFailed(
			await runSetCompositionOrientationOperation({
				expectedRevision: 0,
				orientation: 'square' as 'horizontal'
			})
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.rejected).toBe('square');
		expect(failure.alternatives).toEqual(['horizontal', 'vertical']);
		expect(engineState.transport.orientation).toBe('horizontal');
	});

	it('refuses when no composition is open', async () => {
		compositionMeta.userCompositionSlug = null;

		const failure = expectFailed(
			await runSetCompositionOrientationOperation({ expectedRevision: 0, orientation: 'vertical' })
		);

		expect(failure.code).toBe('no_composition_open');
	});
});

describe('transport timing', () => {
	it('sets the duration and the rate together', async () => {
		const changed = expectChangedPointers(
			await runSetCompositionTimingOperation({
				expectedRevision: 0,
				durationSeconds: 9,
				fps: 24
			})
		);

		expect(changed).toEqual(['/state/transport/durationSeconds', '/state/transport/fps']);
		expect(engineState.transport.durationSeconds).toBe(9);
		expect(engineState.transport.fps).toBe(24);
	});

	it('accepts an NTSC fractional rate the engine resolves to an exact rational', async () => {
		expectChangedPointers(
			await runSetCompositionTimingOperation({ expectedRevision: 0, fps: 29.97 })
		);

		expect(engineState.transport.fps).toBe(29.97);
	});

	it('refuses a rate outside the standard delivery set', async () => {
		const failure = expectFailed(
			await runSetCompositionTimingOperation({ expectedRevision: 0, fps: 29.9 })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.rejected).toBe('29.9');
		expect(failure.alternatives).toContain('29.97');
		expect(engineState.transport.fps).toBe(30);
	});

	it('refuses a timing edit that names nothing to change', async () => {
		const failure = expectFailed(await runSetCompositionTimingOperation({ expectedRevision: 0 }));

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['durationSeconds', 'fps', 'posterSeconds']);
	});

	it('names the poster frame in seconds and clears it with null', async () => {
		const applied = await runSetCompositionTimingOperation({
			expectedRevision: 0,
			posterSeconds: 2.5
		});
		expect(expectChangedPointers(applied)).toEqual(['/state/transport/posterSeconds']);
		expect(engineState.transport.posterSeconds).toBe(2.5);

		const cleared = await runSetCompositionTimingOperation({
			expectedRevision: applied.status === 'applied' ? applied.revision : 0,
			posterSeconds: null
		});
		expect(expectChangedPointers(cleared)).toEqual(['/state/transport/posterSeconds']);
		expect(engineState.transport.posterSeconds).toBeUndefined();
	});

	it('refuses a poster time before the start of the run', async () => {
		const failure = expectFailed(
			await runSetCompositionTimingOperation({ expectedRevision: 0, posterSeconds: -1 })
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('-1');
		expect(engineState.transport.posterSeconds).toBeUndefined();
	});

	it('reports a duration outside the schema range as a blocking finding', async () => {
		const failure = expectFailed(
			await runSetCompositionTimingOperation({ expectedRevision: 0, durationSeconds: 0 })
		);

		expect(failure.code).toBe('schema_invalid');
		expect(failure.findings.findings[0].path).toBe('/state/transport/durationSeconds');
		expect(engineState.transport.durationSeconds).toBe(6);
	});

	it('refuses a duration that is not a finite number of seconds', async () => {
		const failure = expectFailed(
			await runSetCompositionTimingOperation({ expectedRevision: 0, durationSeconds: Number.NaN })
		);

		expect(failure.code).toBe('invalid_argument');
	});
});

describe('transport format', () => {
	it('sets the delivery format', async () => {
		const changed = expectChangedPointers(
			await runSetCompositionFormatOperation({ expectedRevision: 0, format: 'prores' })
		);

		expect(changed).toEqual(['/state/transport/format']);
		expect(engineState.transport.format).toBe('prores');
	});

	it('refuses a format the engine does not encode', async () => {
		const failure = expectFailed(
			await runSetCompositionFormatOperation({ expectedRevision: 0, format: 'mov' as 'webm' })
		);

		expect(failure.code).toBe('unsupported_variant');
		expect(failure.alternatives).toEqual(['webm', 'prores']);
	});
});

describe('transport background', () => {
	it('declares the Pack field as the fill, making the piece full-frame', async () => {
		const changed = expectChangedPointers(
			await runSetCompositionBackgroundOperation({ expectedRevision: 0, fill: 'pack' })
		);

		expect(changed).toEqual(['/state/backgroundFill']);
		expect(engineState.backgroundFill).toBe('pack');
	});

	it('declares an explicit hex as an intentional departure from the Pack', async () => {
		expectChangedPointers(
			await runSetCompositionBackgroundOperation({ expectedRevision: 0, fill: '#101014' })
		);

		expect(engineState.backgroundFill).toBe('#101014');
	});

	it('removes the fill and returns the piece to the transparent lane', async () => {
		expectChangedPointers(
			await runSetCompositionBackgroundOperation({ expectedRevision: 0, fill: 'pack' })
		);

		expectChangedPointers(
			await runSetCompositionBackgroundOperation({ expectedRevision: 1, fill: null })
		);

		expect(engineState.backgroundFill).toBeUndefined();
	});

	it('refuses a fill that is neither a hex nor the Pack sentinel', async () => {
		const failure = expectFailed(
			await runSetCompositionBackgroundOperation({ expectedRevision: 0, fill: 'transparent' })
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('transparent');
		expect(engineState.backgroundFill).toBeUndefined();
	});
});
