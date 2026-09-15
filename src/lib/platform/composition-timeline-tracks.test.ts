import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildCompositionTimelineTracks } from './composition-timeline-tracks.ts';
import {
	createDefaultEngineState,
	StageSchema,
	type ChartMotion,
	type EngineState
} from './engine-schema.ts';
import { createTimelineTrackId, createVideoClipSelectionId } from './timeline-entity-identity.ts';
import { isVideoTimelineTrack } from './timeline-track.ts';

function makeTimelineState(): EngineState {
	const state = createDefaultEngineState();
	state.transport = { orientation: 'horizontal', durationSeconds: 10, fps: 30, format: 'webm' };
	state.typography = { fontFamily: 'serif', paperColor: '#ffffff', inkColor: '#000000' };
	state.marks = {
		defaults: { highlight: { color: '#ffee00', intensity: 0.6 } },
		timings: [{ start: 0.3, duration: 0.1, ease: 'smooth' }]
	};
	state.surface = {
		type: 'plain',
		content: {
			title: 'Timeline',
			body: [
				{
					type: 'paragraph',
					segments: [{ text: 'Marked phrase', markStyles: ['highlight'] }]
				}
			]
		},
		enter: { start: 0, duration: 0.05, ease: 'settled' },
		exit: { start: 0.9, duration: 0.04, ease: 'smooth' },
		// Diagram primitive Block with its dedicated roll subtrack.
		diagram: [
			{
				type: 'stat-callout',
				id: 'revenue-roll',
				position: { x: 0.5, y: 0.5 },
				from: 0,
				to: 100,
				enter: { start: 0.2, duration: 0.05, ease: 'settled' },
				rollStart: 0.24,
				rollWindow: 0.3
			}
		]
	};
	state.textAnimations = [
		{
			id: 'title-reveal',
			target: { kind: 'surface', slot: 'title' },
			effect: 'soft-blur-in',
			enter: { start: 0.22, duration: 0.08, ease: 'smooth' }
		}
	];
	state.overlays = [
		{
			id: 'leader',
			type: 'lower-third',
			content: {},
			position: { anchor: 'center' },
			enter: { start: 0.1, duration: 0.05, ease: 'smooth' }
		},
		{
			id: 'follower:roll',
			type: 'lower-third',
			content: {},
			position: { anchor: 'center' },
			enter: { start: 0.8, duration: 0.05, ease: 'smooth' },
			animation: {
				cascade: { anchor: { overlay: 'leader' }, event: 'end', offsetMs: 200 }
			}
		},
		{
			id: 'counter-roll',
			type: 'counter',
			content: { rollStart: 0.15, rollWindow: 0.4 },
			position: { anchor: 'center' },
			enter: { start: 0.08, duration: 0.05, ease: 'settled' }
		}
	];
	state.effects = [];
	state.audioCues = [
		{ id: 'manual:sting', kind: 'cue', assetSlug: 'foley-complete', start: 0.75, duration: 0.1 }
	];
	state.media = { assets: [], videoTrack: { clips: [] } };
	return state;
}

const appearance = {
	paperColor: '#ffffff',
	inkColor: '#111111',
	resolveMarkColor: () => '#ffee00'
};

