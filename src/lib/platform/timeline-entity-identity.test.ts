import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	createKeyframeSelectionId,
	createSoundRailReferenceId,
	createTimelineTrackId,
	createVideoClipSelectionId,
	parseKeyframeSelectionId,
	parseSoundRailReferenceId,
	parseTimelineTrackId,
	parseVideoClipSelectionId,
	type SoundRailReference,
	type TimelineTrackIdentity
} from './timeline-entity-identity.ts';

describe('timeline entity identity', () => {
	it('round-trips every track kind without suffix guessing', () => {
		const identities: TimelineTrackIdentity[] = [
			{ kind: 'surface' },
			{ kind: 'surface-message', index: 2 },
			{ kind: 'checklist-item', index: 3 },
			{ kind: 'mark', index: 4 },
			{ kind: 'overlay', overlayId: 'lower-third-roll-stack-spin-beat-cursor-1' },
			{ kind: 'overlay-subtrack', overlayId: 'lower-third-roll', subtrack: { kind: 'stack' } },
			{ kind: 'overlay-subtrack', overlayId: 'tweet-stack', subtrack: { kind: 'pile' } },
			{ kind: 'overlay-subtrack', overlayId: 'counter-stack', subtrack: { kind: 'roll' } },
			{ kind: 'overlay-subtrack', overlayId: 'cta-spin', subtrack: { kind: 'beat' } },
			{ kind: 'overlay-subtrack', overlayId: 'hero-beat', subtrack: { kind: 'spin' } },
			{
				kind: 'overlay-subtrack',
				overlayId: 'cursor-roll-stack',
				subtrack: { kind: 'cursor', index: 5 }
			},
			{ kind: 'block', blockId: 'revenue-roll-stack-spin-beat' },
			{ kind: 'block-subtrack', blockId: 'revenue-roll', subtrack: { kind: 'roll' } },
			{ kind: 'text-animation', textAnimationId: 'title-roll-stack' },
			{ kind: 'effect', effectId: 'pixelation-1:roll' },
			{ kind: 'captions' },
			{ kind: 'video' },
			{ kind: 'sound' },
			{ kind: 'stage-camera' },
			{ kind: 'stage-focus' },
			{ kind: 'stage-body', bodyId: 'screen' }
		];

		for (const identity of identities) {
			const id = createTimelineTrackId(identity);
			assert.deepEqual(parseTimelineTrackId(id), identity, id);
		}

		assert.notEqual(
			createTimelineTrackId({ kind: 'overlay', overlayId: 'notice-roll' }),
			createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: 'notice',
				subtrack: { kind: 'roll' }
			})
		);
	});

	it('round-trips ids containing separators and unicode', () => {
		const identity: TimelineTrackIdentity = {
			kind: 'overlay',
			overlayId: 'launch:hero/β - roll'
		};
		assert.deepEqual(parseTimelineTrackId(createTimelineTrackId(identity)), identity);
	});

	it('rejects invalid and non-canonical track identities', () => {
		for (const value of [
			'',
			'overlay-',
			'overlay:notice:roll',
			'overlay-subtrack:notice:cursor:-1',
			'overlay-subtrack:notice:cursor:01',
			'block-subtrack:notice:spin',
			'textanim:title',
			'text-animation:',
			'overlay:%ZZ',
			'overlay:launch%2fhero',
			'overlay-subtrack:notice:cursor:1:extra',
			'mark:1.5'
		]) {
			assert.equal(parseTimelineTrackId(value), null, value);
		}
	});

	it('round-trips keyframe selections with encoded track and channel identities', () => {
		const trackId = createTimelineTrackId({
			kind: 'overlay',
			overlayId: 'hero-roll:stack'
		});
		const id = createKeyframeSelectionId(trackId, 'custom:rotation-axis', 12);
		assert.deepEqual(parseKeyframeSelectionId(id), {
			trackId,
			channel: 'custom:rotation-axis',
			index: 12
		});
		assert.equal(parseKeyframeSelectionId('keyframe:overlay%3Ahero:opacity:-1'), null);
		assert.equal(parseKeyframeSelectionId('keyframe:not-a-track:opacity:0'), null);
		assert.equal(parseKeyframeSelectionId('keyframe:surface::0'), null);
	});

	it('round-trips derived and manual sound rail references', () => {
		const references: SoundRailReference[] = [
			{ kind: 'derived', cueId: 'overlay:hero-roll:enter' },
			{ kind: 'manual', cueId: 'outro-sting-roll:final' }
		];
		for (const reference of references) {
			assert.deepEqual(parseSoundRailReferenceId(createSoundRailReferenceId(reference)), reference);
		}
		assert.equal(parseSoundRailReferenceId('sound-reference:automatic:cue'), null);
		assert.equal(parseSoundRailReferenceId('sound-reference:derived:'), null);
		assert.equal(parseSoundRailReferenceId('sound-reference:manual:cue:extra'), null);
	});

	it('round-trips video clip selections without confusing clips with tracks', () => {
		const id = createVideoClipSelectionId('opening:take/β');
		assert.deepEqual(parseVideoClipSelectionId(id), { clipId: 'opening:take/β' });
		assert.equal(parseTimelineTrackId(id), null);
		assert.equal(parseVideoClipSelectionId('video-clip:'), null);
		assert.equal(parseVideoClipSelectionId('video-clip:opening:extra'), null);
		assert.equal(parseVideoClipSelectionId('video-clip:opening%2ftake'), null);
	});

	it('fails fast when constructing invalid identities', () => {
		assert.throws(() => createTimelineTrackId({ kind: 'overlay', overlayId: '' }), TypeError);
		assert.throws(() => createTimelineTrackId({ kind: 'mark', index: -1 }), TypeError);
		assert.throws(
			() => createKeyframeSelectionId(createTimelineTrackId({ kind: 'surface' }), '', 0),
			TypeError
		);
		assert.throws(() => createSoundRailReferenceId({ kind: 'manual', cueId: '' }), TypeError);
		assert.throws(() => createVideoClipSelectionId(''), TypeError);
	});

	// A missing identity used to surface as `Cannot read properties of undefined
	// (reading 'kind')` from inside a Svelte derivation, and an unhandled kind
	// returned `undefined` wearing the `TimelineTrackId` brand (GFX-COMPUTER-22).
	it('names the offending value instead of minting an undefined track id', () => {
		const missing = undefined as unknown as TimelineTrackIdentity;
		assert.throws(() => createTimelineTrackId(missing), {
			name: 'TypeError',
			message: 'Timeline entity identity: track identity must name a kind, received undefined.'
		});
		assert.throws(() => createTimelineTrackId({} as unknown as TimelineTrackIdentity), {
			name: 'TypeError',
			message:
				'Timeline entity identity: track identity must name a kind, received an identity without a kind.'
		});
		assert.throws(() => createTimelineTrackId({ kind: 'scene' } as unknown as TimelineTrackIdentity), {
			name: 'TypeError',
			message: 'Timeline entity identity: unsupported track kind scene.'
		});
		assert.throws(() => createTimelineTrackId({ kind: 'stage-body', bodyId: '' }), TypeError);
		assert.equal(parseTimelineTrackId('stage-body:'), null);
		assert.equal(parseTimelineTrackId('stage-camera:1'), null);
	});
});
