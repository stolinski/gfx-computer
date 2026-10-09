<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import { GFX_PRODUCT_NAME } from '$lib/identity/gfx-brand';
	import GfxMarkHomeLink from '$lib/identity/GfxMarkHomeLink.svelte';
	import { compositionAutosaveInvalidation } from '../../../lib/platform/composition-autosave-invalidation.svelte.ts';
	import { storeUserCompositionUnderNewSlug } from '$lib/platform/composition-lifecycle-operations';
	import { compositionMeta } from '$lib/platform/composition-meta.svelte';
	import { engineState, packState, transitionState } from '$lib/platform/engine-state.svelte';
	import {
		filmState,
		readOpenFilmAsUserCompositionDocument
	} from '$lib/platform/film-state.svelte';
	import { filmFromPreset } from '$lib/platform/film-ingress';
	import {
		legacyPresetEnvelopeFromPreset,
		openFilmDocumentFromFilm,
		savedPresetFromOpenFilm
	} from '$lib/platform/open-film-document';
	import { getPack } from '$lib/platform/packs/registry';
	import { collectPresetRendererRequirements } from '$lib/platform/pipelines/preset-renderer-requirements';
	import { pipelineRendererRuntime } from '$lib/platform/pipelines/runtime-context.svelte';
	import { posterKeyForPreset } from '$lib/platform/posters';
	import { getPresetBySlug } from '$lib/platform/preset-catalog';
	import { applyFilm } from '$lib/platform/preset';
	import { presetBase } from '$lib/platform/preset-base.svelte';
	import { staleBuildRecovery } from '$lib/platform/stale-build-recovery-runtime';
	import {
		storedPresetViewOfUserComposition,
		type UserCompositionDocument
	} from '$lib/platform/user-composition-record';
	import { userCompositionStore } from '$lib/platform/user-composition-store';
	import { ensurePackLoaded } from '$lib/platform/user-pack-runtime';
	import { isCurrentPresetRouteRendererLoad } from '$lib/utils/preset-route-renderer-load';
	import { isModuleLoadFailure } from '$lib/utils/stale-build-recovery';
	import Workspace from '$lib/platform/Workspace.svelte';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const routeKey = $derived(JSON.stringify([data.slug, data.source]));

	// What this route resolved to. The corpus half arrives from the server load;
	// the session half is read here, out of the store this build is configured
	// with, because a browser-scoped session is one the origin cannot see and must
	// never be sent (ADR-0053).
	type CompositionRouteStatus = 'loading' | 'ready' | 'missing' | 'error';
	let resolutionStatus = $state<CompositionRouteStatus>('loading');

	// Content key for the poster of the open User composition — handed to the
	// Workspace, which captures the settled frame under it once (see ./posters).
	// Null for a library Preset: its poster is a committed still (ADR-0061).
	let posterKey = $state<string | null>(null);

	// Snapshot taken immediately after the document is applied — used to detect
	// the first real edit (anything different from a fresh load must be user
	// input). Opening a document seeds `engineState`, `presetBase`, and
	// `filmState`, so the snapshot covers composition, metadata, and Scene-list
	// edits alike.
	let loadSnapshot = '';
	// The route key the open document was loaded at. The Workspace is keyed on it,
	// so it stays mounted when the first edit of a Starter moves the URL.
	let appliedRouteKey = $state<string | null>(null);
	// The route key of the Film the first edit of a Starter created. The URL is
	// replaced with it, and the document that is open is already that Film, so
	// arriving there loads nothing.
	let createdFilmRouteKey = $state<string | null>(null);
	let rendererLoadError = $state<string | null>(null);
	let routeLoadGeneration = 0;

	// Whether the open document is the one this URL names.
	const isOpenDocumentRoute = $derived(
		routeKey === appliedRouteKey || routeKey === createdFilmRouteKey
	);

	// The tab follows the composition the moment its name is edited, so a stack of
	// open pieces stays tellable apart.
	const documentTitle = $derived(
		isOpenDocumentRoute && presetBase.name
			? `${presetBase.name} · ${GFX_PRODUCT_NAME}`
			: GFX_PRODUCT_NAME
	);

	// The slug the open document is stored under, or null while it is a Starter
	// nobody has edited. A stored Film autosaves there; a Starter's first edit
	// creates a new Film under a new slug (ADR-0068 §3).
	let storedSlug = $state<string | null>(null);
	let isCreatingFilm = false;

	afterNavigate(() => {
		if (createdFilmRouteKey !== null && routeKey === createdFilmRouteKey) return;
		void loadNavigatedPreset();
	});

	async function loadNavigatedPreset(): Promise<void> {
		const generation = ++routeLoadGeneration;
		const nextData = data;
		const nextRouteKey = JSON.stringify([nextData.slug, nextData.source]);
		const isCurrentLoad = (): boolean =>
			isCurrentPresetRouteRendererLoad(generation, routeLoadGeneration, nextRouteKey, routeKey);

		appliedRouteKey = null;
		createdFilmRouteKey = null;
		rendererLoadError = null;
		resolutionStatus = 'loading';
		posterKey = null;
		loadSnapshot = '';
		storedSlug = null;
		transitionState.active = null;
		transitionState.capturing = false;
		compositionMeta.isUserComposition = false;
		compositionMeta.userCompositionSlug = null;
		compositionMeta.forkedFrom = null;
		compositionMeta.persistenceError = null;

		// A corpus Preset's slug always opens the pristine Starter: nothing is ever
		// stored under it (ADR-0068 §3), so the store is asked only for other slugs.
		let sessionComposition: UserCompositionDocument | null = null;
		if (!nextData.corpusPreset) {
			try {
				sessionComposition = await userCompositionStore.loadUserComposition(nextData.slug);
			} catch (cause) {
				if (!isCurrentLoad()) return;
				console.error('Failed to load the session composition.', { slug: nextData.slug, cause });
				resolutionStatus = 'error';
				return;
			}
			if (!isCurrentLoad()) return;
		}

		// The open document is a Film (ADR-0068 §8). A stored composition arrives
		// as one, with each Scene's real origin. A corpus Preset opens as an
		// unsaved one-Scene Film that remembers its source.
		const document: UserCompositionDocument | null =
			sessionComposition ??
			(nextData.corpusPreset
				? {
						film: filmFromPreset(nextData.corpusPreset, {
							slug: nextData.slug,
							contentKey: posterKeyForPreset(nextData.corpusPreset)
						}),
						legacyPresetEnvelope: legacyPresetEnvelopeFromPreset(nextData.corpusPreset)
					}
				: null);
		if (!document) {
			resolutionStatus = 'missing';
			return;
		}
		const preset = savedPresetFromOpenFilm(
			openFilmDocumentFromFilm(document.film, document.legacyPresetEnvelope)
		);

		try {
			// ADR-0055: a User Pack is loaded from the store before anything reads
			// it; one the store no longer holds fails here, with the slug named, and
			// nothing substitutes another look.
			const packResolution = await ensurePackLoaded(preset.pack);
			if (!isCurrentLoad()) return;
			if (packResolution.kind === 'missing') {
				resolutionStatus = 'error';
				rendererLoadError = packResolution.message;
				return;
			}
			const requirements = collectPresetRendererRequirements(preset, {
				pack: getPack(preset.pack),
				resolvePack: getPack,
				resolvePreset: getPresetBySlug
			});
			const rendererBundle = await pipelineRendererRuntime.resolve(requirements);
			if (!isCurrentLoad()) return;
			pipelineRendererRuntime.activate(rendererBundle);
			applyFilm(document.film, document.legacyPresetEnvelope);
			resolutionStatus = 'ready';
			// Only a User composition is captured on view; a library Preset's poster
			// is a committed still (ADR-0061).
			posterKey = sessionComposition
				? posterKeyForPreset(storedPresetViewOfUserComposition(sessionComposition))
				: null;
			storedSlug = sessionComposition ? nextData.slug : null;
			loadSnapshot = snapshotState();
			compositionMeta.isUserComposition = sessionComposition !== null;
			compositionMeta.userCompositionSlug = nextData.slug;
			compositionMeta.forkedFrom = sessionComposition?.film.scenes[0]?.origin?.slug ?? null;
			appliedRouteKey = nextRouteKey;
		} catch (cause) {
			if (!isCurrentLoad()) return;
			// A renderer chunk the origin no longer serves means a rebuild landed
			// since this page loaded; the tab reloads onto the current build and
			// stays on "Loading…" meanwhile (ADR-0058). Any other failure, or a
			// chunk missing from the current build, is shown.
			if (isModuleLoadFailure(cause) && (await staleBuildRecovery.reloadIfBuildIsStale())) {
				return;
			}
			if (!isCurrentLoad()) return;
			resolutionStatus = 'error';
			console.error('Failed to load composition renderers.', {
				slug: nextData.slug,
				cause
			});
			rendererLoadError =
				cause instanceof Error ? cause.message : 'Failed to load composition renderers.';
		}
	}

	// Autosave: run on any change to the open Film — engineState, presetBase,
	// the pack, or filmState.
	// Skips explicit built-in source mode, when state matches the post-load snapshot, and
	// while the transition snapshot path is mid-capture — engineState is a
	// scratch buffer holding a swapped-in from/to state during that window.
	$effect(() => {
		// Read first, so the effect runs again when a Starter's first edit has
		// become a stored Film and can save whatever changed meanwhile.
		const currentStoredSlug = storedSlug;
		if (
			resolutionStatus !== 'ready' ||
			data.source === 'builtin' ||
			transitionState.capturing ||
			!isOpenDocumentRoute
		) {
			return;
		}

		const currentSnap = snapshotState();

		if (currentSnap === loadSnapshot || isCreatingFilm) return;

		const generation = routeLoadGeneration;
		// Serialize before the debounce so this save cannot observe a later route's state.
		const document = readOpenFilmAsUserCompositionDocument();

		const timer = setTimeout(() => {
			if (!isCurrentOpenDocument(generation)) return;

			if (currentStoredSlug === null) {
				void createFilmFromEditedStarter(generation, document, currentSnap);
				return;
			}
			userCompositionStore
				.saveUserComposition(currentStoredSlug, document)
				.then(() => {
					if (!isCurrentOpenDocument(generation)) return;
					compositionMeta.persistenceError = null;
				})
				.catch((error: unknown) => {
					if (!isCurrentOpenDocument(generation)) return;
					console.error('Autosave failed', error);
					compositionMeta.persistenceError =
						error instanceof Error ? error.message : 'Autosave failed.';
				});
		}, 500);

		return () => clearTimeout(timer);
	});

	// The first edit to a Starter (ADR-0068 §3): store the edited document as a
	// new Film under a new slug, minted the way a new composition's is, and
	// replace the URL with it. The Starter's own route keeps showing the Starter.
	async function createFilmFromEditedStarter(
		generation: number,
		document: UserCompositionDocument,
		documentSnapshot: string
	): Promise<void> {
		isCreatingFilm = true;
		try {
			const slug = await storeUserCompositionUnderNewSlug(document);
			if (!isCurrentOpenDocument(generation)) return;
			compositionMeta.persistenceError = null;
			compositionMeta.isUserComposition = true;
			compositionMeta.userCompositionSlug = slug;
			compositionMeta.forkedFrom = document.film.scenes[0]?.origin?.slug ?? null;
			posterKey = posterKeyForPreset(storedPresetViewOfUserComposition(document));
			// What is stored is `documentSnapshot`; anything edited since differs
			// from it and is saved when `storedSlug` makes the autosave run again.
			loadSnapshot = documentSnapshot;
			createdFilmRouteKey = JSON.stringify([slug, null]);
			storedSlug = slug;
			await goto(resolve('/p/[slug]', { slug }), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
		} catch (error) {
			if (!isCurrentOpenDocument(generation)) return;
			console.error('Creating a Film from the edited Starter failed', error);
			compositionMeta.persistenceError =
				error instanceof Error ? error.message : 'Autosave failed.';
		} finally {
			isCreatingFilm = false;
		}
	}

	function snapshotState(): string {
		return (
			JSON.stringify(engineState) +
			JSON.stringify(presetBase) +
			packState.slug +
			filmState.selectedSceneId +
			JSON.stringify(filmState.scenes.map((scene) => scene.id)) +
			compositionAutosaveInvalidation.revision
		);
	}

	function isCurrentOpenDocument(generation: number): boolean {
		return generation === routeLoadGeneration && isOpenDocumentRoute;
	}
</script>

<svelte:head>
	<title>{documentTitle}</title>
</svelte:head>

{#if rendererLoadError}
	<main class="missing stack">
		<h1>Couldn't load renderer</h1>
		<p>{rendererLoadError}</p>
		<a href={resolve('/')}>All presets</a>
	</main>
{:else if resolutionStatus === 'error'}
	<main class="missing stack">
		<h1>Couldn't load composition</h1>
		<p>The composition store didn't respond. Reload to retry.</p>
		<a href={resolve('/')}>All presets</a>
	</main>
{:else if resolutionStatus === 'missing'}
	<main class="missing stack">
		<h1>Preset not found</h1>
		<p>No preset named "{data.slug}".</p>
		<a href={resolve('/')}>All presets</a>
	</main>
{:else if resolutionStatus === 'loading'}
	<!-- Renderer bundles resolve asynchronously, so this stands in for the editor
	     for a few frames after a card is clicked. It carries the chrome bar the
	     Workspace is about to draw, holding the mark on its pixel instead of
	     blanking it out and snapping it back when the editor arrives. -->
	<main class="loading" aria-busy="true">
		<header class="loading__topbar">
			<GfxMarkHomeLink />
		</header>
		<p role="status">Loading…</p>
	</main>
{:else if isOpenDocumentRoute}
	{#key appliedRouteKey}
		<Workspace {posterKey} />
	{/key}
{/if}

<style>
	.loading {
		padding: 0;
	}

	/* Same 52px bar and 12px inset as `.workspace__topbar`, so the mark does not
	   move when the Workspace replaces this. */
	.loading__topbar {
		align-items: center;
		background: #131315;
		border-block-end: 1px solid #26262a;
		display: flex;
		min-block-size: 52px;
		padding-inline: 12px 14px;
	}

	.loading p {
		margin: 0;
		padding: var(--pad-l);
	}

	.missing {
		padding: var(--pad-l);
		max-inline-size: 32rem;
	}

	.missing h1 {
		margin: 0;
	}
</style>
