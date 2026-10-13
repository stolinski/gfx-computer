// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import twoSceneMagicMoveFilmJson from '../../../scripts/fixtures/film-magic-move/two-scene-magic-move.film.json';

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { filmFromCorpusPreset, parseFilm } from './film-ingress';
import { insertFilmScene } from './film-scene-membership';
import { filmSceneBoundaryKindLabel } from './film-scene-boundary-kind-label';
import {
	FILM_SCENE_BOUNDARY_KINDS,
	type Film,
	type FilmMagicMovePair,
	type FilmSceneBoundary
} from './film-schema';
import { filmState, readOpenFilm } from './film-state.svelte';
import FilmSceneBoundarySection from './FilmSceneBoundarySection.svelte';
import { getOverlayDefinition } from './pipelines/definition-registry';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
import { posterKeyForPreset } from './posters';
import { applyFilm } from './preset';
import { getPresetBySlug } from './preset-catalog';
import { deselectLayer, sceneBoundarySelection, selectSceneBoundary } from './selection.svelte';

import { cloneJsonValue } from '../utils/json-clone';

import type { Preset } from './engine-schema';

// The boundary operation reaches the session store through the lifecycle
// module. The real one reads `$env/dynamic/public`, which jsdom does not have;
// nothing here stores anything.
vi.mock('./user-composition-store', () => ({
	IS_ORIGIN_COMPOSITION_STORE_SERVED: true,
	userCompositionStore: {
		listUserCompositions: vi.fn(async () => []),
		loadUserComposition: vi.fn(async () => null),
		createUserComposition: vi.fn(),
		saveUserComposition: vi.fn(),
		deleteUserComposition: vi.fn(),
		inspectStorage: vi.fn()
	}
}));

const SCENE_STARTERS = ['lower-third', 'chapter-card-descent', 'counter-milestone'] as const;
const SHATTER: FilmSceneBoundary = {
	kind: 'seeded-shatter',
	durationMs: 1200,
	params: { seed: 1337, columns: 14, scatter: 0.13, rotation: 0.55, depth: 0.6, shadow: 0.35 }
};

function requireStarter(slug: string): Preset {
	const starter = getPresetBySlug(slug);
	if (!starter) throw new Error(`The corpus holds no Starter "${slug}".`);
	return starter;
}

/** A Film of three Scenes, `scene-1` to `scene-3`, with the given two boundaries. */
function openThreeSceneFilm(boundaries: readonly [FilmSceneBoundary, FilmSceneBoundary]): void {
	const [first, ...rest] = SCENE_STARTERS.map((slug) => {
		const starter = requireStarter(slug);
		return filmFromCorpusPreset(starter, { slug, contentKey: posterKeyForPreset(starter) });
	});
	const film: Film = { ...first, name: 'Launch film', scenes: [...first.scenes], boundaries: [] };
	for (const [index, source] of rest.entries()) {
		insertFilmScene(film, { ...source.scenes[0], id: `scene-${index + 2}` }, film.scenes.length);
	}
	applyFilm({ ...film, boundaries: [...boundaries] }, { kind: 'deliverable' });
}

function boundaries(): readonly FilmSceneBoundary[] {
	return readOpenFilm().boundaries;
}

/** How long an operation that loads a renderer module may take under a busy test run. */
const RENDERER_LOAD_WAIT = { timeout: 20_000 } as const;

beforeEach(async () => {
	filmState.isSwappingScene = false;
	// A Film loads the effect of every boundary it holds before it opens.
	await pipelineRendererRuntime.ensureTransition('seeded-shatter');
	openThreeSceneFilm([{ kind: 'fade', durationMs: 1000 }, SHATTER]);
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'launch-film';
	compositionMeta.persistenceError = null;
	deselectLayer();
});