describe('composition timeline tracks', () => {
	it('constructs representative rows in the canonical order with typed ids', () => {
		const tracks = buildCompositionTimelineTracks(makeTimelineState(), appearance);
		assert.deepEqual(
			tracks.map((track) => track.id),
			[
				createTimelineTrackId({ kind: 'surface' }),
				createTimelineTrackId({ kind: 'mark', index: 0 }),
				createTimelineTrackId({ kind: 'block', blockId: 'revenue-roll' }),
				createTimelineTrackId({
					kind: 'block-subtrack',
					blockId: 'revenue-roll',
					subtrack: { kind: 'roll' }
				}),
				createTimelineTrackId({ kind: 'overlay', overlayId: 'leader' }),
				createTimelineTrackId({ kind: 'overlay', overlayId: 'follower:roll' }),
				createTimelineTrackId({ kind: 'overlay', overlayId: 'counter-roll' }),
				createTimelineTrackId({
					kind: 'overlay-subtrack',
					overlayId: 'counter-roll',
					subtrack: { kind: 'roll' }
				}),
				createTimelineTrackId({ kind: 'text-animation', textAnimationId: 'title-reveal' }),
				createTimelineTrackId({ kind: 'video' }),
				createTimelineTrackId({ kind: 'sound' })
			]
		);

		assert.equal(tracks[0].label, 'Surface');
		assert.match(tracks[2].label, /^stat ·/);
		assert.match(tracks[8].label, /^T · title/);
		assert.equal(tracks[9].label, 'Video');
		assert.ok(
			tracks[10].transitions.some((transition) => transition.soundReference?.kind === 'manual')
		);
	});

	it('always builds one fixed Video row and maps ordered canonical clips', () => {
		const emptyTracks = buildCompositionTimelineTracks(makeTimelineState(), appearance);
		const emptyVideo = emptyTracks.find(isVideoTimelineTrack);
		assert.ok(emptyVideo);
		assert.equal(emptyVideo.isRemovable, false);
		assert.deepEqual(emptyVideo.clips, []);

		const state = makeTimelineState();
		state.media = {
			assets: [
				{
					id: 'camera-a',
					kind: 'video',
					name: 'Opening interview camera',
					assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
				},
				{
					id: 'screen-b',
					kind: 'video',
					name: 'Screen capture',
					assetUrl: `/api/user-assets/${'b'.repeat(64)}.webm`
				}
			],
			videoTrack: {
				clips: [
					{
						id: 'opening:clip',
						assetId: 'camera-a',
						timelineStartFrame: 0,
						durationFrames: 60,
						sourceStartSeconds: 4.25,
						audio: { enabled: true, gain: 0.8 }
					},
					{
						id: 'demo',
						assetId: 'screen-b',
						timelineStartFrame: 90,
						durationFrames: 30,
						sourceStartSeconds: 1,
						audio: { enabled: false, gain: 1 }
					}
				]
			}
		};

		const tracks = buildCompositionTimelineTracks(state, appearance);
		const video = tracks.find(isVideoTimelineTrack);
		assert.ok(video);
		assert.deepEqual(video.clips, [
			{
				id: createVideoClipSelectionId('opening:clip'),
				clipId: 'opening:clip',
				assetId: 'camera-a',
				label: 'Opening interview camera',
				timelineStartFrame: 0,
				durationFrames: 60,
				sourceStartSeconds: 4.25,
				audio: { enabled: true, gain: 0.8 }
			},
			{
				id: createVideoClipSelectionId('demo'),
				clipId: 'demo',
				assetId: 'screen-b',
				label: 'Screen capture',
				timelineStartFrame: 90,
				durationFrames: 30,
				sourceStartSeconds: 1,
				audio: { enabled: false, gain: 1 }
			}
		]);
		const videoIndex = tracks.indexOf(video);
		const soundIndex = tracks.findIndex(
			(track) => track.id === createTimelineTrackId({ kind: 'sound' })
		);
		assert.equal(videoIndex, soundIndex - 1);
	});

	it('writes representative track edits back to the authored composition', () => {
		const state = makeTimelineState();
		const tracks = buildCompositionTimelineTracks(state, appearance);
		const find = (id: ReturnType<typeof createTimelineTrackId>) => {
			const track = tracks.find((entry) => entry.id === id);
			assert.ok(track, id);
			return track;
		};

		find(createTimelineTrackId({ kind: 'surface' })).transitions[0].unified?.setEnter?.(0.03, 0.07);
		assert.deepEqual(state.surface.enter, { start: 0.03, duration: 0.07, ease: 'settled' });

		find(createTimelineTrackId({ kind: 'mark', index: 0 })).transitions[0].unified?.setEnter?.(
			0.36,
			0.12
		);
		assert.equal(state.marks.timings[0].start, 0.36);
		assert.equal(state.marks.timings[0].duration, 0.12);

		find(
			createTimelineTrackId({
				kind: 'block-subtrack',
				blockId: 'revenue-roll',
				subtrack: { kind: 'roll' }
			})
		).transitions[0].onUpdate?.({ start: 0.4, duration: 0.2 });
		const statPrimitive = state.surface.diagram?.[0];
		assert.ok(statPrimitive?.type === 'stat-callout');
		assert.equal(statPrimitive.rollStart, 0.4);
		assert.equal(statPrimitive.rollWindow, 0.2);

		find(
			createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: 'counter-roll',
				subtrack: { kind: 'roll' }
			})
		).transitions[0].onUpdate?.({ start: 0.28, duration: 0.45 });
		assert.deepEqual(state.overlays[2].content, { rollStart: 0.28, rollWindow: 0.45 });

		const sound = find(createTimelineTrackId({ kind: 'sound' }));
		const manual = sound.transitions.find(
			(transition) => transition.soundReference?.kind === 'manual'
		);
		manual?.onUpdate?.({ start: 0.66, duration: 0.2 });
		assert.equal(state.audioCues[0].start, 0.66);
		assert.equal(state.audioCues[0].duration, 0.2);
	});

	it('resolves Cascade links and preserves the weld when a follower moves', () => {
		const state = makeTimelineState();
		const tracks = buildCompositionTimelineTracks(state, appearance);
		const follower = tracks.find(
			(track) => track.id === createTimelineTrackId({ kind: 'overlay', overlayId: 'follower:roll' })
		);
		assert.ok(follower);
		const clip = follower.transitions[0];
		assert.ok(Math.abs(clip.start - 0.17) < 1e-9);
		assert.equal(
			clip.cascade?.anchorTrackId,
			createTimelineTrackId({ kind: 'overlay', overlayId: 'leader' })
		);
		assert.ok(Math.abs((clip.cascade?.anchorFraction ?? 0) - 0.15) < 1e-9);

		clip.unified?.setEnter?.(0.27, 0.06);
		assert.equal(state.overlays[1].enter?.duration, 0.06);
		assert.ok(Math.abs((state.overlays[1].animation?.cascade?.offsetMs ?? 0) - 1200) < 1e-9);
	});

	it('gives every Kinetic Word a first-class full-clip Block row', () => {
		const state = makeTimelineState();
		state.surface.typeField = {
			words: [
				{
					type: 'kinetic-word',
					id: 'moving-type',
					text: 'BECOME',
					hierarchy: 'display',
					ink: 'accent',
					position: { x: 0.5, y: 0.5 },
					scale: 1,
					rotation: 0
				}
			],
			phrases: [{ id: 'middle', wordIds: ['moving-type'], focalWordId: 'moving-type' }]
		};

		const track = buildCompositionTimelineTracks(state, appearance).find(
			(candidate) =>
				candidate.id === createTimelineTrackId({ kind: 'block', blockId: 'moving-type' })
		);
		assert.ok(track);
		assert.equal(track.label, 'BECOME');
		assert.deepEqual(track.transitions[0], {
			id: 'clip',
			label: 'BECOME',
			color: '#c8a94e',
			start: 0,
			duration: 1
		});
	});

	it('exposes chart items through the shared Block timeline identity', () => {
		const state = makeTimelineState();
		state.surface.chart = {
			mode: 'single',
			items: [
				{
					id: 'agent-chart',
					type: 'column-chart',
					title: 'Agent count distribution',
					data: {
						categories: [{ id: 'multiple', label: '2–5' }],
						series: [
							{
								id: 'responses',
								label: 'Responses',
								values: [{ categoryId: 'multiple', value: 744 }]
							}
						]
					},
					layout: { mode: 'single' },
					domain: { min: 0, max: 800 },
					labels: { categories: true, values: true, legend: false },
					fill: { role: 'default' },
					motion: {
						entry: { start: 0.1, duration: 0.05, ease: 'sharp' },
						reveal: { start: 0.15, duration: 0.15 },
						emphasis: { start: 0.3, duration: 0.05 },
						annotation: { start: 0.35, duration: 0.05 },
						exit: { start: 0.8, duration: 0.1 }
					}
				}
			]
		};

		const tracks = buildCompositionTimelineTracks(state, appearance);
		const chartTrack = tracks.find(
			(track) => track.id === createTimelineTrackId({ kind: 'block', blockId: 'agent-chart' })
		);
		assert.ok(chartTrack);
		assert.equal(chartTrack.label, 'Agent count distribution');
		assert.deepEqual(
			chartTrack.transitions.map((transition) => transition.id),
			['entry', 'reveal', 'emphasis', 'annotation', 'exit']
		);
		assert.deepEqual(
			chartTrack.transitions.map((transition) => [transition.start, transition.duration]),
			[
				[0.1, 0.05],
				[0.15, 0.15],
				[0.3, 0.05],
				[0.35, 0.05],
				[0.8, 0.1]
			]
		);
		const phaseUpdates = [
			{ start: 0.11, duration: 0.03 },
			{ start: 0.16, duration: 0.13 },
			{ start: 0.31, duration: 0.03 },
			{ start: 0.36, duration: 0.03 },
			{ start: 0.81, duration: 0.08 }
		];
		for (let index = 0; index < chartTrack.transitions.length; index += 1) {
			const phaseName = chartTrack.transitions[index].id as keyof ChartMotion;
			const previousMotion: ChartMotion = structuredClone(state.surface.chart.items[0].motion);
			chartTrack.transitions[index].onUpdate?.(phaseUpdates[index]);
			assert.deepEqual(state.surface.chart.items[0].motion[phaseName], {
				...previousMotion[phaseName],
				...phaseUpdates[index]
			});
			for (const otherName of Object.keys(previousMotion) as (keyof ChartMotion)[]) {
				if (otherName !== phaseName) {
					assert.deepEqual(
						state.surface.chart.items[0].motion[otherName],
						previousMotion[otherName]
					);
				}
			}
		}
		assert.ok(Math.abs((chartTrack.transitions[1].minStart ?? 0) - 0.15) < 1e-12);
		assert.ok(Math.abs((chartTrack.transitions[1].maxDuration ?? 0) - 0.15) < 1e-12);
		const revealBeforeInvalidEdit = structuredClone(state.surface.chart.items[0].motion.reveal);
		chartTrack.transitions[1].onUpdate?.({ start: 0.14, duration: 0.15 });
		assert.deepEqual(state.surface.chart.items[0].motion.reveal, revealBeforeInvalidEdit);

		state.surface.chart.items[0].motion = {
			entry: { start: 0.1, duration: 0.001 },
			reveal: { start: 0.101, duration: 0.001 },
			emphasis: { start: 0.102, duration: 0.001 },
			annotation: { start: 0.103, duration: 0.001 },
			exit: { start: 0.104, duration: 0.001 }
		};
		const shortTrack = buildCompositionTimelineTracks(state, appearance).find(
			(track) => track.id === createTimelineTrackId({ kind: 'block', blockId: 'agent-chart' })
		);
		assert.ok(shortTrack);
		assert.deepEqual(
			shortTrack.transitions.map((transition) => transition.duration),
			[0.001, 0.001, 0.001, 0.001, 0.001]
		);
		assert.ok(
			shortTrack.transitions.every((transition) => transition.minDuration === Number.EPSILON)
		);
	});

	it('exposes a draggable tweet pile window that writes through to overlay content', () => {
		const state = makeTimelineState();
		state.overlays.push({
			id: 'reactions',
			type: 'tweet-stack',
			content: { pileStart: 0.08, pileWindow: 0.52 },
			position: { anchor: 'center' }
		});
		const trackId = createTimelineTrackId({
			kind: 'overlay-subtrack',
			overlayId: 'reactions',
			subtrack: { kind: 'pile' }
		});
		const track = buildCompositionTimelineTracks(state, appearance).find(
			(candidate) => candidate.id === trackId
		);
		assert.ok(track);
		assert.equal(track.label, 'tweet pile');
		track.transitions[0].onUpdate?.({ start: 0.2, duration: 0.44 });
		assert.deepEqual(state.overlays.at(-1)?.content, { pileStart: 0.2, pileWindow: 0.44 });
	});
});

