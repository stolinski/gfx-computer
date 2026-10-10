import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import {
	runClearCompositionSessionOperation,
	runDeleteSessionCompositionOperation,
	runInspectCompositionSessionOperation,
	type CompositionSessionInspectionOutcome,
	type CompositionSessionInspectionReceipt,
	type CompositionSessionOutcome
} from './composition-session-operations';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { userCompositionStore } from './user-composition-store';

import type { CompositionLifecycleReceipt } from './composition-lifecycle-operations';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { Preset } from './engine-schema';
import type { UserCompositionMeta } from './user-composition-store';

vi.mock('./user-composition-store', () => ({
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

function sessionEntry(slug: string, name: string, preset: Preset): UserCompositionMeta {
	return {
		slug,
		name,
		forkedFrom: null,
		savedAt: '2026-08-28T12:00:00.000Z',
		posterKey: null,
		durationSeconds: preset.state.transport.durationSeconds,
		sceneCount: 1,
		surfaceType: preset.state.surface.type,
		media: preset.state.media,
		mediaStatus: 'ready'
	};
}

function expectInspected(
	outcome: CompositionSessionInspectionOutcome
): CompositionSessionInspectionReceipt {
	if (outcome.status !== 'inspected') {
		throw new Error(`Expected an inspection but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectApplied(outcome: CompositionSessionOutcome): CompositionLifecycleReceipt {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(
	outcome: CompositionSessionInspectionOutcome | CompositionSessionOutcome
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the session operation applied.');
	}
	return outcome;
}

let blankPreset: Preset;

beforeEach(() => {
	vi.clearAllMocks();
	blankPreset = parsePresetIngress(blankPresetJson);
	sessionStore.listUserCompositions.mockResolvedValue([
		sessionEntry('untitled', 'Untitled', blankPreset),
		sessionEntry('second-piece', 'Second piece', blankPreset)
	]);
	sessionStore.deleteUserComposition.mockResolvedValue(undefined);
	sessionStore.inspectStorage.mockResolvedValue({
		available: true,
		usedBytes: null,
		quotaBytes: null
	});

	applyPreset(blankPreset);
	compositionMeta.isUserComposition = false;
	compositionMeta.userCompositionSlug = null;
	compositionMeta.forkedFrom = null;
});

describe('session inspection', () => {
	it('lists what the session holds and carries the revision of the open composition', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = 'untitled';
		compositionEditHistory.recordApplied({
			label: 'Set orientation',
			undo: () => {},
			redo: () => {}
		});

		const receipt = expectInspected(await runInspectCompositionSessionOperation());

		expect(receipt.total).toBe(2);
		expect(receipt.truncated).toBe(false);
		expect(receipt.entries.map((entry) => entry.slug)).toEqual(['untitled', 'second-piece']);
		expect(receipt.entries[0].revision).toBe(1);
		expect(receipt.entries[1].revision).toBeNull();
	});

	it('reports storage the disk-backed development store cannot measure as unknown', async () => {
		const receipt = expectInspected(await runInspectCompositionSessionOperation());

		expect(receipt.storage).toEqual({ available: true, usedBytes: null, quotaBytes: null });
	});

	it('reports the room a store that measures itself has left', async () => {
		sessionStore.inspectStorage.mockResolvedValue({
			available: true,
			usedBytes: 24_576,
			quotaBytes: 4 * 1024 * 1024
		});

		const receipt = expectInspected(await runInspectCompositionSessionOperation());

		expect(receipt.storage).toEqual({
			available: true,
			usedBytes: 24_576,
			quotaBytes: 4 * 1024 * 1024
		});
	});

	it('reports a store that did not answer', async () => {
		sessionStore.listUserCompositions.mockRejectedValue(new Error('Store offline'));

		const failure = expectFailed(await runInspectCompositionSessionOperation());

		expect(failure.code).toBe('storage_unavailable');
		expect(failure.message).toContain('Store offline');
	});
});

describe('deleting one session composition', () => {
	it('removes the named composition and reports it against the session catalog', async () => {
		const receipt = expectApplied(
			await runDeleteSessionCompositionOperation({ slug: 'second-piece', expectedRevision: 0 })
		);

		expect(sessionStore.deleteUserComposition).toHaveBeenCalledWith('second-piece');
		expect(receipt.slug).toBe('second-piece');
		expect(receipt.focus).toBe('session-catalog');
	});

	it('refuses to delete the composition currently open and names what to use instead', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = 'untitled';

		const failure = expectFailed(
			await runDeleteSessionCompositionOperation({ slug: 'untitled', expectedRevision: 0 })
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['composition.open']);
		expect(failure.message).toContain('open another composition');
		expect(sessionStore.deleteUserComposition).not.toHaveBeenCalled();
	});

	it('refuses a slug this session does not hold and names the ones it does', async () => {
		const failure = expectFailed(
			await runDeleteSessionCompositionOperation({ slug: 'nothing-here', expectedRevision: 0 })
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.alternatives).toEqual(['untitled', 'second-piece']);
		expect(sessionStore.deleteUserComposition).not.toHaveBeenCalled();
	});

	it('refuses a stale revision before destroying anything', async () => {
		compositionEditHistory.recordApplied({ label: 'Set Pack', undo: () => {}, redo: () => {} });

		const failure = expectFailed(
			await runDeleteSessionCompositionOperation({ slug: 'second-piece', expectedRevision: 0 })
		);

		expect(failure.code).toBe('stale_revision');
		expect(sessionStore.deleteUserComposition).not.toHaveBeenCalled();
	});
});

describe('clearing the session', () => {
	it('deletes every composition once the caller confirms', async () => {
		const receipt = expectApplied(await runClearCompositionSessionOperation({ confirmed: true }));

		expect(sessionStore.deleteUserComposition).toHaveBeenCalledTimes(2);
		expect(receipt.slug).toBeNull();
		expect(receipt.focus).toBe('session-catalog');
	});

	it('refuses an unconfirmed clear, because nothing survives it', async () => {
		const failure = expectFailed(await runClearCompositionSessionOperation({ confirmed: false }));

		expect(failure.code).toBe('consent_required');
		expect(sessionStore.deleteUserComposition).not.toHaveBeenCalled();
	});

	it('refuses to clear while a composition is open and autosaving itself back', async () => {
		compositionMeta.isUserComposition = true;
		compositionMeta.userCompositionSlug = 'untitled';

		const failure = expectFailed(await runClearCompositionSessionOperation({ confirmed: true }));

		expect(failure.code).toBe('precondition_unmet');
		expect(sessionStore.deleteUserComposition).not.toHaveBeenCalled();
	});

	it('clears while a Starter is open read-only, because none of it is in the session', async () => {
		compositionMeta.isUserComposition = false;
		compositionMeta.userCompositionSlug = 'lower-third';

		expectApplied(await runClearCompositionSessionOperation({ confirmed: true }));

		expect(sessionStore.deleteUserComposition).toHaveBeenCalledTimes(2);
	});
});
