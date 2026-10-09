<script lang="ts">
	import { compositionEditHistory } from './composition-edit-history';
	import { compositionMeta } from './composition-meta.svelte';
	import { describeCompositionOperationFailure } from './composition-operation-preflight';
	import { runAddCompositionSceneFromStarterOperation } from './composition-scene-operations';
	import {
		libraryPresetCompositorBadge,
		libraryPresetFamilyLabel,
		type LibraryPresetCard
	} from './library-preset-card';
	import { buildLibraryPresetCard } from './library-preset-card-builder';
	import PosterCard from './PosterCard.svelte';
	import { listPresets } from './preset-catalog';
	import {
		matchesCompositionSearchQuery,
		normalizeCompositionSearchQuery
	} from '$lib/utils/composition-search';

	// The Scene strip's `+` (ADR-0068 §10): the Starters as the home library
	// shows them — the same poster cards, the same search matching — in a
	// top-layer popover anchored above the trigger. Choosing one runs
	// `composition.add-scene-from-starter` and closes the picker. Only the
	// deliverable corpus is listed; a fixture is not a Starter.

	// Built on first open: each card hashes its Preset for the poster lookup,
	// which a Workspace that never adds a Scene has no reason to pay for.
	let starterCards = $state.raw<readonly LibraryPresetCard[]>([]);
	let query = $state('');
	let pickerEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let searchEl = $state<HTMLInputElement | null>(null);

	const visibleStarterCards = $derived.by(() => {
		const normalizedQuery = normalizeCompositionSearchQuery(query);
		return starterCards.filter((card) =>
			matchesCompositionSearchQuery(normalizedQuery, card.name, card.slug)
		);
	});

	// The strip sits at the bottom of the window, so the picker opens upward:
	// its end edge on the trigger's, its foot just above the strip.
	function positionPicker(): void {
		if (!pickerEl || !triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		pickerEl.style.right = `${window.innerWidth - rect.right}px`;
		pickerEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
	}

	function onPickerToggle(event: ToggleEvent): void {
		if (event.newState !== 'open') return;
		query = '';
		if (starterCards.length === 0) {
			starterCards = listPresets()
				.map(buildLibraryPresetCard)
				.toSorted((a, b) => a.name.localeCompare(b.name));
		}
		positionPicker();
		searchEl?.focus();
	}

	async function chooseStarter(starterSlug: string): Promise<void> {
		const outcome = await runAddCompositionSceneFromStarterOperation({
			expectedRevision: compositionEditHistory.revision,
			starterSlug
		});
		if (outcome.status === 'applied') {
			pickerEl?.hidePopover();
		} else {
			compositionMeta.persistenceError = describeCompositionOperationFailure(outcome);
		}
	}
</script>

<button
	class="scene-picker__trigger"
	type="button"
	popovertarget="film-scene-starter-picker"
	aria-label="Add Scene"
	bind:this={triggerEl}
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
</button>
<div
	class="scene-picker"
	id="film-scene-starter-picker"
	popover
	bind:this={pickerEl}
	ontoggle={onPickerToggle}
>
	<input
		class="scene-picker__search"
		type="search"
		aria-label="Search Starters"
		placeholder="Search {starterCards.length} Starters…"
		bind:value={query}
		bind:this={searchEl}
	/>
	<ul class="scene-picker__grid">
		{#each visibleStarterCards as card (card.slug)}
			<li>
				<PosterCard
					slug={card.slug}
					thumbSrc={card.posterUrl}
					name={card.name}
					type={card.surfaceType}
					badge={libraryPresetCompositorBadge(card)}
					kindLabel={libraryPresetFamilyLabel(card)}
					durationSeconds={card.durationSeconds}
					reflow={true}
					aspect="wide"
					onchoose={() => chooseStarter(card.slug)}
				/>
			</li>
		{/each}
	</ul>
</div>

<style>
	/* The strip's end cap: the Timeline's add control, at the strip's height. */
	.scene-picker__trigger {
		align-items: center;
		background: transparent;
		border: 0;
		border-inline-start: 1px solid var(--chrome-hairline);
		color: var(--chrome-muted);
		cursor: pointer;
		display: flex;
		flex-shrink: 0;
		inline-size: 30px;
		justify-content: center;
		padding: 0;
		transition: color 100ms ease;
	}

	.scene-picker__trigger:hover {
		color: var(--chrome-text);
	}

	.scene-picker__trigger:focus-visible {
		outline: 2px solid #ffd608;
		outline-offset: -2px;
	}

	/* Top-layer picker — the add menu's popover treatment at library size.
	   Layout display lives on :popover-open ONLY: an unconditional author
	   `display` overrides the UA's closed-popover display:none and leaves an
	   invisible click-eating overlay at the popover's static position. */
	.scene-picker {
		background: var(--chrome-raised);
		block-size: min(34rem, 100dvh - 9rem);
		border: 1px solid var(--chrome-hairline);
		border-radius: var(--br-s);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
		flex-direction: column;
		gap: var(--vs-s);
		inline-size: min(62rem, 100vw - 2rem);
		inset: auto;
		margin: 0;
		opacity: 1;
		padding: var(--vs-s);
		position: fixed;
		transform: translateY(0) scale(1);
		transform-origin: bottom right;
		transition:
			opacity 120ms ease,
			transform 160ms var(--ease-smooth),
			overlay 160ms allow-discrete,
			display 160ms allow-discrete;
	}

	.scene-picker:popover-open {
		display: flex;
	}

	.scene-picker:not(:popover-open) {
		opacity: 0;
		transform: translateY(6px) scale(0.97);
	}

	@starting-style {
		.scene-picker:popover-open {
			opacity: 0;
			transform: translateY(6px) scale(0.97);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.scene-picker {
			transition-duration: 1ms;
		}
	}

	/* The home library's search field, on the Workspace ladder. */
	.scene-picker__search {
		appearance: none;
		background: var(--chrome-well);
		block-size: 2rem;
		border: 1px solid var(--chrome-hairline);
		border-radius: 6px;
		color: var(--chrome-text);
		flex-shrink: 0;
		font-family: Archivo, sans-serif;
		font-size: 0.78125rem;
		outline: none;
		padding-block: 0;
		padding-inline: 0.625rem;
		transition: border-color 120ms ease;
	}

	.scene-picker__search:focus-visible {
		border-color: #ffd608;
	}

	.scene-picker__search::placeholder {
		color: var(--chrome-muted);
	}

	/* The home library's grid, scrolling inside the picker. */
	.scene-picker__grid {
		align-content: start;
		display: grid;
		flex: 1;
		gap: 5px;
		grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
		list-style: none;
		margin: 0;
		min-block-size: 0;
		overflow-y: auto;
		padding: 0;
	}

	.scene-picker__grid > li {
		min-inline-size: 0;
	}
</style>
