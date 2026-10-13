import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMediaGrants } from './composition-media-grants.svelte';
import { compositionMeta } from './composition-meta.svelte';
import {
	runAddCompositionMediaLibraryEntryOperation,
	runAddCompositionVideoClipOperation,
	runInspectCompositionMediaOperation,
	runRemoveCompositionMediaLibraryEntryOperation,
	runRemoveCompositionVideoClipOperation,
	runUpdateCompositionVideoClipOperation,
	type CompositionMediaInspectionOutcome,
	type CompositionMediaInspectionReceipt
} from './composition-media-operations';
import { engineState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionMediaInspectionState } from './composition-media-inspection.svelte';
import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { CompositionWorkspaceFocus } from './composition-workspace-focus';
import type { UserVideoAssetDescriptor } from './user-video-asset';

const { inspectionStates } = vi.hoisted(() => ({
	inspectionStates: new Map<string, CompositionMediaInspectionState>()
}));

// The real inspection store probes bytes over the network. These operations only
// ever ask it two questions — "is this asset readable" and "how long is it" — so
// the test drives those answers directly instead of standing up a video server.
vi.mock('./composition-media-inspection.svelte', () => ({
	compositionMediaInspection: {
		read: (assetUrl: string): CompositionMediaInspectionState =>
			inspectionStates.get(assetUrl) ?? { status: 'idle' },
		ensure: (): Promise<void> => Promise.resolve(),
		seed: (descriptor: UserVideoAssetDescriptor): void => {
			inspectionStates.set(descriptor.url, { status: 'ready', metadata: descriptor });
		},
		forget: (assetUrl: string): void => {
			inspectionStates.delete(assetUrl);
		}
	}
}));

const READABLE_DIGEST = 'ab'.repeat(32);
const UNREADABLE_DIGEST = 'cd'.repeat(32);
const READABLE_GRANT = 'grant-abababababab';
const UNREADABLE_GRANT = 'grant-cdcdcdcdcdcd';

function descriptorFor(digest: string, durationSeconds: number): UserVideoAssetDescriptor {
	return {
		url: `/api/user-assets/${digest}.mp4`,
		mime: 'video/mp4',
		sizeBytes: 4096,
		durationSeconds,
		displayWidth: 1920,
		displayHeight: 1080,
		rotation: 0,
		averageFrameRate: 30,
		videoCodec: 'avc1.640028',
		hasAudio: false
	};
}

function expectApplied(outcome: CompositionOperationOutcome): {
	changed: readonly string[];
	focus: CompositionWorkspaceFocus;
	revision: number;
} {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return { changed: outcome.changed.pointers, focus: outcome.focus, revision: outcome.revision };
}

function expectFailed(
	outcome: CompositionOperationOutcome | CompositionMediaInspectionOutcome
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the media edit applied.');
	}
	return outcome;
}

