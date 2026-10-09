// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import { transitionState } from './engine-state.svelte';
import { filmFromCorpusPreset } from './film-ingress';
import { filmFrameCount, filmSceneFrameCount, filmSceneFrameOffsets } from './film-playhead';
import { insertFilmScene } from './film-scene-membership';
import { filmState, readOpenFilm } from './film-state.svelte';
import FilmSceneStrip from './FilmSceneStrip.svelte';
import { posterKeyForPreset } from './posters';
import { applyFilm } from './preset';
import { getPresetBySlug, listPresets } from './preset-catalog';
import { resolveFrameRate } from '../utils/composition-timing';

import type { Preset } from './engine-schema';
import type { Film } from './film-schema';

// The strip's operations reach the session store through the lifecycle module.
// The real one reads `$env/dynamic/public`, which the app shell injects and
// jsdom does not; nothing here stores anything.
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
const PICKED_STARTER = 'achievement-unlocked';

function requireStarter(slug: string): Preset {
	const starter = getPresetBySlug(slug);
	if (!starter) throw new Error(`The corpus holds no Starter "${slug}".`);
	return starter;
}

/** A Film of three Scenes, `scene-1` to `scene-3`, one per Starter, cut together. */
function threeSceneFilm(): Film {
	const [first, ...rest] = SCENE_STARTERS.map((slug) => {
		const starter = requireStarter(slug);
		return filmFromCorpusPreset(starter, { slug, contentKey: posterKeyForPreset(starter) });
	});
	const film: Film = { ...first, name: 'Launch film', scenes: [...first.scenes], boundaries: [] };
	for (const [index, source] of rest.entries()) {
		insertFilmScene(film, { ...source.scenes[0], id: `scene-${index + 2}` }, film.scenes.length);
	}
	return film;
}

function segmentButtons(): HTMLButtonElement[] {
	return within(screen.getByRole('toolbar', { name: 'Scenes' }))
		.getAllByRole<HTMLButtonElement>('button')
		.filter((button) => button.dataset.sceneId !== undefined);
}

function segmentIds(): (string | undefined)[] {
	return segmentButtons().map((button) => button.dataset.sceneId);
}

/** Lay the strip's track out 1000px wide, so a pointer position is a known Film frame. */
function layOutTrack(): void {
	const track = segmentButtons()[0].parentElement;
	if (!track) throw new Error('The strip has no track.');
	track.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 30);
}

/** How long an operation that loads renderer modules may take under a busy test run. */
const RENDERER_LOAD_WAIT = { timeout: 20_000 } as const;

// jsdom keeps a popover closed, so what is inside the picker is queried as
// hidden content.
const IN_POPOVER = { hidden: true } as const;

/** Open the `+` picker the way the browser's popover does: with a toggle event. */
async function openStarterPicker(): Promise<HTMLElement> {
	const search = screen.getByRole('searchbox', { name: 'Search Starters', ...IN_POPOVER });
	const picker = search.parentElement;
	if (!picker) throw new Error('The picker has no popover.');
	const toggle = new Event('toggle');
	Object.defineProperty(toggle, 'newState', { value: 'open' });
	await fireEvent(picker, toggle);
	return picker;
}

beforeEach(() => {
	transitionState.capturing = false;
	filmState.isSwappingScene = false;
	// jsdom has no popover API; the picker only ever closes itself through it.
	HTMLElement.prototype.hidePopover = vi.fn();
	applyFilm(threeSceneFilm(), { kind: 'deliverable' });
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'launch-film';
	compositionMeta.persistenceError = null;
});

