<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import { animState } from '$lib/platform/anim-state.svelte';
	import { getCaptureAsset } from '$lib/platform/capture-assets';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import {
		calculateFilmedPageLayout,
		resolveSurfacePageAnchor,
		calculateWebsiteShowcaseLayout,
		WEBSITE_CAPTURE_HEIGHT,
		WEBSITE_CAPTURE_WIDTH,
		websiteImageState,
		websiteScreenshotFraming
	} from '$lib/utils/website-showcase';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	interface Props {
		element?: HTMLElement | null;
	}

	let { element = $bindable<HTMLElement | null>(null) }: Props = $props();
	let loadedUrl = $state('');
	let failedUrl = $state('');
	// A user-asset capture reports its size only once decoded; a bundled capture
	// declares it, so the filmed layout is right before the first paint.
	let loadedSize = $state<{ width: number; height: number } | null>(null);

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const framing = $derived(websiteScreenshotFraming(engineState.surface.variant));
	const captureAsset = $derived(
		engineState.surface.content.captureAsset
			? getCaptureAsset(engineState.surface.content.captureAsset)
			: null
	);
	const imageUrl = $derived(captureAsset?.url ?? engineState.surface.content.imageUrl);
	const imageState = $derived(websiteImageState(imageUrl, loadedUrl, failedUrl));
	const captureSize = $derived(
		captureAsset
			? { width: captureAsset.width, height: captureAsset.height }
			: (loadedSize ?? { width: WEBSITE_CAPTURE_WIDTH, height: WEBSITE_CAPTURE_HEIGHT })
	);
	const layout = $derived(
		calculateWebsiteShowcaseLayout(engineState.transport.orientation, frame.width, frame.height)
	);
	const filmed = $derived(
		calculateFilmedPageLayout(
			frame.width,
			frame.height,
			captureSize.width,
			captureSize.height,
			resolveSurfacePageAnchor(engineState.surface, engineState.transport.orientation)
		)
	);
	// The browser framing rises into place; the filmed page has no entrance of
	// its own — the cut is the entrance — so the same visibility leaves it put.
	const travel = $derived(frame.height - layout.browser.y + 24);
	const translateY = $derived((1 - animState.paperVisibility) * travel);
	const attachSurface: Attachment<HTMLElement> = (node) => {
		element = node;
		return () => {
			if (element === node) element = null;
		};
	};

	function handleImageLoad(event: Event): void {
		const image = event.currentTarget as HTMLImageElement;
		loadedUrl = imageUrl ?? '';
		failedUrl = '';
		loadedSize =
			image.naturalWidth > 0 && image.naturalHeight > 0
				? { width: image.naturalWidth, height: image.naturalHeight }
				: null;
	}

	function handleImageError(): void {
		failedUrl = imageUrl ?? '';
		loadedUrl = '';
		loadedSize = null;
	}
</script>

{#if framing === 'filmed'}
	<article
		{@attach attachSurface}
		class="website-screenshot website-screenshot--filmed surface"
		data-image-state={imageState}
		style:block-size={`${frame.height}px`}
		style:inline-size={`${frame.width}px`}
	>
		{#if imageUrl}
			<img
				alt=""
				crossorigin="anonymous"
				data-export-resource="required"
				onerror={handleImageError}
				onload={handleImageLoad}
				src={imageUrl}
				style:block-size={`${filmed.height}px`}
				style:inline-size={`${filmed.width}px`}
				style:left={`${filmed.left}px`}
				style:top={`${filmed.top}px`}
			/>
		{/if}
		{#if imageState !== 'ready'}
			<p>{imageState === 'broken' ? 'Screenshot unavailable' : 'Awaiting website capture'}</p>
		{/if}
	</article>
{:else}
	<article
		{@attach attachSurface}
		class="website-screenshot surface"
		data-image-state={imageState}
		style:block-size={`${layout.browser.height}px`}
		style:inline-size={`${layout.browser.width}px`}
		style:left={`${layout.browser.x}px`}
		style:top={`${layout.browser.y}px`}
		style:transform={`translateY(${translateY}px)`}
	>
		<header
			class="website-screenshot__chrome"
			style:block-size={`${layout.browser.chromeHeight}px`}
		>
			<span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"
			></span>
		</header>
		<div
			class="website-screenshot__viewport"
			style:block-size={`${layout.browser.screenshotHeight}px`}
		>
			{#if imageUrl}
				<img
					alt=""
					crossorigin="anonymous"
					data-export-resource="required"
					onerror={handleImageError}
					onload={handleImageLoad}
					src={imageUrl}
				/>
			{/if}
			{#if imageState !== 'ready'}
				<p>{imageState === 'broken' ? 'Screenshot unavailable' : 'Awaiting website capture'}</p>
			{/if}
		</div>
	</article>
{/if}

<style>
	.website-screenshot {
		background: #0d1117;
		border-radius: 24px;
		box-sizing: border-box;
		display: grid;
		grid-template-rows: auto 1fr;
		overflow: hidden;
		position: absolute;
		transform-origin: center;
	}

	/* The filmed page: the frame is a crop into the capture, no chrome, no
	   corners — a screen the camera is close to. */
	.website-screenshot--filmed {
		border-radius: 0;
		display: block;
		inset: 0;
	}

	/* The capture is laid at native density and is wider than the frame;
	   Graffiti's `img { max-inline-size: 100% }` reset would clamp it to the
	   frame width and squash it. */
	.website-screenshot--filmed img {
		display: block;
		max-inline-size: none;
		position: absolute;
	}

	.website-screenshot--filmed p {
		color: #a8adb5;
		font-family: ui-monospace, monospace;
		font-size: 52px;
		inset: 0;
		margin: 0;
		place-content: center;
		position: absolute;
		text-align: center;
	}

	.website-screenshot__chrome {
		align-items: center;
		background: #25272b;
		display: flex;
		gap: 18px;
		padding-inline: 34px;
	}

	.website-screenshot__chrome span {
		background: #6f737b;
		block-size: 22px;
		border-radius: 50%;
		inline-size: 22px;
	}

	.website-screenshot__viewport {
		background: #15171a;
		display: grid;
		overflow: hidden;
		place-items: center;
		position: relative;
	}

	.website-screenshot__viewport img {
		block-size: 100%;
		display: block;
		inline-size: 100%;
		object-fit: contain;
	}

	.website-screenshot__viewport p {
		color: #a8adb5;
		font-family: ui-monospace, monospace;
		font-size: 52px;
		inset: 0;
		margin: 0;
		place-content: center;
		position: absolute;
		text-align: center;
	}
</style>
