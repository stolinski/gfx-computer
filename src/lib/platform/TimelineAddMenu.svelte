<script lang="ts">
	import { onDestroy } from 'svelte';

	import { TEXT_EFFECT_IDS } from '$lib/text-animations/catalog';
	import {
		engineState,
		addCaptions,
		addChartBlock,
		addDiagramPrimitive,
		addOverlay,
		addTextAnimation
	} from './engine-state.svelte';
	import { PIPELINE_DEFINITION_REGISTRY } from './pipelines/definition-registry';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import { selectLayer } from './selection.svelte';
	import { createTimelineTrackId } from './timeline-entity-identity';
	import { AsyncAuthoringOperationGuard } from '$lib/utils/async-authoring-operation';
	import { runAddCompositionKineticWordOperation } from './composition-kinetic-type-operations';
	import { compositionEditHistory } from './composition-edit-history';
	import { KINETIC_TYPE_WORD_LIMIT } from './engine-schema';

	// The gutter footer's "Add layer" control: a top-layer popover menu of the
	// addable layer types — the real add affordance, not a stray <select>. The
	// popover escapes the panel's overflow:hidden and opens upward.
	const overlayDefinitions = Object.values(PIPELINE_DEFINITION_REGISTRY.overlays);
	const addOperationGuard = new AsyncAuthoringOperationGuard();
	onDestroy(() => addOperationGuard.dispose());

	// Diagram primitive Blocks (ADR-0036) — explicit placement is the authoring
	// model, so a new primitive lands at a sensible spot and is immediately
	// selected for canvas drag + inspector editing.
	const CHART_TYPES = [
		{ type: 'bar-chart', label: 'Bar chart' },
		{ type: 'column-chart', label: 'Column chart' },
		{ type: 'line-chart', label: 'Line chart' },
		{ type: 'unit-grid-chart', label: 'Unit grid' },
		{ type: 'dot-field-chart', label: 'Dot field' }
	] as const;

	const canAddChart = $derived(
		(engineState.surface.type === 'plain' || engineState.surface.type === 'paper') &&
			(engineState.surface.chart?.items.length ?? 0) < 4
	);
	const canAddKineticWord = $derived(
		engineState.surface.type === 'plain' &&
			engineState.stage === undefined &&
			(engineState.surface.typeField?.words.length ?? 0) < KINETIC_TYPE_WORD_LIMIT
	);

	const DIAGRAM_TYPES = [
		{ type: 'node', label: 'Diagram node' },
		{ type: 'edge-arrow', label: 'Diagram edge' },
		{ type: 'label', label: 'Diagram label' },
		{ type: 'stat-callout', label: 'Stat callout' },
		{ type: 'timeline-segment', label: 'Timeline segment' }
	] as const;

	let addMenuEl: HTMLDivElement | null = null;
	let addTriggerEl: HTMLButtonElement | null = null;

	function attachAddMenu(element: HTMLDivElement): () => void {
		addMenuEl = element;
		return () => {
			if (addMenuEl === element) addMenuEl = null;
		};
	}

	function attachAddTrigger(element: HTMLButtonElement): () => void {
		addTriggerEl = element;
		return () => {
			if (addTriggerEl === element) addTriggerEl = null;
		};
	}

	// The footer sits at the bottom of a clipped, fixed-height panel, so the menu
	// renders in the top layer (popover) and is anchored on open: fixed, left-edge
	// aligned to the trigger, bottom resting just above it (opens upward).
	function positionAddMenu(): void {
		if (!addMenuEl || !addTriggerEl) return;
		const rect = addTriggerEl.getBoundingClientRect();
		addMenuEl.style.left = `${rect.left}px`;
		addMenuEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
		addMenuEl.style.minInlineSize = `${rect.width}px`;
	}

	function onAddMenuToggle(event: ToggleEvent): void {
		if (event.newState === 'open') positionAddMenu();
	}

	async function pickOverlay(type: string): Promise<void> {
		const definition = overlayDefinitions.find((entry) => entry.type === type);
		if (!definition) return;
		const generation = addOperationGuard.begin();
		const overlayIdentity = engineState.overlays.map((overlay) => overlay.id).join('\u0000');
		try {
			await pipelineRendererRuntime.ensureOverlay(type);
			if (
				!addOperationGuard.isCurrent(generation) ||
				engineState.overlays.map((overlay) => overlay.id).join('\u0000') !== overlayIdentity
			) {
				return;
			}
			const def = definition.defaults();
			const id = addOverlay({
				type,
				content: def.content,
				position: def.position,
				enter: def.enter,
				exit: def.exit
			});
			selectLayer(createTimelineTrackId({ kind: 'overlay', overlayId: id }));
			addMenuEl?.hidePopover();
		} catch (cause) {
			console.error('Failed to load Overlay renderer.', { type, cause });
		}
	}

	async function pickChart(type: (typeof CHART_TYPES)[number]['type']): Promise<void> {
		const generation = addOperationGuard.begin();
		const surface = engineState.surface;
		const chartIdentity = surface.chart?.items.map((item) => item.id).join('\u0000') ?? '';
		try {
			const bundle = await pipelineRendererRuntime.resolve({
				surfaces: new Set(),
				blocks: new Set([type]),
				annotations: new Set(),
				overlays: new Set(),
				effects: new Set(),
				transitions: new Set()
			});
			if (
				!addOperationGuard.isCurrent(generation) ||
				engineState.surface !== surface ||
				(surface.chart?.items.map((item) => item.id).join('\u0000') ?? '') !== chartIdentity ||
				!canAddChart
			) {
				return;
			}
			pipelineRendererRuntime.activate(bundle);
			const id = addChartBlock(type);
			if (!id) return;
			selectLayer(createTimelineTrackId({ kind: 'block', blockId: id }));
			addMenuEl?.hidePopover();
		} catch (cause) {
			console.error('Failed to load Chart renderer.', { type, cause });
		}
	}

	async function pickKineticWord(): Promise<void> {
		addOperationGuard.supersede();
		const outcome = await runAddCompositionKineticWordOperation({
			expectedRevision: compositionEditHistory.revision
		});
		if (outcome.status === 'applied') addMenuEl?.hidePopover();
	}

	function pickTextAnimation(): void {
		addOperationGuard.supersede();
		const firstEffect = TEXT_EFFECT_IDS[0];
		if (!firstEffect) return;
		addTextAnimation({
			target: { kind: 'surface', slot: 'body' },
			effect: firstEffect,
			enter: { start: 0.04, duration: 0.1, ease: 'smooth' }
		});
		addMenuEl?.hidePopover();
	}

	async function pickDiagramPrimitive(type: (typeof DIAGRAM_TYPES)[number]['type']): Promise<void> {
		const generation = addOperationGuard.begin();
		const surface = engineState.surface;
		const diagramIdentity = surface.diagram?.map((item) => item.id).join('\u0000') ?? '';
		try {
			const bundle = await pipelineRendererRuntime.resolve({
				surfaces: new Set(),
				blocks: new Set([type]),
				annotations: new Set(),
				overlays: new Set(),
				effects: new Set(),
				transitions: new Set()
			});
			if (
				!addOperationGuard.isCurrent(generation) ||
				engineState.surface !== surface ||
				(surface.diagram?.map((item) => item.id).join('\u0000') ?? '') !== diagramIdentity
			) {
				return;
			}
			pipelineRendererRuntime.activate(bundle);
			const id = addDiagramPrimitive(type);
			selectLayer(createTimelineTrackId({ kind: 'block', blockId: id }));
			addMenuEl?.hidePopover();
		} catch (cause) {
			console.error('Failed to load Diagram renderer.', { type, cause });
		}
	}

	function pickCaptions(): void {
		addOperationGuard.supersede();
		addCaptions();
		selectLayer(createTimelineTrackId({ kind: 'captions' }));
		addMenuEl?.hidePopover();
	}
