<script lang="ts">
	// Every Archivo weight the chrome declares must be REGISTERED, or the
	// browser silently substitutes the nearest loaded cut — with only 600
	// present, all lighter text rendered semibold while computed styles still
	// reported the declared weight.
	import '@fontsource/archivo/latin-400.css';
	import '@fontsource/archivo/latin-500.css';
	import '@fontsource/archivo/latin-600.css';
	import '@fontsource/archivo/latin-700.css';
	import '@drop-in/graffiti';
	import archivo400Url from '@fontsource/archivo/files/archivo-latin-400-normal.woff2?url';
	import archivo600Url from '@fontsource/archivo/files/archivo-latin-600-normal.woff2?url';
	import { browser } from '$app/environment';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import { page, updated } from '$app/state';

	import {
		GFX_DESCRIPTION,
		GFX_PRODUCT_NAME,
		GFX_PUBLIC_ORIGIN,
		GFX_SOCIAL_CARD_PATH
	} from '$lib/identity/gfx-brand';
	import gfxMark from '$lib/assets/identity/gfx-mark.svg';
	import {
		CANVAS_DRAW_ELEMENT_FLAG_ARGUMENT,
		CANVAS_DRAW_ELEMENT_FLAG_NAME,
		CANVAS_DRAW_ELEMENT_LAUNCH_COMMAND,
		isCanvasDrawElementCaptureAvailable
	} from '$lib/platform/standard-browser-dom-capture';
	import { installOpenCompositionAddressNavigator } from '$lib/platform/open-composition-address';
	import { readWebmcpCompositionPreconditions } from '$lib/platform/webmcp-tool-preconditions';
	import { startWebmcpToolController } from '$lib/platform/webmcp-tool-controller';
	import { listWebmcpToolDefinitions } from '$lib/platform/webmcp-tool-definitions';

	let { children } = $props();

	// The hard capability gate (Dex qju2qity): without CanvasDrawElement the app
	// renders nothing approximate — the notice below replaces every route, so
	// `window.__gfxDomFrameCaptureMode` stays truthfully absent.
	const isCompositionCaptureAvailable = browser ? isCanvasDrawElementCaptureAvailable() : true;

	// WebMCP is progressive enhancement in one direction only (ADR-0054 §4):
	// without `document.modelContext`, or inside a frame, an insecure context, or
	// an opaque origin, no controller starts and the app behaves exactly as it
	// does with no agent attached. Nothing below the layout may depend on it.
	// The capability gate above is not an input: a WebMCP browser without
	// CanvasDrawElement — a headless agent browser, say — registers the same
	// tools behind the notice, so an agent can still create, read, and edit a
	// composition there; only the operations that have to render fail on such
	// a page. A refusal is silent by design, so it is published where a harness
	// can read it.
	const webmcpLifetime = new AbortController();
	const webmcpStart = browser
		? startWebmcpToolController({
				view: window,
				definitions: listWebmcpToolDefinitions(),
				lifetime: webmcpLifetime.signal
			})
		: null;
	const webmcpToolController = webmcpStart?.controller ?? null;
	if (webmcpStart) window.__gfxWebmcpExposureRefusal = webmcpStart.refusal;

	onDestroy(() => webmcpLifetime.abort());

	// The page follows the open document, and this is the one place that moves
	// it. A lifecycle operation — from a GUI action or a WebMCP tool, on the home
	// page or in the Workspace — reports the address of the document it opened,
	// and the page goes there. From a composition page the URL is replaced: it is
	// the same page with a different document. From anywhere else it is a new
	// history entry, so Back returns to where the author was.
	if (browser) {
		onDestroy(
			installOpenCompositionAddressNavigator(({ slug }) =>
				goto(resolve('/p/[slug]', { slug }), { replaceState: page.route.id === '/p/[slug]' })
			)
		);
	}

	// A tab that outlived an integration rebuild leaves the client router: the
	// origin no longer serves the chunks this build would import, so its next
	// navigation loads the current build whole (ADR-0058). `kit.version`
	// polling keeps `updated` current; a navigation that already unloads the
	// page needs no help.
	beforeNavigate(({ willUnload, to, cancel }) => {
		if (!updated.current || willUnload || !to?.url) return;
		cancel();
		location.href = to.url.href;
	});

	// Registration follows the route and the composition: the preconditions are
	// read inside the effect so any edit that makes a tool possible — or
	// impossible — reaches `document.modelContext` on the same tick the Workspace
	// sees it.
	$effect(() => {
		if (!webmcpToolController) return;
		const composition = readWebmcpCompositionPreconditions();
		const routeId = page.route.id;
		void webmcpToolController.synchronize(composition, routeId).catch((error: unknown) => {
			console.error('WebMCP tool registration failed', error);
		});
	});

	// Share scrapers need absolute URLs, and the only origin any of them ever
	// fetches is the ratified public one (ADR-0052) — a local or preview origin
	// in these tags would resolve to nothing for the reader who sees the card.
	const shareUrl = $derived(`${GFX_PUBLIC_ORIGIN}${page.url.pathname}`);
</script>

<svelte:head>
	<link rel="icon" href={gfxMark} />
	<meta name="description" content={GFX_DESCRIPTION} />
	<meta name="theme-color" content="#0c0c0e" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={GFX_PRODUCT_NAME} />
	<meta property="og:title" content={GFX_PRODUCT_NAME} />
	<meta property="og:description" content={GFX_DESCRIPTION} />
	<meta property="og:url" content={shareUrl} />
	<meta property="og:image" content="{GFX_PUBLIC_ORIGIN}{GFX_SOCIAL_CARD_PATH}" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="The GFX title card on the deck" />
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="preload" href={archivo400Url} as="font" type="font/woff2" crossorigin="anonymous" />
	<link rel="preload" href={archivo600Url} as="font" type="font/woff2" crossorigin="anonymous" />
	<link
		rel="preload"
		href="/fonts/PaperMono-Variable.woff2"
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
	/>
</svelte:head>

{#if isCompositionCaptureAvailable}
	{@render children()}
{:else}
	<main class="capability-gate">
		<h1>{CANVAS_DRAW_ELEMENT_FLAG_NAME} required</h1>
		<p>
			GFX renders with
			<a href="https://github.com/WICG/html-in-canvas">HTML-in-Canvas</a>, which
			this browser has behind a flag. Enable it at
			<!-- chrome:// URLs refuse navigation from web content, so this is copy text. -->
			<code>chrome://flags/#canvas-draw-element</code> and relaunch, or launch
			with the flag:
		</p>
		<p><code>{CANVAS_DRAW_ELEMENT_FLAG_ARGUMENT}</code></p>
		<pre><code>{CANVAS_DRAW_ELEMENT_LAUNCH_COMMAND}</code></pre>
	</main>
{/if}

<style>
	.capability-gate {
		display: grid;
		place-content: center;
		gap: var(--pad-s);
		min-block-size: 100dvh;
		text-align: center;
	}

	.capability-gate h1,
	.capability-gate p {
		margin: 0;
	}

	.capability-gate pre {
		margin: 0;
		user-select: all;
	}

	/* Paper Mono (paper.design, OFL) is the tool-chrome mono — the variable cut
	   covers every weight the chrome uses. Pack/content fonts register in their
	   own Pack folders and are unaffected. License: static/fonts/PaperMono-OFL.txt */
	@font-face {
		font-family: 'Paper Mono';
		src: url('/fonts/PaperMono-Variable.woff2') format('woff2-variations');
		font-weight: 100 800;
		font-style: normal;
		font-display: swap;
	}
</style>
