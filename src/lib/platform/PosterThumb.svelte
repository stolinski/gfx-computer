<script lang="ts">
	// A composition's poster still on the alpha checker: the preview stage of a
	// library card (`./PosterCard.svelte`) and the thumbnail of a Film in the
	// Workspace's Add to Film menu. It takes the inline size it is given.
	import { SvelteMap } from 'svelte/reactivity';
	import type { Attachment } from 'svelte/attachments';

	import type { SurfaceType } from '$lib/platform/engine-schema';
	import { imageContentViewBoxInset } from '$lib/utils/image-alpha-bounds';
	import SurfaceIcon from './SurfaceIcon.svelte';

	// Content-crop per poster URL, cached module-wide so aspect flips and
	// re-renders never rescan the same image.
	const contentViewBoxCache = new SvelteMap<string, string | null>();

	interface Props {
		// URL of this composition's own poster — a committed still for a library
		// Preset, the store's capture for a User composition — passed ONLY when
		// the caller knows it exists. Null means "no own poster": the thumb
		// starts on the surface default immediately instead of discovering
		// absence through a 404 (console noise).
		thumbSrc: string | null;
		type: SurfaceType;
		/** The preview's aspect; a library grid flips every thumb at once. */
		aspect: 'wide' | 'tall';
	}

	let { thumbSrc, type, aspect }: Props = $props();

	// Fallback chain: this composition's own poster → the committed
	// surface-type default → the surface glyph. The base level comes from
	// poster knowledge; onerror only downgrades on a genuinely missing file —
	// it is a backstop, not the discovery mechanism.
	let downgrade = $state<'surface' | 'failed' | null>(null);
	const level = $derived(downgrade ?? (thumbSrc !== null ? 'composition' : 'surface'));
	let ready = $state(false);
	let shouldLoad = $state(false);

	const loadVisiblePoster: Attachment<HTMLElement> = (element) => {
		if (typeof IntersectionObserver === 'undefined') {
			shouldLoad = true;
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			shouldLoad = true;
			observer.disconnect();
		});
		observer.observe(element);
		return () => observer.disconnect();
	};

	const src = $derived(
		level === 'surface'
			? `/surface-posters/${type}.webp`
			: level === 'composition' && thumbSrc !== null
				? thumbSrc
				: ''
	);

	// object-view-box crop zooming the poster to its alpha content (mock parity:
	// the composition reads LARGE in the thumb, not tiny in a 4K frame). Null =
	// full-frame poster, shown whole.
	let contentViewBox = $state<string | null>(null);

	function handleLoad(event: Event): void {
		ready = true;
		const image = event.currentTarget as HTMLImageElement;
		const source = image.currentSrc || image.src;
		const cached = contentViewBoxCache.get(source);
		if (cached !== undefined) {
			contentViewBox = cached;
			return;
		}

		// Alpha scanning is presentation refinement, not image readiness. Keep it
		// out of the load event so a burst of local poster decodes can paint first.
		const measureContentCrop = (): void => {
			if (!ready || (image.currentSrc || image.src) !== source) return;
			const inset = imageContentViewBoxInset(image);
			contentViewBoxCache.set(source, inset);
			contentViewBox = inset;
		};
		if ('requestIdleCallback' in window) {
			window.requestIdleCallback(measureContentCrop, { timeout: 1_000 });
		} else {
			globalThis.setTimeout(measureContentCrop, 0);
		}
	}

	function handleError(): void {
		ready = false;
		contentViewBox = null;
		downgrade = level === 'composition' ? 'surface' : 'failed';
	}
</script>

<span class="poster-thumb" class:is-tall={aspect === 'tall'} {@attach loadVisiblePoster}>
	{#if src && shouldLoad}
		<img
			class="poster-thumb__image"
			class:is-ready={ready}
			{src}
			alt=""
			decoding="async"
			style:object-view-box={contentViewBox}
			onload={handleLoad}
			onerror={handleError}
		/>
	{/if}
	{#if !ready}
		{#if level === 'failed'}
			<span class="poster-thumb__glyph"><SurfaceIcon {type} /></span>
		{:else}
			<span class="poster-thumb__skeleton" aria-hidden="true"></span>
		{/if}
	{/if}
</span>

<style>
	/* Preview stage — edge-to-edge on the alpha checker, the same ground the
	   Workspace canvas uses: transparent compositions read as transparent, and a
	   poster shown whole (object-fit contain) letterboxes onto checker, never
	   onto dead black. */
	.poster-thumb {
		aspect-ratio: 16 / 9;
		display: block;
		background: repeating-conic-gradient(#17171a 0% 25%, #101013 0% 50%) 0 0 / 18px 18px;
		overflow: hidden;
		position: relative;
		transition: aspect-ratio 160ms var(--ease-smooth, ease);
	}

	.poster-thumb.is-tall {
		aspect-ratio: 9 / 16;
	}

	.poster-thumb__image {
		block-size: 100%;
		inline-size: 100%;
		inset: 0;
		object-fit: contain;
		opacity: 0;
		position: absolute;
		transition: opacity 300ms var(--ease-smooth, ease);
	}

	.poster-thumb__image.is-ready {
		opacity: 1;
	}

	.poster-thumb__glyph {
		block-size: 34%;
		color: var(--muted, #8a8a90);
		inset-block-start: 50%;
		inset-inline-start: 50%;
		position: absolute;
		translate: -50% -50%;
	}

	.poster-thumb__skeleton {
		background: linear-gradient(
			100deg,
			transparent 30%,
			color-mix(in oklab, var(--line, #26262a) 70%, transparent) 50%,
			transparent 70%
		);
		background-size: 220% 100%;
		inset: 0;
		position: absolute;
		animation: poster-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes poster-shimmer {
		from {
			background-position: 220% 0;
		}
		to {
			background-position: -120% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.poster-thumb__skeleton {
			animation: none;
		}

		.poster-thumb {
			transition: none;
		}
	}
</style>
