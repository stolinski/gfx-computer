<script lang="ts">
	import { ENGINE_FONT_FAMILIES, type Figure } from '$lib/platform/engine-schema';
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState, packState } from '$lib/platform/engine-state.svelte';
	import { getPack } from '$lib/platform/packs/registry';
	import { resolveFigureVoiceColors, resolveFontTreatment } from '$lib/platform/packs/resolve';
	import type { FigureVoice } from '$lib/utils/figure-scene';
	import { figureReadableTextId } from '$lib/utils/figure-readable-text';
	import { prepareFigure } from '$lib/utils/figure-scene-prepare';
	import { resolveFigureTextStyle, type FigureTextRole } from '$lib/utils/figure-text';
	import { getVideoFrameSize } from '$lib/utils/video-frame';

	interface Props {
		block: Figure;
	}

	let { block }: Props = $props();

	const pack = $derived(getPack(packState.slug));
	const voices = $derived(resolveFigureVoiceColors(pack));
	const orientation = $derived(engineState.transport.orientation);
	const size = $derived(getVideoFrameSize(orientation));
	const fontFamily = $derived(
		resolveFontTreatment(pack) ??
			ENGINE_FONT_FAMILIES[engineState.typography.fontFamily]?.stack ??
			ENGINE_FONT_FAMILIES.sans.stack
	);
	// Layout runs once per declaration and orientation; only Moves run per frame.
	const prepared = $derived(prepareFigure(block, orientation));
	const scene = $derived(
		prepared.scene(
			animState.globalProgress,
			animState.globalProgress * engineState.transport.durationSeconds * 1000
		)
	);

	// `muted` shares the label ink at reduced strength.
	function voiceAlpha(voice: FigureVoice | null): number {
		return voice === 'muted' ? 0.72 : 1;
	}

	function color(voice: FigureVoice | null): string {
		return voice === null ? 'none' : voices.color[voice];
	}

	function textStyle(role: FigureTextRole): string {
		const style = resolveFigureTextStyle(role, orientation);
		return `font-size:${style.fontSize}px;font-weight:${style.fontWeight};letter-spacing:${style.letterSpacing}px`;
	}
</script>

<svg
	class="figure"
	data-figure={block.id}
	data-figure-kind={block.kind}
	data-figure-alpha={scene.alpha}
	viewBox={`0 0 ${size.width} ${size.height}`}
	preserveAspectRatio="none"
	style:font-family={fontFamily}
	aria-hidden="true"
>
	<g opacity={scene.alpha}>
		{#each scene.items as item (item.key)}
			{#if item.opacity > 0.001}
				{#if item.shape === 'circle'}
					<circle
						data-figure-mark={item.mark}
						cx={item.cx}
						cy={item.cy}
						r={Math.max(0, item.r)}
						fill={color(item.fill)}
						fill-opacity={item.fillOpacity * voiceAlpha(item.fill)}
						stroke={color(item.stroke)}
						stroke-width={item.strokeWidth}
						opacity={item.opacity}
					/>
				{:else if item.shape === 'rect'}
					<rect
						data-figure-mark={item.mark}
						x={item.x}
						y={item.y}
						width={Math.max(0, item.width)}
						height={Math.max(0, item.height)}
						rx={item.rx}
						fill={color(item.fill)}
						fill-opacity={item.fillOpacity * voiceAlpha(item.fill)}
						stroke={color(item.stroke)}
						stroke-width={item.strokeWidth}
						opacity={item.opacity}
					/>
				{:else if item.shape === 'path'}
					<path
						data-figure-mark={item.mark}
						d={item.d}
						fill={color(item.fill)}
						fill-opacity={item.fillOpacity * voiceAlpha(item.fill)}
						stroke={color(item.stroke)}
						stroke-width={item.strokeWidth}
						stroke-opacity={voiceAlpha(item.stroke)}
						stroke-linecap={item.linecap ?? 'butt'}
						stroke-linejoin="round"
						pathLength={item.draw === undefined ? undefined : 1}
						stroke-dasharray={item.draw !== undefined
							? '1 1'
							: item.dash
								? item.dash.array.join(' ')
								: undefined}
						stroke-dashoffset={item.draw !== undefined
							? 1 - item.draw
							: item.dash
								? item.dash.offset
								: undefined}
						opacity={item.opacity}
					/>
				{:else}
					<text
						data-figure-text={item.key}
						data-gfx-readable-id={figureReadableTextId(block.id, item.key)}
						x={item.x}
						y={item.y}
						text-anchor={item.anchor}
						dominant-baseline={item.baseline}
						textLength={item.width}
						lengthAdjust="spacingAndGlyphs"
						fill={item.contrastWith ? voices.readableOn[item.contrastWith] : color(item.fill)}
						fill-opacity={item.contrastWith ? 1 : voiceAlpha(item.fill)}
						opacity={item.opacity}
						style={textStyle(item.role)}>{item.text}</text
					>
				{/if}
			{/if}
		{/each}
	</g>
</svg>

<style>
	.figure {
		block-size: 100%;
		inline-size: 100%;
		inset: 0;
		pointer-events: none;
		position: absolute;
	}
</style>
