<script lang="ts">
	import CaptionsMount from './CaptionsMount.svelte';
	import ChartMount from './ChartMount.svelte';
	import DiagramMount from './DiagramMount.svelte';
	import KineticTypeFieldMount from './KineticTypeFieldMount.svelte';
	import { engineState } from './engine-state.svelte';
	import OverlayMount from './OverlayMount.svelte';
	import SurfaceMount from './SurfaceMount.svelte';
	import { partitionStageOverlays } from './pipelines/depth-stage-planes';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	interface Props {
		element?: HTMLElement | null;
		surfaceElement?: HTMLElement | null;
		/**
		 * Depth-of-field plane split (ADR-0027). When true, the Overlay layer is
		 * hoisted into its own frame-sized element that is a *direct* child of the
		 * layoutsubtree canvas — `copyElementImageToTexture` only rasterizes the
		 * canvas's direct children, not nested wrappers, so a separately-capturable
		 * Overlay plane requires a sibling, not a descendant. When false (the
		 * default, no DOF), the Overlay nests inside `.composition` exactly as
		 * before and the merged capture is unchanged.
		 */
		splitPlanes?: boolean;
		overlayRootElement?: HTMLElement | null;
		/**
		 * On the depth stage an Overlay with a pose or an explicit depth rides its
		 * own plane (ADR-0057), so it gets its own frame-sized direct canvas
		 * child — the capture lane rasterizes direct children only. Keyed by
		 * Overlay id; an entry is null once its root unmounts.
		 */
		posedOverlayRootElements?: Record<string, HTMLElement | null>;
	}

	let {
		element = $bindable<HTMLElement | null>(null),
		surfaceElement = $bindable<HTMLElement | null>(null),
		splitPlanes = false,
		overlayRootElement = $bindable<HTMLElement | null>(null),
		posedOverlayRootElements = $bindable<Record<string, HTMLElement | null>>({})
	}: Props = $props();

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	// On the stage, posed Overlays leave the shared root for their own capture
	// roots, and body Overlays (ADR-0062) leave every root: the stage draws
	// their geometry, so no plane captures them.
	const stagePartition = $derived(
		engineState.stage?.type === 'depth' ? partitionStageOverlays(engineState.overlays) : null
	);
	const posedOverlayIds = $derived(
		stagePartition ? stagePartition.posed.map((overlay) => overlay.id) : []
	);
	const sharedRootExcludedIds = $derived(
		stagePartition
			? [...stagePartition.posed, ...stagePartition.bodies].map((overlay) => overlay.id)
			: []
	);
</script>

<div
	bind:this={element}
	class="composition"
	style:block-size={`${frame.height}px`}
	style:inline-size={`${frame.width}px`}
>
	<SurfaceMount bind:element={surfaceElement} />
	<!-- Kinetic Word Blocks are crisp native DOM on the Surface plane; semantic
	     phrases never create a second layout or rendering tree. -->
	<KineticTypeFieldMount />
	<!-- Chart Blocks share the Surface plane. DOM chrome provides the intentional
	     grid/axis underlay and reserved labels; analytic GPU marks punch inside-label plates. -->
	<ChartMount />
	<!-- Diagram Blocks (ADR-0036) live on the SURFACE plane in every render
	     path — inside .composition even when the Overlay plane is hoisted, so
	     a diagram parallaxes with the surface it annotates. -->
	<DiagramMount />
	{#if !splitPlanes}
		<OverlayMount />
		<!-- Captions ride TOPMOST wherever the overlays live — broadcast
		     captions sit above everything. -->
		<CaptionsMount />
	{/if}
</div>
{#if splitPlanes}
	<!-- Overlay plane source: a frame-sized direct child of the canvas, mirroring
	     `.composition`'s container context so overlay sizing (cq units) is identical
	     to the nested case. Captured on its own to become the DOF Overlay plane. -->
	<div
		bind:this={overlayRootElement}
		class="composition overlay-root"
		style:block-size={`${frame.height}px`}
		style:inline-size={`${frame.width}px`}
	>
		<OverlayMount excludeIds={sharedRootExcludedIds} />
		<CaptionsMount />
	</div>
	<!-- One root per posed Overlay (ADR-0057): the same frame-sized sibling
	     construction as the shared Overlay root, captured on its own so the
	     stage can place it on its own plane. -->
	{#each posedOverlayIds as overlayId (overlayId)}
		<div
			bind:this={posedOverlayRootElements[overlayId]}
			class="composition overlay-root"
			data-posed-overlay-root={overlayId}
			style:block-size={`${frame.height}px`}
			style:inline-size={`${frame.width}px`}
		>
			<OverlayMount onlyIds={[overlayId]} />
		</div>
	{/each}
{/if}

<style>
	.composition {
		background-color: transparent;
		box-sizing: border-box;
		--cqmin: calc(min(var(--frame-w), var(--frame-h)) / 100 * 1px);
		container-type: size;
		display: block;
		overflow: hidden;
		position: relative;
		transform-origin: top left;
	}

	/* Overlaps `.composition` exactly (both are frame-sized direct children of the
	   canvas), so the Overlay plane lands in the same coordinate space as the
	   Surface plane for back-to-front compositing. */
	.overlay-root {
		inset: 0;
		position: absolute;
	}

	.composition :global(.surface) {
		position: absolute;
	}
</style>
