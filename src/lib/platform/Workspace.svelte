<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { page } from '$app/state';

	import GfxMarkHomeLink from '$lib/identity/GfxMarkHomeLink.svelte';
	import { AnimationManager } from './animation-manager';
	import { TextAnimationManager } from '$lib/text-animations/manager.svelte';
	import { animState } from './anim-state.svelte';
	import { buildCompositionAnimationManifest } from './composition-animation-manifest';
	import { trackCompositionAuthoringDependencies } from './composition-authoring-dependencies';
	import {
		CompositionExportController,
		type CompositionExportOutcome,
		type CompositionExportUiState
	} from './composition-export-controller';
	import { compositionExportHandle } from './composition-export-handle.svelte';
	import { compositionVerificationProbe } from './composition-verification-probe.svelte';
	import { buildCompositionTimelineTracks } from './composition-timeline-tracks';
	import { compositionEditHistory } from './composition-edit-history';
	import Composition from './Composition.svelte';
	import {
		renderCompositionFrameTo,
		shouldSplitCompositionPlanes,
		type CompositionPosedOverlayRoot,
		type CompositionFrameRenderRequest,
		type CompositionFrameRenderResources,
		type CompositionReadableProbeMode
	} from './composition-frame-renderer';
	import CanvasControlsBar from './CanvasControlsBar.svelte';
	import CanvasEditingOverlay from './CanvasEditingOverlay.svelte';
	import Inspector from './Inspector.svelte';
	import InspectorToggle from './InspectorToggle.svelte';
	import TimelineOutline from './TimelineOutline.svelte';
	import VideoFrame from './VideoFrame.svelte';
	import { fontsReady } from './fonts';
	import { createGpuHost, type GpuHost } from './gpu-host';
	import { disposeSubstrateTextures, getSubstrateTexture } from './substrate-textures';
	import { loadStageModelMesh } from './stage-model-assets';
	import { StageModelController } from './stage-model-controller';
	import { loadStageTypeface } from './stage-typeface-assets';
	import { StageTypefaceController } from './stage-typeface-controller';
	import { resolveStageTypefaceRole } from './packs/resolve';
	import { partitionStageOverlays } from './pipelines/depth-stage-planes';
	import {
		CanvasPaintGenerationTracker,
		clearCanvasPaintHandler,
		requestCanvasPaint,
		setCanvasPaintHandler
	} from './html-in-canvas';
	import { measureCompositionDomRoot } from './composition-dom-rasterizer';
	import { waitForCompositionResourceReadiness } from './composition-resource-readiness';
	import { Timeline } from './timeline.svelte';
	import { timelineHandle } from './timeline-handle.svelte';
	import { engineState, packState, readMarkColor, transitionState } from './engine-state.svelte';
	import { applyCompositionState, applyPreset } from './preset';
	import { getPresetBySlug } from './preset-catalog';
	import { presetBase } from './preset-base.svelte';
	import { serializeCompositionState } from './preset-pure';
	import { compositionMeta } from './composition-meta.svelte';
	import { getAuthoringPackOption } from './packs/catalog';
	import { getPack } from './packs/registry';
	import { isPresetOpaque, isTransitionOpaque } from '$lib/utils/output-classification';
	import { readRuntimeRenderRegistryIdentity } from './deterministic-render-registry-identity';
	import { resolveSurfaceTypographyColors } from './pipelines/definition-registry';
	import { collectPresetRendererRequirements } from './pipelines/preset-renderer-requirements';
	import { pipelineRendererController } from './pipelines/runtime-loader';

	import { TransitionSnapshotController } from './transition-snapshot-controller';
	import {
		COMPOSITION_EXPORT_FORMAT_LABELS,
		COMPOSITION_EXPORT_FORMATS,
		isCompositionExportFormatAvailable
	} from './composition-export-formats';
	import type { SyncExportRequest } from './export-video';
	import { AudioPreview } from './audio-preview';
	import { resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';
	import { clampNumber } from '$lib/utils/math';
	import {
		captureDeterministicRenderRegionManifest,
		exposeDeterministicRenderAudit,
		exposeVisualAudit,
		type DeterministicRenderCaptureAuthority,
		type DeterministicTransitionEndpointManifest
	} from './runtime-audit';
	import { seekDeterministicTimelineFrame } from './deterministic-render-capture-authority';
	import { deriveDeterministicTransitionReadableContracts } from './deterministic-readable-contract';
	import { DeterministicRenderCaptureController } from './deterministic-render-capture-controller';
	import { readBlobAsBase64 } from '$lib/utils/blob-encoding';
	import { capturePosterFrame, readCanvasFramePixels } from '$lib/utils/canvas-capture';
	import { isPosterFrameUsable } from '$lib/utils/poster-frame-choice';
	import { cloneJsonValue } from '$lib/utils/json-clone';
	import {
		deterministicFrameAddressFor,
		type DeterministicFrameRequest,
		type DeterministicSettledFrame
	} from '$lib/utils/deterministic-render-measurements';
	import { posterExists, putPoster, type ScriptedPosterFrameCapture } from './posters';
	import { PosterCaptureController } from './poster-capture-controller';
	import {
		CompositionRenderResourceController,
		type CompositionRenderResourceSet
	} from './composition-render-resources';
	import { StageSubstrateController } from './stage-substrate-controller';
	import { buildSurfaceRenderInputs } from './surface-render-inputs-builder';
	import { VideoUnderlayRuntimeController } from './video-underlay-runtime-controller';

	// Content key for this composition's poster, supplied by the route (which owns
	// the loaded Preset). When set, the settled frame is captured once and cached
	// server-side so the picker can show a real, always-in-sync preview.
	let { posterKey = null }: { posterKey?: string | null } = $props();

	let compositionElement = $state<HTMLElement | null>(null);
	// Depth-of-field plane split (ADR-0027). When a `depth-of-field` Effect is
	// present the Overlay layer is hoisted into this frame-sized sibling of
	// `.composition` so it can be captured on its own as the Overlay plane; the
	// Surface plane is then `.composition` (surface-only). Null otherwise.
	let overlayRootElement = $state<HTMLElement | null>(null);
	// The posed Overlays' own capture roots (ADR-0057), keyed by Overlay id;
	// Composition binds each frame-sized sibling here and nulls it on unmount.
	let posedOverlayRootElements = $state<Record<string, HTMLElement | null>>({});

	// The mounted posed roots in Layer order — what the frame request, the
	// readiness wait, and the readable audit all address.
	function livePosedOverlayRoots(): CompositionPosedOverlayRoot[] {
		const roots: CompositionPosedOverlayRoot[] = [];
		for (const overlay of engineState.overlays) {
			const element = posedOverlayRootElements[overlay.id];
			if (element) roots.push({ overlayId: overlay.id, element });
		}
		return roots;
	}
	let canvas = $state.raw<HTMLCanvasElement | null>(null);
	let host = $state.raw<GpuHost | null>(null);
	let renderResourceSet = $state.raw<CompositionRenderResourceSet | null>(null);
	let isWorkspaceDestroyed = false;
	let timeline = $state.raw<Timeline | null>(null);
	const animationManager = new AnimationManager();
	const audioPreview = new AudioPreview();
	const textAnimationManager = new TextAnimationManager();
	const transitionSnapshotController = new TransitionSnapshotController();
	const deterministicRenderCaptureController = new DeterministicRenderCaptureController();
	let readableProbeMode: CompositionReadableProbeMode = 'normal';
	let forceReadableAuditDomCapture = false;
	let suppressCachedTransitionForAudit = false;
	let transitionSnapshotPreparation: Promise<void> | null = null;
	const compositionExportController = new CompositionExportController();
	const canvasPaintGenerationTracker = new CanvasPaintGenerationTracker();
	const compositionRenderResourceController = new CompositionRenderResourceController();
	const stageSubstrateController = new StageSubstrateController({
		load: getSubstrateTexture,
		onReady: () => {
			if (canvas && !isWorkspaceDestroyed) requestCanvasPaint(canvas);
		},
		onError: (error) => {
			console.error('Stage substrate preparation failed.', error);
			status = error instanceof Error ? error.message : 'Stage substrate preparation failed.';
		}
	});
	// The resident body mesh's bounds, for the canvas overlay's projected
	// selection region (ADR-0060 §3): the controller is a plain class, so its
	// readiness nudges an epoch the derivation reads.
	let stageModelEpoch = $state(0);
	const stageModelController = new StageModelController({
		load: loadStageModelMesh,
		onReady: () => {
			stageModelEpoch += 1;
			if (canvas && !isWorkspaceDestroyed) requestCanvasPaint(canvas);
		},
		onError: (error) => {
			console.error('Stage model preparation failed.', error);
			status = error instanceof Error ? error.message : 'Stage model preparation failed.';
		}
	});
	// The typefaces the stage's body Overlays set in (ADR-0062), decoded before
	// first paint and export the way the screen's mesh is.
	const stageTypefaceController = new StageTypefaceController({
		load: loadStageTypeface,
		onReady: () => {
			if (canvas && !isWorkspaceDestroyed) requestCanvasPaint(canvas);
		},
		onError: (error) => {
			console.error('Stage typeface preparation failed.', error);
			status = error instanceof Error ? error.message : 'Stage typeface preparation failed.';
		}
	});
	const stageBodyMesh = $derived.by(() => {
		void stageModelEpoch;
		void engineState.stage?.screen?.model;
		return stageModelController.mesh();
	});
	const posterCaptureController = new PosterCaptureController({
		waitForFonts: fontsReady,
		delay: (signal) => abortableTimeout(900, signal),
		nextFrame: abortableAnimationFrame,
		settlePaint: settleCompositionPaint,
		exists: posterExists,
		// A capture that lands before the video underlay's first decoded frame
		// shows nothing. Retry with fresh settle windows until content arrives;
		// a frame that still shows nothing is handed back as measured, and the
		// controller declines to store it (ADR-0061).
		capture: async (canvas) => {
			let frame = await capturePosterFrame(canvas);
			for (
				let attempt = 0;
				attempt < 4 && (frame === null || !isPosterFrameUsable(frame));
				attempt++
			) {
				await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 700));
				await settleCompositionPaint(new AbortController().signal);
				await new Promise(requestAnimationFrame);
				frame = await capturePosterFrame(canvas);
			}
			return frame;
		},
		store: putPoster,
		reportError: (error) => console.error('Poster capture failed', error)
	});

	// User-composition poster capture (see ./posters). Once the composition has
	// mounted its GPU host and the route has resolved a content key, force one
	// settled paint and snapshot the canvas to a content-keyed WebP; guarded to
	// once per key. Library Presets pass no key: their posters are committed
	// stills rendered by `pnpm capture:posters` (ADR-0061).
	$effect(() => {
		const key = posterKey;
		const localCanvas = canvas;
		const localCompositionElement = compositionElement;
		if (!key || !localCanvas || !host || !localCompositionElement) {
			posterCaptureController.update(null);
			return;
		}
		posterCaptureController.update({
			key,
			canvas: localCanvas,
			compositionIdentity: localCompositionElement
		});
	});

	function abortableTimeout(delayMs: number, signal: AbortSignal): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timeout = window.setTimeout(settle, delayMs);
			function cleanup(): void {
				window.clearTimeout(timeout);
				signal.removeEventListener('abort', abort);
			}
			function settle(): void {
				cleanup();
				resolve();
			}
			function abort(): void {
				cleanup();
				reject(signal.reason);
			}
			signal.addEventListener('abort', abort, { once: true });
		});
	}

	function abortableAnimationFrame(signal: AbortSignal): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const frame = requestAnimationFrame(settle);
			function cleanup(): void {
				cancelAnimationFrame(frame);
				signal.removeEventListener('abort', abort);
			}
			function settle(): void {
				cleanup();
				resolve();
			}
			function abort(): void {
				cleanup();
				reject(signal.reason);
			}
			signal.addEventListener('abort', abort, { once: true });
		});
	}

	// Where the editor parks the playhead on first load: a settled frame past every
	// enter and before any exit, so the composition + its overlays are visible
	// immediately instead of an empty t=0 canvas (overlays haven't entered yet).
	// Preview-only — export still renders from frame 0.
	const SETTLED_PREVIEW_FRACTION = 0.5;

	// How many times a deterministic settle re-drives a frame that produced no
	// composite before it reports the frame unreachable. Small on purpose: a
	// dropped composite is a transient the next paint clears, so a frame that
	// misses this many settles is a real fault, not a slow machine.
	const DETERMINISTIC_SETTLE_ATTEMPTS = 4;

	let isExporting = $state(false);
	let separateWav = $state(false);
	let progress = $state(0);
	let status = $state('');
	// Layout Contract verification owns composition geometry, not authoring
	// chrome. Once its trusted browser seam is used, unmount the editor overlay
	// so exhaustive cells do not pay for reactive hit-region measurement.
	let deterministicRenderAuditMode = $state(false);
	const videoUnderlayRuntimeController = new VideoUnderlayRuntimeController({
		readHost: () => host,
		readIsExporting: () => isExporting,
		readState: () => engineState,
		renderPreparedPreview: renderPreparedPreviewFrame,
		reportError: (error) => {
			console.error('Composition video underlay failed.', error);
			status = error instanceof Error ? error.message : 'Composition video underlay failed.';
		}
	});
	let showCheckerboard = $state(true);
	// Preview-only reference still behind the transparent canvas (ADR-0034 §7) —
	// judges an overlay over real footage. Never part of the composition or the
	// export. Overrides the checkerboard while set.
	let backdropUrl = $state<string | null>(null);

	// Display zoom — a multiplier on the fit-to-window size (1 = fit = 100%). It
	// is a CSS transform on the displayed canvas only; the native render
	// resolution is untouched (3840×2160). The drag/scale/click geometry reads
	// getBoundingClientRect, which already reflects the transform, so coordinates
	// stay correct at any zoom without threading the factor through.
	let zoom = $state(1);
	// Pan offset (display px) applied with the zoom transform. Only meaningful when
	// zoomed in (zoom > 1); reset to centre whenever we return to fit.
	let panX = $state(0);
	let panY = $state(0);
	// True while a pan drag is in flight, so the canvas tracks the cursor without
	// the zoom transition's float.
	let isPanning = $state(false);
	const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

	function zoomIn(): void {
		const next = ZOOM_LEVELS.find((level) => level > zoom + 1e-6);
		if (next !== undefined) zoom = next;
	}

	function zoomOut(): void {
		const lower = [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 1e-6);
		if (lower !== undefined) {
			zoom = lower;
			if (zoom <= 1) {
				panX = 0;
				panY = 0;
			}
		}
	}

	function zoomFit(): void {
		zoom = 1;
		panX = 0;
		panY = 0;
	}

	// Timeline panel height. Fixed 220px in portrait; drag-resizable in landscape
	// (ADR-0034 §7), where it shares vertical space with the canvas. The chosen
	// landscape height persists in state across orientation flips.
	const DEFAULT_TIMELINE_H = 220;
	let timelineHeight = $state(DEFAULT_TIMELINE_H);
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	const isLandscape = $derived(viewportWidth > viewportHeight);
	const effectiveTimelineHeight = $derived(isLandscape ? timelineHeight : DEFAULT_TIMELINE_H);

	let timelineResizeStart: { startY: number; startHeight: number } | null = null;

	function onTimelineResizeStart(event: PointerEvent): void {
		if (event.button !== 0 || !isLandscape) return;
		event.preventDefault();
		timelineResizeStart = { startY: event.clientY, startHeight: timelineHeight };
		window.addEventListener('pointermove', onTimelineResizeMove);
		window.addEventListener('pointerup', onTimelineResizeEnd);
	}

	function onTimelineResizeMove(event: PointerEvent): void {
		if (!timelineResizeStart) return;
		// Drag up grows the timeline (and shrinks the canvas), down shrinks it.
		const delta = timelineResizeStart.startY - event.clientY;
		const max = Math.max(DEFAULT_TIMELINE_H, viewportHeight - 220);
		timelineHeight = clampNumber(timelineResizeStart.startHeight + delta, 140, max);
	}

	function onTimelineResizeEnd(): void {
		timelineResizeStart = null;
		window.removeEventListener('pointermove', onTimelineResizeMove);
		window.removeEventListener('pointerup', onTimelineResizeEnd);
	}

	// Composition history and transport keys. Native field/button editing keeps
	// its own keyboard behavior; canvas commands use the shared authoring history.
	function handleKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const tag = target?.tagName;
		const ownsNativeEditHistory =
			tag === 'INPUT' ||
			tag === 'TEXTAREA' ||
			tag === 'SELECT' ||
			target?.isContentEditable === true;
		const isHistoryCommand =
			(event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z';
		if (isHistoryCommand) {
			if (ownsNativeEditHistory) return;
			const applied = event.shiftKey
				? compositionEditHistory.redo()
				: compositionEditHistory.undo();
			if (applied) event.preventDefault();
			return;
		}

		if (ownsNativeEditHistory || tag === 'BUTTON') return;
		const isSpace = event.code === 'Space' && !event.repeat;
		const isStep = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
		if (!isSpace && !isStep) return;
		event.preventDefault();
		if (isSpace) {
			timeline?.toggle();
			return;
		}
		const direction = event.key === 'ArrowRight' ? 1 : -1;
		timeline?.stepFrames(direction * (event.shiftKey ? 10 : 1));
	}

	// ── Top-bar identity strip ───────────────────────────────────────────────
	const isHorizontal = $derived(engineState.transport.orientation === 'horizontal');
	// Native target resolution is fixed (3840×2160 ↔ 2160×3840) — the readout
	// states the frame the export renders, it is not an editable field.
	const resolutionLabel = $derived(isHorizontal ? '3840 × 2160' : '2160 × 3840');

	// Export popover — anchored under the top-bar trigger, same top-layer popover
	// treatment as the backdrop picker.
	let exportMenuEl = $state<HTMLDivElement | null>(null);
	let exportTriggerEl = $state<HTMLButtonElement | null>(null);

	function onExportMenuToggle(event: ToggleEvent): void {
		if (event.newState !== 'open' || !exportMenuEl || !exportTriggerEl) return;
		const rect = exportTriggerEl.getBoundingClientRect();
		exportMenuEl.style.right = `${window.innerWidth - rect.right}px`;
		exportMenuEl.style.top = `${rect.bottom + 6}px`;
	}

	function buildRenderInputs(timestamp: number): ReturnType<typeof buildSurfaceRenderInputs> {
		return buildSurfaceRenderInputs(
			{
				readState: () => engineState,
				readAnimState: () => animState,
				readPack: () => getPack(packState.slug),
				readMarkColor,
				readTextAnimationAlpha: () =>
					typeof window === 'undefined' ? null : (window.__gfxTextAnimationManager ?? null)
			},
			timestamp
		);
	}

	// The composition's resolved paper/ink as the active Surface prints them
	// (ADR-0038 + ADR-0039 §2 substrate immunity): explicit typography
	// override → intrinsic substrate on immune documents → active Pack cores.
	// Derived from engineState + packState.slug, so a pack switch restyles
	// every consumer before the re-capture.
	const resolvedTypographyColors = $derived(
		resolveSurfaceTypographyColors(
			getPack(packState.slug),
			engineState.surface.type,
			engineState.typography
		)
	);

	const tracks = $derived(
		buildCompositionTimelineTracks(engineState, {
			paperColor: resolvedTypographyColors.paperColor,
			inkColor: resolvedTypographyColors.inkColor,
			resolveMarkColor: readMarkColor
		})
	);

	const planeSplitActive = $derived(shouldSplitCompositionPlanes(engineState));

	// The GPU host owns one Video asset decoder cache and one resident underlay texture. The
	// cache itself is keyed by immutable media asset identity, never clip timing.
	$effect(() => {
		const localHost = host;
		untrack(() => videoUnderlayRuntimeController.replaceHost(localHost));
	});

	// Reconcile only immutable asset membership. Clip slips/cuts intentionally do
	// not touch decoder ownership and therefore cannot recreate a decoder.
	$effect(() => {
		const assets = engineState.media.assets.map(({ id, assetUrl }) => ({ id, assetUrl }));
		untrack(() => videoUnderlayRuntimeController.reconcileMedia(assets));
	});

	async function waitForActiveCompositionResources(signal?: AbortSignal): Promise<void> {
		const localCompositionElement = compositionElement;
		const localOverlayRootElement = overlayRootElement;
		const localPosedOverlayRoots = livePosedOverlayRoots();
		const localHost = host;
		const localPackSlug = packState.slug;
		const localPack = getPack(localPackSlug);
		const localStageReadiness = stageSubstrateController.snapshot();
		const localStageModelReadiness = stageModelController.snapshot();
		const localStageTypefaceReadiness = stageTypefaceController.snapshot();

		if (!localCompositionElement) {
			throw new Error('Composition root is unavailable while waiting for resources.');
		}
		if (!localHost) {
			throw new Error('Composition GPU host is unavailable while waiting for resources.');
		}
		await waitForCompositionResourceReadiness({
			pack: localPack,
			roots: [
				localCompositionElement,
				localOverlayRootElement,
				...localPosedOverlayRoots.map((root) => root.element)
			],
			flushDom: tick,
			waitForStage: () =>
				Promise.all([
					localStageReadiness.promise,
					localStageModelReadiness.promise,
					localStageTypefaceReadiness.promise
				]).then(() => undefined),
			waitForMedia: () => videoUnderlayRuntimeController.waitForReadiness(signal),
			signal
		});

		if (isWorkspaceDestroyed) {
			throw new Error('Workspace was destroyed while composition resources were pending.');
		}
		const currentPosedOverlayRoots = livePosedOverlayRoots();
		if (
			compositionElement !== localCompositionElement ||
			overlayRootElement !== localOverlayRootElement ||
			currentPosedOverlayRoots.length !== localPosedOverlayRoots.length ||
			currentPosedOverlayRoots.some(
				(root, index) => root.element !== localPosedOverlayRoots[index]?.element
			)
		) {
			throw new Error('Composition roots changed while resource readiness was pending.');
		}
		if (packState.slug !== localPackSlug) {
			throw new Error('Active Pack changed while composition resources were pending.');
		}
		if (host !== localHost) {
			throw new Error('Composition GPU host changed while resource readiness was pending.');
		}
		stageSubstrateController.assertCurrent(localStageReadiness);
		stageModelController.assertCurrent(localStageModelReadiness);
		stageTypefaceController.assertCurrent(localStageTypefaceReadiness);
	}

	async function settleCompositionPaint(signal: AbortSignal): Promise<void> {
		const localCanvas = canvas;
		if (!localCanvas) {
			throw new Error('Composition canvas is unavailable while settling export paint.');
		}
		await canvasPaintGenerationTracker.waitForNextPaint(localCanvas, signal);
		// The paint handler records the paint and then QUEUES the composite, so the
		// paint record alone is not a composited frame: the queued render is what
		// uploads the DOM raster and submits this frame's GPU work. Without this
		// wait the heaviest compositions settle on the previous frame's pixels.
		await videoUnderlayRuntimeController.settleQueuedPreview();
		if (canvas !== localCanvas) {
			throw new Error('Composition canvas changed while settling export paint.');
		}
	}

	// Scripted poster capture (ADR-0061): `pnpm capture:posters` parks the
	// playhead on each candidate frame through this seam and reads the still
	// back with its measurement. Peer to `__gfxExport`; never a UI path.
	async function capturePosterFrameAt(
		timestampSeconds: number
	): Promise<ScriptedPosterFrameCapture | null> {
		const localCanvas = canvas;
		const localTimeline = timeline;
		if (!localCanvas || !localTimeline) {
			throw new Error('Composition canvas and timeline are unavailable for poster capture.');
		}
		const signal = new AbortController().signal;
		await fontsReady();
		localTimeline.pause();
		localTimeline.seek(timestampSeconds);
		await settleCompositionPaint(signal);
		// Composited is not yet presented: `toBlob` reads the presented image,
		// which lands two frame boundaries after the submit (see the deterministic
		// settle below for why one is not enough).
		await host?.device.queue.onSubmittedWorkDone();
		await abortableAnimationFrame(signal);
		await abortableAnimationFrame(signal);
		const frame = await capturePosterFrame(localCanvas);
		if (!frame) return null;
		return {
			timestampSeconds: localTimeline.time,
			width: frame.width,
			height: frame.height,
			contentFraction: frame.contentFraction,
			isBlank: frame.isBlank,
			webpBase64: await readBlobAsBase64(frame.blob)
		};
	}

	function currentFrameRenderResources(): CompositionFrameRenderResources {
		return (
			renderResourceSet?.snapshot() ?? {
				host: null,
				pipeline: null,
				effectChain: null,
				shaderPassDispatcher: null,
				compositionPlanes: null,
				depthStage: null
			}
		);
	}

	// Workspace owns every live DOM/GPU reference. The renderer receives an
	// explicit per-call snapshot of those dependencies; it does not subscribe to
	// Svelte state or create a second lifecycle around them.
	function buildCompositionFrameRenderRequest(
		outputView: GPUTextureView,
		timestamp: number
	): CompositionFrameRenderRequest {
		const posedOverlayRoots = livePosedOverlayRoots();
		return {
			outputView,
			timestamp,
			state: engineState,
			pack: getPack(packState.slug),
			paperVisibility: animState.paperVisibility,
			compositionElement,
			overlayRootElement,
			posedOverlayRoots,
			substrateTexture: stageSubstrateController.texture(),
			stageModelMesh: stageModelController.mesh(),
			stageTypeface: (slug: string) => stageTypefaceController.typeface(slug),
			overlayChannels: animState.overlayChannels,
			overlayProgresses: animState.overlayProgresses,
			effectChannels: animState.effectChannels,
			videoUnderlayTexture: videoUnderlayRuntimeController.preparedTexture(),
			readableProbeMode,
			domCapture: {
				surface: canvasPaintGenerationTracker.generationFor(compositionElement),
				overlay: canvasPaintGenerationTracker.generationFor(overlayRootElement),
				posedOverlays: Object.fromEntries(
					posedOverlayRoots.map((root) => [
						root.overlayId,
						canvasPaintGenerationTracker.generationFor(root.element)
					])
				),
				force: isExporting || forceReadableAuditDomCapture
			},
			resources: currentFrameRenderResources(),
			cachedTransition: suppressCachedTransitionForAudit
				? null
				: transitionSnapshotController.cachedFrame(),
			buildSurfaceInputs: buildRenderInputs
		};
	}

	function renderPreparedPreviewFrame(localHost: GpuHost, timestamp: number): boolean {
		if (host !== localHost || isExporting || isWorkspaceDestroyed) {
			return false;
		}
		return (
			renderCompositionFrameTo(
				buildCompositionFrameRenderRequest(
					localHost.context.getCurrentTexture().createView(),
					timestamp
				)
			) !== 'unavailable'
		);
	}

	function renderAt(timestamp: number): void {
		const localHost = host;
		if (!localHost || isExporting || isWorkspaceDestroyed) {
			return;
		}
		videoUnderlayRuntimeController.queuePreview(
			secondsToFrames(timestamp, resolveFrameRate(engineState.transport.fps)),
			timestamp
		);
	}

	async function prepareVideoExportFrame(frame: number, timestamp: number): Promise<void> {
		await videoUnderlayRuntimeController.prepareExportFrame(frame);
		void timestamp;
	}

	// The single per-frame driver. Called by the Timeline's tick (play + seek)
	// and by the composition-sync effect after an authoring change. Advances the
	// GSAP playhead (which applies DOM transforms + writes animState), then asks
	// the canvas to paint — the paint handler re-uploads the now-current DOM and
	// composites it (uploadDom + renderAt). Going through requestCanvasPaint keeps
	// capture on the browser's paint tick, after Svelte has flushed the DOM the
	// new progress produced; a synchronous renderAt here would composite a stale
	// DOM texture. This is imperative on purpose — rendering is a side effect of
	// time/authoring changes, not a reactive derivation.
	function tickTimeline(timestamp: number): void {
		const duration = engineState.transport.durationSeconds;
		const fraction = duration > 0 ? timestamp / duration : 0;
		animationManager.progress(fraction);
		animState.globalProgress = fraction;
		if (canvas) {
			requestCanvasPaint(canvas);
		}
	}

	function nextFrame(): Promise<void> {
		return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}

	function rebuildAnimationAtProgress(snapshotProgress: number): void {
		animationManager.rebuild(
			buildCompositionAnimationManifest({
				state: engineState,
				runtime: animState,
				textAnimationRoot: compositionElement,
				textAnimationCompiler: textAnimationManager,
				resolveMarkColor: readMarkColor
			})
		);
		animationManager.progress(snapshotProgress);
		animState.globalProgress = snapshotProgress;
	}

	$effect(() => {
		const active = transitionState.active;
		if (!active) {
			transitionSnapshotController.invalidate();
			return;
		}
		if (!host || !canvas || !renderResourceSet) {
			return;
		}

		const localHost = host;
		const localCanvas = canvas;
		untrack(() => {
			const preparation = transitionSnapshotController.update(active, {
				host: localHost,
				width: localCanvas.width,
				height: localCanvas.height,
				captureCompositionState: () =>
					serializeCompositionState(presetBase, $state.snapshot(engineState), packState.slug),
				applyCompositionState,
				readCapturing: () => transitionState.capturing,
				writeCapturing: (value) => {
					transitionState.capturing = value;
				},
				flushDom: tick,
				waitForFonts: fontsReady,
				waitForLayout: async () => {
					await nextFrame();
					await nextFrame();
				},
				settlePaint: () => settleCompositionPaint(new AbortController().signal),
				settleAnimation: rebuildAnimationAtProgress,
				renderFrame: (outputView, timestamp) =>
					renderCompositionFrameTo(buildCompositionFrameRenderRequest(outputView, timestamp)),
				isActiveTransition: (candidate) => transitionState.active === candidate,
				seekTimeline: (timestamp) => timeline?.seek(timestamp)
			});
			transitionSnapshotPreparation = preparation;
			const clearPreparation = (): void => {
				if (transitionSnapshotPreparation === preparation) {
					transitionSnapshotPreparation = null;
				}
			};
			void preparation.then(clearPreparation, (error) => {
				console.error('Transition snapshot preparation failed.', error);
				status = error instanceof Error ? error.message : 'Transition snapshot preparation failed.';
				clearPreparation();
			});
		});
	});

	$effect(() => {
		if (!canvas || host) {
			return;
		}

		const targetCanvas = canvas;

		let isCancelled = false;
		createGpuHost(targetCanvas)
			.then((nextHost) => {
				if (isCancelled || isWorkspaceDestroyed) {
					nextHost.dispose();
					return;
				}
				host = nextHost;
			})
			.catch((error) => {
				if (isCancelled || isWorkspaceDestroyed) {
					return;
				}
				console.error('Unable to initialize the GPU host.', error);
				status = error instanceof Error ? error.message : 'Unable to initialize the GPU host.';
			});

		return () => {
			isCancelled = true;
		};
	});

	$effect(() => {
		const localHost = host;
		const localStage = engineState.stage;
		const stageAsset =
			localStage?.type === 'depth' ? (localStage.backdrop?.image?.asset ?? null) : null;
		untrack(() => {
			stageSubstrateController.update({
				host: localHost,
				stageIdentity: localStage ?? null,
				asset: stageAsset
			});
		});
	});

	$effect(() => {
		const localStage = engineState.stage;
		const screenModel = localStage?.type === 'depth' ? (localStage.screen?.model ?? null) : null;
		untrack(() => {
			stageModelController.update({ stageIdentity: localStage ?? null, model: screenModel });
		});
	});

	$effect(() => {
		// The face every body Overlay sets in is the Pack's (ADR-0062): one
		// typeface per composition while the stage carries a body.
		const localStage = engineState.stage;
		const hasBodies =
			localStage?.type === 'depth' && partitionStageOverlays(engineState.overlays).bodies.length > 0;
		const slugs = hasBodies ? [resolveStageTypefaceRole(getPack(packState.slug))] : [];
		untrack(() => {
			stageTypefaceController.update({ stageIdentity: localStage ?? null, slugs });
		});
	});

	$effect(() => {
		// Triggers (tracked): rebuild the pipeline only when the GPU host, the
		// composition/canvas elements, or the surface type/orientation change.
		if (!host || !compositionElement || !canvas) {
			return;
		}

		const surfaceType = engineState.surface.type;
		void engineState.transport.orientation;

		const localHost = host;
		const localSource = compositionElement;
		const localCanvas = canvas;

		// Everything below is imperative engine wiring. Triggers above stay tracked;
		// allocation and state writes below must not subscribe this effect to itself.
		return untrack(() => {
			let nextResources: CompositionRenderResourceSet;
			try {
				nextResources = compositionRenderResourceController.replace({
					host: localHost,
					sourceElement: localSource,
					surfaceType,
					width: localCanvas.width,
					height: localCanvas.height
				});
			} catch (error) {
				renderResourceSet = null;
				console.error('Composition render resource initialization failed.', error);
				status =
					error instanceof Error ? error.message : 'Composition render resources unavailable.';
				return;
			}
			renderResourceSet = nextResources;

			if (!timeline) {
				timeline = new Timeline({
					durationSeconds: engineState.transport.durationSeconds,
					fps: engineState.transport.fps,
					tick: tickTimeline,
					// Preview audio rides the transport (ADR-0033 §6): cues schedule on
					// play from the playhead, reschedule on loop wrap, cancel on pause.
					// Scrub stays silent — seek has no hook by design.
					onPlay: () => {
						videoUnderlayRuntimeController.startPlayback();
						audioPreview
							.start(engineState, () => timeline?.time ?? 0)
							.catch((error) => console.error('Preview audio failed to start.', error));
					},
					onPause: () => {
						videoUnderlayRuntimeController.stopPlayback();
						audioPreview.stop();
					},
					onLoop: () => {
						videoUnderlayRuntimeController.stopPlayback();
						videoUnderlayRuntimeController.startPlayback();
						audioPreview
							.start(engineState, () => timeline?.time ?? 0)
							.catch((error) => console.error('Preview audio failed to restart.', error));
					}
				});
				if (typeof window !== 'undefined') {
					window.__gfxTimeline = timeline;
					window.__gfxTextAnimationManager = textAnimationManager;
					// Agent-facing export seam (ADR-0042) — the sync loop drives the
					// real export path with a start timecode + sync filename.
					window.__gfxExport = performExport;
					window.__gfxCapturePosterFrameAt = capturePosterFrameAt;
				}
				// The `delivery` family exports through this handle, and waits on the
				// same outcome the Export button produces (ADR-0054 §7).
				compositionExportHandle.current = ({ request, signal }) => performExport(request, signal);
				// The inspector's keyframe rows navigate the playhead through this
				// handle (prev/next jumps + add-at-playhead).
				timelineHandle.current = timeline;
				animationManager.rebuild(
					buildCompositionAnimationManifest({
						state: engineState,
						runtime: animState,
						textAnimationRoot: compositionElement,
						textAnimationCompiler: textAnimationManager,
						resolveMarkColor: readMarkColor
					})
				);
				// Park on a settled frame so the composition is visible on open (the
				// seek drives the manifest to that frame and requests the first paint).
				timeline.seek(engineState.transport.durationSeconds * SETTLED_PREVIEW_FRACTION);
			}

			setCanvasPaintHandler(localCanvas, (event) => {
				canvasPaintGenerationTracker.record(localCanvas, event);
				// A paint composites the current DOM through the shared seam. The seek/play
				// tick already applied the GSAP state (and wrote animState) before
				// requesting this paint, so we only composite here — renderAt(), not
				// tickTimeline(), to avoid re-driving the animation on every paint.
				if (timeline) {
					renderAt(timeline.time);
				}
			});
			// Gate first paint on every initial frame input: active Pack fonts, static
			// substrate upload, and Video asset decoder readiness. A Video underlay paint
			// also waits for its exact sample in renderAt; this gate prevents a competing
			// font/substrate paint from racing the decoder's initial probe.
			void waitForActiveCompositionResources()
				.then(() => {
					if (!isWorkspaceDestroyed && host === localHost && renderResourceSet === nextResources) {
						requestCanvasPaint(localCanvas);
					}
				})
				.catch((error) => {
					if (isWorkspaceDestroyed || host !== localHost || renderResourceSet !== nextResources)
						return;
					console.error('Composition first paint preparation failed.', error);
					status =
						error instanceof Error ? error.message : 'Composition first paint preparation failed.';
				});

			return () => {
				clearCanvasPaintHandler(localCanvas);
			};
		});
	});

	$effect(() => {
		const localTimeline = timeline;
		const localCompositionRoot = compositionElement;
		const localOverlayRoot = overlayRootElement;
		if (!localTimeline || !localCompositionRoot) return;

		async function forceAuditPaint(): Promise<void> {
			if (!canvas) throw new Error('Readable capture requires the active canvas.');
			// The settle already requests the paint in both lanes. A second request
			// here would collapse onto a follow-up rasterization that lands after the
			// audit has read the frame — a doubled 4K raster and a moving target.
			await settleCompositionPaint(new AbortController().signal);
			await tick();
		}

		const baseAuthority: DeterministicRenderCaptureAuthority = {
			compositionRoot: localCompositionRoot,
			overlayRoot: localOverlayRoot,
			posedOverlayRoots: livePosedOverlayRoots().map((root) => root.element),
			seekExactFrame: (requestedAddress) =>
				seekDeterministicTimelineFrame(requestedAddress, {
					timeline: localTimeline,
					fps: engineState.transport.fps,
					settleNextPaint: () => settleCompositionPaint(new AbortController().signal),
					flushDom: tick
				}),
			captureReadableCompositedMasks: (settled, targets) => {
				const localCanvas = canvas;
				const localHost = host;
				if (!localCanvas || !localHost) {
					throw new Error('Readable capture requires the active canvas and GPU host.');
				}
				// Every direct canvas child the readable audit may need to suppress or
				// paint: the composition root, the shared Overlay root, and each posed
				// Overlay's own root (ADR-0057) — a card riding its own plane is still
				// readable content.
				return deterministicRenderCaptureController.capture(settled, targets, {
					canvas: localCanvas,
					compositionRoots: [
						localCompositionRoot,
						...(localOverlayRoot ? [localOverlayRoot] : []),
						...livePosedOverlayRoots().map((root) => root.element)
					],
					waitForGpu: () => localHost.device.queue.onSubmittedWorkDone(),
					forcePaint: forceAuditPaint,
					setDomCaptureForced: (forced) => {
						forceReadableAuditDomCapture = forced;
					},
					setProbeMode: (mode) => {
						readableProbeMode = mode;
					}
				});
			}
		};

		const authority: DeterministicRenderCaptureAuthority = {
			...baseAuthority,
			captureTransitionEndpointManifests: async (settled) => {
				const active = transitionState.active;
				if (!active) return [];
				await transitionSnapshotPreparation;
				const sourceComposition = serializeCompositionState(
					presetBase,
					$state.snapshot(engineState),
					packState.slug
				);
				const wasCapturing = transitionState.capturing;
				const endpointManifests: DeterministicTransitionEndpointManifest[] = [];
				const endpointContracts = deriveDeterministicTransitionReadableContracts(active);
				try {
					transitionState.capturing = true;
					suppressCachedTransitionForAudit = true;
					for (const endpoint of ['from', 'to'] as const) {
						const preset = cloneJsonValue(active[endpoint]);
						preset.state.transport.orientation = sourceComposition.state.transport.orientation;
						applyCompositionState(preset);
						await tick();
						await fontsReady();
						await nextFrame();
						await nextFrame();
						const frameRate = resolveFrameRate(preset.state.transport.fps);
						const frameIndex = Math.round(
							preset.state.transport.durationSeconds * 0.5 * (frameRate.num / frameRate.den)
						);
						const endpointRequest = {
							address: deterministicFrameAddressFor(frameIndex, frameRate),
							frameRate: { num: frameRate.num, den: frameRate.den }
						};
						const endpointSettled = await seekDeterministicTimelineFrame(endpointRequest, {
							timeline: localTimeline,
							fps: preset.state.transport.fps,
							settleNextPaint: () => settleCompositionPaint(new AbortController().signal),
							flushDom: tick
						});
						const contract = endpointContracts.find(
							(entry) => entry.endpoint === endpoint
						)?.contract;
						if (!contract || contract.status === 'unavailable') {
							throw new Error(`Transition ${endpoint} readable contract was unavailable.`);
						}
						const manifest = await captureDeterministicRenderRegionManifest(
							engineState,
							endpointSettled,
							baseAuthority
						);
						const expectedIds = contract.expected.map((entry) => entry.id);
						if (
							expectedIds.length !== manifest.readableCoverage.expectedReadableIdentities.length ||
							expectedIds.some(
								(id) => !manifest.readableCoverage.expectedReadableIdentities.includes(id)
							)
						) {
							throw new Error(`Transition ${endpoint} endpoint identity authority diverged.`);
						}
						endpointManifests.push({
							endpoint,
							presetSlug: endpoint === 'from' ? active.fromSlug : active.toSlug,
							manifest
						});
					}
				} finally {
					applyCompositionState(sourceComposition);
					await tick();
					await nextFrame();
					await nextFrame();
					transitionState.capturing = wasCapturing;
					suppressCachedTransitionForAudit = false;
					const requestedProgress =
						settled.address.timestampMicroseconds /
						(sourceComposition.state.transport.durationSeconds * 1_000_000);
					rebuildAnimationAtProgress(requestedProgress);
					await seekDeterministicTimelineFrame(
						{ address: settled.address, frameRate: settled.activeFrameRate },
						{
							timeline: localTimeline,
							fps: sourceComposition.state.transport.fps,
							settleNextPaint: () => settleCompositionPaint(new AbortController().signal),
							flushDom: tick
						}
					);
				}
				return endpointManifests;
			}
		};

		window.__captureGfxDeterministicReadablePngArtifacts = (readableId) =>
			deterministicRenderCaptureController.artifactDataUrls(readableId);
		window.__readGfxRuntimeRenderRegistryIdentity = readRuntimeRenderRegistryIdentity;
		// The one settle every exact-frame reader goes through: the scripted CDP
		// handle below, and the `verification` family's probe. A second settle path
		// would be a second set of guarantees about which frame is on the canvas.
		const settleDeterministicCompositionFrame = async (
			request: DeterministicFrameRequest
		): Promise<DeterministicSettledFrame & { settleMilliseconds: number }> => {
			const startedAt = performance.now();
			// Every await in a settle can resolve without a composite reaching the
			// canvas: a queued preview is dropped when its host reads back null, when
			// a newer request supersedes it, or when the frame renderer reports
			// `unavailable`. The canvas then still holds the PREVIOUS frame, and a
			// reader cannot tell that apart from a correct settle — under a full
			// matrix run this surfaced as a frame-determinism failure whose "replay"
			// bytes were exactly the away frame's. So the settle is retried until a
			// composite actually lands, and gives up loudly rather than handing back
			// pixels that belong to another address.
			let settled: DeterministicSettledFrame | null = null;
			for (let attempt = 0; attempt < DETERMINISTIC_SETTLE_ATTEMPTS; attempt += 1) {
				const composited = videoUnderlayRuntimeController.readRenderedPreviewGeneration();
				settled = await baseAuthority.seekExactFrame(request);
				if (videoUnderlayRuntimeController.readRenderedPreviewGeneration() > composited) break;
				settled = null;
			}
			if (!settled) {
				throw new Error(
					`Composition never composited frame ${request.address.frameIndex} in ${DETERMINISTIC_SETTLE_ATTEMPTS} settles.`
				);
			}
			// A composited frame is not yet a READABLE one. `settleCompositionPaint`
			// gets the composite submitted; this waits for it to finish and then to be
			// presented, because `toBlob`/`toDataURL` read the canvas's presented
			// image. Two frame boundaries is what presentation actually costs: the
			// first rAF runs BEFORE the paint that presents this frame, the second
			// after it. One was enough whenever the machine was idle and returned the
			// previous frame's pixels whenever it was not — invisible in the WICG
			// lane, where the settle already rides the browser's own paint tick, and
			// reproducible in the rasterization lane under a full matrix run.
			await host?.device.queue.onSubmittedWorkDone();
			await nextFrame();
			await nextFrame();
			return { ...settled, settleMilliseconds: performance.now() - startedAt };
		};
		window.__settleGfxDeterministicCompositionFrame = settleDeterministicCompositionFrame;

		function deterministicFrameRequestFor(frame: number): DeterministicFrameRequest {
			const frameRate = resolveFrameRate(engineState.transport.fps);
			return {
				address: deterministicFrameAddressFor(frame, frameRate),
				frameRate: { num: frameRate.num, den: frameRate.den }
			};
		}

		compositionVerificationProbe.current = {
			captureSettledFrame: async (frame, signal) => {
				const settled = await settleDeterministicCompositionFrame(
					deterministicFrameRequestFor(frame)
				);
				signal.throwIfAborted();
				if (!canvas) throw new Error('The composition canvas is unavailable.');
				const pixels = await readCanvasFramePixels(canvas);
				if (!pixels) throw new Error('The composition canvas presented no pixels to measure.');
				return {
					frame: settled.address.frameIndex,
					timestampMicroseconds: settled.address.timestampMicroseconds,
					frameRate: settled.activeFrameRate,
					pixels
				};
			},
			auditSettledFrameReadableText: async (frame, signal) => {
				const settled = await settleDeterministicCompositionFrame(
					deterministicFrameRequestFor(frame)
				);
				signal.throwIfAborted();
				return captureDeterministicRenderRegionManifest(engineState, settled, {
					compositionRoot: baseAuthority.compositionRoot,
					overlayRoot: baseAuthority.overlayRoot,
					captureReadableCompositedMasks: baseAuthority.captureReadableCompositedMasks
				});
			}
		};

		window.__captureGfxDeterministicFrameGeometry = (candidateIds) => {
			const width = engineState.transport.orientation === 'horizontal' ? 3840 : 2160;
			const height = engineState.transport.orientation === 'horizontal' ? 2160 : 3840;
			const elements: Record<string, { x: number; y: number; width: number; height: number }> = {};
			// Each candidate is measured inside the direct canvas child that owns it,
			// because the Overlay plane is hoisted to its own child while the DOF/stage
			// split is on. Both children are frame-sized, so normalizing against the
			// measured root keeps one native coordinate space either way.
			const measureWithin = (source: HTMLElement, ids: readonly string[]): void => {
				if (ids.length === 0) return;
				measureCompositionDomRoot({ element: source, width, height, view: window }, (root) => {
					const rootRect = root.getBoundingClientRect();
					if (rootRect.width <= 0 || rootRect.height <= 0) {
						throw new Error('Composition geometry root is unavailable.');
					}
					for (const candidateId of ids) {
						const element = candidateId.startsWith('overlay:')
							? root.querySelector<HTMLElement>(
									`[data-overlay-id="${CSS.escape(candidateId.slice('overlay:'.length))}"]`
								)
							: root;
						if (!element) continue;
						const rect = element.getBoundingClientRect();
						elements[candidateId] = {
							x: ((rect.x - rootRect.x) * width) / rootRect.width,
							y: ((rect.y - rootRect.y) * height) / rootRect.height,
							width: (rect.width * width) / rootRect.width,
							height: (rect.height * height) / rootRect.height
						};
					}
				});
			};
			// A posed Overlay (ADR-0057) is hoisted into its own frame-sized root,
			// so its candidate is measured there; every other Overlay candidate is
			// measured in the shared Overlay root as before.
			const sharedOverlayIds: string[] = [];
			const posedGroups: { root: HTMLElement; ids: string[] }[] = [];
			for (const candidateId of candidateIds) {
				if (candidateId === 'composition-root') {
					elements[candidateId] = { x: 0, y: 0, width, height };
					continue;
				}
				if (candidateId !== 'overlay-root' && !candidateId.startsWith('overlay:')) continue;
				const posedRoot = candidateId.startsWith('overlay:')
					? posedOverlayRootElements[candidateId.slice('overlay:'.length)]
					: null;
				if (!posedRoot) {
					sharedOverlayIds.push(candidateId);
					continue;
				}
				const group = posedGroups.find((entry) => entry.root === posedRoot);
				if (group) group.ids.push(candidateId);
				else posedGroups.push({ root: posedRoot, ids: [candidateId] });
			}
			measureWithin(localOverlayRoot ?? localCompositionRoot, sharedOverlayIds);
			for (const group of posedGroups) measureWithin(group.root, group.ids);
			return { elements };
		};
		window.__configureGfxDeterministicRenderCell = async (input) => {
			if (new URLSearchParams(window.location.search).get('source') !== 'builtin') {
				throw new Error('Deterministic render cells require the built-in Preset route.');
			}
			if (!deterministicRenderAuditMode) {
				deterministicRenderAuditMode = true;
				await tick();
			}
			const preset = getPresetBySlug(input.presetSlug);
			if (!preset || preset.kind === 'fixture') {
				throw new Error(`Unknown deliverable Preset ${input.presetSlug}.`);
			}
			const configuredPack = getPack(input.packId);
			const configuredPreset = cloneJsonValue(preset);
			configuredPreset.pack = input.packId;
			configuredPreset.state.transport.orientation = input.orientation;
			pipelineRendererController.activate(
				await pipelineRendererController.resolve(
					collectPresetRendererRequirements(configuredPreset, {
						pack: configuredPack,
						resolvePack: getPack,
						resolvePreset: getPresetBySlug
					})
				)
			);
			applyPreset(configuredPreset);
			if (transitionState.active) {
				transitionState.active = {
					...transitionState.active,
					from: { ...cloneJsonValue(transitionState.active.from), pack: input.packId },
					to: { ...cloneJsonValue(transitionState.active.to), pack: input.packId }
				};
			}
			await tick();
			await fontsReady();
			await waitForActiveCompositionResources();
			await nextFrame();
			await nextFrame();
			if (!canvas) throw new Error('Composition canvas is unavailable.');
			const frameRate = resolveFrameRate(configuredPreset.state.transport.fps);
			const transition = transitionState.active;
			return {
				presetSlug: input.presetSlug,
				packId: packState.slug,
				orientation: engineState.transport.orientation,
				width: canvas.width,
				height: canvas.height,
				frameRate: { num: frameRate.num, den: frameRate.den },
				expectedOutputClass: (
					transition
						? isTransitionOpaque({ from: transition.from, to: transition.to })
						: isPresetOpaque(configuredPreset)
				)
					? 'opaque'
					: 'transparent'
			};
		};
		exposeDeterministicRenderAudit(engineState, authority);

		return () => {
			compositionVerificationProbe.current = null;
		};
	});

	$effect(() => {
		// Re-run the visual audit whenever the surface has settled, so DOM
		// positions reflect what the viewer sees at rest, not at frame 0.
		void engineState.surface.content.body;
		void engineState.surface.content.title;
		void engineState.surface.content.counterpoint;
		void engineState.surface.variant;
		void engineState.surface.content.sourceUrl;
		void engineState.typography.fontFamily;
		void engineState.transport.orientation;
		void animState.paperVisibility;
		const id = requestAnimationFrame(() => {
			if (animState.paperVisibility >= 0.99) {
				exposeVisualAudit(engineState);
			}
		});

		return () => cancelAnimationFrame(id);
	});

	// Composition sync — the single reactive bridge from authoring state to the
	// imperative canvas. It tracks every input that changes WHAT the composition
	// is (content, marks, effects, overlays, typography, background) and, when any
	// changes, rebuilds the animation manifest and repaints the current frame. It
	// is NOT a per-frame driver — it must not read per-frame state (animState
	// progresses); the timeline tick owns time. The rebuild+tick is untracked so
	// this effect never subscribes to the animState / pipeline / timeline.time it
	// touches — that self-subscription is exactly what made the render effects
	// loop. Rendering is a side effect of authoring changes, expressed once, here.
	$effect(() => {
		trackCompositionAuthoringDependencies(engineState, packState.slug);

		untrack(() => {
			if (!timeline) return;
			// Rebuild is fingerprint-guarded: a no-op when only effects/background
			// changed (those aren't manifest tweens). The tick repaints either way.
			animationManager.rebuild(
				buildCompositionAnimationManifest({
					state: engineState,
					runtime: animState,
					textAnimationRoot: compositionElement,
					textAnimationCompiler: textAnimationManager,
					resolveMarkColor: readMarkColor
				})
			);
			tickTimeline(timeline.time);
		});
	});

	$effect(() => {
		if (!timeline) {
			return;
		}

		timeline.durationSeconds = engineState.transport.durationSeconds;
		timeline.fps = engineState.transport.fps;

		if (timeline.time > engineState.transport.durationSeconds) {
			timeline.seek(engineState.transport.durationSeconds);
		}
	});

	onDestroy(() => {
		isWorkspaceDestroyed = true;
		posterCaptureController.dispose();
		videoUnderlayRuntimeController.dispose();
		animationManager.dispose();
		textAnimationManager.dispose();
		if (typeof window !== 'undefined') {
			window.__gfxTextAnimationManager = undefined;
			window.__gfxExport = undefined;
			window.__gfxCapturePosterFrameAt = undefined;
			window.__captureGfxDeterministicReadablePngArtifacts = undefined;
			window.__captureGfxDeterministicRenderRegionManifest = undefined;
			window.__readGfxRuntimeRenderRegistryIdentity = undefined;
			window.__captureGfxDeterministicFrameGeometry = undefined;
			window.__settleGfxDeterministicCompositionFrame = undefined;
			window.__configureGfxDeterministicRenderCell = undefined;
			window.removeEventListener('pointermove', onTimelineResizeMove);
			window.removeEventListener('pointerup', onTimelineResizeEnd);
		}
		timeline?.dispose();
		timeline = null;
		timelineHandle.current = null;
		compositionExportHandle.current = null;
		audioPreview.dispose();
		transitionSnapshotController.dispose();
		compositionExportController.dispose();
		if (typeof window !== 'undefined' && window.__gfxTimeline) {
			window.__gfxTimeline = undefined;
		}
		compositionRenderResourceController.dispose();
		renderResourceSet = null;
		stageSubstrateController.dispose();
		stageModelController.dispose();
		stageTypefaceController.dispose();
		disposeSubstrateTextures();
		host?.dispose();
		host = null;
	});

	// Workspace retains the live Svelte/DOM/GPU ownership required by export.
	// The controller owns planning, deterministic stepping, encoding handoff,
	// downloads, status, cancellation, and cleanup.
	async function performExport(
		request?: SyncExportRequest,
		signal?: AbortSignal
	): Promise<CompositionExportOutcome> {
		await tick();
		await transitionSnapshotPreparation;
		return compositionExportController.export(
			{
				readState: () => engineState,
				readTransition: () => transitionState.active,
				readCanvas: () => canvas,
				isFrameRendererReady: () => canvas !== null && renderResourceSet !== null,
				readSeparateWav: () => separateWav,
				pauseTimeline: () => timeline?.pause(),
				buildAnimationManifest: () =>
					buildCompositionAnimationManifest({
						state: engineState,
						runtime: animState,
						textAnimationRoot: compositionElement,
						textAnimationCompiler: textAnimationManager,
						resolveMarkColor: readMarkColor
					}),
				writeGlobalProgress: (fraction) => {
					animState.globalProgress = fraction;
				},
				waitForCompositionResources: waitForActiveCompositionResources,
				flushDom: tick,
				settleCompositionPaint,
				prepareCompositionFrame: prepareVideoExportFrame,
				renderCompositionFrame: (timestamp) => {
					if (!host) return 'unavailable';
					return renderCompositionFrameTo(
						buildCompositionFrameRenderRequest(
							host.context.getCurrentTexture().createView(),
							timestamp
						)
					);
				},
				writeExportUiState: (next: CompositionExportUiState) => {
					isExporting = next.isExporting;
					progress = next.progress;
					status = next.status;
				}
			},
			request,
			signal
		);
	}

	// The GUI export handler — seals arity at the DOM event boundary so a
	// MouseEvent can never leak into `performExport`'s request (the
	// phantom-fork lesson: never bind a possibly-absent param to DOM input).
	function handleExport(): Promise<CompositionExportOutcome> {
		return performExport();
	}

	// The person's stop, reaching the same run an agent stops with its
	// AbortSignal: render, upload, encode, and download all end together.
	function cancelExport(): void {
		compositionExportController.cancel();
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	bind:innerWidth={viewportWidth}
	bind:innerHeight={viewportHeight}
/>

<main class="workspace" style:--timeline-h="{effectiveTimelineHeight}px">
	<header class="workspace__topbar">
		<GfxMarkHomeLink />
		<span class="topbar__name" data-composition-slug={page.params.slug ?? ''}
			>{presetBase.name || (compositionMeta.userCompositionSlug ?? 'Untitled')}</span
		>
		<span class="topbar__chip">{presetBase.kind}</span>
		<span class="topbar__chip topbar__chip--pack">
			<i aria-hidden="true"></i>{getAuthoringPackOption(packState.slug).label}
		</span>
		{#if compositionMeta.isUserComposition}
			<span class="topbar__chip topbar__chip--forked">Forked</span>
			{#if compositionMeta.revertUserComposition}
				<button type="button" class="topbar__revert" onclick={compositionMeta.revertUserComposition}
					>Revert</button
				>
			{/if}
		{/if}
		<span class="topbar__spacer"></span>
		<div class="topbar__orientation" role="group" aria-label="Orientation">
			<button
				type="button"
				aria-label="Switch to horizontal"
				aria-pressed={isHorizontal}
				onclick={() => (engineState.transport.orientation = 'horizontal')}
			>
				▭ H
			</button>
			<button
				type="button"
				aria-label="Switch to vertical"
				aria-pressed={!isHorizontal}
				onclick={() => (engineState.transport.orientation = 'vertical')}
			>
				▯ V
			</button>
		</div>
		<span class="topbar__resolution">{resolutionLabel}</span>
		<button
			class="topbar__export"
			type="button"
			popovertarget="export-menu"
			bind:this={exportTriggerEl}
		>
			{isExporting ? `Exporting ${Math.round(progress * 100)}%…` : 'Export ⇪'}
		</button>
	</header>

	<!-- Top-layer export sheet — the identity strip owns the action; the format
	     and audio options live with it instead of a rail section. -->
	<div
		class="export-menu"
		id="export-menu"
		popover
		bind:this={exportMenuEl}
		ontoggle={onExportMenuToggle}
	>
		<label class="export-menu__row">
			<span>Format</span>
			<!-- A format this origin cannot deliver stays visible but cannot be chosen,
			     so a piece that declares it still shows what it declared. -->
			<select bind:value={engineState.transport.format}>
				{#each COMPOSITION_EXPORT_FORMATS as format (format)}
					<option value={format} disabled={!isCompositionExportFormatAvailable(format)}>
						{COMPOSITION_EXPORT_FORMAT_LABELS[format]}
					</option>
				{/each}
			</select>
		</label>
		<div class="export-menu__row">
			<span>Separate WAV</span>
			<InspectorToggle
				checked={separateWav}
				label="Separate WAV"
				onchange={(checked) => (separateWav = checked)}
			/>
		</div>
		{#if isExporting}
			<button class="export-menu__go" type="button" onclick={cancelExport}>Cancel export</button>
			<progress aria-label="Export progress" max="1" value={progress}></progress>
		{:else}
			<button class="export-menu__go" type="button" onclick={handleExport}>
				Export composition
			</button>
		{/if}
		{#if status}
			<p class="export-menu__status">{status}</p>
		{/if}
	</div>

	<section class="workspace__canvas" aria-label="Composition">
		<VideoFrame
			bind:canvas
			orientation={engineState.transport.orientation}
			{showCheckerboard}
			{backdropUrl}
			{zoom}
			{panX}
			{panY}
			{isPanning}
		>
			<Composition
				bind:element={compositionElement}
				splitPlanes={planeSplitActive}
				bind:overlayRootElement
				bind:posedOverlayRootElements
			/>
		</VideoFrame>
		{#if !deterministicRenderAuditMode}
			<CanvasEditingOverlay
				{compositionElement}
				{overlayRootElement}
				{posedOverlayRootElements}
				{stageBodyMesh}
				stageTypeface={(slug) => stageTypefaceController.typeface(slug)}
				{canvas}
				compositionSize={{ width: canvas?.width ?? 3840, height: canvas?.height ?? 2160 }}
				{zoom}
				{panX}
				{panY}
				onPan={(x, y) => {
					panX = x;
					panY = y;
				}}
				onPanStart={() => {
					isPanning = true;
				}}
				onPanEnd={() => {
					isPanning = false;
				}}
			/>
		{/if}
	</section>

	<div class="workspace__controls">
		<CanvasControlsBar
			{timeline}
			{showCheckerboard}
			onToggleCheckerboard={() => {
				if (backdropUrl !== null) {
					// The backdrop overrides the checkerboard — toggling the checker
					// back on means "return to checkerboard", so clear the backdrop.
					backdropUrl = null;
					showCheckerboard = true;
				} else {
					showCheckerboard = !showCheckerboard;
				}
			}}
			{backdropUrl}
			onSelectBackdrop={(url) => {
				backdropUrl = url;
			}}
			{zoom}
			onZoomIn={zoomIn}
			onZoomOut={zoomOut}
			onZoomFit={zoomFit}
		/>
	</div>

	<div class="workspace__timeline">
		{#if isLandscape}
			<div
				class="timeline-resize"
				role="separator"
				aria-label="Resize timeline"
				aria-orientation="horizontal"
				onpointerdown={onTimelineResizeStart}
			></div>
		{/if}
		{#if timeline}
			<TimelineOutline {timeline} {tracks} />
		{/if}
	</div>

	<div class="workspace__inspector">
		<Inspector />
	</div>
</main>

<style>
	.workspace {
		/* DESIGN.md neutral ladder — defined once here; every editor-chrome
		   surface below reads these instead of Graffiti white-alpha neutrals. */
		--chrome-text: #e8e8ea;
		--chrome-muted: #8a8a90;
		--chrome-deck: #131315;
		--chrome-well: #0c0c0e;
		--chrome-raised: #1a1a1d;
		--chrome-hairline: #26262a;
		/* The canvas surround is a recessed well — the rail and timeline panels
		   step up from it, making the three-zone architecture legible. */
		background: var(--chrome-well);
	}

	/* Graffiti's raised-button chrome (gradient fill, 8px radius, inset bevel +
	   drop shadow, 560 weight) must not bleed into the flat editor chrome.
	   :where keeps this reset's specificity at the element tier: it outranks
	   Graffiti's bare `button` by cascade order while every component rule still
	   wins over it, so intended radii/shadows re-add cleanly. */
	:where(.workspace) :global(:where(button, select, input)) {
		background-image: none;
		border-radius: 0;
		box-shadow: none;
		font-weight: inherit;
		text-shadow: none;
	}

	.workspace {
		block-size: 100dvh;
		display: grid;
		grid-template-areas:
			'topbar    inspector'
			'canvas    inspector'
			'controls  inspector'
			'timeline  timeline';
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
		grid-template-rows: auto minmax(0, 1fr) auto var(--timeline-h, 220px);
		min-block-size: 0;
		overflow: hidden;
	}

	/* Identity strip above the canvas — the piece's passport: name, kind, pack,
	   fork state, orientation, native resolution, export. Everything that says
	   WHAT this composition is lives here, readable before touching anything. */
	.workspace__topbar {
		align-items: center;
		background: var(--chrome-deck);
		border-block-end: 1px solid var(--chrome-hairline);
		display: flex;
		gap: 12px;
		grid-area: topbar;
		min-block-size: 52px;
		padding-inline: 12px 14px;
	}

	.topbar__name {
		color: var(--chrome-text);
		font-size: 0.90625rem;
		font-weight: 650;
		letter-spacing: 0.005em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.topbar__chip {
		border: 1px solid var(--chrome-hairline);
		border-radius: 999px;
		color: var(--chrome-muted);
		flex-shrink: 0;
		font-family: 'Paper Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 400;
		letter-spacing: 0.12em;
		padding: 3px 8px;
		text-transform: uppercase;
	}

	.topbar__chip--pack {
		align-items: center;
		color: var(--chrome-text);
		display: inline-flex;
		gap: 0.45em;
	}

	.topbar__chip--pack i {
		background: #ffd608;
		block-size: 7px;
		border-radius: 2px;
		display: inline-block;
		inline-size: 7px;
	}

	.topbar__chip--forked {
		border-color: color-mix(in srgb, #ffd608 55%, var(--chrome-hairline));
		color: #ffd608;
	}

	.topbar__revert {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex-shrink: 0;
		font-size: 0.6875rem;
		padding: 0;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.topbar__revert:hover {
		color: var(--chrome-text);
	}

	.topbar__spacer {
		flex: 1;
	}

	.topbar__orientation {
		border: 1px solid var(--chrome-hairline);
		border-radius: 6px;
		display: inline-flex;
		flex-shrink: 0;
		overflow: hidden;
	}

	.topbar__orientation button {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font-family: 'Paper Mono', monospace;
		font-size: 0.65625rem;
		font-weight: 400;
		padding: 5px 11px;
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.topbar__orientation button[aria-pressed='true'] {
		background: var(--chrome-raised);
		color: var(--chrome-text);
	}

	.topbar__orientation button:focus-visible {
		outline: 2px solid #ffd608;
		outline-offset: -2px;
	}

	.topbar__resolution {
		color: var(--chrome-muted);
		flex-shrink: 0;
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
	}

	.topbar__export {
		align-items: center;
		background: #ffd608;
		block-size: 30px;
		border: 1px solid #ffd608;
		border-radius: 6px;
		color: #141200;
		cursor: pointer;
		display: inline-flex;
		flex-shrink: 0;
		font-family: Archivo, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		gap: 7px;
		padding: 0 13px;
		transition: background-color 120ms ease;
	}

	.topbar__export:hover {
		background: #ffe14a;
		border-color: #ffe14a;
	}

	.topbar__export:focus-visible {
		outline: 2px solid #ffd608;
		outline-offset: 2px;
	}

	/* Top-layer export sheet — same popover treatment as the backdrop picker.
	   The layout display lives on :popover-open ONLY: an unconditional author
	   `display` would override the UA's closed-popover display:none and leave an
	   invisible click-eating overlay parked over the top bar. */
	.export-menu {
		background: var(--chrome-deck);
		border: 1px solid var(--chrome-hairline);
		border-radius: var(--br-s);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
		color: var(--chrome-text);
		flex-direction: column;
		gap: var(--vs-s);
		inset: auto;
		margin: 0;
		min-inline-size: 15rem;
		opacity: 1;
		padding: var(--vs-base);
		position: fixed;
		transform: translateY(0) scale(1);
		transform-origin: top right;
		transition:
			opacity 120ms ease,
			transform 160ms var(--ease-smooth),
			overlay 160ms allow-discrete,
			display 160ms allow-discrete;
	}

	.export-menu:popover-open {
		display: flex;
	}

	.export-menu:not(:popover-open) {
		opacity: 0;
		transform: translateY(-6px) scale(0.97);
	}

	@starting-style {
		.export-menu:popover-open {
			opacity: 0;
			transform: translateY(-6px) scale(0.97);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.export-menu {
			transition-duration: 1ms;
		}
	}

	.export-menu__row {
		align-items: center;
		display: grid;
		gap: var(--vs-s);
		grid-template-columns: 1fr auto;
	}

	.export-menu__row > span {
		color: var(--chrome-muted);
		font-family: Archivo, sans-serif;
		font-size: 0.8125rem;
	}

	.export-menu__row select {
		background: var(--chrome-well);
		border: 1px solid var(--chrome-hairline);
		border-radius: 5px;
		color: var(--chrome-text);
		font-family: 'Paper Mono', monospace;
		font-size: 0.78rem;
		padding: 4px var(--vs-s);
	}

	.export-menu__row select:focus-visible {
		border-color: #ffd608;
		outline: none;
	}

	.export-menu__go {
		background: var(--chrome-raised);
		border: 1px solid var(--chrome-hairline);
		border-radius: 6px;
		color: var(--chrome-text);
		cursor: pointer;
		font-family: Archivo, sans-serif;
		font-size: 0.8125rem;
		padding-block: 6px;
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.export-menu__go:hover:not(:disabled) {
		background: var(--chrome-hairline);
	}

	.export-menu__go:focus-visible {
		border-color: #ffd608;
		outline: none;
	}

	.export-menu__go:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.export-menu__status {
		color: var(--chrome-muted);
		font-size: 0.75rem;
		margin: 0;
	}

	.workspace__canvas {
		align-items: center;
		container-type: size;
		display: flex;
		grid-area: canvas;
		justify-content: center;
		min-block-size: 0;
		overflow: hidden;
		padding: var(--vs-l) var(--vs-l) 0;
		position: relative;
	}

	.workspace__controls {
		background: var(--chrome-deck);
		border-block-end: var(--border-1);
		border-block-start: 1px solid var(--chrome-hairline);
		grid-area: controls;
	}

	.workspace__timeline {
		grid-area: timeline;
		min-block-size: 0;
		overflow: hidden;
		position: relative;
	}

	/* Landscape-only drag handle to resize the timeline against the canvas. */
	.timeline-resize {
		cursor: ns-resize;
		inset-block-start: 0;
		inset-inline: 0;
		block-size: 7px;
		position: absolute;
		touch-action: none;
		z-index: 2;
	}

	.timeline-resize::after {
		background: var(--chrome-hairline);
		content: '';
		inset-block-start: 0;
		inset-inline: 0;
		block-size: 1px;
		position: absolute;
		transition:
			background-color 100ms ease,
			block-size 100ms ease;
	}

	.timeline-resize:hover::after {
		background: var(--chrome-muted);
		block-size: 2px;
	}

	.workspace__inspector {
		display: flex;
		flex-direction: column;
		grid-area: inspector;
		min-block-size: 0;
		overflow: hidden;
	}
</style>
