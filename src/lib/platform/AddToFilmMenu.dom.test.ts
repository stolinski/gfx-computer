// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import AddToFilmMenu from './AddToFilmMenu.svelte';
import { compositionMeta } from './composition-meta.svelte';
import { filmFromCorpusPreset, filmFromPreset } from './film-ingress';
import { filmState } from './film-state.svelte';
import { posterKeyForPreset } from './posters';
import { applyFilm } from './preset';
import { getPresetBySlug } from './preset-catalog';
import { parsePresetIngress } from './preset-ingress';
import { userCompositionStore } from './user-composition-store';

import type { UserCompositionMeta } from './user-composition-store';

const STORED_POSTER_KEY = '0123456789abcdef';

// The preset route's load lists the User composition posters the store holds.
vi.mock('$app/state', () => ({ page: { data: { posterKeys: ['0123456789abcdef'] } } }));

// The session store the menu lists and the operations write. The real module
// reads `$env/dynamic/public`, which the app shell injects and jsdom does not.
vi.mock('./user-composition-store', () => ({
	IS_ORIGIN_COMPOSITION_STORE_SERVED: true,
	userCompositionStore: {
		listUserCompositions: vi.fn(),
		loadUserComposition: vi.fn(),
		createUserComposition: vi.fn(),
		saveUserComposition: vi.fn(),
		deleteUserComposition: vi.fn(),
		inspectStorage: vi.fn()
	}
}));

const sessionStore = vi.mocked(userCompositionStore);

/** How long an operation that loads renderer modules may take under a busy test run. */
const RENDERER_LOAD_WAIT = { timeout: 20_000 } as const;

// jsdom keeps a popover closed, so the menu's entries are queried as hidden content.
const IN_POPOVER = { hidden: true } as const;

function storedFilm(
	entry: Pick<UserCompositionMeta, 'slug' | 'name' | 'savedAt' | 'posterKey' | 'sceneCount'>
): UserCompositionMeta {
	return {
		...entry,
		forkedFrom: null,
		durationSeconds: 6,
		surfaceType: 'plain',
		media: { assets: [], videoTrack: { clips: [] } },
		mediaStatus: 'ready'
	};
}

const OLDER_FILM = storedFilm({
	slug: 'launch-film',
	name: 'Launch film',
	savedAt: '2026-10-01T12:00:00.000Z',
	posterKey: STORED_POSTER_KEY,
	sceneCount: 3
});
const NEWER_FILM = storedFilm({
	slug: 'teaser',
	name: 'Teaser',
	savedAt: '2026-10-08T12:00:00.000Z',
	// A Film whose poster was never captured.
	posterKey: 'fedcba9876543210',
	sceneCount: 1
});

async function openMenu(): Promise<HTMLElement> {
	const menu = screen.getByRole('button', { name: 'New Film', ...IN_POPOVER }).parentElement;
	if (!menu) throw new Error('The menu has no popover.');
	const toggle = new Event('toggle');
	Object.defineProperty(toggle, 'newState', { value: 'open' });
	await fireEvent(menu, toggle);
	await waitFor(() => expect(sessionStore.listUserCompositions).toHaveBeenCalled());
	return menu;
}

beforeEach(() => {
	vi.clearAllMocks();
	HTMLElement.prototype.hidePopover = vi.fn();
	sessionStore.listUserCompositions.mockResolvedValue([OLDER_FILM, NEWER_FILM]);
	sessionStore.loadUserComposition.mockResolvedValue(null);
	sessionStore.createUserComposition.mockResolvedValue(undefined);
	sessionStore.saveUserComposition.mockResolvedValue(undefined);
	filmState.isSwappingScene = false;

	// An unsaved corpus Preset is open, as its page opens it.
	const starter = getPresetBySlug('lower-third');
	if (!starter) throw new Error('The corpus holds no Starter "lower-third".');
	applyFilm(
		filmFromCorpusPreset(starter, {
			slug: 'lower-third',
			contentKey: posterKeyForPreset(starter)
		}),
		{ kind: 'deliverable' }
	);
	compositionMeta.isUserComposition = false;
	compositionMeta.userCompositionSlug = 'lower-third';
	compositionMeta.persistenceError = null;
});

