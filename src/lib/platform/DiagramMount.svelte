<script lang="ts">
	import type { Component } from 'svelte';

	import { animState, type OverlayChannelValues } from './anim-state.svelte';
	import { engineState, packState } from './engine-state.svelte';
	import { getPack } from './packs/registry';
	import {
		appearanceVarsToStyle,
		requireCoreColor,
		resolveAppearanceVars,
		resolveDepthTreatment,
		resolveFieldInkColor,
		resolveFontTreatment,
		resolvePackRoleColor,
		resolveTypographyColors
	} from './packs/resolve';
	import { ENGINE_FONT_FAMILIES, type DiagramPrimitive } from './engine-schema';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import { requireLoadedBlockRenderer } from './pipelines/runtime-loader';
	import { isDarkSurfaceColor } from '$lib/utils/color';
	import { resolveDiagramPrimitiveForRender } from '$lib/utils/diagram-geometry';

	// The DOM half of the diagram Block layer (ADR-0036): node / label /
	// stat-callout / code mounted at their explicit composition fractions, plus the
	// timeline-segment's caption. Lives inside `.composition` beside the
	// SurfaceMount so the surface pipeline's DOM capture carries it on the
	// SURFACE plane in every render path (flat, DOF split, depth stage) — a
	// diagram parallaxes with the surface it annotates, never with overlays.
	// Stroke primitives (edge-arrow, the segment's rule) render in the pipelines'
	// marks canvas, not here.

	function getDiagramCanvasSource(
		primitive: DiagramPrimitive
	): Component<{ block: DiagramPrimitive }> | null {
		// Every authored primitive requires its renderer, including GPU-only strokes.
		pipelineRendererRuntime.current();
		const CanvasSource = requireLoadedBlockRenderer(primitive.type).CanvasSource;
		if (
			!CanvasSource &&
			(primitive.type === 'node' ||
				primitive.type === 'label' ||
				primitive.type === 'stat-callout' ||
				primitive.type === 'code')
		) {
			throw new Error(`Required diagram Block renderer "${primitive.type}" has no CanvasSource.`);
		}
		return (CanvasSource ?? null) as Component<{ block: DiagramPrimitive }> | null;
	}

	const primitives = $derived(
		(engineState.surface.diagram ?? []).map((primitive) =>
			resolveDiagramPrimitiveForRender(primitive, engineState.transport.orientation)
		)
	);
	const pack = $derived(getPack(packState.slug));

	// The diagram's inherited ink (each primitive's currentColor floor) resolves
	// authored override first. A plain Surface on a declared full-frame field
	// then uses that field's paired ink; every other Surface retains the ordinary
	// typography chain used by body text.
	const diagramInk = $derived(
		engineState.surface.type === 'plain' && engineState.backgroundFill !== undefined
			? resolveFieldInkColor(pack, engineState.typography.inkColor)
			: resolveTypographyColors(pack, engineState.typography).inkColor
	);

	// A primitive declaring `ink: 'accent'` rides the Pack's core accent-treatment
	// instead — the composition picks WHICH primitives carry emphasis, the Pack
	// still owns what accent looks like (guaranteed present by the boot validator).
	const accentInk = $derived(requireCoreColor(pack, 'accent-treatment'));

	// The mount root's voice, specific → general (ADR-0024): a Pack
	// `diagram.font` claim (the diagram chrome's own face — e.g. the brand
	// mono) beats a pack-wide `font-treatment` claim beats the preset's
	// ENGINE_FONT_FAMILIES typography voice.
	const diagramFontClaim = $derived.by(() => {
		const role = pack.roles['diagram.font'];
		return role && role.kind === 'style' && typeof role.value === 'string' ? role.value : null;
	});
	const fontStack = $derived(
		diagramFontClaim ??
			resolveFontTreatment(pack) ??
			ENGINE_FONT_FAMILIES[engineState.typography.fontFamily]?.stack ??
			ENGINE_FONT_FAMILIES.sans.stack
	);

	// Transparent piece (no backgroundFill, no stage backdrop): the diagram ink
	// composites over unknown footage, so DOM primitives carry a two-zone
	// legibility halo by default — G5's worst-case floor must hold over bright
	// footage, and naked single-colour text over transparent is rejected.
	// text-shadow inherits and paints without compositing-layer promotion (a
	// CSS filter would drop out of the HTML-in-canvas capture). Full-frame
	// pieces skip it: their contrast is authored against a known field.
	const isTransparentPiece = $derived(
		engineState.backgroundFill === undefined && engineState.stage === undefined
	);
	const textGuard = $derived(
		isTransparentPiece ? '0 2px 18px rgb(0 0 0 / 0.55), 0 1px 5px rgb(0 0 0 / 0.5)' : undefined
	);

	// A segment's caption clears the rule PERPENDICULAR to the span direction —
	// a horizontal span captions above its midpoint; a vertical rail captions
	// beside it (left-edge anchored so the centred text can't reach back across
	// the stroke). An orientation-blind fixed offset put vertical captions ON
	// the rail (Critic finding from the original vertical reflow proof).
	function isVerticalSpan(primitive: DiagramPrimitive & { type: 'timeline-segment' }): boolean {
		return (
			Math.abs(primitive.to.y - primitive.from.y) > Math.abs(primitive.to.x - primitive.from.x)
		);
	}

	function centerFor(primitive: DiagramPrimitive): { x: number; y: number } {
		if (primitive.type === 'edge-arrow') {
			return { x: 0, y: 0 };
		}
		if (primitive.type === 'timeline-segment') {
			const mid = {
				x: (primitive.from.x + primitive.to.x) / 2,
				y: (primitive.from.y + primitive.to.y) / 2
			};
			// The rule itself is stroke-drawn in the pipeline.
			return isVerticalSpan(primitive)
				? { x: mid.x + 0.033, y: mid.y }
				: { x: mid.x, y: mid.y - 0.045 };
		}
		return primitive.position;
	}

	function channelsFor(primitive: DiagramPrimitive): OverlayChannelValues | null {
		return animState.blockChannels[primitive.id] ?? null;
	}

	function positionStyle(
		primitive: DiagramPrimitive,
		channels: OverlayChannelValues | null
	): string {
		const center = centerFor(primitive);
		// Channel x/y are composition-fraction deltas from the authored position
		// (ADR-0035 §3), folded straight into the percentage placement.
		const x = (center.x + (channels?.x ?? 0)) * 100;
		const y = (center.y + (channels?.y ?? 0)) * 100;
		// Beside a vertical rail the caption anchors its LEFT edge (not its
		// centre) so the text grows away from the stroke, never back across it.
		const anchor =
			primitive.type === 'timeline-segment' && isVerticalSpan(primitive) ? ';translate:0 -50%' : '';
		const textBoxWidth =
			'maxWidth' in primitive && primitive.maxWidth
				? `;inline-size:calc(${primitive.maxWidth / Math.max(primitive.scale ?? 1, 0.25)} * var(--frame-w) * 1px)`
				: '';
		return `left:${x}%;top:${y}%${anchor}${textBoxWidth}`;
	}

	// Intrinsic entrance forms per type — the pipeline-owned motion-form
	// (Identity Spec, ADR-0035 §2: what you get when the composition doesn't
	// take the pen). Node: scale-settle. Label / segment caption: short rise.
	// Stat-callout: plain fade (the roll is the show). All fade with the exit
	// alpha; an exit never un-draws or un-scales.
	function intrinsicStyle(primitive: DiagramPrimitive): string {
		const progress = Math.max(0, Math.min(1, animState.blockProgresses[primitive.id] ?? 0));
		const alpha = Math.max(0, Math.min(1, animState.blockAlphas[primitive.id] ?? 1));
		const opacity = progress * alpha;
		const baseScale = 'scale' in primitive ? (primitive.scale ?? 1) : 1;

		if (primitive.type === 'node') {
			return `opacity:${opacity};scale:${baseScale * (0.85 + 0.15 * progress)}`;
		}
		if (primitive.type === 'label' || primitive.type === 'timeline-segment') {
			const rise = (1 - progress) * 24;
			return `opacity:${opacity};transform:translateY(${rise}px);scale:${baseScale}`;
		}
		return `opacity:${opacity};scale:${baseScale}`;
	}

	// Composition-owned styling (ADR-0035 §2): the authored channels replace the
	// intrinsic entrance outright. Scale/rotation are absolute channel values
	// seeded from the primitive's static `scale`.
	function channelStyle(channels: OverlayChannelValues): string {
		const opacity = Math.max(0, Math.min(1, channels.opacity));
		const parts = [`opacity:${opacity}`, `scale:${channels.scale}`];
		if (channels.rotation !== 0) {
			parts.push(`rotate:${channels.rotation}deg`);
		}
		return parts.join(';');
	}

	// Pack appearance per primitive type (ADR-0024 resolution), plus the node's
	// structural depth rig as a ready CSS shadow and a box-ink that follows the
	// resolved fill's luminance — a white card wants dark text even when the
	// composition's ink is footage-white.
	function appearanceStyle(primitive: DiagramPrimitive): string {
		const vars = resolveAppearanceVars(pack, primitive.type);
		const primitiveInk = (primitive.ink ?? 'ink') === 'accent' ? accentInk : diagramInk;
		vars['--ink'] = primitiveInk;
		let style = `${appearanceVarsToStyle(vars)};color:${primitiveInk}`;
		if (primitive.type === 'node') {
			// The 'fg' shadow-colour sentinel resolves through the node's own
			// mount-injected `--ink` (ADR-0024) — never a baked colour; a Pack
			// that wants a specific shadow colour names it in the rig.
			const depth = resolveDepthTreatment(pack, 'node', 'var(--ink)');
			if (depth) {
				if (depth.kind === 'glow') {
					// Emissive packs bloom with a centered hot core and wider skirt.
					const glow = `0 0 ${depth.radius}px color-mix(in srgb, ${depth.color} ${Math.round(depth.intensity * 100)}%, transparent), 0 0 ${depth.radius * 2.25}px color-mix(in srgb, ${depth.color} ${Math.round(depth.intensity * 45)}%, transparent)`;
					style += `;--node-shadow:${glow}`;
				} else if (depth.blur > 0) {
					// A blurred offset is a card lifted off the page: one soft cast
					// shadow and no backing plate.
					style += `;--node-shadow:${depth.dx}px ${depth.dy}px ${depth.blur}px ${depth.color}`;
				} else {
					// A reflective Pack's hard offset is a physical backing plate, not a
					// zero-falloff shadow. Keep that signature as explicit geometry and
					// add a restrained soft cast shadow for continuous outer falloff.
					const softBlur = Math.max(18, depth.blur + 18);
					style += `;--node-depth-plate:${depth.color};--node-depth-x:${depth.dx}px;--node-depth-y:${depth.dy}px;--node-shadow:0 ${Math.max(8, depth.dy + 4)}px ${softBlur}px color-mix(in srgb, ${depth.color} 28%, transparent)`;
				}
			}
			const fill = vars['--fill'];
			if (fill) {
				// Computed CONTRAST decision, not a brand claim: the box's text/border
				// ink is picked light-or-dark against the resolved Pack fill's
				// luminance so a white card keeps dark text even when the
				// composition's ink is footage-white. The pair is intentionally
				// near-black/near-white — legibility poles, not palette colours.
				style += `;--node-box-ink:${isDarkSurfaceColor(fill) ? '#ffffff' : '#0c0c0c'}`;
			}
			if (primitive.highlight) {
				// The swipe wears the node's own accent Role; the word under it takes
				// the legibility pole for that colour.
				const marker = resolvePackRoleColor(pack, 'node.accent', 'accent-treatment');
				style += `;--node-highlight:${marker};--node-highlight-ink:${isDarkSurfaceColor(marker) ? '#ffffff' : '#0c0c0c'}`;
			}
		}
		return style;
	}
