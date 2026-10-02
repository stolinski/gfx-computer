// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import kineticFixtureJson from '$lib/presets/kinetic-type-field-static-fixture.json';

import { compositionMeta } from './composition-meta.svelte';
import { engineState, transitionState } from './engine-state.svelte';
import KineticWordInspector from './KineticWordInspector.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { layerSelection } from './selection.svelte';
import { createTimelineTrackId } from './timeline-entity-identity';

function phraseIds(): string[] {
	return engineState.surface.typeField?.phrases.map((phrase) => phrase.id) ?? [];
}

// A `.dom` test on purpose: only Svelte's browser build wraps `engineState` in
// the deep Proxy the phrase edits read from. `structuredClone` throws
// DataCloneError on that Proxy, so every phrase edit failed before it reached
// the operation (the same defect class as Sentry GFX-COMPUTER-X).
describe('KineticWordInspector phrase edits', () => {
	beforeEach(() => {
		transitionState.capturing = false;
		applyPreset(parsePresetIngress(kineticFixtureJson));
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.forkedFrom = null;
		const firstWord = engineState.surface.typeField?.words[0];
		if (!firstWord) throw new Error('The kinetic fixture has no words.');
		layerSelection.id = createTimelineTrackId({ kind: 'block', blockId: firstWord.id });
	});

	it('adds a phrase', async () => {
		const before = phraseIds();
		render(KineticWordInspector);

		await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

		await waitFor(() => expect(phraseIds()).toHaveLength(before.length + 1));
		expect(phraseIds().slice(0, before.length)).toEqual(before);
	});

	it('reorders a phrase', async () => {
		const [first, second, ...rest] = phraseIds();
		render(KineticWordInspector);

		await fireEvent.click(screen.getByRole('button', { name: `Move ${first} later` }));

		await waitFor(() => expect(phraseIds()).toEqual([second, first, ...rest]));
	});

	it('removes a phrase', async () => {
		const [first, ...rest] = phraseIds();
		render(KineticWordInspector);

		await fireEvent.click(screen.getByRole('button', { name: `Remove ${first}` }));

		await waitFor(() => expect(phraseIds()).toEqual(rest));
		expect(phraseIds()).not.toContain(first);
	});
});

describe('KineticWordInspector orientation placement', () => {
	beforeEach(() => {
		transitionState.capturing = false;
		applyPreset(parsePresetIngress(kineticFixtureJson));
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = 'untitled';
		compositionMeta.forkedFrom = null;
		engineState.transport.orientation = 'vertical';
		const firstWord = engineState.surface.typeField?.words[0];
		if (!firstWord) throw new Error('The kinetic fixture has no words.');
		delete firstWord.orientationOverrides;
		layerSelection.id = createTimelineTrackId({ kind: 'block', blockId: firstWord.id });
	});

	it('copies the shown placement into the orientation and removes it again', async () => {
		const word = (): NonNullable<typeof engineState.surface.typeField>['words'][number] => {
			const first = engineState.surface.typeField?.words[0];
			if (!first) throw new Error('The kinetic fixture lost its first word.');
			return first;
		};
		const shared = { position: { ...word().position }, scale: word().scale };
		render(KineticWordInspector);

		await fireEvent.click(screen.getByRole('switch', { name: 'Customize vertical' }));
		await waitFor(() =>
			expect(word().orientationOverrides?.vertical).toMatchObject({
				position: shared.position,
				scale: shared.scale
			})
		);

		await fireEvent.click(screen.getByRole('switch', { name: 'Customize vertical' }));
		await waitFor(() => expect(word().orientationOverrides).toBeUndefined());
	});
});
