<script lang="ts">
	import Toc from '$lib/components/Toc.svelte';
	import PresetLoops from '$lib/components/PresetLoops.svelte';

	let { data } = $props();

	const doc = $derived(data.doc);
</script>

<svelte:head>
	<title>{doc.meta.title} · GFX docs</title>
</svelte:head>

<main>
	<article>
		<p class="kicker">
			{#if doc.meta.section}<span class="section">{doc.meta.section}</span>{/if}
			<span class="source">docs/{doc.meta.file}</span>
		</p>
		<div class="prose">
			<!-- eslint-disable-next-line svelte/no-at-html-tags — HTML is rendered from the repo's own markdown -->
			{@html doc.html}
		</div>
		{#if doc.meta.file === 'README.md'}
			<PresetLoops />
		{/if}
		<footer>
			{#if doc.prev}
				<a class="adjacent prev" href={doc.prev.href}>
					<span>Previous</span>
					{doc.prev.title}
				</a>
			{:else}
				<span></span>
			{/if}
			{#if doc.next}
				<a class="adjacent next" href={doc.next.href}>
					<span>Next</span>
					{doc.next.title}
				</a>
			{/if}
		</footer>
	</article>
	<Toc headings={doc.headings} />
</main>

<style>
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 13rem;
		gap: 3.5rem;
		padding: 2.5rem 3rem 5rem;
	}

	article {
		max-width: 44rem;
		min-width: 0;
	}

	.kicker {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-family: var(--mono);
		font-size: 0.6875rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin: 0 0 1.25rem;
	}

	.kicker .section {
		color: var(--signal-y);
	}

	.kicker .source {
		color: var(--faint);
		text-transform: none;
		letter-spacing: 0.02em;
	}

	footer {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 4rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--line-soft);
	}

	.adjacent {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		max-width: 48%;
		font-size: 0.875rem;
		font-weight: 550;
		text-decoration: none;
		color: var(--text);
		padding: 0.75rem 1rem;
		border: 1px solid var(--line-soft);
		border-radius: 8px;
		transition: border-color 120ms;
	}

	.adjacent:hover {
		border-color: var(--line);
	}

	.adjacent span {
		font-family: var(--mono);
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--faint);
	}

	.next {
		text-align: right;
		margin-left: auto;
	}

	@media (max-width: 72rem) {
		main {
			grid-template-columns: minmax(0, 1fr);
		}

		main :global(> nav) {
			display: none;
		}
	}

	@media (max-width: 56rem) {
		main {
			padding: 1.75rem 1.25rem 4rem;
		}
	}
</style>