function expectInspected(
	outcome: CompositionMediaInspectionOutcome
): CompositionMediaInspectionReceipt {
	if (outcome.status !== 'inspected') {
		throw new Error(`Expected a media reading but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

/** The library entry every clip test cuts from: 12 seconds of readable source. */
async function addReadableLibraryEntry(expectedRevision = 0): Promise<void> {
	compositionMediaGrants.record('holiday.mp4', descriptorFor(READABLE_DIGEST, 12));
	expectApplied(
		await runAddCompositionMediaLibraryEntryOperation({ expectedRevision, grantId: READABLE_GRANT })
	);
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	compositionMediaGrants.clear();
	inspectionStates.clear();
});

describe('media library entries', () => {
	it('reports an empty library and the frame grid a cut lands on', async () => {
		const receipt = expectInspected(await runInspectCompositionMediaOperation());

		expect(receipt.entries).toEqual([]);
		expect(receipt.clips).toEqual([]);
		expect(receipt.addableGrantIds).toEqual([]);
		expect(receipt.frameCount).toBe(180);
		expect(receipt.contentTrust).toBe('untrusted');
	});

	it('refuses to add media when nobody has granted this page a file', async () => {
		const failure = expectFailed(
			await runAddCompositionMediaLibraryEntryOperation({
				expectedRevision: 0,
				grantId: READABLE_GRANT
			})
		);

		expect(failure.code).toBe('consent_required');
		expect(failure.message).toMatch(/drop a file on the Media rail/);
	});

	it('refuses a grant the visitor never made, naming the ones they did', async () => {
		compositionMediaGrants.record('holiday.mp4', descriptorFor(READABLE_DIGEST, 12));

		const failure = expectFailed(
			await runAddCompositionMediaLibraryEntryOperation({
				expectedRevision: 0,
				grantId: 'grant-000000000000'
			})
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.alternatives).toEqual([READABLE_GRANT]);
	});

	it('adds a granted file and reveals it on the Media rail', async () => {
		compositionMediaGrants.record('holiday.mp4', descriptorFor(READABLE_DIGEST, 12));

		const receipt = expectApplied(
			await runAddCompositionMediaLibraryEntryOperation({
				expectedRevision: 0,
				grantId: READABLE_GRANT
			})
		);

		expect(receipt.changed).toEqual(['/state/media/assets']);
		expect(receipt.focus).toEqual({ target: 'media-library' });
		expect(engineState.media.assets).toEqual([
			{
				id: 'video-1',
				kind: 'video',
				name: 'holiday.mp4',
				assetUrl: `/api/user-assets/${READABLE_DIGEST}.mp4`
			}
		]);
	});

	it('refuses to add the same bytes twice, naming the entry that already holds them', async () => {
		await addReadableLibraryEntry();

		const failure = expectFailed(
			await runAddCompositionMediaLibraryEntryOperation({
				expectedRevision: 1,
				grantId: READABLE_GRANT
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['video-1']);
	});

	it('ends as cancelled when the caller withdraws before the edit applies', async () => {
		compositionMediaGrants.record('holiday.mp4', descriptorFor(READABLE_DIGEST, 12));
		const controller = new AbortController();
		controller.abort();

		const failure = expectFailed(
			await runAddCompositionMediaLibraryEntryOperation({
				expectedRevision: 0,
				grantId: READABLE_GRANT,
				signal: controller.signal
			})
		);

		expect(failure.code).toBe('cancelled');
		expect(engineState.media.assets).toEqual([]);
	});

	it('reports what the browser can and cannot reach, and which grants are still addable', async () => {
		await addReadableLibraryEntry();
		compositionMediaGrants.record('unreachable.mp4', descriptorFor(UNREADABLE_DIGEST, 4));
		inspectionStates.set(`/api/user-assets/${UNREADABLE_DIGEST}.mp4`, {
			status: 'error',
			message: 'Cannot inspect the asset.'
		});

		const receipt = expectInspected(await runInspectCompositionMediaOperation());

		expect(receipt.entries).toEqual([
			{
				assetId: 'video-1',
				name: 'holiday.mp4',
				availability: 'ready',
				sourceDurationSeconds: 12,
				unreachableReason: null,
				clipIds: []
			}
		]);
		expect(receipt.addableGrantIds).toEqual([UNREADABLE_GRANT]);
	});

	it('keeps a referenced entry, naming the clips that still need it', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 60
			})
		);

		const failure = expectFailed(
			await runRemoveCompositionMediaLibraryEntryOperation({
				expectedRevision: 2,
				assetId: 'video-1'
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.alternatives).toEqual(['video-1:clip']);
	});

	it('removes an unreferenced entry', async () => {
		await addReadableLibraryEntry();

		expectApplied(
			await runRemoveCompositionMediaLibraryEntryOperation({
				expectedRevision: 1,
				assetId: 'video-1'
			})
		);

		expect(engineState.media.assets).toEqual([]);
	});

	it('refuses an entry this composition does not carry', async () => {
		const failure = expectFailed(
			await runRemoveCompositionMediaLibraryEntryOperation({
				expectedRevision: 0,
				assetId: 'video-9'
			})
		);

		expect(failure.code).toBe('unknown_target');
		expect(failure.rejected).toBe('video-9');
	});
});

describe('video track clips', () => {
	it('normalizes direct time units onto exact clip frames', async () => {
		await addReadableLibraryEntry();

		const receipt = expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: { seconds: 1 },
				durationFrames: { milliseconds: 2000 }
			})
		);

		expect(receipt.focus).toEqual({ target: 'video-clip', clipId: 'video-1:clip' });
		expect(engineState.media.videoTrack.clips).toEqual([
			{
				id: 'video-1:clip',
				assetId: 'video-1',
				timelineStartFrame: 30,
				durationFrames: 60,
				sourceStartSeconds: 0,
				audio: { enabled: true, gain: 1 }
			}
		]);
	});

	it('takes every frame that legally fits when no duration is named', async () => {
		await addReadableLibraryEntry();

		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 120
			})
		);

		expect(engineState.media.videoTrack.clips[0].durationFrames).toBe(60);
	});

	it('refuses a cut longer than the source can supply', async () => {
		compositionMediaGrants.record('short.mp4', descriptorFor(READABLE_DIGEST, 1));
		expectApplied(
			await runAddCompositionMediaLibraryEntryOperation({
				expectedRevision: 0,
				grantId: READABLE_GRANT
			})
		);

		const failure = expectFailed(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 90
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['30']);
	});

	it('refuses a cut that would overlap a clip already on the track', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 60
			})
		);

		const failure = expectFailed(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 2,
				assetId: 'video-1',
				timelineStartFrame: 30,
				durationFrames: 60
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['video-1:clip occupies 0–60']);
		expect(engineState.media.videoTrack.clips).toHaveLength(1);
	});

	it('refuses a start frame outside the composition', async () => {
		await addReadableLibraryEntry();

		const failure = expectFailed(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 180
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['0', '179']);
	});

	it('refuses a cut from bytes this browser cannot read', async () => {
		compositionMediaGrants.record('holiday.mp4', descriptorFor(READABLE_DIGEST, 12));
		expectApplied(
			await runAddCompositionMediaLibraryEntryOperation({
				expectedRevision: 0,
				grantId: READABLE_GRANT
			})
		);
		inspectionStates.set(`/api/user-assets/${READABLE_DIGEST}.mp4`, {
			status: 'error',
			message: 'Cannot inspect the asset.'
		});

		const failure = expectFailed(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 30
			})
		);

		expect(failure.code).toBe('precondition_unmet');
		expect(failure.message).toMatch(/Cannot inspect the asset/);
	});

	it('moves a clip to an exact frame', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 60
			})
		);

		expectApplied(
			await runUpdateCompositionVideoClipOperation({
				expectedRevision: 2,
				clipId: 'video-1:clip',
				edit: { kind: 'move', timelineStartFrame: { timecode: '00:00:03:00' } }
			})
		);

		expect(engineState.media.videoTrack.clips[0].timelineStartFrame).toBe(90);
	});

	it('refuses a move past the end of the composition, naming the nearest legal frame', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 60
			})
		);

		const failure = expectFailed(
			await runUpdateCompositionVideoClipOperation({
				expectedRevision: 2,
				clipId: 'video-1:clip',
				edit: { kind: 'move', timelineStartFrame: 150 }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['120']);
		expect(engineState.media.videoTrack.clips[0].timelineStartFrame).toBe(0);
	});

	it('trims a clip end on an exact frame', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 60
			})
		);

		expectApplied(
			await runUpdateCompositionVideoClipOperation({
				expectedRevision: 2,
				clipId: 'video-1:clip',
				edit: { kind: 'trim-end', timelineEndFrame: 45 }
			})
		);

		expect(engineState.media.videoTrack.clips[0].durationFrames).toBe(45);
	});

	it('slips the source under a clip without moving it on the timeline', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 60
			})
		);

		expectApplied(
			await runUpdateCompositionVideoClipOperation({
				expectedRevision: 2,
				clipId: 'video-1:clip',
				edit: { kind: 'slip', sourceStartFrame: 30 }
			})
		);

		const clip = engineState.media.videoTrack.clips[0];
		expect(clip.sourceStartSeconds).toBeCloseTo(1, 10);
		expect(clip.timelineStartFrame).toBe(0);
		expect(clip.durationFrames).toBe(60);
	});

	it('refuses an edit to a clip that is not on the track', async () => {
		await addReadableLibraryEntry();

		const failure = expectFailed(
			await runUpdateCompositionVideoClipOperation({
				expectedRevision: 1,
				clipId: 'video-9:clip',
				edit: { kind: 'move', timelineStartFrame: 0 }
			})
		);

		expect(failure.code).toBe('unknown_target');
	});

	it('removes a clip and returns focus to the composition', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 60
			})
		);

		const receipt = expectApplied(
			await runRemoveCompositionVideoClipOperation({
				expectedRevision: 2,
				clipId: 'video-1:clip'
			})
		);

		expect(receipt.focus).toEqual({ target: 'composition-root' });
		expect(engineState.media.videoTrack.clips).toEqual([]);
	});

	it('reports each clip in exact frames alongside the entry it was cut from', async () => {
		await addReadableLibraryEntry();
		expectApplied(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 1,
				assetId: 'video-1',
				timelineStartFrame: 30,
				durationFrames: 60,
				sourceStartFrame: 60
			})
		);

		const receipt = expectInspected(await runInspectCompositionMediaOperation());

		expect(receipt.clips).toEqual([
			{
				clipId: 'video-1:clip',
				assetId: 'video-1',
				timelineStartFrame: 30,
				timelineEndFrame: 90,
				durationFrames: 60,
				sourceStartFrame: 60,
				audioEnabled: true,
				audioGain: 1
			}
		]);
		expect(receipt.entries[0].clipIds).toEqual(['video-1:clip']);
	});
});

describe('media operation preconditions', () => {
	it('refuses every media operation while no composition is open', async () => {
		compositionMeta.userCompositionSlug = null;

		expect(expectFailed(await runInspectCompositionMediaOperation()).code).toBe(
			'no_composition_open'
		);
		expect(
			expectFailed(
				await runAddCompositionMediaLibraryEntryOperation({
					expectedRevision: 0,
					grantId: READABLE_GRANT
				})
			).code
		).toBe('no_composition_open');
	});

	it('refuses an edit made against a revision the composition has moved past', async () => {
		await addReadableLibraryEntry();

		const failure = expectFailed(
			await runAddCompositionVideoClipOperation({
				expectedRevision: 0,
				assetId: 'video-1',
				timelineStartFrame: 0,
				durationFrames: 30
			})
		);

		expect(failure.code).toBe('stale_revision');
		expect(failure.revision).toBe(1);
	});
});
