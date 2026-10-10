import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';
import transitionWipeDemoPresetJson from '$lib/presets/transition-wipe-demo.json';

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import {
	runExportCompositionJsonOperation,
	runInspectCompositionOperation,
	runSetCompositionIdentityOperation,
	type CompositionInspectionOutcome,
	type CompositionInspectionReceipt,
	type CompositionJsonExportOutcome,
	type CompositionJsonExportReceipt
} from './composition-document-operations';
import { engineState } from './engine-state.svelte';
import { filmState } from './film-state.svelte';
import { parseFilmIngress } from './film-ingress';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { presetBase } from './preset-base.svelte';
import { WEBMCP_RESULT_CHARACTER_BUDGET } from './webmcp-operation-inventory';

import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { CompositionOperationOutcome } from './composition-edit-transaction';

function expectInspected(outcome: CompositionInspectionOutcome): CompositionInspectionReceipt {
	if (outcome.status !== 'inspected') {
		throw new Error(`Expected an inspection but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectExported(outcome: CompositionJsonExportOutcome): CompositionJsonExportReceipt {
	if (outcome.status !== 'exported') {
		throw new Error(`Expected an export but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(
	outcome: CompositionInspectionOutcome | CompositionJsonExportOutcome | CompositionOperationOutcome
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the operation succeeded.');
	}
	return outcome;
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	compositionMeta.persistenceError = null;
});

describe('composition inspection', () => {
	it('reports the revision, identity, transport, Pack, and output class', () => {
		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.revision).toBe(0);
		expect(receipt.slug).toBe('untitled');
		expect(receipt.name).toBe('Blank');
		expect(receipt.pack).toBe('syntax');
		expect(receipt.transport).toEqual({
			orientation: 'horizontal',
			durationSeconds: 6,
			fps: 30,
			format: 'webm'
		});
		expect(receipt.outputClass).toBe('transparent-overlay');
		expect(receipt.backgroundFill).toBeNull();
	});

	it('names the Layer tree as ids, kinds, and order rather than the document body', async () => {
		await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'Inspected' });
		engineState.overlays.push({
			type: 'lower-third',
			id: 'headline',
			content: { title: 'Headline' },
			position: { anchor: 'bottom-left', offset: { x: 0.06, y: 0.08 } }
		});

		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.name).toBe('Inspected');
		expect(receipt.layers.entries).toEqual([
			{ kind: 'surface', id: 'surface', type: 'plain' },
			{ kind: 'overlay', id: 'headline', type: 'lower-third' }
		]);
		expect(receipt.layers.total).toBe(2);
		expect(receipt.layers.truncated).toBe(false);
		expect(JSON.stringify(receipt).length).toBeLessThanOrEqual(WEBMCP_RESULT_CHARACTER_BUDGET);
	});

	it('classifies a declared background fill as a full-frame piece', () => {
		engineState.backgroundFill = '#101014';

		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.outputClass).toBe('full-frame');
		expect(receipt.backgroundFill).toBe('#101014');
	});

	it('refuses to inspect when no composition is open', () => {
		compositionMeta.userCompositionSlug = null;

		const failure = expectFailed(runInspectCompositionOperation());

		expect(failure.code).toBe('no_composition_open');
	});
});

describe('composition JSON export', () => {
	it('returns one standalone document that parses back through the ingress boundary', () => {
		const receipt = expectExported(runExportCompositionJsonOperation());

		expect(receipt.characterCount).toBe(receipt.json.length);
		// The standalone document is the Film (ADR-0068 §3), and it reads back.
		const film = parseFilmIngress(JSON.parse(receipt.json));
		expect(film.schema).toBe('gfx-film@1');
		expect(film.name).toBe('Blank');
		expect(film.scenes).toHaveLength(1);
		expect(film.scenes[0].state).toEqual(parsePresetIngress(blankPresetJson).state);
	});

	it('exports a legacy transition Preset as the two-Scene Film it opened as', () => {
		applyPreset(parsePresetIngress(transitionWipeDemoPresetJson));
		compositionMeta.userCompositionSlug = 'my-transition';

		const receipt = expectExported(runExportCompositionJsonOperation());

		// ADR-0068 §3: the transition is a boundary between two Scenes.
		const film = parseFilmIngress(JSON.parse(receipt.json));
		expect(film.scenes.map((scene) => scene.origin?.slug)).toEqual([
			transitionWipeDemoPresetJson.transition.from,
			transitionWipeDemoPresetJson.transition.to
		]);
		expect(film.boundaries.map((boundary) => boundary.kind)).toEqual([
			transitionWipeDemoPresetJson.transition.effect
		]);
	});

	it('refuses to export when no composition is open', () => {
		compositionMeta.userCompositionSlug = null;

		expect(expectFailed(runExportCompositionJsonOperation()).code).toBe('no_composition_open');
	});
});

describe('composition identity', () => {
	it('sets the name, description, and kind as one edit', async () => {
		const outcome = await runSetCompositionIdentityOperation({
			expectedRevision: 0,
			name: 'Renamed',
			description: 'A described composition',
			kind: 'deliverable'
		});

		expect(outcome.status).toBe('applied');
		expect(presetBase.name).toBe('Renamed');
		expect(presetBase.description).toBe('A described composition');
		expect(presetBase.kind).toBe('deliverable');
		expect(compositionEditHistory.revision).toBe(1);
		expect(compositionEditHistory.undoLabel).toBe('Set composition identity');
	});

	it('clears the optional description rather than storing an empty string', async () => {
		await runSetCompositionIdentityOperation({ expectedRevision: 0, description: 'Temporary' });
		await runSetCompositionIdentityOperation({ expectedRevision: 1, description: '' });

		expect(presetBase.description).toBeUndefined();
	});

	it('refuses an identity edit that names nothing to change', async () => {
		const failure = expectFailed(await runSetCompositionIdentityOperation({ expectedRevision: 0 }));

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['name', 'description', 'kind']);
	});

	it('refuses a blank name and a kind the catalog does not classify', async () => {
		const blankName = expectFailed(
			await runSetCompositionIdentityOperation({ expectedRevision: 0, name: '   ' })
		);
		expect(blankName.code).toBe('invalid_argument');
		expect(blankName.rejected).toBe('   ');

		const unknownKind = expectFailed(
			await runSetCompositionIdentityOperation({
				expectedRevision: 0,
				kind: 'draft' as 'deliverable'
			})
		);
		expect(unknownKind.code).toBe('unsupported_variant');
		expect(unknownKind.alternatives).toEqual(['deliverable', 'fixture']);
		expect(presetBase.name).toBe('Blank');
	});

	it('refuses a stale revision and applies nothing', async () => {
		await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'First' });

		const failure = expectFailed(
			await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'Second' })
		);

		expect(failure.code).toBe('stale_revision');
		expect(failure.movedSince).toEqual(['Set composition identity']);
		expect(presetBase.name).toBe('First');
	});

	it('refuses to edit while a Scene swap has engine state in transit', async () => {
		filmState.isSwappingScene = true;

		const failure = expectFailed(
			await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'Renamed' })
		);
		filmState.isSwappingScene = false;

		expect(failure.code).toBe('precondition_unmet');
		expect(presetBase.name).toBe('Blank');
	});
});
