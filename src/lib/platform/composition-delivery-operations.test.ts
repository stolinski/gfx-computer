import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import {
	runExportCompositionVideoOperation,
	type CompositionDeliveryOutcome,
	type CompositionDeliveryReceipt
} from './composition-delivery-operations';
import { buildCompositionExportPlan } from './composition-export-controller';
import { compositionExportHandle } from './composition-export-handle.svelte';
import { compositionMeta } from './composition-meta.svelte';
import { engineState } from './engine-state.svelte';
import { readOpenFilm } from './film-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionExportOutcome } from './composition-export-controller';
import type { CompositionOperationFailure } from './composition-operation-preflight';

let exportSignals: (AbortSignal | undefined)[] = [];

function registerExportRunner(outcome: CompositionExportOutcome): void {
	compositionExportHandle.current = ({ signal }) => {
		exportSignals.push(signal);
		return Promise.resolve(outcome);
	};
}

function deliveredOutcome(wavFilename: string | null = null): CompositionExportOutcome {
	return {
		status: 'delivered',
		plan: buildCompositionExportPlan({ film: readOpenFilm() }),
		videoByteLength: 4096,
		wavFilename
	};
}

function expectDelivered(outcome: CompositionDeliveryOutcome): CompositionDeliveryReceipt {
	if (outcome.status !== 'delivered') {
		throw new Error(`Expected a delivery receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(outcome: CompositionDeliveryOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the export reported a file.');
	}
	return outcome;
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	exportSignals = [];
});

afterEach(() => {
	compositionExportHandle.current = null;
});

describe('composition delivery', () => {
	it('reports the encoded file only once the export really delivered it', async () => {
		registerExportRunner(deliveredOutcome());

		const receipt = expectDelivered(
			await runExportCompositionVideoOperation({ expectedRevision: 0 })
		);

		expect(receipt).toMatchObject({
			revision: 0,
			format: 'webm',
			codec: 'vp9-alpha',
			output: 'transparent',
			width: 3840,
			height: 2160,
			fps: 30,
			frameCount: 180,
			videoFilename: 'gfx-overlay.webm',
			videoByteLength: 4096,
			wavFilename: null
		});
	});

	it('classifies a full-frame piece by what the composition declares', async () => {
		engineState.backgroundFill = '#101014';
		engineState.transport.format = 'prores';
		registerExportRunner(deliveredOutcome('gfx-bumper.wav'));

		const receipt = expectDelivered(
			await runExportCompositionVideoOperation({ expectedRevision: 0 })
		);

		expect(receipt.codec).toBe('prores-4444');
		expect(receipt.output).toBe('opaque');
		expect(receipt.videoFilename).toBe('gfx-bumper.mov');
		expect(receipt.wavFilename).toBe('gfx-bumper.wav');
	});

	it('hands the caller cancellation through to the running export', async () => {
		registerExportRunner({ status: 'cancelled' });
		const controller = new AbortController();

		const failure = expectFailed(
			await runExportCompositionVideoOperation({
				expectedRevision: 0,
				signal: controller.signal
			})
		);

		expect(exportSignals).toEqual([controller.signal]);
		expect(failure.code).toBe('cancelled');
		expect(failure.message).toMatch(/no file was produced/);
	});

	it('never starts an export the caller has already withdrawn', async () => {
		registerExportRunner(deliveredOutcome());
		const controller = new AbortController();
		controller.abort();

		expect(
			expectFailed(
				await runExportCompositionVideoOperation({
					expectedRevision: 0,
					signal: controller.signal
				})
			).code
		).toBe('cancelled');
		expect(exportSignals).toEqual([]);
	});

	it('reports an encode that failed as export_failed rather than a receipt', async () => {
		registerExportRunner({ status: 'failed', message: 'webm export failed with status 500.' });

		const failure = expectFailed(await runExportCompositionVideoOperation({ expectedRevision: 0 }));

		expect(failure.code).toBe('export_failed');
		expect(failure.message).toBe('webm export failed with status 500.');
		expect(failure.rejected).toBe('webm');
	});

	it('refuses a second export while one is already encoding', async () => {
		registerExportRunner({ status: 'busy' });

		const failure = expectFailed(await runExportCompositionVideoOperation({ expectedRevision: 0 }));

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toMatch(/already running/);
	});

	it('refuses when the stage cannot supply frames', async () => {
		registerExportRunner({ status: 'unavailable', message: 'Stage is unavailable.' });

		const failure = expectFailed(await runExportCompositionVideoOperation({ expectedRevision: 0 }));

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toBe('Stage is unavailable.');
	});

	it('refuses when the composition is not on screen to encode', async () => {
		const failure = expectFailed(await runExportCompositionVideoOperation({ expectedRevision: 0 }));

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toMatch(/not on screen/);
	});

	it('refuses to ship a version the caller has not observed', async () => {
		registerExportRunner(deliveredOutcome());

		const failure = expectFailed(await runExportCompositionVideoOperation({ expectedRevision: 4 }));

		expect(failure.code).toBe('stale_revision');
		expect(exportSignals).toEqual([]);
	});

	it('refuses while no composition is open', async () => {
		compositionMeta.userCompositionSlug = null;
		registerExportRunner(deliveredOutcome());

		expect(
			expectFailed(await runExportCompositionVideoOperation({ expectedRevision: 0 })).code
		).toBe('no_composition_open');
	});
});