</script>

{#if primitives.length > 0}
	<div
		class="diagram-mount"
		style:font-family={fontStack}
		style:color={diagramInk}
		style:text-shadow={textGuard}
	>
		{#each primitives as primitive (primitive.id)}
			{@const PrimitiveSource = getDiagramCanvasSource(primitive)}
			{#if primitive.type !== 'edge-arrow'}
				{@const channels = channelsFor(primitive)}
				{#if primitive.type !== 'timeline-segment' || primitive.label}
					<div
						class="diagram-mount__item"
						data-diagram-primitive={primitive.id}
						data-diagram-node={primitive.type === 'node' ? primitive.id : undefined}
						style="{positionStyle(primitive, channels)};{channels
							? channelStyle(channels)
							: intrinsicStyle(primitive)};{appearanceStyle(primitive)}"
					>
						{#if (primitive.type === 'node' || primitive.type === 'label' || primitive.type === 'stat-callout' || primitive.type === 'code') && PrimitiveSource}
							<PrimitiveSource block={primitive} />
						{:else if primitive.type === 'timeline-segment'}
							<span
								class="diagram-mount__segment-label"
								data-diagram-text-role="caption"
								data-gfx-readable-id={`block:${primitive.id}:label`}
								data-gfx-readable-text={primitive.label}
								data-gfx-text-role="diagram-caption">{primitive.label}</span
							>
						{/if}
					</div>
				{/if}
			{/if}
		{/each}
	</div>
{/if}

<style>
	.diagram-mount {
		inset: 0;
		pointer-events: none;
		position: absolute;
	}

	.diagram-mount__item {
		position: absolute;
		/* Primitives centre on their authored point — GUI drag and the stroke
		   endpoints both reason about centres. CSS `translate` handles the
		   centring so `transform` stays free for the entrance rise. */
		translate: -50% -50%;
		transform-origin: center;
	}

	.diagram-mount__segment-label {
		font-family: 'Paper Mono', ui-monospace, monospace;
		font-size: calc(2.2 * var(--cqmin));
		font-weight: 600;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}
</style>
