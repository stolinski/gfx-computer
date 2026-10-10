<script lang="ts">
	import { animState, type OverlayChannelValues } from './anim-state.svelte';
	import { engineState, packState } from './engine-state.svelte';
	import { getPack } from './packs/registry';
	import {
		appearanceVarsToStyle,
		resolveAppearanceVars,
		resolveFieldInkColor
	} from './packs/resolve';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import { filterPackAppearanceVarsForImmunity } from './pipelines/identity-registry';
	import type { Overlay, OverlayPlacement } from './engine-schema';
	import type { OverlayRenderer } from './pipelines/types';
	import { resolveOverlayPlacement, resolveOverlayTransform } from '$lib/utils/overlay-placement';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	interface Props {
		/**
		 * Host only these Overlays: a posed Overlay's own capture root (ADR-0057),
		 * or the root an Overlay is captured alone in for a magic move (ADR-0068 §5).
		 */
		onlyIds?: readonly string[];
		/**
		 * Leave these Overlays to their own roots: the posed and body Overlays of
		 * the depth stage, and the Overlays a magic move is carrying.
		 */
		excludeIds?: readonly string[];
	}

	let { onlyIds, excludeIds = [] }: Props = $props();

	function hostsOverlay(overlayId: string): boolean {
		return (onlyIds ? onlyIds.includes(overlayId) : true) && !excludeIds.includes(overlayId);
	}

	function findRenderer(type: string): OverlayRenderer | null {
		return pipelineRendererRuntime.current().overlays.get(type) ?? null;
	}

	// transform-origin matching an anchor's pinned point, so a scale grows from the
	// anchored edge/corner instead of the element's default centre.
	function anchorOrigin(anchor: string): string {
		if (anchor === 'normalized-rect') return 'top left';
		const v = anchor.startsWith('top') ? 'top' : anchor.startsWith('bottom') ? 'bottom' : 'center';
		const h = anchor.endsWith('left') ? 'left' : anchor.endsWith('right') ? 'right' : 'center';
		return `${v} ${h}`;
	}

	function positionStyle(
		placement: OverlayPlacement,
		channels: OverlayChannelValues | null
	): string {
		const { anchor, offset, rect } = placement;
		// Offsets are fractions of the composition (0..1 of inline-size / block-size).
		// 0.05 = 5% margin from the anchor edge.
		const ox = (offset?.x ?? 0) * 100;
		const oy = (offset?.y ?? 0) * 100;
		// Channel x/y are composition-fraction DELTAS from the anchored spot
		// (ADR-0035 §3), folded into the inset percentages (which resolve against
		// the composition box). Right/bottom insets grow the opposite way, so the
		// delta flips sign there to keep +x → right, +y → down.
		const dx = (channels?.x ?? 0) * 100;
		const dy = (channels?.y ?? 0) * 100;
		// Scale / rotation: absolute channel values when the composition owns the
		// motion; the static position fields (their seeds) otherwise.
		const { scale, rotationDegrees: rotation } = resolveOverlayTransform(placement, channels);

		const parts: string[] = [];

		if (anchor === 'normalized-rect' && rect) {
			parts.push(
				`left:${(rect.x + (channels?.x ?? 0)) * 100}%`,
				`top:${(rect.y + (channels?.y ?? 0)) * 100}%`,
				`inline-size:${rect.width * 100}%`,
				`block-size:${rect.height * 100}%`
			);
		} else {
			if (anchor.startsWith('top')) {
				parts.push(`top:${oy + dy}%`);
			} else if (anchor.startsWith('bottom')) {
				parts.push(`bottom:${oy - dy}%`);
			} else {
				parts.push(`top:${50 + dy}%`);
			}

			if (anchor.endsWith('left')) {
				parts.push(`left:${ox + dx}%`);
			} else if (anchor.endsWith('right')) {
				parts.push(`right:${ox - dx}%`);
			} else {
				parts.push(`left:${50 + dx}%`);
			}

			// Centre anchors: offset the element by half its own size so its
			// visual centre aligns with the 50% origin — full `center` on both
			// axes, `top-center`/`bottom-center` on x only (without this the
			// element's LEFT edge pinned at 50% and rendered off-centre right —
			// the youtube-subscribe vertical Critic finding). Uses CSS `translate`
			// (independent of `transform`) so it doesn't conflict with the
			// visibilityStyle translateY animation.
			if (anchor === 'center') {
				parts.push(`translate:-50% -50%`);
			} else if (anchor === 'top-center' || anchor === 'bottom-center') {
				parts.push(`translate:-50% 0`);
			}
		}

		// Uniform scale + static/channel rotation about the anchor point. CSS
		// longhands (`scale`, `rotate`) compose with the `translate` (center
		// anchor) and the visibilityStyle `transform` translateY entry slide
		// without clobbering either.
		if (scale !== 1 || rotation !== 0) {
			parts.push(`transform-origin:${anchorOrigin(anchor)}`);
		}
		if (scale !== 1) {
			parts.push(`scale:${scale}`);
		}
		if (rotation !== 0) {
			parts.push(`rotate:${rotation}deg`);
		}

		return parts.join(';');
	}

	// Composition-owned visibility (ADR-0035 §2): the authored opacity channel
	// replaces the intrinsic fade-through + slide outright. Clamped like the
	// intrinsic path — overshooting opacity is meaningless.
	function channelVisibilityStyle(channels: OverlayChannelValues): string {
		return `opacity:${Math.max(0, Math.min(1, channels.opacity))};`;
	}

	function visibilityStyle(progress: number, renderer: OverlayRenderer): string {
		// Clamp to [0,1] INTENTIONALLY: the generic overlay enter is a fade-through
		// (opacity + a short slide-up), which is the motion-form every overlay
		// Pipeline declares in its identity spec (e.g. watermark "fade-through").
		// A `settled`/`back.out` ease can drive progress past 1; clamping discards
		// that overshoot so the slide settles cleanly without a bounce that would
		// contradict the declared fade-through. Do NOT un-clamp to "add overshoot"
		// — overshoot is a different motion-form that would need per-overlay opt-in
		// (and overshooting opacity is meaningless). See dex 9z8tm4na.
		const visible = Math.max(0, Math.min(1, progress));
		if (renderer.disableOpacityTransition) {
			return `visibility:${visible <= 0.001 ? 'hidden' : 'visible'};`;
		}
		if (renderer.edgeTransition === 'right') {
			const frame = getVideoFrameSize(engineState.transport.orientation);
			const translateX = Math.round((1 - progress) * frame.width);
			return `opacity:${visible};transform:translateX(${translateX}px);`;
		}
		if (renderer.disableEntryOffset) {
			return `opacity:${visible};`;
		}
		const ty = (1 - visible) * 32;
		return `opacity:${visible};transform:translateY(${ty}px);`;
	}

	// Immune artifacts retain their intrinsic platform appearance; a partially
	// immune one (ADR-0039 §2) keeps only its declared claimable chrome slots.
	// Treatments layered around them still resolve through their own Pipeline
	// mounts.
	function appearanceStyle(overlay: Overlay, renderer: OverlayRenderer): string {
		const pack = getPack(packState.slug);
		const vars = resolveAppearanceVars(pack, overlay.type);
		if (renderer.fieldInkOnBackground && engineState.backgroundFill !== undefined) {
			vars['--ink'] = resolveFieldInkColor(pack);
		}

		return appearanceVarsToStyle(
			filterPackAppearanceVarsForImmunity(`overlay:${overlay.type}`, vars)
		);
	}
</script>

{#each engineState.overlays as overlay, index (overlay.id)}
	{@const renderer = findRenderer(overlay.type)}
	{#if renderer && hostsOverlay(overlay.id)}
		{@const Component = renderer.CanvasSource}
		{@const channels = animState.overlayChannels[index] ?? null}
		{@const placement = resolveOverlayPlacement(
			overlay.position,
			engineState.transport.orientation
		)}
		<div
			class="overlay-mount__item"
			data-overlay-id={overlay.id}
			data-overlay-type={overlay.type}
			data-overlay-anchor={placement.anchor}
			style="{positionStyle(placement, channels)};{channels
				? channelVisibilityStyle(channels)
				: visibilityStyle(animState.overlayProgresses[index] ?? 1, renderer)};{appearanceStyle(
				overlay,
				renderer
			)}"
		>
			<Component content={overlay.content} />
		</div>
	{/if}
{/each}

<style>
	.overlay-mount__item {
		position: absolute;
		z-index: 1;
	}
</style>
