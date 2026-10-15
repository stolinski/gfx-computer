<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState, packState } from '$lib/platform/engine-state.svelte';
	import { getPack } from '$lib/platform/packs/registry';
	import { resolvePackRoleColor } from '$lib/platform/packs/resolve';
	import { hexToRgbaFloat } from '$lib/utils/color';
	import { cqminLength } from '$lib/utils/frame-relative-length';
	import { resolveIconOrbitRing, resolveIconOrbitScene } from '$lib/utils/icon-orbit-scene';
	import { getVideoFrameSize } from '$lib/utils/video-frame';
	import {
		ICON_ORBIT_DEFAULT_ICON_SIZE,
		ICON_ORBIT_DEFAULT_LABEL_SIZE,
		ICON_ORBIT_DEFAULT_STROKE_WIDTH,
		type IconOrbitContent
	} from './definition';
	import { ICON_ORBIT_GLYPHS, type IconOrbitGlyph, type IconOrbitGlyphName } from './icons';

	interface Props {
		content: IconOrbitContent;
	}

	let { content }: Props = $props();

	const uid = $props.id();
	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const durationSeconds = $derived(engineState.transport.durationSeconds);
	const ring = $derived(
		resolveIconOrbitRing(
			{
				centerX: content.centerX ?? 0.5,
				radius: content.radius ?? 0.3,
				tilt: content.tilt ?? 0.18,
				iconSize: content.iconSize ?? ICON_ORBIT_DEFAULT_ICON_SIZE
			},
			content.orientationOverrides,
			engineState.transport.orientation
		)
	);
	const scene = $derived(
		resolveIconOrbitScene(
			{
				...ring,
				icons: content.icons,
				pass: content.pass ?? 'all',
				turnDegreesPerSecond: content.turnDegreesPerSecond ?? 8,
				glow: content.glow ?? 1
			},
			animState.globalProgress * durationSeconds,
			durationSeconds,
			frame.width,
			frame.height
		)
	);

	// The glow is light, so it is drawn in the glow colour while the stroke's
	// core stays near white, the way a neon tube burns white at its centre.
	const glowColor = $derived(
		content.color ??
			resolvePackRoleColor(getPack(packState.slug), 'icon-orbit.glow', 'accent-treatment')
	);
	const glowChannels = $derived(hexToRgbaFloat(glowColor));
	const coreColor = $derived(`color-mix(in srgb, white 82%, ${glowColor})`);
	const strokeWidth = $derived(content.strokeWidth ?? ICON_ORBIT_DEFAULT_STROKE_WIDTH);
	const labelSize = $derived(content.labelSize ?? ICON_ORBIT_DEFAULT_LABEL_SIZE);

	function glyph(name: string): IconOrbitGlyph {
		return ICON_ORBIT_GLYPHS[name as IconOrbitGlyphName];
	}
</script>

<div
	class="icon-orbit"
	data-overlay="icon-orbit"
	style:--glow={glowColor}
	style:inline-size={`${frame.width}px`}
	style:block-size={`${frame.height}px`}
>
	<svg
		class="icon-orbit__field"
		width={frame.width}
		height={frame.height}
		viewBox={`0 0 ${frame.width} ${frame.height}`}
		aria-hidden="true"
	>
		<defs>
			<filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation={Math.min(frame.width, frame.height) * 0.004} />
			</filter>
			{#each scene as item (item.index)}
				<filter
					id={`${uid}-glow-${item.index}`}
					x="-150%"
					y="-150%"
					width="400%"
					height="400%"
					color-interpolation-filters="sRGB"
				>
					<feGaussianBlur in="SourceAlpha" stdDeviation={item.glowNear} result="near" />
					<feGaussianBlur in="SourceAlpha" stdDeviation={item.glowFar} result="far" />
					<feColorMatrix
						in="near"
						type="matrix"
						values={`0 0 0 0 ${(1 + glowChannels[0]) / 2}  0 0 0 0 ${(1 + glowChannels[1]) / 2}  0 0 0 0 ${(1 + glowChannels[2]) / 2}  0 0 0 2.2 0`}
						result="nearLight"
					/>
					<feColorMatrix
						in="far"
						type="matrix"
						values={`0 0 0 0 ${glowChannels[0]}  0 0 0 0 ${glowChannels[1]}  0 0 0 0 ${glowChannels[2]}  0 0 0 1.6 0`}
						result="farLight"
					/>
					<feGaussianBlur in="SourceGraphic" stdDeviation={item.depthBlur} result="core" />
					<feMerge>
						<feMergeNode in="farLight" />
						<feMergeNode in="farLight" />
						<feMergeNode in="farLight" />
						<feMergeNode in="nearLight" />
						<feMergeNode in="nearLight" />
						<feMergeNode in="core" />
					</feMerge>
				</filter>
			{/each}
		</defs>

		{#each scene as item (item.index)}
			<g fill={coreColor} filter={`url(#${uid}-soft)`}>
				{#each item.sparks as spark, sparkIndex (sparkIndex)}
					<circle cx={spark.x} cy={spark.y} r={spark.radius} fill-opacity={spark.opacity} />
				{/each}
				{#each item.motes as mote, moteIndex (moteIndex)}
					<circle cx={mote.x} cy={mote.y} r={mote.radius} fill-opacity={mote.opacity} />
				{/each}
			</g>
			<g
				transform={`translate(${item.x} ${item.y}) rotate(${item.lean}) scale(${item.size / 120})`}
				filter={`url(#${uid}-glow-${item.index})`}
				opacity={item.opacity}
			>
				<g
					stroke={coreColor}
					stroke-width={strokeWidth}
					fill="none"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					{#each glyph(item.icon).paths as d, pathIndex (pathIndex)}
						<path {d} />
					{/each}
				</g>
				{#each glyph(item.icon).dots ?? [] as dot, dotIndex (dotIndex)}
					<circle cx={dot.x} cy={dot.y} r={dot.r} fill={coreColor} />
				{/each}
			</g>
		{/each}
	</svg>

	{#each scene as item (item.index)}
		{#if item.label}
			<span
				class="icon-orbit__label"
				data-gfx-readable-id={`label-${item.index}`}
				data-gfx-text-role="overlay-corner-secondary"
				style:left={`${item.x}px`}
				style:top={`${item.y + item.size * 0.62}px`}
				style:font-size={cqminLength(labelSize)}
				style:color={`color-mix(in srgb, white 88%, ${glowColor} ${item.opacity * 12}%)`}
			>
				{item.label}
			</span>
		{/if}
	{/each}
</div>

<style>
	.icon-orbit {
		inset-block-start: 0;
		inset-inline-start: 0;
		pointer-events: none;
		position: absolute;
	}

	/* The global reset caps an svg at its container's width; the field is
	   exactly frame-sized, so it opts out. */
	.icon-orbit__field {
		display: block;
		max-inline-size: none;
		overflow: visible;
	}

	/* Text-shadow paints the label's light without promoting a compositing
	   layer, so it survives the HTML-in-Canvas capture. */
	.icon-orbit__label {
		font-family: var(--fontLabel, var(--font, 'Archivo', sans-serif));
		font-weight: 800;
		letter-spacing: 0.22em;
		position: absolute;
		text-shadow:
			0 0 0.35em var(--glow),
			0 0 1em var(--glow);
		text-transform: uppercase;
		translate: -50% 0;
		white-space: nowrap;
	}
</style>
