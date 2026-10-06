<script lang="ts">
	import type { Component } from 'svelte';

	import type { Figure } from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import { requireLoadedBlockRenderer } from './pipelines/runtime-loader';

	// Figures (ADR-0067) live on the Surface plane beside charts and diagrams,
	// so HTML-in-Canvas captures them in every render path. Each Figure gets its
	// own layer in declaration order; the `figure` Pipeline draws every kind.
	const figures = $derived(engineState.surface.figures ?? []);

	function requireFigureCanvasSource(): Component<{ block: Figure }> {
		// Read the reactive bundle revision before enforcing the synchronous invariant.
		pipelineRendererRuntime.current();
		const CanvasSource = requireLoadedBlockRenderer('figure').CanvasSource;
		if (!CanvasSource) throw new Error('Required Figure Block renderer has no CanvasSource.');
		return CanvasSource as Component<{ block: Figure }>;
	}

	const FigureCanvasSource = $derived(figures.length > 0 ? requireFigureCanvasSource() : null);
</script>

{#if FigureCanvasSource}
	{#each figures as figure (figure.id)}
		<div class="figure-mount" data-figure-mount={figure.id}>
			<FigureCanvasSource block={figure} />
		</div>
	{/each}
{/if}

<style>
	.figure-mount {
		inset: 0;
		pointer-events: none;
		position: absolute;
	}
</style>
