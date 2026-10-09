import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Timeline } from './timeline.svelte';

/** A hand-cranked `requestAnimationFrame` and clock, so play runs frame by frame. */
let frameCallbacks: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let nowMilliseconds: number;

function runFrameAt(milliseconds: number): void {
	nowMilliseconds = milliseconds;
	const callbacks = [...frameCallbacks.values()];
	frameCallbacks.clear();
	for (const callback of callbacks) callback(milliseconds);
}

beforeEach(() => {
	frameCallbacks = new Map();
	nextFrameId = 1;
	nowMilliseconds = 0;
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
		const id = nextFrameId++;
		frameCallbacks.set(id, callback);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
		frameCallbacks.delete(id);
	});
	vi.spyOn(performance, 'now').mockImplementation(() => nowMilliseconds);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Timeline play reaching the end', () => {
	it('loops on its own frame 0 when there is no Scene to cut to, as it always has', () => {
		const ticks: number[] = [];
		const onLoop = vi.fn();
		const onPlayReachedEnd = vi.fn(() => null);
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			tick: (timestamp) => ticks.push(timestamp),
			onLoop,
			onPlayReachedEnd
		});

		timeline.play();
		runFrameAt(500);
		runFrameAt(1200);

		expect(onPlayReachedEnd).toHaveBeenCalledTimes(1);
		expect(ticks).toEqual([0.5, 1, 0]);
		expect(timeline.time).toBe(0);
		expect(timeline.isPlaying).toBe(true);
		expect(onLoop).toHaveBeenCalledTimes(1);
		timeline.dispose();
	});

	it('takes a cut before the end is ticked, and resumes from where the cut left the playhead', async () => {
		const ticks: number[] = [];
		const onLoop = vi.fn();
		let finishCut: () => void = () => undefined;
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			tick: (timestamp) => ticks.push(timestamp),
			onLoop,
			onPlayReachedEnd: () =>
				new Promise<void>((resolve) => {
					finishCut = resolve;
				})
		});

		timeline.play();
		runFrameAt(500);
		runFrameAt(1200);

		// The outgoing Scene never shows its end, and the clock holds for the cut.
		expect(ticks).toEqual([0.5]);
		expect(timeline.isPlaying).toBe(true);
		expect(frameCallbacks.size).toBe(0);

		timeline.cutTo({ durationSeconds: 2, fps: 30, time: 0 });
		nowMilliseconds = 1900;
		finishCut();
		await vi.waitFor(() => expect(onLoop).toHaveBeenCalledTimes(1));
		runFrameAt(2400);

		// The 700 ms the cut took is not played back.
		expect(ticks).toEqual([0.5, 0.5]);
		expect(timeline.time).toBe(0.5);
		expect(timeline.durationSeconds).toBe(2);
		timeline.dispose();
	});

	it('stays paused when play was stopped while the cut settled', async () => {
		const onLoop = vi.fn();
		let finishCut: () => void = () => undefined;
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			tick: () => undefined,
			onLoop,
			onPlayReachedEnd: () =>
				new Promise<void>((resolve) => {
					finishCut = resolve;
				})
		});

		timeline.play();
		runFrameAt(1200);
		timeline.pause();
		finishCut();
		await Promise.resolve();
		await Promise.resolve();

		expect(timeline.isPlaying).toBe(false);
		expect(frameCallbacks.size).toBe(0);
		expect(onLoop).not.toHaveBeenCalled();
	});

	it('pauses when the cut fails', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			tick: () => undefined,
			onPlayReachedEnd: () => Promise.reject(new Error('Composition root is unavailable.'))
		});

		timeline.play();
		runFrameAt(1200);
		await vi.waitFor(() => expect(timeline.isPlaying).toBe(false));

		expect(logged).toHaveBeenCalledTimes(1);
	});
});

