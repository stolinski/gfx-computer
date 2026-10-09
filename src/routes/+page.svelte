<script lang="ts">
	import { onMount } from 'svelte';

	import { GFX_PRODUCT_NAME } from '$lib/identity/gfx-brand';
	import type { CompositionValidationFinding } from '$lib/platform/composition-validation-findings';
	import { posterUrl } from '$lib/platform/posters';
	import type { UserCompositionMeta } from '$lib/platform/user-composition-store';
	import gfxLogotype from '$lib/assets/identity/gfx-logotype.svg';
	import gfxMark from '$lib/assets/identity/gfx-mark.svg';
	import PosterCard from './PosterCard.svelte';
	import { SURFACE_LABELS } from './surface-labels';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type HomepagePresetCard = PageProps['data']['presets'][number];
	/** The fields a session composition's card renders; the store types the rest. */
	type UserCompositionCardMeta = Pick<
		UserCompositionMeta,
		'slug' | 'name' | 'forkedFrom' | 'savedAt' | 'posterKey' | 'durationSeconds' | 'surfaceType'
	>;

	// User-composition posters that actually exist (server load reads the
	// store) — their cards get a thumbSrc only for these, so nothing probes a
	// not-yet-captured poster. Library cards carry their committed poster URL
	// from the load itself (ADR-0061).
	const posterKeys = $derived(new Set(data.posterKeys));

	// Which compositor a Preset drives, resolved the same way Workspace does:
	// `state.stage` → the dimensional depth stage (real WebGPU 3D, ADR-0028);
	// a `depth-of-field` Effect → the flat multiplane DOF (2.5D, ADR-0027);
	// otherwise the plain flat composite. Only the non-default (3D / 2.5D) ones
	// get a badge so they're discoverable — flat is the unmarked default.
	function compositorBadge(entry: HomepagePresetCard): string | null {
		if (entry.hasDepthStage) return '3D depth stage';
		if (entry.hasDepthOfField) return '2.5D multiplane DOF';
		return null;
	}

	const presets = $derived(data.presets);
	const fixtures = $derived(data.fixtures);
	const presetCardsBySlug = $derived(
		new Map([...presets, ...fixtures].map((entry) => [entry.slug, entry]))
	);

	// Content families cut across the generic `plain` Surface. Charts are a semantic
	// family — every Chart Block and Figure declaration — grouped without slug heuristics;
	// legacy content families still use prefixes before falling back to Surface type.
	const TEMPLATE_FAMILIES: readonly { label: string; prefixes: readonly string[] }[] = [
		{ label: 'Captions', prefixes: ['captions-'] },
		{ label: 'Flowcharts', prefixes: ['docu-flowchart', 'wake-conversation-flow'] },
		{ label: 'Docu', prefixes: ['docu-'] },
		{ label: 'Lower thirds', prefixes: ['lower-third'] },
		{ label: 'Social beats', prefixes: ['youtube-', 'instagram-'] },
		{ label: 'Title cards', prefixes: ['title-card-'] }
	];

	function templateGroupLabel(entry: HomepagePresetCard): string {
		if (entry.hasChart) return 'Charts';
		const family = TEMPLATE_FAMILIES.find((candidate) =>
			candidate.prefixes.some((prefix) => entry.slug.startsWith(prefix))
		);
		return family ? family.label : SURFACE_LABELS[entry.surfaceType];
	}

	const templateGroups = $derived.by(() => {
		const byLabel: Record<string, HomepagePresetCard[]> = {};
		for (const entry of presets) {
			const label = templateGroupLabel(entry);
			(byLabel[label] ??= []).push(entry);
		}
		return Object.entries(byLabel)
			.map(([label, entries]) => ({ label, entries }))
			.sort((a, b) => a.label.localeCompare(b.label));
	});

	let userCompositions = $state<UserCompositionCardMeta[]>([]);
	// Two-step in-place delete: first press arms this slug ("Delete?"), second
	// press commits; pointer-down elsewhere or Escape disarms.
	let confirmingSlug = $state<string | null>(null);
	let isImporting = $state(false);
	/**
	 * What an import refused over. `document` covers the two answers the operation
	 * never sees — a file that is not JSON at all, and a session store that would
	 * not hold the composition — so one list explains every way an import stops.
	 */
	type ImportIssueSource = CompositionValidationFinding['source'] | 'document';
	interface ImportIssue extends Omit<CompositionValidationFinding, 'source'> {
		source: ImportIssueSource;
	}
	let importIssues = $state.raw<ImportIssue[]>([]);

	// The library reads the same store the editor and every WebMCP operation
	// write, so a composition an agent just created is on this page after a
	// reload — whether that store is this origin's disk or the visitor's own
	// browser (ADR-0053).
	onMount(() => {
		import('$lib/platform/user-composition-store')
			.then(async ({ userCompositionStore }) => {
				userCompositions = await userCompositionStore.listUserCompositions();
			})
			.catch(() => {
				userCompositions = [];
			});
	});

	// ── Rail filter / search / sort / preview aspect ─────────────────────────
	// Rail selection: 'all' | 'user' | 'fixtures' | a template-family label.
	let activeFilter = $state<string>('all');
	let query = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	let sortKey = $state<'name' | 'duration'>('name');
	// The whole grid previews in one aspect; flipping it re-flows every card —
	// the pack-neutral doctrine surfaced at the library level.
	let previewAspect = $state<'wide' | 'tall'>('wide');

	const normalizedQuery = $derived(query.trim().toLowerCase());

	function matchesQuery(name: string, slug: string): boolean {
		if (normalizedQuery === '') return true;
		return (
			name.toLowerCase().includes(normalizedQuery) || slug.toLowerCase().includes(normalizedQuery)
		);
	}

	function sortEntries(entries: readonly HomepagePresetCard[]): HomepagePresetCard[] {
		const copy = [...entries];
		if (sortKey === 'duration') {
			copy.sort((a, b) => a.durationSeconds - b.durationSeconds);
		} else {
			copy.sort((a, b) => a.name.localeCompare(b.name));
		}
		return copy;
	}

	const visibleUserCompositions = $derived.by(() => {
		if (activeFilter !== 'all' && activeFilter !== 'user') return [];
		return userCompositions
			.filter((userComposition) => matchesQuery(userComposition.name, userComposition.slug))
			.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt));
	});

	const visibleTemplateGroups = $derived.by(() => {
		if (activeFilter === 'user' || activeFilter === 'fixtures') return [];
		return templateGroups
			.filter((group) => activeFilter === 'all' || group.label === activeFilter)
			.map((group) => ({
				label: group.label,
				entries: sortEntries(group.entries.filter((entry) => matchesQuery(entry.name, entry.slug)))
			}))
			.filter((group) => group.entries.length > 0);
	});

	// Fixtures stay demoted: they render only from their rail entry, or at the
	// bottom of a live search (searching means "everywhere").
	const visibleFixtures = $derived.by(() => {
		if (activeFilter !== 'fixtures' && !(activeFilter === 'all' && normalizedQuery !== ''))
			return [];
		return sortEntries(fixtures.filter((entry) => matchesQuery(entry.name, entry.slug)));
	});

	const nothingVisible = $derived(
		visibleUserCompositions.length === 0 &&
			visibleTemplateGroups.length === 0 &&
			visibleFixtures.length === 0
	);

	function focusSearchShortcut(event: KeyboardEvent): void {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			searchInput?.focus();
			searchInput?.select();
		}
	}

	function clearSearchOnEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		if (query !== '') {
			query = '';
			event.stopPropagation();
		} else {
			searchInput?.blur();
		}
	}

	function documentImportIssue(message: string): ImportIssue {
		return { source: 'document', rule: null, severity: 'error', path: '', message };
	}

	async function createBlankUserComposition(): Promise<void> {
		importIssues = [];
		const { runCreateBlankCompositionOperation } =
			await import('$lib/platform/composition-lifecycle-operations');
		const outcome = await runCreateBlankCompositionOperation();
		if (outcome.status === 'failed') {
			importIssues = [documentImportIssue(outcome.message), ...outcome.findings.findings];
		}
	}

	/**
	 * Import a standalone composition the visitor picked themselves. The file
	 * input is the whole consent story \u2014 the browser's own picker, opened by their
	 * gesture \u2014 and everything after it is `composition.import-json`, the same
	 * operation an attached agent calls. That shared path is what lets a document
	 * written under the previous namespace's schema id import here too (ADR-0053),
	 * and what keeps the session slug clear of a composition this session holds.
	 */
	async function importPresetJson(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		isImporting = true;
		importIssues = [];
		try {
			let value: unknown;
			try {
				value = JSON.parse(await file.text()) as unknown;
			} catch (cause) {
				importIssues = [
					documentImportIssue(
						`"${file.name}" is not JSON: ${cause instanceof Error ? cause.message : 'it could not be parsed'}.`
					)
				];
				return;
			}

			const { runImportCompositionJsonOperation } =
				await import('$lib/platform/composition-lifecycle-operations');
			const outcome = await runImportCompositionJsonOperation({ document: value });
			if (outcome.status === 'failed') {
				importIssues = [documentImportIssue(outcome.message), ...outcome.findings.findings];
			}
		} catch (cause) {
			importIssues = [
				documentImportIssue(cause instanceof Error ? cause.message : 'Import failed.')
			];
		} finally {
			isImporting = false;
			input.value = '';
		}
	}

	function importIssueKey(issue: ImportIssue): string {
		return `${issue.source}:${issue.rule ?? ''}:${issue.path}:${issue.message}`;
	}

	async function deleteUserComposition(slug: string): Promise<void> {
		if (confirmingSlug !== slug) {
			confirmingSlug = slug;
			return;
		}
		confirmingSlug = null;
		try {
			const { userCompositionStore } = await import('$lib/platform/user-composition-store');
			await userCompositionStore.deleteUserComposition(slug);
			userCompositions = userCompositions.filter(
				(userComposition) => userComposition.slug !== slug
			);
		} catch (error) {
			console.error(`Failed to delete composition "${slug}".`, error);
		}
	}

	function disarmDeleteOnPointerDown(event: PointerEvent): void {
		if (confirmingSlug === null) return;
		if (event.target instanceof Element && event.target.closest('.card__delete')) return;
		confirmingSlug = null;
	}

	function disarmDeleteOnEscape(event: KeyboardEvent): void {
		if (confirmingSlug !== null && event.key === 'Escape') confirmingSlug = null;
	}