describe('the Scene strip', () => {
	it('shows one segment per Scene, as wide as the Scene is long, with its name and timing', () => {
		render(FilmSceneStrip);
		const film = readOpenFilm();
		const rate = resolveFrameRate(film.fps);
		const totalFrames = filmFrameCount(film);
		const offsets = filmSceneFrameOffsets(film);

		const segments = segmentButtons();

		expect(segmentIds()).toEqual(['scene-1', 'scene-2', 'scene-3']);
		for (const [index, segment] of segments.entries()) {
			const starter = requireStarter(SCENE_STARTERS[index]);
			const frameCount = filmSceneFrameCount(film.scenes[index], rate);
			const startSeconds = Math.floor(offsets[index] / rate.fps);
			expect(segment.title).toBe(starter.name);
			expect(segment.textContent).toContain(starter.name);
			expect(segment.textContent).toContain(
				`${Math.floor(startSeconds / 60)}:${String(startSeconds % 60).padStart(2, '0')} · ${starter.state.transport.durationSeconds.toFixed(1)} s`
			);
			expect(Number.parseFloat(segment.style.inlineSize)).toBeCloseTo(
				(frameCount / totalFrames) * 100,
				6
			);
		}
		const widths = segments.map((segment) => Number.parseFloat(segment.style.inlineSize));
		expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);
		// The open Scene is the pressed one.
		expect(segments.map((segment) => segment.getAttribute('aria-pressed'))).toEqual([
			'true',
			'false',
			'false'
		]);
	});

	it('is not shown for an unsaved Starter', () => {
		compositionMeta.isUserComposition = false;

		render(FilmSceneStrip);

		expect(screen.queryByRole('toolbar', { name: 'Scenes' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Add Scene' })).toBeNull();
	});

	it('opens the Scene under a click, at the Film frame under the pointer', async () => {
		render(FilmSceneStrip);
		layOutTrack();
		const film = readOpenFilm();
		const totalFrames = filmFrameCount(film);
		const offsets = filmSceneFrameOffsets(film);
		const revision = compositionEditHistory.revision;
		// A point a third of the way into the second Scene.
		const secondSceneFrames = filmSceneFrameCount(film.scenes[1], resolveFrameRate(film.fps));
		const targetFilmFrame = offsets[1] + Math.floor(secondSceneFrames / 3);
		const clientX = ((targetFilmFrame + 0.5) / totalFrames) * 1000;

		await fireEvent.click(segmentButtons()[1], { detail: 1, clientX });

		await waitFor(() => expect(filmState.selectedSceneId).toBe('scene-2'));
		expect(segmentButtons()[1].getAttribute('aria-pressed')).toBe('true');
		expect(segmentButtons()[0].getAttribute('aria-pressed')).toBe('false');
		// Selection advances the revision once and is not an edit.
		expect(compositionEditHistory.revision).toBe(revision + 1);
		expect(compositionEditHistory.canUndo).toBe(false);
	});

	it('opens a Scene from the keyboard and moves focus between segments with the arrow keys', async () => {
		render(FilmSceneStrip);
		const [first, second, third] = segmentButtons();

		first.focus();
		await fireEvent.keyDown(first, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(second);
		await fireEvent.keyDown(second, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(third);
		// The last segment has no segment after it; focus stays.
		await fireEvent.keyDown(third, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(third);
		await fireEvent.keyDown(third, { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(second);

		// Enter and Space activate a button as a click with no pointer position.
		await fireEvent.click(second, { detail: 0 });

		await waitFor(() => expect(filmState.selectedSceneId).toBe('scene-2'));
	});

	it('removes the open Scene from its remove control, and keeps a Film’s last Scene', async () => {
		render(FilmSceneStrip);
		const firstName = requireStarter(SCENE_STARTERS[0]).name;

		await fireEvent.click(screen.getByRole('button', { name: `Remove ${firstName}` }));

		await waitFor(() => expect(segmentIds()).toEqual(['scene-2', 'scene-3']));
		// The neighbour opened, and the control now belongs to it.
		expect(filmState.selectedSceneId).toBe('scene-2');
		expect(compositionEditHistory.undoLabel).toBe('Remove Scene "scene-1"');

		await fireEvent.click(
			screen.getByRole('button', { name: `Remove ${requireStarter(SCENE_STARTERS[1]).name}` })
		);
		await waitFor(() => expect(segmentIds()).toEqual(['scene-3']));
		expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
	});

	it('removes the open Scene with Delete or Backspace on its segment, and no other', async () => {
		render(FilmSceneStrip);

		// A segment that is not the open Scene is not removed by the key.
		await fireEvent.keyDown(segmentButtons()[1], { key: 'Delete' });
		expect(segmentIds()).toEqual(['scene-1', 'scene-2', 'scene-3']);

		await fireEvent.keyDown(segmentButtons()[0], { key: 'Delete' });
		await waitFor(() => expect(segmentIds()).toEqual(['scene-2', 'scene-3']));

		await fireEvent.keyDown(segmentButtons()[0], { key: 'Backspace' });
		await waitFor(() => expect(segmentIds()).toEqual(['scene-3']));

		// The last Scene stays.
		await fireEvent.keyDown(segmentButtons()[0], { key: 'Delete' });
		expect(segmentIds()).toEqual(['scene-3']);
	});

	it('reorders a Scene dragged along the strip', async () => {
		render(FilmSceneStrip);
		layOutTrack();

		// Press on the last Scene, drag to the start of the strip, let go.
		await fireEvent.pointerDown(segmentButtons()[2], { button: 0, clientX: 950 });
		await fireEvent(window, new MouseEvent('pointermove', { clientX: 5 }));
		await fireEvent(window, new MouseEvent('pointerup', { clientX: 5 }));

		await waitFor(() => expect(segmentIds()).toEqual(['scene-3', 'scene-1', 'scene-2']));
		expect(compositionEditHistory.undoLabel).toBe('Move Scene "scene-3"');
		// The click that ends the drag selects nothing.
		await fireEvent.click(segmentButtons()[0], { detail: 1, clientX: 5 });
		expect(filmState.selectedSceneId).toBe('scene-1');
	});

	it('lists the Starters as poster cards behind `+` and adds the chosen one as the last Scene', async () => {
		render(FilmSceneStrip);
		expect(screen.getByRole('button', { name: 'Add Scene' })).not.toBeNull();
		const picked = requireStarter(PICKED_STARTER);

		const picker = await openStarterPicker();

		// Every deliverable Starter, and nothing else, each a button named for it.
		const cards = within(picker).getAllByRole('button', IN_POPOVER);
		expect(cards).toHaveLength(listPresets().length);
		expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(
			listPresets()
				.map((entry) => entry.preset.name)
				.toSorted((a, b) => a.localeCompare(b))
		);
		expect(within(picker).queryByRole('link', IN_POPOVER)).toBeNull();
		expect(within(picker).queryByRole('heading', IN_POPOVER)).toBeNull();

		await fireEvent.click(within(picker).getByRole('button', { name: picked.name, ...IN_POPOVER }));

		// The operation loads the Starter's renderer modules before it applies.
		await waitFor(
			() => expect(segmentIds()).toEqual(['scene-1', 'scene-2', 'scene-3', 'scene-4']),
			RENDERER_LOAD_WAIT
		);
		expect(segmentButtons()[3].title).toBe(picked.name);
		expect(readOpenFilm().boundaries).toHaveLength(3);
		expect(readOpenFilm().scenes[3].origin?.slug).toBe(PICKED_STARTER);
		expect(HTMLElement.prototype.hidePopover).toHaveBeenCalled();
	});

	it('filters the Starters as the search field is typed in, by name or slug', async () => {
		render(FilmSceneStrip);
		const picker = await openStarterPicker();
		const search = within(picker).getByRole('searchbox', {
			name: 'Search Starters',
			...IN_POPOVER
		});
		const matching = listPresets().filter(
			(entry) =>
				entry.preset.name.toLowerCase().includes('checklist') || entry.slug.includes('checklist')
		);
		expect(matching.length).toBeGreaterThan(0);
		expect(matching.length).toBeLessThan(listPresets().length);

		await fireEvent.input(search, { target: { value: '  Checklist ' } });

		expect(within(picker).getAllByRole('button', IN_POPOVER)).toHaveLength(matching.length);

		await fireEvent.input(search, { target: { value: 'no starter is called this' } });
		expect(within(picker).queryAllByRole('button', IN_POPOVER)).toEqual([]);
	});
});