describe('Timeline play pressed at the end', () => {
	it('rewinds to its own frame 0 when there is no other Scene, as it always has', () => {
		const ticks: number[] = [];
		const onPlay = vi.fn();
		const onPlayFromEnd = vi.fn(() => null);
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			loop: false,
			tick: (timestamp) => ticks.push(timestamp),
			onPlay,
			onPlayFromEnd
		});
		timeline.seek(1);
		ticks.length = 0;

		timeline.play();
		runFrameAt(250);

		expect(onPlayFromEnd).toHaveBeenCalledTimes(1);
		expect(onPlay).toHaveBeenCalledWith(0);
		expect(ticks).toEqual([0.25]);
		timeline.dispose();
	});

	it('is not asked when the playhead is anywhere before the end', () => {
		const onPlayFromEnd = vi.fn(() => null);
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			tick: () => undefined,
			onPlayFromEnd
		});
		timeline.seek(0.5);

		timeline.play();

		expect(onPlayFromEnd).not.toHaveBeenCalled();
		timeline.dispose();
	});

	it('waits for the Film to cut to the Scene play starts from, then plays from there', async () => {
		const ticks: number[] = [];
		const onPlay = vi.fn();
		const onLoop = vi.fn();
		let finishCut: () => void = () => undefined;
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			loop: false,
			tick: (timestamp) => ticks.push(timestamp),
			onPlay,
			onLoop,
			onPlayFromEnd: () =>
				new Promise<void>((resolve) => {
					finishCut = resolve;
				})
		});
		timeline.seek(1);
		ticks.length = 0;

		timeline.play();

		// Nothing of the Scene that ended is ticked or announced while the cut settles.
		expect(timeline.isPlaying).toBe(true);
		expect(frameCallbacks.size).toBe(0);
		expect(onPlay).not.toHaveBeenCalled();

		timeline.cutTo({ durationSeconds: 3, fps: 30, time: 0 });
		nowMilliseconds = 800;
		finishCut();
		await vi.waitFor(() => expect(onPlay).toHaveBeenCalledWith(0));
		runFrameAt(1300);

		expect(ticks).toEqual([0.5]);
		expect(timeline.durationSeconds).toBe(3);
		expect(onLoop).not.toHaveBeenCalled();
		timeline.dispose();
	});

	it('stops on the end of the last Scene with loop off, then starts again through the cut', async () => {
		const ticks: number[] = [];
		const cuts: string[] = [];
		const timeline = new Timeline({
			durationSeconds: 1,
			fps: 30,
			loop: false,
			tick: (timestamp) => ticks.push(timestamp),
			// With loop off there is no Scene to cut to at the end of the last one.
			onPlayReachedEnd: () => null,
			onPlayFromEnd: () => {
				cuts.push('from-end');
				timeline.cutTo({ durationSeconds: 2, fps: 30, time: 0 });
				return Promise.resolve();
			}
		});

		timeline.play();
		runFrameAt(1200);

		expect(timeline.isPlaying).toBe(false);
		expect(timeline.time).toBe(1);
		expect(ticks).toEqual([1]);

		nowMilliseconds = 5000;
		timeline.play();
		await vi.waitFor(() => expect(frameCallbacks.size).toBe(1));
		runFrameAt(5500);

		expect(cuts).toEqual(['from-end']);
		expect(ticks).toEqual([1, 0.5]);
		expect(timeline.durationSeconds).toBe(2);
		timeline.dispose();
	});
});

describe('Timeline.cutTo', () => {
	it('points the transport at another Scene without ticking', () => {
		const ticks: number[] = [];
		const timeline = new Timeline({
			durationSeconds: 6,
			fps: 30,
			tick: (timestamp) => ticks.push(timestamp)
		});
		timeline.seek(5);
		ticks.length = 0;

		timeline.cutTo({ durationSeconds: 2.5, fps: 24, time: 0.5 });

		expect(ticks).toEqual([]);
		expect(timeline.durationSeconds).toBe(2.5);
		expect(timeline.fps).toBe(24);
		expect(timeline.time).toBe(0.5);
	});

	it('holds the playhead inside the Scene it cuts to', () => {
		const timeline = new Timeline({ durationSeconds: 6, fps: 30, tick: () => undefined });

		timeline.cutTo({ durationSeconds: 2, fps: 30, time: 9 });

		expect(timeline.time).toBe(2);
	});
});