describe('the Add to Film menu', () => {
	it('is one topbar action', () => {
		render(AddToFilmMenu);

		expect(screen.getAllByRole('button')).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Add to Film' })).not.toBeNull();
	});

	it('lists New Film first, then the stored Films with their Scene counts, newest first', async () => {
		render(AddToFilmMenu);

		const menu = await openMenu();

		await waitFor(() => expect(within(menu).getAllByRole('button', IN_POPOVER)).toHaveLength(3));
		const entries = within(menu).getAllByRole('button', IN_POPOVER);
		expect(entries[0].textContent?.trim()).toBe('New Film');
		expect(entries[1].textContent).toContain('Teaser');
		expect(entries[1].textContent).toContain('1 Scene');
		expect(entries[1].textContent).not.toContain('1 Scenes');
		expect(entries[2].textContent).toContain('Launch film');
		expect(entries[2].textContent).toContain('3 Scenes');
	});

	it('shows a Film’s own poster when the store holds one, and its Surface default when not', async () => {
		render(AddToFilmMenu);
		const menu = await openMenu();
		await waitFor(() => expect(within(menu).getAllByRole('button', IN_POPOVER)).toHaveLength(3));

		const [, teaser, launchFilm] = within(menu).getAllByRole('button', IN_POPOVER);

		expect(launchFilm.querySelector('img')?.getAttribute('src')).toBe(
			`/api/posters/${STORED_POSTER_KEY}`
		);
		expect(teaser.querySelector('img')?.getAttribute('src')).toBe('/surface-posters/plain.webp');
		// `New Film` is a plain entry: no thumbnail.
		expect(
			within(menu)
				.getByRole('button', { name: 'New Film', ...IN_POPOVER })
				.querySelector('img')
		).toBeNull();
	});

	it('stores the open document as a Film of its own from New Film', async () => {
		render(AddToFilmMenu);
		const menu = await openMenu();

		await fireEvent.click(within(menu).getByRole('button', { name: 'New Film', ...IN_POPOVER }));

		await waitFor(
			() => expect(sessionStore.createUserComposition).toHaveBeenCalledTimes(1),
			RENDERER_LOAD_WAIT
		);
		expect(sessionStore.saveUserComposition).not.toHaveBeenCalled();
		await waitFor(() => expect(compositionMeta.isUserComposition).toBe(true));
		expect(filmState.scenes).toHaveLength(1);
	});

	it('adds the open document to the chosen Film as its last Scene', async () => {
		sessionStore.loadUserComposition.mockResolvedValue({
			film: filmFromPreset(parsePresetIngress({ ...blankPresetJson, name: 'Teaser' }), null),
			legacyPresetEnvelope: { kind: 'deliverable' }
		});
		render(AddToFilmMenu);
		const menu = await openMenu();
		await waitFor(() => expect(within(menu).getAllByRole('button', IN_POPOVER)).toHaveLength(3));

		await fireEvent.click(within(menu).getAllByRole('button', IN_POPOVER)[1]);

		await waitFor(
			() => expect(sessionStore.saveUserComposition).toHaveBeenCalledTimes(1),
			RENDERER_LOAD_WAIT
		);
		const [slug, stored] = sessionStore.saveUserComposition.mock.calls[0];
		expect(slug).toBe('teaser');
		expect(stored.film.scenes.map((scene) => scene.name)).toEqual([undefined, 'Lower-third']);
		expect(sessionStore.createUserComposition).not.toHaveBeenCalled();
		await waitFor(() => expect(compositionMeta.userCompositionSlug).toBe('teaser'));
		expect(filmState.selectedSceneId).toBe('scene-2');
		expect(HTMLElement.prototype.hidePopover).toHaveBeenCalled();
	});
});
