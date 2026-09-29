<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Packs · GFX docs</title>
</svelte:head>

<main>
	<h1>Packs</h1>
	<p class="lede">
		A Pack is the look, and the look is swappable. Here is one composition — the
		<code>{data.presetSlug}</code> Preset — rendered under every Pack.
	</p>

	{#each data.dresses as dress (dress.slug)}
		<section>
			<h2 id={dress.slug}>{dress.label}</h2>
			<img
				src={dress.stillHref}
				alt="The {data.presetSlug} composition rendered under the {dress.label} Pack"
				width="1600"
				height="900"
				loading="lazy"
				decoding="async"
			/>
			<p>{dress.feel}</p>
			<ul class="swatches">
				{#each dress.swatches as swatch (swatch.role)}
					<li>
						<span class="chip" style:background={swatch.hex} aria-hidden="true"></span>
						{swatch.name}
						<code>{swatch.hex}</code>
					</li>
				{/each}
			</ul>
			<ul class="faces">
				{#each dress.faces as face (face.role)}
					<li>{face.family} <span>{face.use}</span></li>
				{/each}
			</ul>
		</section>
	{/each}
</main>

<style>
	main {
		max-width: 52rem;
		padding: 2.5rem 3rem 5rem;
	}

	h1 {
		font-family: var(--display);
		font-size: 2.125rem;
		font-weight: 640;
		letter-spacing: -0.015em;
		line-height: 1.15;
		margin: 0 0 1rem;
	}

	h2 {
		font-family: var(--display);
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin: 0 0 1rem;
	}

	.lede {
		color: var(--muted);
		max-width: 34rem;
		margin: 0 0 3rem;
	}

	code {
		font-family: var(--mono);
		font-size: 0.8125em;
		color: var(--text);
	}

	section {
		margin-top: 3.5rem;
		padding-top: 2rem;
		border-top: 1px solid var(--line-soft);
	}

	img {
		display: block;
		width: 100%;
		height: auto;
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	p {
		max-width: 34rem;
		margin: 1.25rem 0 0;
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
		list-style: none;
		margin: 1.25rem 0 0;
		padding: 0;
	}

	.swatches li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
	}

	.chip {
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 4px;
		border: 1px solid var(--line);
	}

	.swatches code {
		color: var(--faint);
	}

	.faces {
		gap: 1.75rem;
		margin-top: 0.75rem;
	}

	.faces li {
		font-size: 0.9375rem;
	}

	.faces span {
		font-family: var(--mono);
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--faint);
	}

	@media (max-width: 56rem) {
		main {
			padding: 1.75rem 1.25rem 4rem;
		}
	}
</style>