</script>

<footer class="gutter__add">
	<button
		class="gutter__add-trigger"
		type="button"
		{@attach attachAddTrigger}
		popovertarget="timeline-add-menu"
		aria-label="Add layer"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="11"
			height="11"
			viewBox="0 0 16 16"
			aria-hidden="true"
		>
			<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
		</svg>
		<span>Layer ▾</span>
	</button>
	<div
		class="add-menu"
		id="timeline-add-menu"
		popover
		{@attach attachAddMenu}
		ontoggle={onAddMenuToggle}
	>
		{#each overlayDefinitions as renderer (renderer.type)}
			<button class="add-menu__item" type="button" onclick={() => pickOverlay(renderer.type)}
				>{renderer.label}</button
			>
		{/each}
		<div class="add-menu__divider" role="presentation"></div>
		{#each DIAGRAM_TYPES as entry (entry.type)}
			<button class="add-menu__item" type="button" onclick={() => pickDiagramPrimitive(entry.type)}
				>{entry.label}</button
			>
		{/each}
		<div class="add-menu__divider" role="presentation"></div>
		<button
			class="add-menu__item"
			type="button"
			disabled={!canAddKineticWord}
			onclick={pickKineticWord}>Kinetic word</button
		>
		{#each CHART_TYPES as entry (entry.type)}
			<button
				class="add-menu__item"
				type="button"
				disabled={!canAddChart}
				onclick={() => pickChart(entry.type)}>{entry.label}</button
			>
		{/each}
		<div class="add-menu__divider" role="presentation"></div>
		<button class="add-menu__item" type="button" onclick={pickTextAnimation}>Text animation</button>
		{#if !engineState.captions}
			<button class="add-menu__item" type="button" onclick={pickCaptions}>Captions</button>
		{/if}
	</div>
</footer>

<style>
	/* Add footer — a real add control with breathing room, not a stray select. */
	.gutter__add {
		border-block-start: 1px solid var(--chrome-hairline);
		padding: var(--vs-s);
	}

	.gutter__add-trigger {
		align-items: center;
		background: transparent;
		border: 1px dashed var(--chrome-hairline, #26262a);
		border-radius: 5px;
		color: var(--chrome-muted);
		cursor: pointer;
		display: flex;
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
		gap: var(--vs-xs);
		inline-size: 100%;
		justify-content: center;
		padding: 6px 12px;
		transition:
			background 100ms ease,
			border-color 100ms ease,
			color 100ms ease;
	}

	.gutter__add-trigger:hover {
		border-color: #3a3a40;
		color: var(--chrome-text);
	}

	/* Top-layer add menu — escapes the panel clip, opens upward from the trigger.
	   Layout display lives on :popover-open ONLY: an unconditional author
	   `display` overrides the UA's closed-popover display:none and leaves an
	   invisible click-eating overlay at the popover's static position. */
	.add-menu {
		background: var(--chrome-raised);
		border: 1px solid var(--chrome-hairline);
		border-radius: var(--br-s);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
		flex-direction: column;
		gap: 1px;
		inset: auto;
		margin: 0;
		max-block-size: 60vh;
		opacity: 1;
		overflow-y: auto;
		padding: var(--vs-xs);
		position: fixed;
		transform: translateY(0) scale(1);
		transform-origin: bottom left;
		transition:
			opacity 120ms ease,
			transform 160ms var(--ease-smooth),
			overlay 160ms allow-discrete,
			display 160ms allow-discrete;
	}

	.add-menu:popover-open {
		display: flex;
	}

	.add-menu:not(:popover-open) {
		opacity: 0;
		transform: translateY(6px) scale(0.97);
	}

	@starting-style {
		.add-menu:popover-open {
			opacity: 0;
			transform: translateY(6px) scale(0.97);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.add-menu {
			transition-duration: 1ms;
		}
	}

	.add-menu__item {
		background: transparent;
		border: 0;
		border-radius: 4px;
		color: var(--chrome-text);
		cursor: pointer;
		font-size: 0.75rem;
		inline-size: 100%;
		padding: 6px var(--vs-s);
		text-align: left;
		text-transform: capitalize;
		transition:
			background 100ms ease,
			color 100ms ease;
		white-space: nowrap;
	}

	.add-menu__item:hover {
		background: var(--chrome-hairline);
		color: var(--chrome-text);
	}

	.add-menu__item:disabled {
		color: var(--chrome-muted);
		cursor: not-allowed;
		opacity: 0.45;
	}

	.add-menu__divider {
		background: var(--chrome-hairline);
		block-size: 1px;
		margin-block: var(--vs-xs);
	}
</style>
