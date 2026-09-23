<script lang="ts">
	import { invalidateCompositionAutosave } from './composition-autosave-invalidation.svelte.ts';
	import {
		engineState,
		removeCaptions,
		removeBlock,
		removeOverlay,
		removeTextAnimation
	} from './engine-state.svelte';
	import { compositionEditHistory } from './composition-edit-history';
	import { runRemoveCompositionKineticWordOperation } from './composition-kinetic-type-operations';
	import { deselectLayer, layerSelection, selectLayer } from './selection.svelte';
	import { lockedLaneIds, toggleLaneLock } from './timeline-lane-locks.svelte';
	import { parseTimelineTrackId, type TimelineTrackId } from './timeline-entity-identity';
	import type { TimelineTrack } from './timeline-track';

	// One gutter row: the layer's color dot + label, selection rail, and the
	// hover remove button for removable layer kinds.
	interface Props {
		track: TimelineTrack;
	}

	let { track }: Props = $props();

	// Top-level lanes sit flush against their kind tick; only rows that belong
	// to another lane (beat sub-rows, content items, slot animations) indent.
	function gutterIndent(trackId: TimelineTrackId): number {
		const identity = parseTimelineTrackId(trackId);
		if (identity?.kind === 'overlay-subtrack' || identity?.kind === 'block-subtrack') return 1;
		if (
			identity?.kind === 'surface-message' ||
			identity?.kind === 'checklist-item' ||
			identity?.kind === 'text-animation'
		) {
			return 1;
		}
		return 0;
	}

	// The lane head's kind word — which Layer family this row belongs to. Beat
	// sub-rows stay single-line (their ↳ label already states the relationship).
	const KIND_LABELS: Record<string, string> = {
		surface: 'Surface',
		'surface-message': 'Message',
		'checklist-item': 'Item',
		captions: 'Captions',
		mark: 'Mark',
		'text-animation': 'Text anim',
		block: 'Block',
		overlay: 'Overlay',
		sound: 'Cues',
		video: 'Video',
		'stage-camera': 'Stage',
		'stage-focus': 'Stage',
		'stage-body': 'Body'
	};

	function gutterKindLabel(trackId: TimelineTrackId): string | null {
		const identity = parseTimelineTrackId(trackId);
		if (!identity) return null;
		return KIND_LABELS[identity.kind] ?? null;
	}

	function canRemoveTrack(trackId: TimelineTrackId): boolean {
		const identity = parseTimelineTrackId(trackId);
		return (
			identity?.kind === 'overlay' ||
			identity?.kind === 'block' ||
			identity?.kind === 'captions' ||
			identity?.kind === 'text-animation'
		);
	}

	async function handleRemoveTrack(trackId: TimelineTrackId): Promise<void> {
		const identity = parseTimelineTrackId(trackId);
		if (identity?.kind === 'overlay') {
			removeOverlay(identity.overlayId);
		} else if (identity?.kind === 'block') {
			const isKineticWord = engineState.surface.typeField?.words.some(
				(word) => word.id === identity.blockId
			);
			if (isKineticWord) {
				const outcome = await runRemoveCompositionKineticWordOperation({
					expectedRevision: compositionEditHistory.revision,
					wordId: identity.blockId
				});
				if (outcome.status === 'failed') return;
			} else {
				removeBlock(identity.blockId);
			}
		} else if (identity?.kind === 'captions') {
			removeCaptions();
		} else if (identity?.kind === 'text-animation') {
			removeTextAnimation(identity.textAnimationId);
		}
		if (canRemoveTrack(trackId)) invalidateCompositionAutosave();
		deselectLayer();
		queueMicrotask(() => {
			document.querySelector<HTMLButtonElement>('[aria-label="Add layer"]')?.focus();
		});
	}

	function handleRowKeydown(event: KeyboardEvent): void {
		if ((event.target as HTMLElement).closest('button, input, select, textarea')) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selectLayer(track.id);
			return;
		}
		if ((event.key === 'Delete' || event.key === 'Backspace') && canRemoveTrack(track.id)) {
			event.preventDefault();
			event.stopPropagation();
			handleRemoveTrack(track.id);
		}
	}
</script>

