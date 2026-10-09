import { framesToSeconds, resolveFrameRate } from '$lib/utils/composition-timing';

export type TimelineTick = (timestamp: number) => void;

export interface TimelineOptions {
	durationSeconds: number;
	fps: number;
	loop?: boolean;
	tick: TimelineTick;
	/** Transport hooks — playback-only side channels (e.g. preview audio,
	 *  ADR-0033 §6). Scrub/seek intentionally has no hook: scrub is silent. */
	onPlay?: (atSeconds: number) => void;
	onPause?: () => void;
	/** Play wrapped to a new start: the same Scene's frame 0, or the Scene a cut made live. */
	onLoop?: () => void;
	/**
	 * Film playback (ADR-0068 §4). Called when play reaches the end of what the
	 * transport runs over, before that end is shown. Returns `null` when there is
	 * no other Scene to cut to, and the Timeline then loops or stops as it always
	 * has. Otherwise returns a promise that settles once the next Scene is live
	 * and the transport has been cut to it (`cutTo`); play resumes from there.
	 */
	onPlayReachedEnd?: () => Promise<void> | null;
}

/** What the transport runs over after a cut: the Scene now live, and where its playhead is. */
export interface TimelineCut {
	durationSeconds: number;
	fps: number;
	time: number;
}

export interface TimelineSelection {
	trackId: string;
	transitionId: string | null;
}

export class Timeline {
	time = $state(0);
	isPlaying = $state(false);
	durationSeconds = $state(0);
	fps = $state(30);
	loop = $state(true);
	selection = $state<TimelineSelection | null>(null);

	#tick: TimelineTick;
	#rafId: number | null = null;
	#playStartedAt = 0;
	#playStartedFrom = 0;
	#onPlay: TimelineOptions['onPlay'];
	#onPause: TimelineOptions['onPause'];
	#onLoop: TimelineOptions['onLoop'];
	#onPlayReachedEnd: TimelineOptions['onPlayReachedEnd'];
	/** Counts `play()` calls, so a cut that settles after a pause and a new play resumes nothing. */
	#playSession = 0;

	constructor(options: TimelineOptions) {
		this.durationSeconds = options.durationSeconds;
		this.fps = options.fps;
		this.loop = options.loop ?? true;
		this.#tick = options.tick;
		this.#onPlay = options.onPlay;
		this.#onPause = options.onPause;
		this.#onLoop = options.onLoop;
		this.#onPlayReachedEnd = options.onPlayReachedEnd;
	}

	/**
	 * Point the transport at another Scene without ticking: its duration, its
	 * rate, and the Scene time its playhead is on. Scene selection calls this in
	 * the same step that writes the Scene into engine state, so the first tick
	 * after the swap already asks for the right frame of the right Scene. The
	 * caller drives that tick once the Scene's animation is rebuilt.
	 */
	cutTo(cut: TimelineCut): void {
		this.durationSeconds = cut.durationSeconds;
		this.fps = cut.fps;
		this.time = Math.max(0, Math.min(cut.time, cut.durationSeconds));
	}

	seek(timestamp: number): void {
		const clamped = Math.max(0, Math.min(timestamp, this.durationSeconds));

		this.time = clamped;
		this.#tick(clamped);
	}

	stepFrames(frames: number): void {
		// Frame steps run on the exact rational (ADR-0042) — at 29.97 the
		// literal drifts off the true 30000/1001 frame grid.
		this.seek(this.time + framesToSeconds(frames, resolveFrameRate(this.fps)));
	}

	play(): void {
		if (this.isPlaying) {
			return;
		}

		if (this.time >= this.durationSeconds) {
			this.time = 0;
		}

		this.isPlaying = true;
		this.#playSession += 1;
		this.#playStartedAt = performance.now();
		this.#playStartedFrom = this.time;
		this.#rafId = requestAnimationFrame(this.#loop);
		this.#onPlay?.(this.time);
	}

	pause(): void {
		const wasPlaying = this.isPlaying;
		this.isPlaying = false;

		if (this.#rafId !== null) {
			cancelAnimationFrame(this.#rafId);
			this.#rafId = null;
		}

		if (wasPlaying) {
			this.#onPause?.();
		}
	}

	toggle(): void {
		if (this.isPlaying) {
			this.pause();
		} else {
			this.play();
		}
	}

	selectTransition(trackId: string, transitionId: string): void {
		this.selection = { trackId, transitionId };
	}

	clearSelection(): void {
		this.selection = null;
	}

	dispose(): void {
		this.pause();
	}

	seekProgress(progress: number): void {
		this.seek(Math.max(0, Math.min(progress, 1)) * this.durationSeconds);
	}

	#loop = (now: number): void => {
		if (!this.isPlaying) {
			return;
		}

		const elapsed = (now - this.#playStartedAt) / 1000;
		const next = Math.min(this.#playStartedFrom + elapsed, this.durationSeconds);

		if (next >= this.durationSeconds) {
			// The end of a Scene is the first frame of the next one, so a cut is
			// taken before this Scene's end is ticked: the outgoing Scene never
			// shows a frame past its last.
			const cut = this.#onPlayReachedEnd?.() ?? null;
			if (cut) {
				this.#resumeAfterCut(cut);
				return;
			}
		}

		this.time = next;
		this.#tick(next);

		if (next >= this.durationSeconds) {
			if (this.loop && this.durationSeconds > 0) {
				this.#playStartedAt = now;
				this.#playStartedFrom = 0;
				this.time = 0;
				this.#tick(0);
				this.#rafId = requestAnimationFrame(this.#loop);
				this.#onLoop?.();
				return;
			}

			this.pause();
			return;
		}

		this.#rafId = requestAnimationFrame(this.#loop);
	};

	/**
	 * Hold play while a cut settles, then run the clock again from where the cut
	 * left the playhead. The time the settle took is not played back: preview
	 * does not skip frames of the incoming Scene to catch up.
	 */
	#resumeAfterCut(cut: Promise<void>): void {
		this.#rafId = null;
		const playSession = this.#playSession;
		cut.then(
			() => {
				if (!this.isPlaying || this.#playSession !== playSession) return;
				this.#playStartedAt = performance.now();
				this.#playStartedFrom = this.time;
				this.#rafId = requestAnimationFrame(this.#loop);
				this.#onLoop?.();
			},
			(error: unknown) => {
				console.error('Film playback could not cut to the next Scene.', error);
				if (this.#playSession === playSession) this.pause();
			}
		);
	}
}

declare global {
	interface Window {
		__gfxTimeline?: Timeline;
		// DOF verification seam (ADR-0027): present a single depth plane in
		// isolation instead of the back-to-front composite. Only consulted while a
		// `depth-of-field` Effect is active.
		__gfxDofPreviewPlane?: 'surface' | 'overlay' | 'composite';
	}
}
