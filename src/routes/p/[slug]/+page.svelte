<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	import { GFX_PRODUCT_NAME } from '$lib/identity/gfx-brand';
	import GfxMarkHomeLink from '$lib/identity/GfxMarkHomeLink.svelte';
	import { compositionAutosaveInvalidation } from '../../../lib/platform/composition-autosave-invalidation.svelte.ts';
	import { compositionMeta } from '$lib/platform/composition-meta.svelte';
	import { engineState, packState, transitionState } from '$lib/platform/engine-state.svelte';
	import { filmState, readOpenFilmAsSavedPreset } from '$lib/platform/film-state.svelte';
	import type { Preset } from '$lib/platform/engine-schema';
	import { getPack } from '$lib/platform/packs/registry';
	import { collectPresetRendererRequirements } from '$lib/platform/pipelines/preset-renderer-requirements';
	import { pipelineRendererRuntime } from '$lib/platform/pipelines/runtime-context.svelte';
	import { posterKeyForPreset } from '$lib/platform/posters';
	import { getPresetBySlug } from '$lib/platform/preset-catalog';
	import { applyPreset } from '$lib/platform/preset';
	import { presetBase } from '$lib/platform/preset-base.svelte';
	import { staleBuildRecovery } from '$lib/platform/stale-build-recovery-runtime';
	import { userCompositionStore } from '$lib/platform/user-composition-store';
	import { ensurePackLoaded } from '$lib/platform/user-pack-runtime';
	import { isUserCompositionNotHeldError } from '$lib/platform/user-composition-store-errors';
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

	// Content key for the poster of the loaded User composition — handed to the
	// Workspace, which captures the settled frame under it once (see ./posters).
	// Null for a library Preset: its poster is a committed still (ADR-0061).
	let posterKey = $state<string | null>(null);

	// Snapshot taken immediately after applyPreset — used to detect the first
	// real edit (anything different from a fresh load must be user input).
	// `applyPreset` opens the Preset as a one-Scene Film: it seeds `engineState`,
	// `presetBase`, and `filmState`, so the snapshot covers composition,
	// metadata, and Scene-list edits alike.
	let loadSnapshot = '';
	let appliedRouteKey = $state<string | null>(null);
	let rendererLoadError = $state<string | null>(null);
	let routeLoadGeneration = 0;
	let revertGeneration = 0;

	// The tab follows the composition the moment its name is edited, so a stack of
	// open pieces stays tellable apart.
	const documentTitle = $derived(
		appliedRouteKey === routeKey && presetBase.name
			? `${presetBase.name} · ${GFX_PRODUCT_NAME}`
			: GFX_PRODUCT_NAME
	);

	// Track whether the currently-viewed Preset was found in the User composition store.
	// This determines fork vs autosave on edit.
	let activeIsUserComposition = false;

	afterNavigate(() => {
		void loadNavigatedPreset();
	});

	async function loadNavigatedPreset(): Promise<void> {
		const generation = ++routeLoadGeneration;
		const nextData = data;
		const nextRouteKey = JSON.stringify([nextData.slug, nextData.source]);
		const isCurrentLoad = (): boolean =>
			isCurrentPresetRouteRendererLoad(generation, routeLoadGeneration, nextRouteKey, routeKey);

		appliedRouteKey = null;
		rendererLoadError = null;
		resolutionStatus = 'loading';
		posterKey = null;
		loadSnapshot = '';
		activeIsUserComposition = false;
		transitionState.active = null;
		transitionState.capturing = false;
		compositionMeta.isUserComposition = false;
		compositionMeta.userCompositionSlug = null;
		compositionMeta.forkedFrom = null;
		compositionMeta.persistenceError = null;

		// A session composition shadows the Starter at the same slug, which is what
		// makes an edited Starter open as the fork rather than the pristine one.
		// `?source=builtin` is how the pristine one is reachable again.
		let sessionComposition: Preset | null = null;
		if (nextData.source !== 'builtin') {
			try {
				sessionComposition = await userCompositionStore.loadUserComposition(nextData.slug);
			} catch (cause) {
				if (!isCurrentLoad()) return;
				console.error('Failed to load the session composition.', { slug: nextData.slug, cause });
				if (!nextData.corpusPreset) {
					resolutionStatus = 'error';
					return;
				}
			}
			if (!isCurrentLoad()) return;
		}

		const preset = sessionComposition ?? nextData.corpusPreset;
		if (!preset) {
			resolutionStatus = 'missing';
			return;
		}

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
			// The open document is a Film (ADR-0068 §8). A corpus Preset opens as an
			// unsaved one-Scene Film that remembers its source; a stored composition
			// arrives from the store as the Preset its record reads to, which does
			// not say what it was seeded from.
			applyPreset(
				preset,
				sessionComposition ? null : { slug: nextData.slug, contentKey: posterKeyForPreset(preset) }
			);
			resolutionStatus = 'ready';
			// Only a User composition is captured on view; a library Preset's poster
			// is a committed still (ADR-0061).
			posterKey = sessionComposition ? posterKeyForPreset(sessionComposition) : null;
			activeIsUserComposition = sessionComposition !== null;
			loadSnapshot = snapshotState();
			compositionMeta.isUserComposition = activeIsUserComposition;
			compositionMeta.userCompositionSlug = nextData.slug;
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
		const currentRouteKey = routeKey;
		if (
			resolutionStatus !== 'ready' ||
			data.source === 'builtin' ||
			transitionState.capturing ||
			appliedRouteKey !== currentRouteKey
		) {
			return;
		}

		const currentSnap = snapshotState();

		if (currentSnap === loadSnapshot) return;

		const capturedSlug = data.slug;
		const capturedRouteKey = currentRouteKey;
		const capturedIsUserComposition = activeIsUserComposition;
		// Serialize before the debounce so this save cannot observe a later route's state.
		// Every writer still stores a Preset, so the open Film is saved as the one it is.
		const serializedUserComposition = readOpenFilmAsSavedPreset();

		const timer = setTimeout(() => {
			if (!isCurrentAppliedRoute(capturedRouteKey)) return;

			if (capturedIsUserComposition) {
				userCompositionStore
					.saveUserComposition(capturedSlug, serializedUserComposition)
					.then(() => {
						if (!isCurrentAppliedRoute(capturedRouteKey)) return;
						compositionMeta.persistenceError = null;
					})
					.catch((error: unknown) => {
						if (!isCurrentAppliedRoute(capturedRouteKey)) return;
						console.error('Autosave failed', error);
						compositionMeta.persistenceError =
							error instanceof Error ? error.message : 'Autosave failed.';
					});
			} else {
				userCompositionStore
					.forkUserComposition(capturedSlug, serializedUserComposition, capturedSlug)
					.then(() => {
						if (!isCurrentAppliedRoute(capturedRouteKey)) return;
						compositionMeta.persistenceError = null;
						activeIsUserComposition = true;
						compositionMeta.isUserComposition = true;
						compositionMeta.forkedFrom = capturedSlug;
						posterKey = posterKeyForPreset(serializedUserComposition);
					})
					.catch((error: unknown) => {
						if (!isCurrentAppliedRoute(capturedRouteKey)) return;
						console.error('Fork failed', error);
						compositionMeta.persistenceError =
							error instanceof Error ? error.message : 'Fork failed.';
					});
			}
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

	async function handleRevert(): Promise<void> {
		const currentRouteKey = appliedRouteKey;
		if (resolutionStatus !== 'ready' || !currentRouteKey || routeKey !== currentRouteKey) return;

		const generation = ++revertGeneration;
		const currentRouteGeneration = routeLoadGeneration;
		const currentSlug = data.slug;
		const corpusPreset = getPresetBySlug(currentSlug);
		if (!corpusPreset) return;
		try {
			const rendererBundle = await pipelineRendererRuntime.resolve(
				collectPresetRendererRequirements(corpusPreset, {
					pack: getPack(corpusPreset.pack),
					resolvePack: getPack,
					resolvePreset: getPresetBySlug
				})
			);
			if (
				generation !== revertGeneration ||
				currentRouteGeneration !== routeLoadGeneration ||
				!isCurrentAppliedRoute(currentRouteKey)
			) {
				return;
			}
			try {
				await userCompositionStore.deleteUserComposition(currentSlug);
			} catch (cause) {
				// Reverting wants the fork gone; a store that no longer holds it —
				// another tab discarded it, or this revert already landed — has given
				// exactly that, so the corpus Preset still gets applied below.
				if (!isUserCompositionNotHeldError(cause)) throw cause;
			}
			if (
				generation !== revertGeneration ||
				currentRouteGeneration !== routeLoadGeneration ||
				!isCurrentAppliedRoute(currentRouteKey)
			) {
				return;
			}
			pipelineRendererRuntime.activate(rendererBundle);
			applyPreset(corpusPreset, {
				slug: currentSlug,
				contentKey: posterKeyForPreset(corpusPreset)
			});
			posterKey = null;
			activeIsUserComposition = false;
			loadSnapshot = snapshotState();
			compositionMeta.isUserComposition = false;
			compositionMeta.forkedFrom = null;
			compositionMeta.persistenceError = null;
		} catch (cause) {
			if (generation !== revertGeneration || !isCurrentAppliedRoute(currentRouteKey)) return;
			console.error('Failed to revert composition.', { slug: currentSlug, cause });
			compositionMeta.persistenceError =
				cause instanceof Error ? cause.message : 'Failed to revert composition.';
		}
	}

	onMount(() => {
		compositionMeta.revertUserComposition = handleRevert;
		return () => {
			compositionMeta.revertUserComposition = null;
		};
	});
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
{:else if appliedRouteKey === routeKey}
	{#key routeKey}
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
