<script lang="ts">
	import gfxLogotype from '$identity/gfx-logotype.svg';
	import PresetLoops from '$lib/components/PresetLoops.svelte';
	// The loop the hero plays and what it is, written by `pnpm capture:workspace-loop`
	// alongside the video and its poster, so the page never states a runtime or a
	// frame size the recording does not have.
	import workspaceLoop from '$lib/workspace-loop.json';

	const runtime = `${Math.floor(workspaceLoop.durationSeconds / 60)}:${(workspaceLoop.durationSeconds % 60).toFixed(2).padStart(5, '0')}`;

	const layers = [
		{ name: 'Surface', blurb: 'The scene a piece lives on — paper, web document, iMessage.' },
		{ name: 'Block', blurb: 'Content primitives — quotes, stats, timelines, diagrams.' },
		{ name: 'Annotation', blurb: 'Hand-drawn marks — circles, underlines, arrows, highlights.' },
		{ name: 'Overlay', blurb: 'Chrome above the content — tape, badges, lower-third framing.' },
		{ name: 'Effect', blurb: 'Full-frame WGSL passes — grain, depth, light, bloom.' }
	];

	const doors = [
		{
			href: '/overview',
			title: 'Overview',
			blurb: 'What GFX renders, how a piece is put together, and what it takes to run one.'
		},
		{
			href: '/preset-format',
			title: 'Authoring',
			blurb: 'The gfx@1 Preset JSON format — compositions authored by GUI and agents alike.'
		},
		{
			href: '/packs',
			title: 'Packs',
			blurb: 'Appearance is swappable — one composition, rendered under every Pack.'
		}
	];
</script>

<svelte:head>
	<title>GFX — a motion-graphics engine on a web stack</title>
	<meta
		name="description"
		content="GFX is an opinionated motion-graphics engine — TypeGPU, HTML-in-Canvas, GSAP — rendering broadcast-quality overlays and full-frame pieces at 4K."
	/>
</svelte:head>

