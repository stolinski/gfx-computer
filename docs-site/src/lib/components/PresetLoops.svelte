<script lang="ts">
	import presetLoops from '$lib/preset-loops.json';
	import { playRenderLoopsWhileVisible } from '$lib/render-loop-playback';
</script>

<section class="preset-loops" {@attach playRenderLoopsWhileVisible}>
	<h2>Rendered presets</h2>
	<div class="band">
		{#each presetLoops as clip (clip.stem)}
			<figure>
				<video
					data-src="/renders/{clip.stem}.mp4"
					poster="/renders/{clip.stem}.webp"
					aria-label={clip.description}
					width="1280"
					height="720"
					preload="none"
					muted
					loop
					playsinline
				></video>
				<figcaption>{clip.preset} · {clip.pack}</figcaption>
			</figure>
		{/each}
	</div>
</section>

<style>
	.preset-loops {
		margin-block: 3rem;
	}

	h2 {
		font-family: var(--mono);
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--faint);
		margin: 0 0 1.75rem;
	}

	.band {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	figure {
		margin: 0;
		min-width: 0;
	}

	figure:first-child {
		grid-column: 1 / -1;
	}

	video {
		display: block;
		width: 100%;
		height: auto;
		border: 1px solid var(--line-soft);
		border-radius: 8px;
		background: var(--panel);
	}

	figcaption {
		font-family: var(--mono);
		font-size: 0.6875rem;
		color: var(--faint);
		margin-top: 0.5rem;
	}

	@media (max-width: 40rem) {
		.band {
			grid-template-columns: 1fr;
		}
	}
</style>