</script>

<svelte:window
	onpointerdown={disarmDeleteOnPointerDown}
	onkeydown={(event) => {
		disarmDeleteOnEscape(event);
		focusSearchShortcut(event);
	}}
/>

{#snippet presetCard(entry: HomepagePresetCard, groupLabel: string)}
	<li>
		<PosterCard
			slug={entry.slug}
			thumbSrc={entry.posterUrl}
			name={entry.name}
			type={entry.surfaceType}
			badge={compositorBadge(entry)}
			kindLabel={groupLabel}
			durationSeconds={entry.durationSeconds}
			reflow={entry.kind !== 'fixture'}
			aspect={previewAspect}
		/>
	</li>
{/snippet}

{#snippet userCompositionCard(userComposition: UserCompositionCardMeta)}
	{@const starterTemplate = userComposition.forkedFrom
		? (presetCardsBySlug.get(userComposition.forkedFrom) ?? null)
		: null}
	<li class="card-cell">
		<PosterCard
			slug={userComposition.slug}
			thumbSrc={userComposition.posterKey !== null && posterKeys.has(userComposition.posterKey)
				? posterUrl(userComposition.posterKey)
				: null}
			name={userComposition.name}
			type={userComposition.surfaceType}
			badge={starterTemplate ? compositorBadge(starterTemplate) : null}
			kindLabel={SURFACE_LABELS[userComposition.surfaceType]}
			durationSeconds={userComposition.durationSeconds}
			reflow={true}
			aspect={previewAspect}
		/>
		<button
			class="card__delete"
			class:is-confirming={confirmingSlug === userComposition.slug}
			type="button"
			aria-label={confirmingSlug === userComposition.slug
				? `Confirm delete ${userComposition.name}`
				: `Delete ${userComposition.name}`}
			onclick={() => deleteUserComposition(userComposition.slug)}
		>
			{#if confirmingSlug === userComposition.slug}
				Delete?
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="14"
					height="14"
					viewBox="0 0 16 16"
					aria-hidden="true"
				>
					<path
						d="M2 4h12M6 4V2h4v2M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4"
						stroke="currentColor"
						stroke-width="1.5"
						fill="none"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{/if}
		</button>
	</li>
{/snippet}

{#snippet sectionHeader(label: string, count: number, withControls: boolean)}
	<div class="home__sectionhead">
		<h3 class="home__subheading">{label} · {count}</h3>
		<span class="home__rule" aria-hidden="true"></span>
		{#if withControls}
			<label class="toolrow__sort">
				Sort ·
				<select bind:value={sortKey}>
					<option value="name">Name</option>
					<option value="duration">Duration</option>
				</select>
			</label>
			<div class="toolrow__aspect" role="group" aria-label="Preview aspect">
				<button
					type="button"
					aria-pressed={previewAspect === 'wide'}
					onclick={() => (previewAspect = 'wide')}
				>
					▭ 16:9
				</button>
				<button
					type="button"
					aria-pressed={previewAspect === 'tall'}
					onclick={() => (previewAspect = 'tall')}
				>
					▯ 9:16
				</button>
			</div>
		{/if}
	</div>
{/snippet}

<svelte:head>
	<title>{GFX_PRODUCT_NAME}</title>
</svelte:head>

<main class="home">
	<header class="topbar">
		<!-- The masthead lockup: mark, then logotype, on one baseline
		     (docs/identity/README.md). The logotype carries the accessible name, so
		     the mark beside it is decorative. -->
		<div class="topbar__brand">
			<img class="topbar__mark" src={gfxMark} alt="" width="22" height="22" />
			<h1 class="topbar__logotype">
				<img src={gfxLogotype} alt={GFX_PRODUCT_NAME} width="38" height="15" />
			</h1>
		</div>
		<div class="topbar__search">
			<svg
				class="topbar__search-glyph"
				xmlns="http://www.w3.org/2000/svg"
				width="13"
				height="13"
				viewBox="0 0 16 16"
				aria-hidden="true"
			>
				<circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none" />
				<path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
			<input
				bind:this={searchInput}
				bind:value={query}
				type="search"
				placeholder="Search {presets.length +
					fixtures.length +
					userCompositions.length} compositions…"
				aria-label="Search compositions"
				onkeydown={clearSearchOnEscape}
			/>
			<kbd class="topbar__search-hint">⌘K</kbd>
		</div>
		<div class="topbar__actions">
			<label class="topbar__action topbar__import">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="13"
					height="13"
					viewBox="0 0 16 16"
					aria-hidden="true"
				>
					<path
						d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10"
						stroke="currentColor"
						stroke-width="1.5"
						fill="none"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				{isImporting ? 'Importing…' : 'Import JSON'}
				<input
					type="file"
					name="preset-json"
					accept="application/json,.json"
					disabled={isImporting}
					onchange={importPresetJson}
				/>
			</label>
			<button
				class="topbar__action topbar__action--primary"
				type="button"
				onclick={createBlankUserComposition}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="13"
					height="13"
					viewBox="0 0 16 16"
					aria-hidden="true"
				>
					<path
						d="M8 3v10M3 8h10"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
					/>
				</svg>
				New composition
			</button>
		</div>
	</header>

	{#if importIssues.length > 0}
		<ul class="home__import-issues" aria-label="Import issues" aria-live="polite">
			{#each importIssues as issue (importIssueKey(issue))}
				<li class:warning={issue.severity === 'warn'}>
					<span>{issue.source}{issue.rule ? ` / ${issue.rule}` : ''}</span>
					{#if issue.path}<code>{issue.path}</code>{/if}
					{issue.message}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="home__split">
		<nav class="rail" aria-label="Filter compositions">
			<div class="rail__body">
				<button
					class="rail__item"
					class:is-active={activeFilter === 'all'}
					type="button"
					onclick={() => (activeFilter = 'all')}
				>
					<span>All</span>
					<span class="rail__count">{presets.length + userCompositions.length}</span>
				</button>
				<button
					class="rail__item"
					class:is-active={activeFilter === 'user'}
					type="button"
					onclick={() => (activeFilter = 'user')}
				>
					<span>Your compositions</span>
					<span class="rail__count">{userCompositions.length}</span>
				</button>
				<hr class="rail__rule" />
				<p class="rail__label">Library</p>
				{#each templateGroups as group (group.label)}
					<button
						class="rail__item"
						class:is-active={activeFilter === group.label}
						type="button"
						onclick={() => (activeFilter = group.label)}
					>
						<span>{group.label}</span>
						<span class="rail__count">{group.entries.length}</span>
					</button>
				{/each}
				{#if fixtures.length > 0}
					<hr class="rail__rule" />
					<button
						class="rail__item rail__item--dim"
						class:is-active={activeFilter === 'fixtures'}
						type="button"
						onclick={() => (activeFilter = 'fixtures')}
					>
						<span>Demos &amp; fixtures</span>
						<span class="rail__count">{fixtures.length}</span>
					</button>
				{/if}
			</div>
		</nav>

		<div class="home__main">
			{#if visibleUserCompositions.length > 0}
				<section class="home__section" aria-label="Your compositions">
					{@render sectionHeader('Your compositions', visibleUserCompositions.length, true)}
					<ul class="home__grid home__grid--wide" class:is-tall={previewAspect === 'tall'}>
						{#each visibleUserCompositions as userComposition (userComposition.slug)}
							{@render userCompositionCard(userComposition)}
						{/each}
					</ul>
				</section>
			{/if}

			{#each visibleTemplateGroups as group, groupIndex (group.label)}
				<section class="home__section" aria-label={group.label}>
					{@render sectionHeader(
						group.label,
						group.entries.length,
						visibleUserCompositions.length === 0 && groupIndex === 0
					)}
					<ul class="home__grid" class:is-tall={previewAspect === 'tall'}>
						{#each group.entries as entry (entry.slug)}
							{@render presetCard(entry, group.label)}
						{/each}
					</ul>
				</section>
			{/each}

			{#if visibleFixtures.length > 0}
				<section class="home__section" aria-label="Demos and fixtures">
					{@render sectionHeader(
						'Demos & fixtures',
						visibleFixtures.length,
						visibleUserCompositions.length === 0 && visibleTemplateGroups.length === 0
					)}
					<ul class="home__grid" class:is-tall={previewAspect === 'tall'}>
						{#each visibleFixtures as entry (entry.slug)}
							{@render presetCard(entry, templateGroupLabel(entry))}
						{/each}
					</ul>
				</section>
			{/if}

			{#if nothingVisible}
				<p class="home__empty">No matches.</p>
			{/if}
		</div>
	</div>
</main>

<style>
	/* The DESIGN.md neutral ladder + signal lights, scoped to the home deck.
	   PosterCard reads these same properties by inheritance. */
	.home {
		--ink: #0c0c0e;
		--panel: #131315;
		--raised: #1a1a1d;
		--line: #26262a;
		--text: #e8e8ea;
		--muted: #8a8a90;
		--selection: #ffd608;
		--danger-text: #f0453d;
		/* Same 52px the editor's topbar stands at — see `.topbar` below. The rail
		   sticks under it, so the height is written once here. */
		--chrome-bar-h: 52px;
		background: var(--ink);
		color: var(--text);
		display: flex;
		flex-direction: column;
		min-block-size: 100svh;
	}

	/* Graffiti's raised-button chrome (gradient fill, 8px radius, inset bevel +
	   drop shadow, 560 weight) must not bleed into the flat deck. :where keeps
	   this reset's specificity at the element tier: it outranks Graffiti's bare
	   `button` by cascade order while every component rule still wins over it,
	   so intended radii/shadows re-add cleanly. */
	:where(.home) :global(:where(button, select, input)) {
		background-image: none;
		border-radius: 0;
		box-shadow: none;
		font-weight: inherit;
		text-shadow: none;
	}

	/* ── Top bar ─────────────────────────────────────────────────────────── */
	/* Height and inline inset match `.workspace__topbar` (Workspace.svelte) on
	   purpose: the mark is the same 22px artwork on both routes, so it has to
	   land on the same pixel when you open a composition. The editor's 52px bar
	   sets the mark 15px in — 12px of bar padding plus the 3px its 28px home-link
	   slot adds — and the brand here centres to the same point. Change one bar's
	   height or inset and the mark visibly jumps on navigation. */
	.topbar {
		align-items: center;
		background: var(--panel);
		border-block-end: 1px solid var(--line);
		display: flex;
		gap: 1.25rem;
		inset-block-start: 0;
		min-block-size: var(--chrome-bar-h);
		padding-inline: 15px 1rem;
		position: sticky;
		z-index: 20;
	}

	.topbar__brand {
		align-items: center;
		display: flex;
		flex-shrink: 0;
		gap: 0.625rem;
	}

	/* Drawn geometry at its proven sizes: the mark holds down to 16px, the
	   logotype down to a 15px cap. Neither is ever re-typeset or re-spaced. */
	.topbar__mark {
		block-size: 1.375rem;
		inline-size: 1.375rem;
	}

	.topbar__logotype {
		display: flex;
		margin: 0;
	}

	.topbar__logotype img {
		block-size: 0.9375rem;
	}

	.topbar__search {
		align-items: center;
		background: var(--ink);
		border: 1px solid var(--line);
		block-size: 2rem;
		border-radius: 6px;
		color: var(--muted);
		display: flex;
		flex: 1;
		gap: 0.5rem;
		max-inline-size: 27rem;
		padding-inline: 0.625rem;
		transition: border-color 120ms ease;
	}

	.topbar__search:focus-within {
		border-color: var(--selection);
	}

	.topbar__search-glyph {
		flex-shrink: 0;
	}

	.topbar__search input {
		appearance: none;
		background: none;
		border: none;
		color: var(--text);
		flex: 1;
		font-family: Archivo, sans-serif;
		font-size: 0.78125rem;
		min-inline-size: 0;
		outline: none;
		padding-block: 0;
	}

	.topbar__search input::placeholder {
		color: var(--muted);
	}

	.topbar__search input::-webkit-search-cancel-button {
		display: none;
	}

	.topbar__search-hint {
		border: 1px solid var(--line);
		border-radius: 4px;
		color: var(--muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-weight: 400;
		padding: 2px 5px;
	}

	.topbar__actions {
		align-items: center;
		display: flex;
		flex-shrink: 0;
		gap: 0.45rem;
		margin-inline-start: auto;
	}

	.topbar__action {
		align-items: center;
		background: var(--raised);
		block-size: 2rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--text);
		cursor: pointer;
		display: inline-flex;
		font-family: Archivo, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		gap: 0.4375rem;
		letter-spacing: 0.02em;
		padding: 0 0.8125rem;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}

	.topbar__action:hover {
		background: #202024;
		border-color: #3a3a3e;
	}

	.topbar__action--primary {
		background: var(--selection);
		border-color: var(--selection);
		color: #141200;
	}

	.topbar__action--primary:hover {
		background: #ffe14a;
		border-color: #ffe14a;
	}

	.topbar__action:focus-visible,
	.topbar__import:has(input:focus-visible) {
		border-color: var(--selection);
		outline: 2px solid var(--selection);
		outline-offset: 2px;
	}

	.topbar__import {
		position: relative;
	}

	.topbar__import input {
		cursor: pointer;
		inset: 0;
		opacity: 0;
		position: absolute;
	}

	.topbar__import:has(input:disabled) {
		color: var(--muted);
		cursor: wait;
	}

	.home__import-issues {
		border-block-end: 1px solid var(--line);
		color: var(--danger-text);
		font-family: Archivo, sans-serif;
		font-size: 0.72rem;
		list-style: none;
		margin: 0;
		padding: 0.6rem 1.25rem;
	}

	.home__import-issues li + li {
		margin-block-start: 0.2rem;
	}

	.home__import-issues li.warning {
		color: var(--text);
	}

	.home__import-issues span,
	.home__import-issues code {
		color: var(--muted);
		font: inherit;
		margin-inline-end: 0.4rem;
	}

	/* ── Rail + main split ───────────────────────────────────────────────── */
	.home__split {
		display: grid;
		flex: 1;
		grid-template-columns: 13.25rem minmax(0, 1fr);
	}

	/* The rail shell runs the FULL column height (panel + hairline to the page
	   bottom, like the artifact); the body inside sticks under the top bar and
	   scrolls its own overflow. */
	.rail {
		background: var(--panel);
		border-inline-end: 1px solid var(--line);
	}

	.rail__body {
		display: grid;
		inset-block-start: var(--chrome-bar-h);
		max-block-size: calc(100svh - var(--chrome-bar-h));
		overflow-y: auto;
		padding-block: 0.875rem 1.125rem;
		position: sticky;
	}

	.rail__label {
		color: var(--muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-weight: 400;
		letter-spacing: 0.18em;
		margin: 0;
		padding: 0.5rem 1.125rem 0.375rem;
		text-transform: uppercase;
	}

	.rail__rule {
		border: none;
		border-block-start: 1px solid var(--line);
		margin: 0.625rem 1.125rem;
	}

	.rail__item {
		align-items: center;
		background: none;
		border: none;
		border-inline-start: 2px solid transparent;
		color: var(--text);
		cursor: pointer;
		display: flex;
		font-family: Archivo, sans-serif;
		font-size: 0.78125rem;
		gap: 0.5rem;
		justify-content: space-between;
		padding: 0.375rem 1.125rem 0.375rem 1.125rem;
		text-align: start;
		transition: background 100ms ease;
	}

	.rail__item:hover {
		background: rgb(255 255 255 / 0.03);
	}

	.rail__item.is-active {
		background: color-mix(in srgb, var(--selection) 6%, transparent);
		border-inline-start-color: var(--selection);
		font-weight: 600;
	}

	.rail__item--dim {
		color: var(--muted);
	}

	.rail__item:focus-visible {
		outline: 2px solid var(--selection);
		outline-offset: -2px;
	}

	.rail__count {
		color: var(--muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
	}

	.home__main {
		display: grid;
		gap: 1.4rem;
		min-inline-size: 0;
		padding: 1rem 1.4rem 3rem;
	}

	/* ── Section headers ─────────────────────────────────────────────────── */
	.home__sectionhead {
		align-items: center;
		display: flex;
		gap: 0.9rem;
	}

	.home__rule {
		background: var(--line);
		block-size: 1px;
		flex: 1;
	}

	.toolrow__sort {
		align-items: center;
		color: var(--muted);
		display: flex;
		font-family: Archivo, sans-serif;
		font-size: 0.71875rem;
		gap: 0.375rem;
		white-space: nowrap;
	}

	.toolrow__sort::after {
		content: '▾';
		font-size: 0.6rem;
	}

	.toolrow__sort select {
		appearance: none;
		background: none;
		border: none;
		color: var(--muted);
		block-size: auto;
		cursor: pointer;
		font-family: Archivo, sans-serif;
		font-size: 0.71875rem;
		line-height: 1.15;
		padding: 0;
		transition: color 100ms ease;
	}

	.toolrow__sort:hover select,
	.toolrow__sort:hover {
		color: var(--text);
	}

	.toolrow__sort select:focus-visible {
		outline: 2px solid var(--selection);
		outline-offset: 2px;
	}

	.toolrow__aspect {
		border: 1px solid var(--line);
		border-radius: 3px;
		display: inline-flex;
		overflow: hidden;
	}

	.toolrow__aspect button {
		background: none;
		border: none;
		color: var(--muted);
		cursor: pointer;
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
		padding: 4px 10px;
		transition:
			background 100ms ease,
			color 100ms ease;
	}

	.toolrow__aspect button[aria-pressed='true'] {
		background: var(--raised);
		color: var(--text);
	}

	.toolrow__aspect button:focus-visible {
		outline: 2px solid var(--selection);
		outline-offset: -2px;
	}

	/* ── Sections + grid ─────────────────────────────────────────────────── */
	.home__section {
		display: grid;
		gap: 0.75rem;
	}

	.home__subheading {
		color: var(--muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
		letter-spacing: 0.16em;
		margin: 0;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.home__grid {
		container-type: inline-size;
		display: grid;
		gap: 5px;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.home__grid--wide {
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
	}

	.home__grid.is-tall {
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
	}

	.home__grid > li {
		min-inline-size: 0;
		position: relative;
	}

	.home__empty {
		color: var(--muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		margin: 2.5rem 0;
		text-align: center;
	}

	.card-cell {
		position: relative;
	}

	.card__delete {
		align-items: center;
		background: var(--panel);
		block-size: 1.85rem;
		border: 1px solid var(--line);
		border-radius: 2px;
		color: var(--text);
		cursor: pointer;
		display: flex;
		inline-size: 1.85rem;
		inset-block-start: var(--vs-s);
		inset-inline-end: var(--vs-s);
		justify-content: center;
		opacity: 0;
		padding: 0;
		position: absolute;
		transition:
			border-color 100ms ease,
			color 100ms ease,
			opacity 100ms ease;
		z-index: 3;
	}

	.card-cell:hover .card__delete,
	.card__delete:focus-visible,
	.card__delete.is-confirming {
		opacity: 1;
	}

	.card__delete:hover {
		border-color: #3a3a3e;
		color: var(--danger-text);
	}

	.card__delete.is-confirming {
		background: var(--ink);
		color: var(--danger-text);
		font-family: Archivo, sans-serif;
		font-size: 0.72rem;
		font-weight: 600;
		inline-size: auto;
		letter-spacing: 0.08em;
		padding-inline: 0.55rem;
		text-transform: uppercase;
	}

	.card__delete:focus-visible {
		outline: 2px solid var(--selection);
		outline-offset: 2px;
	}

	@media (hover: none), (pointer: coarse) {
		.card__delete {
			opacity: 1;
		}

		/* Keep the 1.85rem visual; extend the effective touch target past 44px. */
		.card__delete::after {
			content: '';
			inset: -0.5rem;
			position: absolute;
		}
	}

	@media (max-width: 52rem) {
		.topbar {
			flex-wrap: wrap;
			padding-block: 0.6rem;
			position: static;
		}

		.topbar__search {
			order: 3;
		}

		.home__split {
			grid-template-columns: 1fr;
		}

		.rail {
			border-block-end: 1px solid var(--line);
			border-inline-end: none;
		}

		.rail__body {
			display: flex;
			flex-wrap: wrap;
			gap: 0.1rem;
			max-block-size: none;
			padding: 0.6rem 0.8rem;
			position: static;
		}

		.rail__label,
		.rail__rule {
			display: none;
		}

		.rail__item {
			border: 1px solid var(--line);
			border-radius: 999px;
			gap: 0.4rem;
			padding: 0.28rem 0.7rem;
		}

		.rail__item.is-active {
			border-color: var(--selection);
		}
	}
</style>