describe('stage rows (ADR-0060)', () => {
	function makeStagedState(orientation: 'horizontal' | 'vertical'): EngineState {
		const state = makeTimelineState();
		state.transport.orientation = orientation;
		state.stage = StageSchema.parse({
			type: 'depth',
			camera: {
				pose: { yaw: 14, distance: 1.9 },
				travel: { to: { distance: 1.1 }, start: 0.1, duration: 0.6 },
				vertical: {
					pose: { yaw: 10, distance: 1.12 },
					travel: { to: { distance: 0.72 }, start: 0.2, duration: 0.5 }
				}
			},
			focus: { focusZ: 0, aperture: 0.35, band: 0.05, pull: { from: 0, to: 1, start: 0.3, duration: 0.2 } },
			screen: { model: 'crt-fw900' }
		});
		return state;
	}

	it('leads the outline with Camera, Focus, and one row per body while the stage is on', () => {
		const tracks = buildCompositionTimelineTracks(makeStagedState('horizontal'), appearance);
		assert.deepEqual(
			tracks.slice(0, 4).map((track) => track.id),
			[
				createTimelineTrackId({ kind: 'stage-camera' }),
				createTimelineTrackId({ kind: 'stage-focus' }),
				createTimelineTrackId({ kind: 'stage-body', bodyId: 'screen' }),
				createTimelineTrackId({ kind: 'surface' })
			]
		);
		assert.equal(tracks[0].label, 'Camera');
		assert.equal(tracks[1].label, 'Focus');
		assert.equal(tracks[2].label, 'CRT monitor (FW900)');
		assert.deepEqual(
			tracks[2].transitions.map((transition) => [transition.start, transition.duration]),
			[[0, 1]]
		);
	});

	it('shows no stage rows without a stage', () => {
		const tracks = buildCompositionTimelineTracks(makeTimelineState(), appearance);
		assert.equal(tracks[0].id, createTimelineTrackId({ kind: 'surface' }));
	});

	it('drags the travel and the rack focus back into the composition', () => {
		const state = makeStagedState('horizontal');
		const tracks = buildCompositionTimelineTracks(state, appearance);
		const travel = tracks[0].transitions[0];
		assert.deepEqual([travel.start, travel.duration], [0.1, 0.6]);
		travel.onUpdate?.({ start: 0.25, duration: 0.4 });
		assert.deepEqual(
			[state.stage?.camera.travel?.start, state.stage?.camera.travel?.duration],
			[0.25, 0.4]
		);
		const pull = tracks[1].transitions[0];
		pull.onUpdate?.({ start: 0.5, duration: 0.3 });
		assert.deepEqual([state.stage?.focus.pull?.start, state.stage?.focus.pull?.duration], [0.5, 0.3]);
	});

	it('films the vertical frame through the vertical travel, and writes it', () => {
		const state = makeStagedState('vertical');
		const tracks = buildCompositionTimelineTracks(state, appearance);
		const travel = tracks[0].transitions[0];
		assert.deepEqual([travel.start, travel.duration], [0.2, 0.5]);
		travel.onUpdate?.({ start: 0.3, duration: 0.45 });
		assert.deepEqual(
			[state.stage?.camera.vertical?.travel?.start, state.stage?.camera.vertical?.travel?.duration],
			[0.3, 0.45]
		);
		assert.equal(state.stage?.camera.travel?.start, 0.1, 'the horizontal travel is untouched');
	});

	it('keeps the Camera and Focus rows without their clips, so the entities stay selectable', () => {
		const state = makeStagedState('horizontal');
		state.stage!.camera.travel = undefined;
		state.stage!.camera.vertical = undefined;
		state.stage!.focus.pull = undefined;
		state.stage!.screen = undefined;
		const tracks = buildCompositionTimelineTracks(state, appearance);
		assert.deepEqual(
			tracks.slice(0, 3).map((track) => [track.id, track.transitions.length]),
			[
				[createTimelineTrackId({ kind: 'stage-camera' }), 0],
				[createTimelineTrackId({ kind: 'stage-focus' }), 0],
				[createTimelineTrackId({ kind: 'surface' }), 1]
			]
		);
	});
});
