<script lang="ts">
	import { resolve } from '$app/paths';

	import type { SurfaceType } from '$lib/platform/engine-schema';
	import PosterThumb from './PosterThumb.svelte';

	interface Props {
		slug: string;
		// URL of this composition's own poster, passed ONLY when the caller knows
		// it exists (`./PosterThumb.svelte`).
		thumbSrc: string | null;
		name: string;
		type: SurfaceType;
		badge: string | null;
		/** Family / surface chip under the name (e.g. "Checklist", "Social beats"). */
		kindLabel: string;
		/** Composition run length; null while a user composition is still resolving. */
		durationSeconds: number | null;
		/** Deliverables reflow 16:9 ↔ 9:16 by doctrine — fixtures don't claim it. */
		reflow: boolean;
		/** Grid-wide preview aspect from the toolrow toggle. */
		aspect: 'wide' | 'tall';
		/**
		 * Makes the card a button that chooses this composition, named for it,
		 * instead of a link that opens it: the Workspace's Scene picker.
		 */
		onchoose?: () => void;
	}

	let {
		slug,
		thumbSrc,
		name,
		type,
		badge,
		kindLabel,
		durationSeconds,
		reflow,
		aspect,
		onchoose
	}: Props = $props();
</script>

{#snippet cardContent()}
	<PosterThumb {thumbSrc} {type} {aspect} />
	<span class="poster-card__body">
		<span class="poster-card__name">{name}</span>
		<span class="poster-card__meta">
			<span class="poster-card__kind">{kindLabel}</span>
			{#if badge}
				<span class="poster-card__badge">{badge}</span>
			{/if}
			{#if reflow}
				<span
					class="poster-card__reflow"
					title="Reflows 16:9 ↔ 9:16"
					aria-label="Reflows 16:9 and 9:16">▭▯</span
				>
			{/if}
			{#if durationSeconds !== null}
				<span class="poster-card__duration">{durationSeconds.toFixed(1)} s</span>
			{/if}
		</span>
	</span>
{/snippet}

{#if onchoose}
	<button class="poster-card" type="button" aria-label={name} onclick={onchoose}>
		{@render cardContent()}
	</button>
{:else}
	<a class="poster-card" href={resolve('/p/[slug]', { slug })}>
		{@render cardContent()}
	</a>
{/if}

<style>
	/* Palette rides the page-level spec-ladder custom properties (DESIGN.md);
	   fallbacks keep the card correct if rendered outside .home. */
	.poster-card {
		background: var(--panel, #131315);
		font-size: 1rem;
		border-top: 1px solid var(--line, #26262a);
		border-radius: 7px;
		color: var(--text, #e8e8ea);
		display: grid;
		grid-template-rows: auto 1fr;
		overflow: hidden;
		text-decoration: none;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}

	/* The same card as a button: the link's box, without the control chrome. */
	button.poster-card {
		appearance: none;
		background-image: none;
		border-inline: 0;
		border-block-end: 0;
		box-shadow: none;
		cursor: pointer;
		font: inherit;
		font-size: 1rem;
		inline-size: 100%;
		padding: 0;
		text-align: start;
		text-shadow: none;
	}

	.poster-card:hover {
		background: var(--raised, #1a1a1d);
		border-color: #aaa;
	}

	.poster-card:focus-visible {
		border-color: var(--selection, #ffd608);
		outline: 2px solid var(--selection, #ffd608);
		outline-offset: 3px;
	}

	.poster-card__body {
		align-content: start;
		border-block-start: 1px solid var(--line, #26262a);
		display: grid;
		gap: 0.32rem;
		min-inline-size: 0;
		padding: 0.6rem 0.7rem 0.65rem;
	}

	.poster-card__name {
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		color: var(--text, #e8e8ea);
		display: -webkit-box;
		font-family: Archivo, sans-serif;
		font-size: 0.78125rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		line-height: 1.28;
		overflow: hidden;
	}

	.poster-card__meta {
		align-items: center;
		display: flex;
		flex-wrap: nowrap;
		gap: 0.42rem;
		min-inline-size: 0;
	}

	.poster-card__kind {
		border: 1px solid var(--line, #26262a);
		border-radius: 4px;
		color: var(--muted, #8a8a90);
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-weight: 400;
		letter-spacing: 0.06em;
		overflow: hidden;
		padding: 1px 6px;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.poster-card__badge {
		background: var(--ink, #0c0c0e);
		border: 1px solid var(--line, #26262a);
		border-radius: 4px;
		color: var(--text, #e8e8ea);
		flex-shrink: 0;
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-weight: 400;
		letter-spacing: 0.02em;
		padding: 0.12em 0.5em;
		white-space: nowrap;
	}

	.poster-card__reflow {
		color: var(--muted, #8a8a90);
		flex-shrink: 0;
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		letter-spacing: 0.1em;
	}

	.poster-card__duration {
		color: var(--muted, #8a8a90);
		flex-shrink: 0;
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-variant-numeric: tabular-nums;
		font-weight: 400;
		margin-inline-start: auto;
		white-space: nowrap;
	}
</style>