describe('the Scene boundary section', () => {
	it('shows nothing until a junction is selected', () => {
		render(FilmSceneBoundarySection);

		expect(screen.queryByRole('combobox')).toBeNull();
		expect(screen.queryByText('Boundary')).toBeNull();
	});

	it('shows the kind picker with every kind, and the duration of a fade', () => {
		selectSceneBoundary(0);
		render(FilmSceneBoundarySection);

		expect(screen.getByText('Boundary')).not.toBeNull();
		const kind = screen.getByRole<HTMLSelectElement>('combobox');
		expect(kind.value).toBe('fade');
		expect(
			within(kind)
				.getAllByRole<HTMLOptionElement>('option')
				.map((option) => option.value)
		).toEqual([...FILM_SCENE_BOUNDARY_KINDS]);
		expect(
			within(kind)
				.getAllByRole('option')
				.map((option) => option.textContent)
		).toEqual(FILM_SCENE_BOUNDARY_KINDS.map(filmSceneBoundaryKindLabel));
		expect(screen.getByText('Kind')).not.toBeNull();
		expect(screen.getByText('Duration')).not.toBeNull();
		expect(screen.getByRole<HTMLInputElement>('spinbutton').value).toBe('1000');
		// A fade has nothing else to set.
		expect(screen.queryByText('Seed')).toBeNull();
	});

	it('shows no duration for a cut', () => {
		openThreeSceneFilm([{ kind: 'cut' }, { kind: 'cut' }]);
		selectSceneBoundary(1);
		render(FilmSceneBoundarySection);

		expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('cut');
		expect(screen.queryByText('Duration')).toBeNull();
		expect(screen.queryByRole('spinbutton')).toBeNull();
	});

	it('shows the fields of the effect at an effect boundary, with its params', () => {
		selectSceneBoundary(1);
		render(FilmSceneBoundarySection);

		expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('seeded-shatter');
		expect(screen.getByLabelText<HTMLInputElement>('Seed').value).toBe('1337');
		expect(screen.getByLabelText<HTMLInputElement>('Columns').value).toBe('14');
		for (const label of ['Scatter', 'Rotation']) {
			expect(screen.getByLabelText(label)).not.toBeNull();
		}
	});

	it('follows the selection from one junction to another, and goes when it is cleared', async () => {
		selectSceneBoundary(0);
		render(FilmSceneBoundarySection);
		expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('fade');

		selectSceneBoundary(1);
		await waitFor(() =>
			expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('seeded-shatter')
		);

		deselectLayer();
		await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
	});

	it('makes a cut a one-second fade from the kind picker, as one undoable edit', async () => {
		openThreeSceneFilm([{ kind: 'cut' }, { kind: 'cut' }]);
		selectSceneBoundary(0);
		render(FilmSceneBoundarySection);
		const revision = compositionEditHistory.revision;

		await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fade' } });

		await waitFor(() => expect(boundaries()[0]).toEqual({ kind: 'fade', durationMs: 1000 }));
		expect(compositionEditHistory.revision).toBe(revision + 1);
		expect(compositionEditHistory.undoLabel).toBe('Set the boundary after Scene "scene-1" to fade');
		expect(screen.getByRole<HTMLInputElement>('spinbutton').value).toBe('1000');
		// The junction it edited is still the one selected.
		expect(sceneBoundarySelection.boundaryIndex).toBe(0);
	});

	it('makes a fade an effect and keeps its duration', async () => {
		selectSceneBoundary(0);
		render(FilmSceneBoundarySection);

		await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mask-wipe' } });

		await waitFor(
			() =>
				expect(boundaries()[0]).toEqual({
					kind: 'mask-wipe',
					durationMs: 1000,
					params: { direction: 'right', softness: 0.001 }
				}),
			RENDERER_LOAD_WAIT
		);
		await waitFor(() => expect(screen.getByLabelText('Direction')).not.toBeNull());
	});

	it('sets the duration when the field is changed', async () => {
		selectSceneBoundary(0);
		render(FilmSceneBoundarySection);

		await fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '500' } });

		await waitFor(() => expect(boundaries()[0]).toEqual({ kind: 'fade', durationMs: 500 }));
	});

	it('sets one effect param from the effect own field and keeps the rest', async () => {
		selectSceneBoundary(1);
		render(FilmSceneBoundarySection);

		await fireEvent.input(screen.getByLabelText('Seed'), { target: { value: '7' } });

		await waitFor(() =>
			expect(boundaries()[1]).toEqual({ ...SHATTER, params: { ...SHATTER.params, seed: 7 } })
		);
	});

	it('reports a duration the Scenes have no room for, and shows the duration the Film still has', async () => {
		selectSceneBoundary(0);
		render(FilmSceneBoundarySection);

		await fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '600000' } });

		await waitFor(() => expect(compositionMeta.persistenceError).not.toBeNull());
		// The refusal's own sentence and the finding that caused it.
		expect(compositionMeta.persistenceError).toContain('nothing was applied');
		expect(compositionMeta.persistenceError).toContain('The fade between Scene "scene-1"');
		expect(boundaries()[0]).toEqual({ kind: 'fade', durationMs: 1000 });
		await waitFor(() =>
			expect(screen.getByRole<HTMLInputElement>('spinbutton').value).toBe('1000')
		);
	});

	describe('magic move', () => {
		const LOWER_THIRD_PAIR: FilmMagicMovePair = {
			from: { kind: 'overlay', id: 'lower-third' },
			to: { kind: 'overlay', id: 'lower-third' }
		};
		const SPEAKER_PAIR: FilmMagicMovePair = {
			from: { kind: 'overlay', id: 'speaker' },
			to: { kind: 'overlay', id: 'speaker' }
		};
		const lowerThirdLabel = getOverlayDefinition('lower-third')?.label;

		/** The magic-move fixture: two Scenes sharing `lower-third`, and here `speaker` too. */
		function openSharedOverlayFilm(boundary: FilmSceneBoundary): void {
			const film = parseFilm(cloneJsonValue(twoSceneMagicMoveFilmJson));
			for (const scene of film.scenes) {
				scene.state.overlays.push({ ...cloneJsonValue(scene.state.overlays[0]), id: 'speaker' });
			}
			applyFilm({ ...film, boundaries: [boundary] }, { kind: 'deliverable' });
			selectSceneBoundary(0);
		}

		it('lists one switch per suggested pair, named for its Overlay, off until it is carried', () => {
			openSharedOverlayFilm({ kind: 'fade', durationMs: 1000 });
			render(FilmSceneBoundarySection);

			const switches = screen.getAllByRole('switch');

			expect(switches.map((toggle) => toggle.getAttribute('aria-label'))).toEqual([
				`Magic move ${lowerThirdLabel} · lower-third`,
				`Magic move ${lowerThirdLabel} · speaker`
			]);
			expect(switches.map((toggle) => toggle.getAttribute('aria-checked'))).toEqual([
				'false',
				'false'
			]);
			expect(screen.getByText(`${lowerThirdLabel} · speaker`)).not.toBeNull();
		});

		it('shows a carried pair as on', () => {
			openSharedOverlayFilm({
				kind: 'fade',
				durationMs: 1000,
				magicMove: { pairs: [SPEAKER_PAIR] }
			});
			render(FilmSceneBoundarySection);

			expect(
				screen
					.getByRole('switch', { name: `Magic move ${lowerThirdLabel} · speaker` })
					.getAttribute('aria-checked')
			).toBe('true');
			expect(
				screen
					.getByRole('switch', { name: `Magic move ${lowerThirdLabel} · lower-third` })
					.getAttribute('aria-checked')
			).toBe('false');
		});

		it('adds a pair when its switch is turned on, and removes it when turned off, each as one undoable edit', async () => {
			openSharedOverlayFilm({ kind: 'fade', durationMs: 1000 });
			render(FilmSceneBoundarySection);
			const revision = compositionEditHistory.revision;

			await fireEvent.click(
				screen.getByRole('switch', { name: `Magic move ${lowerThirdLabel} · lower-third` })
			);
			await waitFor(() =>
				expect(boundaries()[0]).toEqual({
					kind: 'fade',
					durationMs: 1000,
					magicMove: { pairs: [LOWER_THIRD_PAIR] }
				})
			);
			expect(compositionEditHistory.revision).toBe(revision + 1);

			await fireEvent.click(
				screen.getByRole('switch', { name: `Magic move ${lowerThirdLabel} · speaker` })
			);
			await waitFor(() =>
				expect(boundaries()[0]).toHaveProperty('magicMove.pairs', [LOWER_THIRD_PAIR, SPEAKER_PAIR])
			);

			await fireEvent.click(
				screen.getByRole('switch', { name: `Magic move ${lowerThirdLabel} · lower-third` })
			);
			await waitFor(() =>
				expect(boundaries()[0]).toHaveProperty('magicMove.pairs', [SPEAKER_PAIR])
			);

			await fireEvent.click(
				screen.getByRole('switch', { name: `Magic move ${lowerThirdLabel} · speaker` })
			);
			await waitFor(() => expect(boundaries()[0]).toEqual({ kind: 'fade', durationMs: 1000 }));
			expect(compositionMeta.persistenceError).toBeNull();
		});

		it('offers no switch for a cut, or for Scenes that share no Overlay', () => {
			openSharedOverlayFilm({ kind: 'cut' });
			const { unmount } = render(FilmSceneBoundarySection);
			expect(screen.queryByRole('switch')).toBeNull();
			unmount();

			openThreeSceneFilm([{ kind: 'fade', durationMs: 1000 }, SHATTER]);
			selectSceneBoundary(0);
			render(FilmSceneBoundarySection);
			expect(screen.queryByRole('switch')).toBeNull();
		});
	});
});
