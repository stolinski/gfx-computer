import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { addOverlay, removeOverlay } from './engine-state.svelte';
import { applyFilm, applyPreset } from './preset';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMediaGrants } from './composition-media-grants.svelte';
import { compositionMeta } from './composition-meta.svelte';
import { filmFromPreset } from './film-ingress';
import { filmState } from './film-state.svelte';
import { parsePresetIngress } from './preset-ingress';
import {
	completeWebmcpRegistrationState,
	readWebmcpCompositionPreconditions,
	readWebmcpSessionCompositionPresence
} from './webmcp-tool-preconditions.ts';
import { userCompositionStore } from './user-composition-store';

import type { UserCompositionMeta } from './user-composition-store';
import type { UserVideoAssetDescriptor } from './user-video-asset';

vi.mock('./user-composition-store', () => ({
	userCompositionStore: {
		listUserCompositions: vi.fn(),
		loadUserComposition: vi.fn(),
		createUserComposition: vi.fn(),
		saveUserComposition: vi.fn(),
		deleteUserComposition: vi.fn()
	}
}));

const sessionStore = vi.mocked(userCompositionStore);

const SESSION_ENTRY: UserCompositionMeta = {
	slug: 'untitled',
	name: 'Untitled',
	forkedFrom: null,
	savedAt: '2026-08-29T12:00:00.000Z',
	posterKey: null,
	durationSeconds: 6,
	sceneCount: 1,
	surfaceType: 'plain',
	media: { assets: [], videoTrack: { clips: [] } },
	mediaStatus: 'ready'
};

const GRANTED_ASSET: UserVideoAssetDescriptor = {
	url: `/api/user-assets/${'a'.repeat(64)}.mp4`,
	mime: 'video/mp4',
	sizeBytes: 5,
	durationSeconds: 12,
	displayWidth: 1920,
	displayHeight: 1080,
	rotation: 0,
	averageFrameRate: 30,
	videoCodec: 'avc',
	hasAudio: false
};

function openBlankComposition(): void {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	compositionEditHistory.clear();
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStore.listUserCompositions.mockResolvedValue([]);
	compositionMediaGrants.clear();
	compositionMeta.userCompositionSlug = null;
	compositionMeta.forkedFrom = null;
	compositionEditHistory.clear();
	applyPreset(parsePresetIngress(blankPresetJson));
});

describe('WebMCP preconditions on a cold page', () => {
	it('answers only `always` while no composition is open', () => {
		compositionMeta.userCompositionSlug = null;
		const state = readWebmcpCompositionPreconditions();

		expect(state.always).toBe(true);
		expect(Object.entries(state).filter(([, met]) => met)).toEqual([['always', true]]);
	});
});

