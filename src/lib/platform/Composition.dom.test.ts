// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';

import twoSceneMagicMoveFilmJson from '../../../scripts/fixtures/film-magic-move/two-scene-magic-move.film.json';

import Composition from './Composition.svelte';
import { ensureFilmRenderersLoaded } from './composition-renderer-readiness';
import { parseFilm } from './film-ingress';
import { filmMagicMoveSoloState } from './film-magic-move-solo.svelte';
import { applyFilm } from './preset';
import { cloneJsonValue } from '../utils/json-clone';

/** Every mounted element of one Overlay, wherever it is hosted. */
function overlayMounts(container: HTMLElement, overlayId: string): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>(`[data-overlay-id="${overlayId}"]`)];
}

beforeEach(async () => {
	// jsdom has no FontFaceSet; the type field's mount listens to it.
	if (!('fonts' in document)) {
		const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
		Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
	}
	const film = parseFilm(cloneJsonValue(twoSceneMagicMoveFilmJson));
	// A second Overlay that no magic move carries.
	film.scenes[0].state.overlays.push({
		...cloneJsonValue(film.scenes[0].state.overlays[0]),
		id: 'speaker'
	});
	await ensureFilmRenderersLoaded({ film, legacyPresetEnvelope: { kind: 'deliverable' } });
	applyFilm(film, { kind: 'deliverable' });
	filmMagicMoveSoloState.overlayIds = [];
});

afterEach(() => {
	filmMagicMoveSoloState.overlayIds = [];
});

describe('the capture roots of a composition during a magic move', () => {
	it('hosts every Overlay in the Scene root when none is carried', () => {
		const { container } = render(Composition);

		const sceneRoot = container.querySelector<HTMLElement>('.composition:not(.overlay-root)');
		expect(sceneRoot).not.toBeNull();
		expect(overlayMounts(container, 'lower-third')).toHaveLength(1);
		expect(sceneRoot?.contains(overlayMounts(container, 'lower-third')[0])).toBe(true);
		expect(container.querySelector('[data-magic-move-overlay-root]')).toBeNull();
	});

	it('moves a carried Overlay to a frame-sized root of its own: one mount, outside the Scene root', async () => {
		const { container } = render(Composition);
		const sceneRoot = container.querySelector<HTMLElement>('.composition:not(.overlay-root)');

		filmMagicMoveSoloState.overlayIds = ['lower-third'];
		await tick();

		const soloRoot = container.querySelector<HTMLElement>(
			'[data-magic-move-overlay-root="lower-third"]'
		);
		expect(soloRoot).not.toBeNull();
		// A sibling of the Scene root, the same size, holding nothing but the Overlay.
		expect(soloRoot?.parentElement).toBe(sceneRoot?.parentElement);
		expect(soloRoot?.style.inlineSize).toBe(sceneRoot?.style.inlineSize);
		expect(soloRoot?.style.blockSize).toBe(sceneRoot?.style.blockSize);
		expect(soloRoot?.querySelectorAll('[data-overlay-id]')).toHaveLength(1);

		const mounts = overlayMounts(container, 'lower-third');
		expect(mounts).toHaveLength(1);
		expect(soloRoot?.contains(mounts[0])).toBe(true);
		expect(sceneRoot?.contains(mounts[0])).toBe(false);
		// The Overlay nobody carries stays in its Scene.
		expect(sceneRoot?.contains(overlayMounts(container, 'speaker')[0])).toBe(true);
	});

	it('lays the carried Overlay out by the same placement as in its Scene', async () => {
		const { container } = render(Composition);
		const inScene = overlayMounts(container, 'lower-third')[0].getAttribute('style');

		filmMagicMoveSoloState.overlayIds = ['lower-third'];
		await tick();

		expect(overlayMounts(container, 'lower-third')[0].getAttribute('style')).toBe(inScene);
	});

	it('puts the Overlay back when it is no longer carried, and ignores an id the Scene does not hold', async () => {
		const { container } = render(Composition);
		const sceneRoot = container.querySelector<HTMLElement>('.composition:not(.overlay-root)');

		filmMagicMoveSoloState.overlayIds = ['lower-third', 'not-in-this-scene'];
		await tick();
		expect(container.querySelectorAll('[data-magic-move-overlay-root]')).toHaveLength(1);

		filmMagicMoveSoloState.overlayIds = [];
		await tick();

		expect(container.querySelector('[data-magic-move-overlay-root]')).toBeNull();
		expect(overlayMounts(container, 'lower-third')).toHaveLength(1);
		expect(sceneRoot?.contains(overlayMounts(container, 'lower-third')[0])).toBe(true);
	});
});
