<script lang="ts">
	import type { Snippet } from 'svelte';

	import {
		getVideoFrameAspectRatio,
		getVideoFrameSize,
		type VideoOrientation
	} from '$lib/utils/video-frame';

	interface Props {
		canvas?: HTMLCanvasElement | null;
		orientation?: VideoOrientation;
		label?: string;
		showCheckerboard?: boolean;
		/** Preview-only reference still rendered under the transparent canvas so an
		 *  overlay is judged over real footage. Never part of the composition or
		 *  the export — the export path renders the composition alone. */
		backdropUrl?: string | null;
		/** Display zoom multiplier on the fit size (1 = fit). CSS transform only —
		 *  the native canvas resolution is unchanged. */
		zoom?: number;
		/** Pan offset in display px, applied with the zoom (only used when zoomed in). */
		panX?: number;
		panY?: number;
		/** True during an active pan drag — disables the transform transition so the
		 *  canvas tracks the cursor 1:1 instead of floating behind it. */
		isPanning?: boolean;
		children: Snippet;
	}

	let {
		canvas = $bindable(null),
		orientation = 'horizontal',
		label = 'Composition',
		showCheckerboard = true,
		backdropUrl = null,
		zoom = 1,
		panX = 0,
		panY = 0,
		isPanning = false,
		children
	}: Props = $props();

	const frameSize = $derived(getVideoFrameSize(orientation));
	const aspectRatio = $derived(getVideoFrameAspectRatio(orientation));
</script>

<figure
	class="video-frame"
	style:--frame-aspect={aspectRatio}
	style:--frame-w={frameSize.width}
	style:--frame-h={frameSize.height}
>
	<div class="video-frame__fit">
		<div
			class="video-frame__viewport"
			class:video-frame__viewport--no-checker={!showCheckerboard || backdropUrl !== null}
			class:video-frame__viewport--panning={isPanning}
			style:--zoom={zoom}
			style:--pan-x="{panX}px"
			style:--pan-y="{panY}px"
		>
			{#if backdropUrl}
				<img class="video-frame__backdrop" src={backdropUrl} alt="" />
			{/if}
			<canvas
				aria-label={label}
				bind:this={canvas}
				class="video-frame__canvas"
				height={frameSize.height}
				layoutsubtree
				width={frameSize.width}
			>
				{@render children()}
			</canvas>
		</div>
	</div>

	<!-- The native-resolution readout lives in the Workspace identity strip; the
	     stage itself stays chrome-free. -->
</figure>

<style>
	.video-frame {
		align-items: center;
		display: flex;
		flex-direction: column;
		gap: var(--vs-s);
		inline-size: 100%;
		margin: 0;
	}

	.video-frame__fit {
		display: grid;
		inline-size: 100%;
		place-items: center;
	}

	.video-frame__viewport {
		aspect-ratio: var(--frame-aspect);
		background:
			linear-gradient(45deg, var(--fg-05) 25%, transparent 25% 75%, var(--fg-05) 75%),
			linear-gradient(45deg, var(--fg-05) 25%, transparent 25% 75%, var(--fg-05) 75%);
		background-position:
			0 0,
			0.5rem 0.5rem;
		background-size: 1rem 1rem;
		border: var(--border-1);
		border-radius: var(--br-m);
		/* Fit the frame to the smaller of: container width, a hard max, or the
		   available height. The height term only reserves a little breathing room —
		   over-reserving leaves the canvas squished with dead space above it,
		   especially once the timeline panel grows. */
		inline-size: min(100cqw, 76rem, calc((100cqh - 2rem) * var(--frame-w) / var(--frame-h)));
		overflow: hidden;
		position: relative;
		/* Display zoom + pan — translate then scale the framed canvas about its
		   centre. Pure transform, so the native render resolution is untouched and
		   getBoundingClientRect (used by the canvas drag/scale/click/pan geometry)
		   reflects it for free. */
		transform: translate(var(--pan-x, 0px), var(--pan-y, 0px)) scale(var(--zoom, 1));
		transition: transform 140ms var(--ease-smooth, ease);
	}

	/* During an active pan drag the canvas must track the cursor exactly — the
	   easing that smooths button zoom would make the drag float. */
	.video-frame__viewport--panning {
		transition: none;
	}

	.video-frame__viewport--no-checker {
		background: var(--chrome-well, #111);
	}

	/* Sits under the premultiplied-alpha transparent canvas, so the overlay
	   composites over it visually. Cover-cropped to the frame like footage. */
	.video-frame__backdrop {
		block-size: 100%;
		inline-size: 100%;
		inset: 0;
		object-fit: cover;
		position: absolute;
	}

	.video-frame__canvas {
		block-size: 100%;
		display: block;
		inline-size: 100%;
		inset: 0;
		position: absolute;
	}

</style>
