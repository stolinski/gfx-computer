import gsap from 'gsap';

export interface AnimationTweenSpec {
	key: string;
	start: number;
	duration: number;
	ease: string;
	from?: number;
	to?: number;
	onUpdate: (value: number) => void;
}

export interface AnimationManifest {
	tweens: readonly AnimationTweenSpec[];
}

function getTweenFrom(tween: AnimationTweenSpec): number {
	return tween.from ?? 0;
}

function getTweenTo(tween: AnimationTweenSpec): number {
	return tween.to ?? 1;
}

function computeFingerprint(manifest: AnimationManifest): string {
	return manifest.tweens
		.map(
			(tween) =>
				`${tween.key}|${tween.start}|${tween.duration}|${tween.ease}|${getTweenFrom(tween)}|${getTweenTo(tween)}`
		)
		.join(';');
}

export class AnimationManager {
	#timeline: gsap.core.Timeline | null = null;
	#fingerprint = '';
	#liveTweens: AnimationTweenSpec[] = [];

	rebuild(manifest: AnimationManifest): void {
		const nextFingerprint = computeFingerprint(manifest);

		if (nextFingerprint === this.#fingerprint && this.#timeline) {
			this.#liveTweens = manifest.tweens.slice();
			// The manifest re-seeds every live slot (first keyframe values) on each
			// build, and a later `progress()` to the same position renders nothing.
			// Force a render at the current position so the slots hold the values
			// the playhead shows, not the seeds.
			this.#timeline.render(this.#timeline.totalTime(), false, true);
			return;
		}

		this.#timeline?.kill();
		this.#liveTweens = manifest.tweens.slice();

		const tl = gsap.timeline({ paused: true });

		for (const tween of this.#liveTweens) {
			const from = getTweenFrom(tween);
			const to = getTweenTo(tween);
			const target = { value: from };
			const liveTween = tween;

			tl.to(
				target,
				{
					value: to,
					duration: tween.duration,
					ease: tween.ease,
					onUpdate: () => liveTween.onUpdate(target.value)
				},
				tween.start
			);
		}

		// Initialize state by writing each tween's `from`. Reverse order so the
		// earliest-listed tween wins for any field written by multiple tweens.
		for (let index = this.#liveTweens.length - 1; index >= 0; index -= 1) {
			const tween = this.#liveTweens[index];
			tween.onUpdate(getTweenFrom(tween));
		}

		tl.set({}, {}, 1);

		this.#timeline = tl;
		this.#fingerprint = nextFingerprint;
	}

	progress(fraction: number): void {
		if (!this.#timeline) {
			return;
		}

		const clamped = Math.max(0, Math.min(fraction, 1));

		this.#timeline.progress(clamped);
	}

	dispose(): void {
		this.#timeline?.kill();
		this.#timeline = null;
		this.#fingerprint = '';
		this.#liveTweens = [];
	}
}
