<script lang="ts">
	import { page } from '$app/state';

	import {
		runAddOpenCompositionToFilmOperation,
		runCreateFilmFromOpenCompositionOperation,
		type CompositionLifecycleOutcome
	} from './composition-lifecycle-operations';
	import { compositionMeta } from './composition-meta.svelte';
	import { posterUrl } from './posters';
	import PosterThumb from './PosterThumb.svelte';
	import { userCompositionStore, type UserCompositionMeta } from './user-composition-store';

	// The one action an unsaved Starter's page offers (ADR-0068 §3): keep the
	// open document, edits included, as a Film. `New Film` stores it as a Film of
	// its own (`composition.create-film-from-open`); a Film row adds it as that
	// Film's last Scene (`composition.add-open-to-film`). Either way the page
	// then follows the Film.

	// Re-read every open, so a Film made in another tab is listed.
	let films = $state.raw<readonly UserCompositionMeta[]>([]);
	let menuEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);

	// The Film posters the store holds, as the preset route's load listed them:
	// a row asks for its own poster only when one exists, and shows its first
	// Scene's Surface default otherwise, exactly as a home library card does.
	const storedPosterKeys = $derived.by(() => {
		const keys: unknown = page.data['posterKeys'];
		return new Set(
			Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []
		);
	});

	function positionMenu(): void {
		if (!menuEl || !triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		menuEl.style.left = `${rect.left}px`;
		menuEl.style.top = `${rect.bottom + 6}px`;
		menuEl.style.minInlineSize = `${rect.width}px`;
	}

	async function loadFilms(): Promise<void> {
		try {
			films = (await userCompositionStore.listUserCompositions()).toSorted((a, b) =>
				b.savedAt.localeCompare(a.savedAt)
			);
		} catch (error) {
			console.error('Failed to list the Films this session holds', error);
			films = [];
		}
	}

	function onMenuToggle(event: ToggleEvent): void {
		if (event.newState !== 'open') return;
		positionMenu();
		void loadFilms();
	}

	function settle(outcome: CompositionLifecycleOutcome): void {
		if (outcome.status === 'applied') menuEl?.hidePopover();
		else compositionMeta.persistenceError = outcome.message;
	}

	async function createFilm(): Promise<void> {
		settle(await runCreateFilmFromOpenCompositionOperation());
	}

	async function addToFilm(filmSlug: string): Promise<void> {
		settle(await runAddOpenCompositionToFilmOperation({ filmSlug }));
	}
</script>

<button
	class="add-to-film__trigger"
	type="button"
	popovertarget="add-to-film-menu"
	bind:this={triggerEl}>Add to Film</button
>
<div class="add-to-film" id="add-to-film-menu" popover bind:this={menuEl} ontoggle={onMenuToggle}>
	<button class="add-to-film__item" type="button" onclick={createFilm}>New Film</button>
	{#each films as film (film.slug)}
		<button
			class="add-to-film__item add-to-film__item--film"
			type="button"
			onclick={() => addToFilm(film.slug)}
		>
			<PosterThumb
				thumbSrc={film.posterKey !== null && storedPosterKeys.has(film.posterKey)
					? posterUrl(film.posterKey)
					: null}
				type={film.surfaceType}
				aspect="wide"
			/>
			<span class="add-to-film__name">{film.name}</span>
			<span class="add-to-film__count"
				>{film.sceneCount} {film.sceneCount === 1 ? 'Scene' : 'Scenes'}</span
			>
		</button>
	{/each}
</div>

<style>
	/* A lone topbar action carries the frame the orientation pair takes from its
	   group (`.topbar__orientation` in Workspace.svelte). */
	.add-to-film__trigger {
		background: transparent;
		border: 1px solid var(--chrome-hairline);
		border-radius: 6px;
		color: var(--chrome-muted);
		cursor: pointer;
		flex-shrink: 0;
		font-family: 'Paper Mono', monospace;
		font-size: 0.65625rem;
		font-weight: 400;
		padding: 5px 11px;
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.add-to-film__trigger:hover {
		color: var(--chrome-text);
	}

	.add-to-film__trigger:focus-visible {
		outline: 2px solid #ffd608;
		outline-offset: -2px;
	}

	/* Top-layer menu — the Timeline add menu's popover treatment, opening
	   downward from the topbar. Layout display lives on :popover-open ONLY: an
	   unconditional author `display` overrides the UA's closed-popover
	   display:none and leaves an invisible click-eating overlay at the popover's
	   static position. */
	.add-to-film {
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
		transform-origin: top left;
		transition:
			opacity 120ms ease,
			transform 160ms var(--ease-smooth),
			overlay 160ms allow-discrete,
			display 160ms allow-discrete;
	}

	.add-to-film:popover-open {
		display: flex;
	}

	.add-to-film:not(:popover-open) {
		opacity: 0;
		transform: translateY(-6px) scale(0.97);
	}

	@starting-style {
		.add-to-film:popover-open {
			opacity: 0;
			transform: translateY(-6px) scale(0.97);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.add-to-film {
			transition-duration: 1ms;
		}
	}

	.add-to-film__item {
		background: transparent;
		border: 0;
		border-radius: 4px;
		color: var(--chrome-text);
		cursor: pointer;
		flex-shrink: 0;
		font-size: 0.75rem;
		inline-size: 100%;
		padding: 6px var(--vs-s);
		text-align: start;
		transition: background 100ms ease;
		white-space: nowrap;
	}

	.add-to-film__item:hover {
		background: var(--chrome-hairline);
	}

	/* A Film row: its poster still, its name, its Scene count — the backdrop
	   menu's thumbnail row. */
	.add-to-film__item--film {
		align-items: center;
		display: grid;
		gap: var(--vs-s);
		grid-template-columns: 56px minmax(0, 1fr) auto;
	}

	.add-to-film__name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.add-to-film__count {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-variant-numeric: tabular-nums;
	}
</style>