<main>
	<section class="hero">
		<div class="frame">
			<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i
				class="corner br"
			></i>
			<video
				class="app"
				width={workspaceLoop.videoWidth}
				height={workspaceLoop.videoHeight}
				poster={workspaceLoop.poster}
				aria-label="The GFX Workspace playing {workspaceLoop.presetName}: the piece builds on the canvas, the composition inspector reads it back, and the playhead crosses one timeline track per layer."
				autoplay
				loop
				muted
				playsinline
			>
				<!-- `media` leaves the loop unselected where reduced motion was asked
				     for, so that visitor gets the poster — a frame of this same
				     recording — held still. -->
				<source
					src={workspaceLoop.video}
					type="video/mp4"
					media="(prefers-reduced-motion: no-preference)"
				/>
			</video>
			<div class="strip">
				<span>{runtime}</span>
				<span>{workspaceLoop.compositionWidth} × {workspaceLoop.compositionHeight}</span>
				<span>gfx@1</span>
			</div>
			<h1>Broadcast&#8209;grade motion graphics, on&nbsp;a&nbsp;web&nbsp;stack.</h1>
			<p class="sub">
				GFX is an opinionated motion-graphics engine — TypeGPU, HTML&#8209;in&#8209;Canvas, GSAP —
				that renders transparent overlays and full-frame pieces at native 4K, authored with full
				parity by a GUI and by agents over one composition model.
			</p>
			<a class="cta" href="/getting-started">Get started</a>
		</div>
	</section>

	<PresetLoops />

	<section class="layers">
		<h2>Five layers, one composition model</h2>
		<ol>
			{#each layers as layer, i (layer.name)}
				<li>
					<span class="n">{String(i + 1).padStart(2, '0')}</span>
					<h3>{layer.name}</h3>
					<p>{layer.blurb}</p>
				</li>
			{/each}
		</ol>
	</section>

	<section class="doors">
		{#each doors as door (door.href)}
			<a href={door.href}>
				<h2>{door.title}</h2>
				<p>{door.blurb}</p>
				<span aria-hidden="true">→</span>
			</a>
		{/each}
	</section>

	<footer>
		<img class="footer-logotype" src={gfxLogotype} alt="GFX" width="38" height="15" />
	</footer>
</main>

<style>
	main {
		max-width: 68rem;
		margin: 0 auto;
		padding: 0 1.5rem;
	}

	/* ————— hero: the app playing, inside safe-area brackets ————— */

	.hero {
		padding: 2.5rem 0 1.5rem;
	}

	.frame {
		position: relative;
		padding: 2.5rem 3.5rem 3.75rem;
	}

	.corner {
		position: absolute;
		width: 1.375rem;
		height: 1.375rem;
		border: 0 solid var(--line);
	}

	.tl {
		top: 0;
		left: 0;
		border-top-width: 1px;
		border-left-width: 1px;
	}

	.tr {
		top: 0;
		right: 0;
		border-top-width: 1px;
		border-right-width: 1px;
	}

	.bl {
		bottom: 0;
		left: 0;
		border-bottom-width: 1px;
		border-left-width: 1px;
	}

	.br {
		bottom: 0;
		right: 0;
		border-bottom-width: 1px;
		border-right-width: 1px;
	}

	/* The loop leads, so the headline reads as a caption under the running app. */
	.app {
		display: block;
		inline-size: 100%;
		block-size: auto;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
	}

	h1 {
		font-family: var(--display);
		font-size: clamp(2.25rem, 5.5vw, 3.875rem);
		font-weight: 680;
		letter-spacing: -0.022em;
		line-height: 1.04;
		margin: 2.5rem 0 0;
		max-width: 17ch;
		text-wrap: balance;
	}

	.sub {
		max-width: 54ch;
		color: var(--muted);
		font-size: 1rem;
		line-height: 1.7;
		margin: 1.5rem 0 2.25rem;
	}

	.cta {
		display: inline-block;
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		border-radius: 6px;
		padding: 0.625rem 1.125rem;
		background: var(--signal-y);
		color: #111;
		transition: background 120ms;
	}

	.cta:hover {
		background: color-mix(in srgb, var(--signal-y) 88%, #fff);
	}

	.strip {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.75rem;
		font-family: var(--mono);
		font-size: 0.6875rem;
		letter-spacing: 0.08em;
		color: var(--faint);
	}

	/* ————— the five layers ————— */

	.layers {
		padding: 3rem 0;
		border-top: 1px solid var(--line-soft);
	}

	.layers h2 {
		font-family: var(--mono);
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--faint);
		margin: 0 0 1.75rem;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 2rem;
	}

	.n {
		font-family: var(--mono);
		font-size: 0.6875rem;
		color: var(--faint);
	}

	.layers h3 {
		font-family: var(--display);
		font-size: 1rem;
		font-weight: 620;
		margin: 0.375rem 0 0.375rem;
	}

	.layers li p {
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--muted);
		margin: 0;
	}

	/* ————— entry doors ————— */

	.doors {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		padding: 0 0 4rem;
	}

	.doors a {
		position: relative;
		display: block;
		text-decoration: none;
		border: 1px solid var(--line-soft);
		border-radius: 10px;
		padding: 1.375rem 1.5rem 1.25rem;
		transition: border-color 120ms;
	}

	.doors a:hover {
		border-color: var(--line);
	}

	.doors h2 {
		font-family: var(--display);
		font-size: 1.125rem;
		font-weight: 640;
		margin: 0 0 0.5rem;
	}

	.doors p {
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--muted);
		margin: 0;
	}

	.doors span {
		position: absolute;
		top: 1.25rem;
		right: 1.375rem;
		color: var(--faint);
		transition: color 120ms;
	}

	.doors a:hover span {
		color: var(--signal-y);
	}

	footer {
		padding: 1.5rem 0 2rem;
		border-top: 1px solid var(--line-soft);
	}

	.footer-logotype {
		display: block;
	}

	@media (max-width: 56rem) {
		.hero {
			padding-top: 2.5rem;
		}

		.frame {
			padding: 3rem 1.75rem 2.5rem;
		}

		ol {
			grid-template-columns: repeat(2, 1fr);
			gap: 1.5rem;
		}

		.doors {
			grid-template-columns: 1fr;
		}
	}
</style>
