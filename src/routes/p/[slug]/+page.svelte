<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';

	import { GFX_PRODUCT_NAME } from '$lib/identity/gfx-brand';
	import GfxMarkHomeLink from '$lib/identity/GfxMarkHomeLink.svelte';
	import { compositionAutosaveInvalidation } from '../../../lib/platform/composition-autosave-invalidation.svelte.ts';
	import { compositionMeta } from '$lib/platform/composition-meta.svelte';
	import { collectFilmRendererRequirements } from '$lib/platform/composition-renderer-readiness';
	import { engineState, packState, transitionState } from '$lib/platform/engine-state.svelte';
	import {
		filmState,
		isOpenFilmEngineStateInTransit,
		readOpenFilmAsUserCompositionDocument
	} from '$lib/platform/film-state.svelte';
	import { filmFromPreset } from '$lib/platform/film-ingress';
	import { legacyPresetEnvelopeFromPreset } from '$lib/platform/open-film-document';
	import {
		discardOpenCompositionArrival,
		isOpenCompositionArrivingAt,
		takeOpenCompositionArrival
	} from '$lib/platform/open-composition-address';
	import { pipelineRendererRuntime } from '$lib/platform/pipelines/runtime-context.svelte';
	import { posterKeyForPreset } from '$lib/platform/posters';
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

	const routeKey = $derived(data.slug);

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
	let appliedRouteKey = $state<string | null>(null);
	let rendererLoadError = $state<string | null>(null);
	let routeLoadGeneration = 0;
	// Counts the documents this route loaded itself. The Workspace is keyed on
	// it, so it remounts for a document the route fetched and stays mounted when
	// a lifecycle operation moved the page with its document already open.
	let loadedDocumentCount = $state(0);

	// Whether the open document is the one this URL names: the route applied it,
	// or the page has just moved here with it open and the arrival is about to be
	// taken (`open-composition-address.ts`).
	const isOpenDocumentRoute = $derived(
		appliedRouteKey === routeKey || isOpenCompositionArrivingAt(routeKey)
	);

	// The tab follows the composition the moment its name is edited, so a stack of
	// open pieces stays tellable apart.
	const documentTitle = $derived(
		isOpenDocumentRoute && presetBase.name
			? `${presetBase.name} · ${GFX_PRODUCT_NAME}`
			: GFX_PRODUCT_NAME
	);

	// The slug the open document is stored under, or null for a corpus Preset.
	// A stored Film autosaves there. A corpus Preset's page never saves: edits
	// stay in memory until `composition.create-film-from-open` (New Film) stores
	// them as a new Film, and leaving the page discards them (ADR-0068 §3).
	let storedSlug: string | null = null;

	afterNavigate(() => {
		// A lifecycle operation opened the document that lives at this slug and
		// moved the page here: the open document is already the right one.
		if (
			takeOpenCompositionArrival(data.slug) &&
			compositionMeta.userCompositionSlug === data.slug
		) {
			keepOpenDocument();
			return;
		}
		void loadNavigatedPreset();
	});

	onDestroy(discardOpenCompositionArrival);

	// Arriving with the document already open: nothing is fetched and nothing is
	// applied, so the undo history and the Composition revision the operation's
	// receipt reported stay as they are. The operation loaded the Pack and the
	// renderers before it applied the document. What is set here is only this
	// route's own bookkeeping: any load still in flight is abandoned, the poster
	// key and the autosave target are read off the open document, and the
	// snapshot autosave compares against is taken now.
	function keepOpenDocument(): void {
		routeLoadGeneration += 1;
		rendererLoadError = null;
		const isStoredFilm = compositionMeta.isUserComposition;
		posterKey = isStoredFilm
			? posterKeyForPreset(
					storedPresetViewOfUserComposition(readOpenFilmAsUserCompositionDocument())
				)
			: null;
		storedSlug = isStoredFilm ? data.slug : null;
		loadSnapshot = snapshotState();
		resolutionStatus = 'ready';
		appliedRouteKey = data.slug;
	}

	async function loadNavigatedPreset(): Promise<void> {
		const generation = ++routeLoadGeneration;
		const nextData = data;
		const nextRouteKey = nextData.slug;
		const isCurrentLoad = (): boolean =>
			isCurrentPresetRouteRendererLoad(generation, routeLoadGeneration, nextRouteKey, routeKey);

		appliedRouteKey = null;
		rendererLoadError = null;
		resolutionStatus = 'loading';
		posterKey = null;
		loadSnapshot = '';
		storedSlug = null;
		transitionState.active = null;
		transitionState.capturing = false;
		filmState.isSwappingScene = false;
		compositionMeta.isUserComposition = false;
		compositionMeta.userCompositionSlug = null;
		compositionMeta.forkedFrom = null;
		compositionMeta.persistenceError = null;

		// A corpus Preset's slug always opens the corpus Preset: nothing is ever
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

		try {
			// ADR-0055: a User Pack is loaded from the store before anything reads
			// it; one the store no longer holds fails here, with the slug named, and
			// nothing substitutes another look. A Film has one Pack (ADR-0068 §1).
			const packResolution = await ensurePackLoaded(document.film.pack);
			if (!isCurrentLoad()) return;
			if (packResolution.kind === 'missing') {
				resolutionStatus = 'error';
				rendererLoadError = packResolution.message;
				return;
			}
			// Every Scene's renderers load before the Film opens, so a cut never
			// waits on a module (ADR-0068 §4).
			const rendererBundle = await pipelineRendererRuntime.resolve(
				collectFilmRendererRequirements(document)
			);
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
			loadedDocumentCount += 1;
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
	// Skips a corpus Preset, which is never saved from its own page, when state
	// matches the post-load snapshot, and while engine state is in transit: the
	// transition snapshot path is mid-capture (engineState is a scratch buffer
	// holding a swapped-in from/to state), or a Scene swap has not settled.
	$effect(() => {
		const currentRouteKey = routeKey;
		if (
			resolutionStatus !== 'ready' ||
			isOpenFilmEngineStateInTransit() ||
			appliedRouteKey !== currentRouteKey
		) {
			return;
		}

		const currentSnap = snapshotState();

		// The open document must still be this route's Film. A lifecycle operation
		// that just opened another one has not moved the page yet, and that
		// document is not saved under this slug.
		if (
			currentSnap === loadSnapshot ||
			storedSlug === null ||
			compositionMeta.userCompositionSlug !== storedSlug
		) {
			return;
		}

		const capturedSlug = storedSlug;
		// Serialize before the debounce so this save cannot observe a later route's state.
		const document = readOpenFilmAsUserCompositionDocument();

		const timer = setTimeout(() => {
			if (
				!isCurrentAppliedRoute(currentRouteKey) ||
				compositionMeta.userCompositionSlug !== capturedSlug
			) {
				return;
			}

			userCompositionStore
				.saveUserComposition(capturedSlug, document)
				.then(() => {
					if (!isCurrentAppliedRoute(currentRouteKey)) return;
					compositionMeta.persistenceError = null;
				})
				.catch((error: unknown) => {
					if (!isCurrentAppliedRoute(currentRouteKey)) return;
					console.error('Autosave failed', error);
					compositionMeta.persistenceError =
						error instanceof Error ? error.message : 'Autosave failed.';
				});
		}, 500);

		return () => clearTimeout(timer);
	});

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

	function isCurrentAppliedRoute(expectedRouteKey: string): boolean {
		return appliedRouteKey === expectedRouteKey && routeKey === expectedRouteKey;
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
	{#key loadedDocumentCount}
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