<div
	class="gutter__row"
	class:gutter__row--selected={layerSelection.id === track.id}
	style:--indent={gutterIndent(track.id)}
	style:--row-color={track.color ?? 'var(--chrome-muted)'}
	role="button"
	tabindex="0"
	onclick={() => selectLayer(track.id)}
	onkeydown={handleRowKeydown}
>
	<span class="gutter__text">
		<span class="gutter__label">{track.label}</span>
		{#if gutterKindLabel(track.id)}
			<span class="gutter__kind">{gutterKindLabel(track.id)}</span>
		{/if}
	</span>
	<button
		class="gutter__lock"
		class:is-locked={lockedLaneIds.has(track.id)}
		type="button"
		aria-pressed={lockedLaneIds.has(track.id)}
		aria-label="Lock {track.label} lane"
		onclick={(e) => {
			e.stopPropagation();
			toggleLaneLock(track.id);
		}}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="9"
			height="9"
			viewBox="0 0 16 16"
			aria-hidden="true"
		>
			<rect x="3" y="7" width="10" height="6.5" rx="1.5" fill="currentColor" />
			<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.6" />
		</svg>
	</button>
	{#if canRemoveTrack(track.id)}
		<button
			class="gutter__remove"
			type="button"
			aria-label="Remove {track.label}"
			onclick={(e) => {
				e.stopPropagation();
				handleRemoveTrack(track.id);
			}}>×</button
		>
	{/if}
</div>

<style>
	/* Lane head: a flat deck row with a kind-colored tick on the left edge tying
	   it to its lane bars; selection reads in the transport cyan (the selection
	   hue everywhere in the timeline). */
	.gutter__row {
		align-items: center;
		background: var(--chrome-deck, #131315);
		block-size: var(--lane-row-h, 36px);
		border-block-end: 1px solid var(--lane-hairline, #1a1a1e);
		border-inline-start: 3px solid var(--row-color, var(--chrome-muted));
		cursor: pointer;
		display: flex;
		gap: 8px;
		padding-inline-end: 10px;
		padding-inline-start: calc(8px + calc(var(--indent, 0) * 12px));
		transition: background 100ms ease;
		user-select: none;
	}

	.gutter__row:hover {
		background: color-mix(in srgb, #ffffff 3%, var(--chrome-deck, #131315));
	}

	.gutter__row--selected {
		background: color-mix(in srgb, #2de8ee 12%, var(--chrome-deck, #131315));
	}

	.gutter__text {
		display: grid;
		flex: 1 1 auto;
		gap: 1px;
		min-inline-size: 0;
	}

	.gutter__label {
		color: var(--chrome-text);
		font-size: 0.71875rem;
		font-weight: 550;
		line-height: 1.15;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.gutter__kind {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.5rem;
		font-weight: 400;
		letter-spacing: 0.12em;
		line-height: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.gutter__row--selected .gutter__label {
		color: var(--chrome-text);
	}

	/* The head's right-side control: session lane lock — a locked lane still
	   selects, but refuses clip / keyframe / video drags. */
	.gutter__lock {
		align-items: center;
		background: transparent;
		block-size: 16px;
		border: 1px solid var(--chrome-hairline, #26262a);
		border-radius: 4px;
		color: var(--chrome-muted);
		cursor: pointer;
		display: flex;
		flex-shrink: 0;
		inline-size: 16px;
		justify-content: center;
		margin-inline-start: auto;
		opacity: 0;
		padding: 0;
		transition:
			color 100ms ease,
			opacity 100ms ease;
	}

	.gutter__row:hover .gutter__lock,
	.gutter__row--selected .gutter__lock,
	.gutter__lock.is-locked,
	.gutter__lock:focus-visible {
		opacity: 1;
	}

	.gutter__lock:hover {
		color: var(--chrome-text);
	}

	.gutter__lock.is-locked {
		background: var(--chrome-raised);
		border-color: var(--chrome-muted);
		color: var(--chrome-text);
	}

	.gutter__lock:focus-visible {
		border-color: #ffd608;
		outline: none;
	}

	.gutter__remove {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex-shrink: 0;
		font-size: 0.9rem;
		line-height: 1;
		opacity: 0;
		padding: 0 2px;
		transition:
			color 100ms ease,
			opacity 100ms ease;
	}

	.gutter__row:hover .gutter__remove,
	.gutter__row--selected .gutter__remove {
		opacity: 1;
	}

	.gutter__remove:hover {
		color: #e6322a;
	}
</style>
