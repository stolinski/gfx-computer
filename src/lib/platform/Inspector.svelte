<script lang="ts">
	import { layerSelection, deselectLayer } from './selection.svelte';
	import { TIMELINE_KIND_COLORS } from './composition-timeline-tracks';
	import {
		parseSoundRailReferenceId,
		parseTimelineTrackId,
		parseVideoClipSelectionId
	} from './timeline-entity-identity';
	import { inspectorRailMode } from './inspector-rail-mode.svelte';
	import BlockInspector from './BlockInspector.svelte';
	import CaptionsInspector from './CaptionsInspector.svelte';
	import MediaInspector from './MediaInspector.svelte';
	import RootInspector from './RootInspector.svelte';
	import SurfaceInspector from './SurfaceInspector.svelte';
	import OverlayInspector from './OverlayInspector.svelte';
	import TextAnimInspector from './TextAnimInspector.svelte';
	import MarkInspector from './MarkInspector.svelte';
	import SoundCueInspector from './SoundCueInspector.svelte';
	import StageBodyInspector from './StageBodyInspector.svelte';
	import StageCameraInspector from './StageCameraInspector.svelte';
	import StageFocusInspector from './StageFocusInspector.svelte';
	import VideoClipInspector from './VideoClipInspector.svelte';

	// Resolve the selected runtime identity to its curated inspector. Main rows
	// and their subtracks intentionally route to the same owning entity.
	const resolved = $derived.by(() => {
		const id = layerSelection.id;
		if (!id) return { kind: 'root' as const };
		const videoClip = parseVideoClipSelectionId(id);
		if (videoClip) return { kind: 'video-clip' as const, clipId: videoClip.clipId };

		const track = parseTimelineTrackId(id);
		if (track) {
			switch (track.kind) {
				case 'surface':
				case 'surface-message':
				case 'checklist-item':
					return { kind: 'surface' as const };
				case 'captions':
					return { kind: 'captions' as const };
				case 'mark':
					return { kind: 'mark' as const, index: track.index };
				case 'text-animation':
					return { kind: 'text-animation' as const, textAnimationId: track.textAnimationId };
				case 'block':
				case 'block-subtrack':
					return { kind: 'block' as const, blockId: track.blockId };
				case 'overlay':
				case 'overlay-subtrack':
					return { kind: 'overlay' as const, overlayId: track.overlayId };
				case 'sound':
				case 'video':
					return { kind: 'generic' as const, id };
				case 'stage-camera':
					return { kind: 'stage-camera' as const };
				case 'stage-focus':
					return { kind: 'stage-focus' as const };
				case 'stage-body':
					return { kind: 'stage-body' as const, bodyId: track.bodyId };
				case 'effect':
					// The Effect chain is a composition-root section; its row lives there.
					return { kind: 'root' as const };
			}
		}

		const soundReference = parseSoundRailReferenceId(id);
		if (soundReference) return { kind: 'sound-cue' as const, reference: soundReference };

		return { kind: 'generic' as const, id };
	});

	// The breadcrumb's scope word — what the rail is currently editing.
	const scopeLabel = $derived.by(() => {
		switch (resolved.kind) {
			case 'root':
				return null;
			case 'surface':
				return 'Surface';
			case 'block':
				return 'Block';
			case 'overlay':
				return 'Overlay';
			case 'captions':
				return 'Captions';
			case 'text-animation':
				return 'Text animation';
			case 'mark':
				return 'Mark';
			case 'sound-cue':
				return 'Sound cue';
			case 'video-clip':
				return 'Video clip';
			case 'stage-camera':
				return 'Camera';
			case 'stage-focus':
				return 'Focus';
			case 'stage-body':
				return 'Body';
			case 'generic':
				return 'Selection';
		}
	});

	// The crumb's kind tick — the same lane color the timeline gutter shows,
	// tying the rail's scope to the selected lane at a glance.
	const scopeTickColor = $derived(TIMELINE_KIND_COLORS[resolved.kind]);
