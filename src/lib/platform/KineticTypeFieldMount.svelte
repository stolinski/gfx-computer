<script lang="ts">
	import type { Component } from 'svelte';

	import { animState } from './anim-state.svelte';
	import { engineState, packState } from './engine-state.svelte';
	import { getPack } from './packs/registry';
	import {
		appearanceVarsToStyle,
		requireCoreColor,
		resolveAppearanceVars,
		resolveFieldInkColor,
		resolveTypographyColors
	} from './packs/resolve';
	import {
		mapNormalizedVariableWeight,
		resolveVariableWeightTreatment
	} from './packs/variable-weight-treatment';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import { requireLoadedBlockRenderer } from './pipelines/runtime-loader';
	import {
		kineticWordHorizontalAnchorTransformOrigin,
		kineticWordHorizontalAnchorTranslate,
		resolveKineticWordChannelKeyframes,
		resolveKineticWordGeometry,
		resolveKineticWordHorizontalAnchor
	} from '$lib/utils/kinetic-word-geometry';
	import {
		evaluateKineticWordGlyphFrames,
		type KineticWordGlyphFrame
	} from '$lib/utils/kinetic-word-glyphs';
	import type { KineticWord } from './engine-schema';

	// Type Field words live on the Surface plane as native DOM text. Phrases are
	// semantic authority only: they never auto-place or reorder the word pool.
	interface KineticWordSourceProps {
		block: KineticWord;
		glyphs?: readonly KineticWordGlyphFrame[];
	}

	function getKineticWordCanvasSource(): Component<KineticWordSourceProps> {
		pipelineRendererRuntime.current();
		const CanvasSource = requireLoadedBlockRenderer('kinetic-word').CanvasSource;
		if (!CanvasSource) {
			throw new Error('Required kinetic-word Block renderer has no CanvasSource.');
		}
		return CanvasSource as Component<KineticWordSourceProps>;
	}

	const field = $derived(engineState.surface.typeField);
	const pack = $derived(getPack(packState.slug));
	const fieldInk = $derived(
		engineState.backgroundFill !== undefined
			? resolveFieldInkColor(pack, engineState.typography.inkColor)
			: resolveTypographyColors(pack, engineState.typography).inkColor
	);
	const accentInk = $derived(requireCoreColor(pack, 'accent-treatment'));
	const textGuard = $derived(
		engineState.backgroundFill === undefined && engineState.stage === undefined
			? '0 3px 28px rgb(0 0 0 / 0.58), 0 1px 8px rgb(0 0 0 / 0.62)'
			: undefined
	);
	// The exact composition millisecond this frame renders; glyph staggers evaluate
	// the word's own reveal track here rather than riding a per-glyph tween.
	const frameMs = $derived(animState.globalProgress * engineState.transport.durationSeconds * 1000);

	/** Glyph frames while the word's reveal track is live; otherwise one plain text run. */
	function wordGlyphs(word: KineticWord): readonly KineticWordGlyphFrame[] | undefined {
		const reveal = resolveKineticWordChannelKeyframes(
			word,
			engineState.transport.orientation
		).reveal;
		if (!reveal || reveal.length === 0) return undefined;
		return evaluateKineticWordGlyphFrames(word.text, reveal, word.glyphStagger, frameMs);
	}

	function wordStyle(word: KineticWord): string {
		const geometry = resolveKineticWordGeometry(word, engineState.transport.orientation);
		const channels = animState.kineticWordChannels[word.id];
		const horizontalAnchor = resolveKineticWordHorizontalAnchor(geometry);
		const ink = word.ink === 'accent' ? accentInk : fieldInk;
		const appearance = resolveAppearanceVars(pack, word.type);
		const variableWeight = resolveVariableWeightTreatment(pack);
		const mappedWeight = variableWeight
			? mapNormalizedVariableWeight(variableWeight, channels?.weight ?? 0.5)
			: undefined;
		return [
			appearanceVarsToStyle(appearance),
			`--kinetic-word-ink:${ink}`,
			mappedWeight === undefined ? '' : `--kinetic-word-weight:${mappedWeight}`,
			channels?.tracking ? `--kinetic-word-tracking:${channels.tracking}em` : '',
			`left:${(geometry.position.x + (channels?.x ?? 0)) * 100}%`,
			`top:${(geometry.position.y + (channels?.y ?? 0)) * 100}%`,
			`translate:${kineticWordHorizontalAnchorTranslate(horizontalAnchor)}`,
			`transform-origin:${kineticWordHorizontalAnchorTransformOrigin(horizontalAnchor)}`,
			`scale:${channels?.scale ?? geometry.scale}`,
			`rotate:${channels?.rotation ?? geometry.rotation}deg`,
			`opacity:${channels?.opacity ?? 1}`
		]
			.filter(Boolean)
			.join(';');
	}
</script>

{#if field && field.words.length > 0}
	<div class="kinetic-type-field" style:text-shadow={textGuard}>
		{#each field.words as word (word.id)}
			{@const KineticWordSource = getKineticWordCanvasSource()}
			<div class="kinetic-type-field__word" data-kinetic-word={word.id} style={wordStyle(word)}>
				<KineticWordSource block={word} glyphs={wordGlyphs(word)} />
			</div>
		{/each}
	</div>
{/if}

<style>
	.kinetic-type-field {
		inset: 0;
		pointer-events: none;
		position: absolute;
	}

	/* Grid so the word box is exactly its line box: no strut, no baseline drift
	   when the renderer clips to its mask. */
	.kinetic-type-field__word {
		display: grid;
		position: absolute;
		transform-origin: center;
		translate: -50% -50%;
	}
</style>