describe('WebMCP preconditions with a composition open', () => {
	beforeEach(openBlankComposition);

	it('opens the editable surface and nothing that needs an element', () => {
		const state = readWebmcpCompositionPreconditions();

		expect(state['composition-open']).toBe(true);
		expect(state['composition-editable']).toBe(true);
		expect(state['overlay-present']).toBe(false);
		expect(state['undo-available']).toBe(false);
	});

	it('reports a corpus Preset as unsaved, and a stored Film as not', () => {
		compositionMeta.isUserComposition = false;
		expect(readWebmcpCompositionPreconditions()['composition-unsaved']).toBe(true);

		compositionMeta.isUserComposition = true;
		expect(readWebmcpCompositionPreconditions()['composition-unsaved']).toBe(false);
		compositionMeta.isUserComposition = false;
	});

	it('opens the Scene tools for a stored Film, and the multi-Scene ones only past one Scene', () => {
		compositionMeta.isUserComposition = false;
		expect(readWebmcpCompositionPreconditions()['film-stored']).toBe(false);
		expect(readWebmcpCompositionPreconditions()['film-multi-scene']).toBe(false);

		compositionMeta.isUserComposition = true;
		expect(readWebmcpCompositionPreconditions()['film-stored']).toBe(true);
		// One Scene: nothing to remove, reorder, or select.
		expect(readWebmcpCompositionPreconditions()['film-multi-scene']).toBe(false);

		const blank = parsePresetIngress(blankPresetJson);
		const film = filmFromPreset(blank, null);
		applyFilm(
			{
				...film,
				scenes: [...film.scenes, { id: 'scene-2', origin: null, state: blank.state }],
				boundaries: [{ kind: 'cut' }]
			},
			{ kind: 'deliverable' }
		);
		expect(readWebmcpCompositionPreconditions()['film-multi-scene']).toBe(true);
		// A cut has no window: the magic-move tools wait for a fade or an effect.
		expect(readWebmcpCompositionPreconditions()['film-window-boundary']).toBe(false);
		filmState.boundaries = [{ kind: 'fade', durationMs: 500 }];
		expect(readWebmcpCompositionPreconditions()['film-window-boundary']).toBe(true);

		filmState.isSwappingScene = true;
		expect(readWebmcpCompositionPreconditions()['film-window-boundary']).toBe(false);
		expect(readWebmcpCompositionPreconditions()['film-stored']).toBe(false);
		expect(readWebmcpCompositionPreconditions()['film-multi-scene']).toBe(false);
		filmState.isSwappingScene = false;
		compositionMeta.isUserComposition = false;
	});

	it('closes editing while a Scene swap has not settled', () => {
		filmState.isSwappingScene = true;
		const state = readWebmcpCompositionPreconditions();
		filmState.isSwappingScene = false;

		expect(state['composition-open']).toBe(true);
		expect(state['composition-editable']).toBe(false);
	});

	it('follows the Overlay in and out of the composition', () => {
		expect(readWebmcpCompositionPreconditions()['overlay-present']).toBe(false);

		const overlayId = addOverlay({
			type: 'watermark',
			position: { anchor: 'bottom-right' },
			content: {}
		});
		expect(readWebmcpCompositionPreconditions()['overlay-present']).toBe(true);

		removeOverlay(overlayId);
		expect(readWebmcpCompositionPreconditions()['overlay-present']).toBe(false);
	});

	it('waits for the visitor to grant a file before media may be added', () => {
		expect(readWebmcpCompositionPreconditions()['media-permitted']).toBe(false);

		compositionMediaGrants.record('clip.mp4', GRANTED_ASSET);
		expect(readWebmcpCompositionPreconditions()['media-permitted']).toBe(true);
	});
});

describe('WebMCP session presence', () => {
	it('is false for an empty session and true once it holds a composition', async () => {
		expect(await readWebmcpSessionCompositionPresence()).toBe(false);

		sessionStore.listUserCompositions.mockResolvedValue([SESSION_ENTRY]);
		expect(await readWebmcpSessionCompositionPresence()).toBe(true);
	});

	it('answers no rather than registering a tool it cannot store through', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		sessionStore.listUserCompositions.mockRejectedValue(new Error('storage denied'));

		expect(await readWebmcpSessionCompositionPresence()).toBe(false);
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});

	it('completes the registration state with the catalog answer', () => {
		const state = completeWebmcpRegistrationState(readWebmcpCompositionPreconditions(), true);
		expect(state['session-composition-present']).toBe(true);
	});

	it('offers adding the open Starter to a Film only when one is unsaved and a Film exists', () => {
		openBlankComposition();
		compositionMeta.isUserComposition = false;
		const unsaved = readWebmcpCompositionPreconditions();
		expect(completeWebmcpRegistrationState(unsaved, true)['open-addable-to-film']).toBe(true);
		// No Film to add it to.
		expect(completeWebmcpRegistrationState(unsaved, false)['open-addable-to-film']).toBe(false);

		// A stored Film is not added to another Film.
		compositionMeta.isUserComposition = true;
		expect(
			completeWebmcpRegistrationState(readWebmcpCompositionPreconditions(), true)[
				'open-addable-to-film'
			]
		).toBe(false);
		compositionMeta.isUserComposition = false;

		// Nothing open.
		compositionMeta.userCompositionSlug = null;
		expect(
			completeWebmcpRegistrationState(readWebmcpCompositionPreconditions(), true)[
				'open-addable-to-film'
			]
		).toBe(false);
	});
});
