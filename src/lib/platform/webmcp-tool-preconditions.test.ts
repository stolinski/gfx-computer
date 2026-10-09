import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { addOverlay, removeOverlay, transitionState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { compositionEditHistory } from './composition-edit-history';
import { compositionMediaGrants } from './composition-media-grants.svelte';
import { compositionMeta } from './composition-meta.svelte';
import { filmState } from './film-state.svelte';
import { parsePresetIngress } from './preset-ingress';
import { presetBase } from './preset-base.svelte';
import {
	completeWebmcpRegistrationState,
	readWebmcpCompositionPreconditions,
	readWebmcpSessionCompositionPresence
} from './webmcp-tool-preconditions.ts';
import { userCompositionStore } from './user-composition-store';

import type { CompositionTransition } from './engine-schema';
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

const COMPOSITION_TRANSITION: CompositionTransition = {
	from: 'lower-third',
	to: 'quote-magnify',
	effect: 'wipe',
	durationMs: 400,
	params: {}
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
	transitionState.capturing = false;
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
		expect(state['transition-present']).toBe(false);
	});

	it('reports a corpus Preset as unsaved, and a stored Film as not', () => {
		compositionMeta.isUserComposition = false;
		expect(readWebmcpCompositionPreconditions()['composition-unsaved']).toBe(true);

		compositionMeta.isUserComposition = true;
		expect(readWebmcpCompositionPreconditions()['composition-unsaved']).toBe(false);
		compositionMeta.isUserComposition = false;
	});

	it('closes editing while a transition snapshot owns engine state', () => {
		transitionState.capturing = true;
		const state = readWebmcpCompositionPreconditions();

		expect(state['composition-open']).toBe(true);
		expect(state['composition-editable']).toBe(false);
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

	it('sees the composition transition the Preset carries', () => {
		presetBase.transition = COMPOSITION_TRANSITION;
		expect(readWebmcpCompositionPreconditions()['transition-present']).toBe(true);

		presetBase.transition = undefined;
		expect(readWebmcpCompositionPreconditions()['transition-present']).toBe(false);
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
});
