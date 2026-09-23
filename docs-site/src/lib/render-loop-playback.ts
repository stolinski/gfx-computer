/** Svelte attachment: load preset clips only when visible and motion is welcome. */
export function playRenderLoopsWhileVisible(root: Element): () => void {
	const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const visible = new Map<HTMLVideoElement, boolean>();
	let disposed = false;

	function shouldPlay(video: HTMLVideoElement): boolean {
		return !disposed && !motion.matches && !document.hidden && visible.get(video) === true;
	}

	function update(): void {
		for (const video of visible.keys()) {
			if (!shouldPlay(video)) {
				video.pause();
				continue;
			}
			if (!video.hasAttribute('src') && video.dataset.src) video.src = video.dataset.src;
			void video.play().then(
				() => {
					// A preference change or navigation can race the asynchronous play request.
					if (!shouldPlay(video)) video.pause();
				},
				() => {}
			);
		}
	}

	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.target instanceof HTMLVideoElement) visible.set(entry.target, entry.isIntersecting);
		}
		update();
	});
	for (const video of root.querySelectorAll<HTMLVideoElement>('video[data-src]')) {
		visible.set(video, false);
		observer.observe(video);
	}
	motion.addEventListener('change', update);
	document.addEventListener('visibilitychange', update);
	return () => {
		disposed = true;
		observer.disconnect();
		motion.removeEventListener('change', update);
		document.removeEventListener('visibilitychange', update);
		for (const video of visible.keys()) video.pause();
	};
}
