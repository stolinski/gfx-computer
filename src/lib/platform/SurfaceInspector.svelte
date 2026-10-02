<script lang="ts">
	import { onDestroy } from 'svelte';

	import {
		SURFACE_KEYFRAME_CHANNELS,
		WEB_DOCUMENT_SITES,
		type Ease,
		type SoundOverride,
		type SurfaceState,
		type SurfaceType
	} from './engine-schema';
	import { engineState } from './engine-state.svelte';
	import { IS_HOSTED_ORIGIN } from './hosted-origin';
	import {
		getSurfaceDefinition,
		PIPELINE_DEFINITION_REGISTRY
	} from './pipelines/definition-registry';
	import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
	import { inspectorFocus, layerSelection } from './selection.svelte';
	import { parseTimelineTrackId } from './timeline-entity-identity';
	import { defaultMessageEnter } from '$lib/pipelines/surfaces/imessage/schedule';
	import { AsyncAuthoringOperationGuard } from '$lib/utils/async-authoring-operation';
	import { DOCUMENT_SLOTS } from '$lib/utils/surface-document-slots';
	import InspectorSection from './InspectorSection.svelte';
	import Field from './Field.svelte';
	import KeyframesSection from './KeyframesSection.svelte';
	import SoundSection from './SoundSection.svelte';
	import SurfaceAppearanceSection from './SurfaceAppearanceSection.svelte';
	import SurfaceChecklistSection from './SurfaceChecklistSection.svelte';
	import ChecklistCardSection from './ChecklistCardSection.svelte';
	import SurfaceDocumentSection from './SurfaceDocumentSection.svelte';
	import SurfaceMessagesSection from './SurfaceMessagesSection.svelte';
	import SurfaceTextMotionSection from './SurfaceTextMotionSection.svelte';
	import TransitionWindowSection from './TransitionWindowSection.svelte';
	import WebsiteCaptureFields from './WebsiteCaptureFields.svelte';

	const surfaceDefinitions = Object.values(PIPELINE_DEFINITION_REGISTRY.surfaces);
	const surfaceChangeGuard = new AsyncAuthoringOperationGuard();
	onDestroy(() => surfaceChangeGuard.dispose());

	const SITE_LABELS: Record<(typeof WEB_DOCUMENT_SITES)[number], string> = {
		twitter: 'Twitter / X',
		reddit: 'Reddit',
		wikipedia: 'Wikipedia',
		hackernews: 'Hacker News',
		github: 'GitHub',
		youtube: 'YouTube',
		news: 'News article',
		pubmed: 'PubMed'
	};

	// ---- Surface controls derived from the active renderer ----

	const definition = $derived(getSurfaceDefinition(engineState.surface.type));
	const controls = $derived(definition?.controls ?? {});

	// ---- Variant (variants-as-data families, ADR-0020) ----
	// Absent `variant` means the family's first id (how type-hero's CanvasSource
	// resolves it), so the select reflects the effective value.

	const variantIds = $derived(definition?.variantIds ?? []);
	const activeVariant = $derived(engineState.surface.variant ?? variantIds[0]);

	function handleVariantChange(event: Event): void {
		engineState.surface.variant = (event.currentTarget as HTMLSelectElement).value;
	}

	// ---- Surface type change ----

	async function handleSurfaceTypeChange(event: Event): Promise<void> {
		const select = event.currentTarget as HTMLSelectElement;
		const nextType = select.value as SurfaceType;
		const previousType = engineState.surface.type;
		if (nextType === previousType) return;
		const nextDefinition = getSurfaceDefinition(nextType);
		if (!nextDefinition) {
			select.value = previousType;
			return;
		}
		const generation = surfaceChangeGuard.begin();
		try {
			await pipelineRendererRuntime.ensureSurface(nextType);
			if (!surfaceChangeGuard.isCurrent(generation)) return;
			if (engineState.surface.type !== previousType) {
				select.value = engineState.surface.type;
				return;
			}
		} catch (cause) {
			if (surfaceChangeGuard.isCurrent(generation)) select.value = engineState.surface.type;
			console.error('Failed to load Surface renderer.', { type: nextType, cause });
			return;
		}
		const nextDefaults = nextDefinition.defaults();
		nextDefaults.content.body = engineState.surface.content.body;
		for (const slot of DOCUMENT_SLOTS) {
			const value = engineState.surface.content[slot];
			if (typeof value === 'string' && value.length > 0) nextDefaults.content[slot] = value;
		}
		engineState.surface = nextDefaults;
	}

	// ---- Chrome mode (ADR-0037) ----

	// Absent means 'window' (canonical) — writing `undefined` back for 'window'
	// keeps saved compositions free of a redundant field. The stored value is
	// shared across chrome-mode surfaces; only the label differs (the
	// checklist's full-chrome presentation is its card, not a window).
	const chromeFullLabel = $derived(engineState.surface.type === 'checklist' ? 'Card' : 'Window');

	function handleChromeChange(event: Event): void {
		const value = (event.currentTarget as HTMLSelectElement).value;
		engineState.surface.chrome = value === 'none' ? 'none' : undefined;
	}

	// ---- Enter / Exit (the surface's transition sugar; ADR-0035 §3 keyframes
	// take the pen when an opacity channel is declared) ----

	function ensureSurfaceTransition(field: 'enter' | 'exit'): NonNullable<SurfaceState['enter']> {
		const existing = engineState.surface[field];
		if (existing) return existing;
		const next =
			field === 'enter'
				? { start: 0, duration: 0.13, ease: 'settled' as Ease }
				: { start: 0.82, duration: 0.16, ease: 'smooth' as Ease };
		engineState.surface[field] = next;
		return next;
	}

	function toggleSurfaceTransition(field: 'enter' | 'exit', checked: boolean): void {
		if (checked) {
			ensureSurfaceTransition(field);
		} else {
			engineState.surface[field] = undefined;
		}
	}

	// ---- On-canvas direct selection (epic 0pkzts2c) ----
	// A selected Surface-message timeline row (set by a canvas bubble click or the
	// timeline gutter) highlights its message entry; the reveal effect below
	// scrolls to it and places the caret so "click a bubble → edit its text".
	let inspectorEl = $state<HTMLDivElement>();

	const selectedTrackIdentity = $derived(
		layerSelection.id ? parseTimelineTrackId(layerSelection.id) : null
	);

	const selectedMessageIndex = $derived(
		selectedTrackIdentity?.kind === 'surface-message' ? selectedTrackIdentity.index : null
	);

	// A selected checklist-item timeline row (canvas item click or timeline
	// gutter) highlights its item entry — the messages pattern, per item.
	const selectedItemIndex = $derived(
		selectedTrackIdentity?.kind === 'checklist-item' ? selectedTrackIdentity.index : null
	);

	function revealTarget(target: string): void {
		if (!inspectorEl) return;
		const [kind, key] = target.split(':');
		if (kind === 'message') {
			const row = inspectorEl.querySelector<HTMLElement>(`[data-message-row="${key}"]`);
			row?.querySelector<HTMLElement>('[contenteditable]')?.focus({ preventScroll: true });
			row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		} else if (kind === 'item') {
			const row = inspectorEl.querySelector<HTMLElement>(`[data-item-row="${key}"]`);
			row?.querySelector<HTMLInputElement>('input[type="text"]')?.focus({ preventScroll: true });
			row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		} else if (kind === 'slot') {
			const input =
				key === 'body'
					? inspectorEl.querySelector<HTMLElement>('.body-field [contenteditable]')
					: inspectorEl.querySelector<HTMLElement>(`input[data-slot="${key}"]`);
			input?.focus({ preventScroll: true });
			input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	// Scroll + caret placement is a true DOM side effect — the legitimate $effect
	// case. Runs post-render, so the target row/input already exists.
	$effect(() => {
		void inspectorFocus.seq;
		const target =
			inspectorFocus.target ??
			(selectedMessageIndex !== null
				? `message:${selectedMessageIndex}`
				: selectedItemIndex !== null
					? `item:${selectedItemIndex}`
					: null);
		if (target) revealTarget(target);
	});

	// This Layer's motion windows for the Sound section (ADR-0033 §5).
	const soundMotions = $derived.by(() => {
		const rows: {
			label: string;
			cueId: string;
			window?: { sound?: SoundOverride };
			ensure?: () => { sound?: SoundOverride };
		}[] = [];
		if (engineState.surface.enter)
			rows.push({ label: 'Enter', cueId: 'surface:enter', window: engineState.surface.enter });
		if (engineState.surface.exit)
			rows.push({ label: 'Exit', cueId: 'surface:exit', window: engineState.surface.exit });
		// Chat bubbles sound too (`message:${index}` cues); a bubble on the default
		// cadence gets its `enter` window materialized on first sound write.
		if (controls.messages) {
			(engineState.surface.content.messages ?? []).forEach((message, index) => {
				rows.push({
					label: `Message ${index + 1}`,
					cueId: `message:${index}`,
					window: message.enter,
					ensure: () => {
						message.enter ??= defaultMessageEnter(index);
						return message.enter;
					}
				});
			});
		}
		// Animated checklist strikes sound (`mark:${index}` cues — indexed by
		// mark-instance position, i.e. checked-item order; the checklist body
		// carries no other marks). Static strikes have no motion and no cue.
		if (controls.items) {
			let strikeMarkIndex = 0;
			(engineState.surface.content.items ?? []).forEach((item, index) => {
				if (!item.checked) return;
				const cueId = `mark:${strikeMarkIndex}`;
				strikeMarkIndex += 1;
				if (!item.strike) return;
				rows.push({ label: `Item ${index + 1} strike`, cueId, window: item.strike });
			});
		}
		return rows;
	});
</script>

<div class="surface-inspector" bind:this={inspectorEl}>
	<InspectorSection label="Surface">
		<Field label="Type">
			<select value={engineState.surface.type} onchange={handleSurfaceTypeChange}>
				{#each surfaceDefinitions as surface (surface.type)}
					<option value={surface.type}>{surface.label}</option>
				{/each}
			</select>
		</Field>

		{#if variantIds.length > 0}
			<Field label="Variant">
				<select value={activeVariant} onchange={handleVariantChange}>
					{#each variantIds as id (id)}
						<option value={id}>{id}</option>
					{/each}
				</select>
			</Field>
		{/if}

		{#if controls.site}
			<Field label="Site">
				<select
					value={engineState.surface.site ?? 'twitter'}
					onchange={(e) => {
						engineState.surface.site = (e.currentTarget as HTMLSelectElement)
							.value as (typeof WEB_DOCUMENT_SITES)[number];
					}}
				>
					{#each WEB_DOCUMENT_SITES as site (site)}
						<option value={site}>{SITE_LABELS[site]}</option>
					{/each}
				</select>
			</Field>
		{/if}

		<!-- Site capture drives the origin's headless browser (ADR-0054 §7); the
		     hosted origin has none, so the fields are absent there. -->
		{#if controls.websiteCapture && !IS_HOSTED_ORIGIN}
			<WebsiteCaptureFields />
		{/if}

		<SurfaceDocumentSection />

		{#if controls.chrome}
			<Field label="Chrome">
				<select value={engineState.surface.chrome ?? 'window'} onchange={handleChromeChange}>
					<option value="window">{chromeFullLabel}</option>
					<option value="none">None</option>
				</select>
			</Field>
		{/if}

		{#if controls.backgroundVisibility && engineState.surface.backgroundVisibility !== undefined}
			<Field label="Background">
				<input
					bind:value={engineState.surface.backgroundVisibility}
					max="1"
					min="0"
					step="0.01"
					type="range"
				/>
			</Field>
		{/if}
	</InspectorSection>

	{#if controls.messages}
		<SurfaceMessagesSection />
	{/if}

	{#if controls.items}
		<SurfaceChecklistSection />
		<ChecklistCardSection />
	{/if}

	<SurfaceAppearanceSection />

	{#if controls.enterExit}
		<TransitionWindowSection
			label="Enter"
			transition={engineState.surface.enter}
			ontoggle={(checked) => toggleSurfaceTransition('enter', checked)}
		/>
		<TransitionWindowSection
			label="Exit"
			transition={engineState.surface.exit}
			ontoggle={(checked) => toggleSurfaceTransition('exit', checked)}
		/>
	{/if}

	<SurfaceTextMotionSection />

	<!-- Composition-owned surface opacity (ADR-0035 §3) — the only surface
	     channel; transforms are camera territory. Declaring it takes the pen
	     from the enter/exit sugar. -->
	<KeyframesSection selfKey="surface" channelNames={SURFACE_KEYFRAME_CHANNELS} />

	<SoundSection motions={soundMotions} />
</div>

<style>
	.surface-inspector {
		display: grid;
		gap: 0;
	}
</style>