</script>

<aside class="inspector">
	<nav class="inspector__modes" aria-label="Inspector mode">
		<button
			type="button"
			aria-pressed={inspectorRailMode.mode === 'inspector'}
			onclick={() => inspectorRailMode.switchToInspector()}>Inspector</button
		>
		<button
			type="button"
			aria-pressed={inspectorRailMode.mode === 'media'}
			onclick={() => inspectorRailMode.switchToMedia()}>Media</button
		>
	</nav>
	{#if inspectorRailMode.mode === 'inspector'}
		<div class="inspector__crumb">
			{#if scopeLabel === null}
				<span class="inspector__crumb-current">Composition</span>
			{:else}
				<button type="button" class="inspector__crumb-root" onclick={deselectLayer}>
					Composition
				</button>
				<span class="inspector__crumb-sep" aria-hidden="true">▸</span>
				{#if scopeTickColor}
					<span class="inspector__crumb-tick" style:background={scopeTickColor} aria-hidden="true"
					></span>
				{/if}
				<span class="inspector__crumb-current">{scopeLabel}</span>
			{/if}
		</div>
	{/if}
	<div class="inspector__scroll">
		{#if inspectorRailMode.mode === 'media'}
			<MediaInspector />
		{:else if resolved.kind === 'root'}
			<RootInspector />
		{:else if resolved.kind === 'surface'}
			<SurfaceInspector />
		{:else if resolved.kind === 'overlay'}
			<OverlayInspector overlayId={resolved.overlayId} />
		{:else if resolved.kind === 'block'}
			<BlockInspector blockId={resolved.blockId} />
		{:else if resolved.kind === 'captions'}
			<CaptionsInspector />
		{:else if resolved.kind === 'text-animation'}
			<TextAnimInspector animId={resolved.textAnimationId} />
		{:else if resolved.kind === 'mark'}
			<MarkInspector markIndex={resolved.index} />
		{:else if resolved.kind === 'sound-cue'}
			<SoundCueInspector reference={resolved.reference} />
		{:else if resolved.kind === 'video-clip'}
			<VideoClipInspector clipId={resolved.clipId} />
		{:else if resolved.kind === 'stage-camera'}
			<StageCameraInspector />
		{:else if resolved.kind === 'stage-focus'}
			<StageFocusInspector />
		{:else if resolved.kind === 'stage-body'}
			<StageBodyInspector bodyId={resolved.bodyId} />
		{:else}
			<div class="generic-label">
				<span class="generic-label__id">{resolved.id}</span>
				<button type="button" class="generic-label__back" onclick={deselectLayer}>
					← composition
				</button>
			</div>
		{/if}
	</div>
</aside>

<style>
	/* The rail is a deck panel (DESIGN.md elevation): labels engraved in
	   Archivo, values on the LCD in mono, wells recessed below the deck. */
	.inspector {
		background: var(--chrome-deck);
		block-size: 100%;
		border-inline-start: 1px solid var(--chrome-hairline);
		color: var(--chrome-text);
		display: flex;
		flex-direction: column;
		font-family: Archivo, sans-serif;
		min-block-size: 0;
		overflow: hidden;
	}

	/* A stable gutter so selecting a layer never reflows the controls, and a
	   thin ladder-colored scrollbar instead of OS chrome. */
	.inspector__scroll {
		flex: 1 1 auto;
		min-block-size: 0;
		overflow-y: auto;
		scrollbar-color: var(--chrome-hairline) transparent;
		scrollbar-gutter: stable;
		scrollbar-width: thin;
	}

	/* Tool-grade controls: the default Graffiti form inputs are comfortable web
	   inputs (38px tall, 18px text) which read as a bloated form in an inspector.
	   Compact them to a dense, DaVinci-style scale across every inspector, as
	   recessed mono wells per the DESIGN.md input contract. */
	.inspector :global(input:not([type='checkbox']):not([type='range']):not([type='color'])),
	.inspector :global(select),
	.inspector :global(textarea) {
		background: var(--chrome-well);
		block-size: auto;
		border: 1px solid var(--chrome-hairline);
		border-radius: 5px;
		box-shadow: none;
		color: var(--chrome-text);
		font-family: 'Paper Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 400;
		line-height: 1.2;
		min-block-size: 0;
		padding-block: 5px;
		padding-inline: 9px;
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.inspector :global(button) {
		font-family: inherit;
	}

	/* Selects state their nature: a muted ▾ at the control's right edge —
	   appearance:none removed the OS arrow, so restore an on-system one. */
	.inspector :global(select) {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%238a8a90' stroke-width='1.2'/%3E%3C/svg%3E");
		background-position: right 8px center;
		background-repeat: no-repeat;
		padding-inline-end: 22px;
	}

	.inspector__modes {
		border-block-end: 1px solid var(--chrome-hairline);
		column-gap: 6px;
		display: grid;
		flex: none;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		padding: 10px 12px 8px;
	}

	.inspector__modes button {
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--chrome-muted);
		cursor: pointer;
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
		letter-spacing: 0.14em;
		padding-block: 6px;
		text-transform: uppercase;
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.inspector__modes button:hover {
		background: var(--chrome-raised);
		color: var(--chrome-text);
	}

	.inspector__modes button[aria-pressed='true'] {
		background: var(--chrome-raised);
		border-color: var(--chrome-hairline);
		color: var(--chrome-text);
	}

	.inspector__modes button:focus-visible {
		border-color: #ffd608;
		outline: none;
	}

	/* Scope breadcrumb — says what the rail is editing; the Composition segment
	   is the way back up when a layer is selected. */
	.inspector__crumb {
		align-items: center;
		border-block-end: 1px solid var(--chrome-hairline);
		color: var(--chrome-muted);
		display: flex;
		flex: none;
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
		gap: 7px;
		letter-spacing: 0.06em;
		min-block-size: 0;
		padding: 6px 16px 10px;
	}

	.inspector__crumb-tick {
		block-size: 8px;
		border-radius: 2px;
		flex: none;
		inline-size: 8px;
	}

	.inspector__crumb-root {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font: inherit;
		letter-spacing: inherit;
		padding: 0;
	}

	.inspector__crumb-root:hover {
		color: var(--chrome-text);
	}

	.inspector__crumb-sep {
		color: var(--chrome-muted);
	}

	.inspector__crumb-current {
		color: var(--chrome-text);
		font-weight: 600;
	}

	.inspector :global(input[type='color']) {
		block-size: 1.6rem;
		inline-size: 2.4rem;
		padding: 2px;
	}

	/* Sliders are flat chrome, not the native accent control: a hairline track
	   with a small light thumb. The thumb takes the yellow accent only while
	   engaged — the same selection/focus reservation as every other control. */
	.inspector :global(input[type='range']) {
		appearance: none;
		background: transparent;
		block-size: 20px;
		border: 0;
		inline-size: 100%;
		margin: 0;
		padding: 0;
	}

	.inspector :global(input[type='range']::-webkit-slider-runnable-track) {
		background: var(--chrome-hairline);
		block-size: 2px;
		border-radius: 1px;
	}

	.inspector :global(input[type='range']::-webkit-slider-thumb) {
		appearance: none;
		background: var(--chrome-text);
		block-size: 10px;
		border: 0;
		border-radius: 3px;
		inline-size: 10px;
		margin-block-start: -4px;
	}

	.inspector :global(input[type='range']::-moz-range-track) {
		background: var(--chrome-hairline);
		block-size: 2px;
		border-radius: 1px;
	}

	.inspector :global(input[type='range']::-moz-range-thumb) {
		background: var(--chrome-text);
		block-size: 10px;
		border: 0;
		border-radius: 3px;
		inline-size: 10px;
	}

	.inspector :global(input[type='range']:active::-webkit-slider-thumb),
	.inspector :global(input[type='range']:focus-visible::-webkit-slider-thumb) {
		background: #ffd608;
	}

	.inspector :global(input[type='range']:active::-moz-range-thumb),
	.inspector :global(input[type='range']:focus-visible::-moz-range-thumb) {
		background: #ffd608;
	}

	/* Raw checkboxes (effect editors) get the same recessed-cell language as
	   InspectorToggle: a well cell whose check is primary text, never OS chrome. */
	.inspector :global(input[type='checkbox']) {
		appearance: none;
		background-color: var(--chrome-well);
		block-size: 14px;
		border: 1px solid var(--chrome-hairline);
		border-radius: 3px;
		cursor: pointer;
		inline-size: 14px;
		margin: 0;
		padding: 0;
		transition: border-color 120ms ease;
	}

	.inspector :global(input[type='checkbox']:hover) {
		border-color: var(--chrome-muted);
	}

	.inspector :global(input[type='checkbox']:checked) {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8' viewBox='0 0 10 8'%3E%3Cpath d='M1 4.2 3.8 7 9 1' fill='none' stroke='%23e8e8ea' stroke-width='1.6'/%3E%3C/svg%3E");
		background-position: center;
		background-repeat: no-repeat;
	}

	/* Focused control gets the yellow selection accent (§7). */
	.inspector :global(input:focus-visible),
	.inspector :global(select:focus-visible),
	.inspector :global(textarea:focus-visible) {
		border-color: #ffd608;
		outline: none;
	}

	/* The one add-action grammar (shared by AddMenu and direct add buttons):
	   a dashed ghost row — an empty slot inviting a fill, never a raised step.
	   Width comes from context (grid bodies stretch it row-wide). */
	.inspector :global(.ins-add) {
		align-items: center;
		background: transparent;
		border: 1px dashed var(--chrome-hairline);
		border-radius: 5px;
		color: var(--chrome-muted);
		cursor: pointer;
		display: inline-flex;
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
		justify-content: center;
		line-height: 1;
		min-block-size: 24px;
		padding-block: 0;
		padding-inline: 10px;
		transition:
			border-color 120ms ease,
			color 120ms ease;
	}

	.inspector :global(.ins-add:hover:not(:disabled)) {
		border-color: #3a3a40;
		color: var(--chrome-text);
	}

	.inspector :global(.ins-add:focus-visible) {
		border-color: #ffd608;
		outline: none;
	}

	.inspector :global(.ins-add:disabled) {
		color: var(--chrome-muted);
		cursor: default;
		opacity: 0.6;
	}

	/* Unit suffix beside a value input (s / ms / derived seconds). */
	.inspector :global(.ins-unit) {
		color: var(--chrome-muted);
		flex: none;
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		white-space: nowrap;
	}

	/* Graffiti's `.row` (used by the per-type content editors) defaults to a
	   stacked, roomy form layout. Pull it onto the same label-left, dense grid as
	   the shared Field so content editors read as one system. (Field-level curation
	   of those editors is a separate pass.) */
	.inspector :global(.row) {
		align-items: center;
		column-gap: var(--vs-s);
		display: grid;
		grid-template-columns: var(--ins-label-w, 5.5rem) minmax(0, 1fr);
		margin: 0;
	}

	.inspector :global(.row > span) {
		color: var(--chrome-muted);
		font-family: Archivo, sans-serif;
		font-size: 0.71875rem;
	}

	.generic-label {
		align-items: flex-start;
		display: flex;
		flex-direction: column;
		gap: var(--vs-s);
		padding: var(--vs-base);
	}

	.generic-label__id {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.75rem;
	}

	.generic-label__back {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0;
	}

	.generic-label__back:hover {
		color: var(--chrome-text);
	}
</style>
