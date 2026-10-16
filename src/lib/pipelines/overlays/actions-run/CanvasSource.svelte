<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import { resolveActionsRunScene, type ActionsRunStepState } from '$lib/utils/actions-run-scene';
	import { getVideoFrameSize } from '$lib/utils/video-frame';
	import {
		ACTIONS_RUN_DEFAULT_LAYOUT,
		ACTIONS_RUN_DEFAULT_SIZES,
		type ActionsRunContent
	} from './definition';

	interface Props {
		content: ActionsRunContent;
	}

	let { content }: Props = $props();

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const durationSeconds = $derived(engineState.transport.durationSeconds);
	const seconds = $derived(animState.globalProgress * durationSeconds);
	const unit = $derived(Math.min(frame.width, frame.height) / 100);
	const layout = $derived(
		content.orientationOverrides?.[engineState.transport.orientation] ?? {
			x: content.x ?? ACTIONS_RUN_DEFAULT_LAYOUT.x,
			y: content.y ?? ACTIONS_RUN_DEFAULT_LAYOUT.y,
			width: content.width ?? ACTIONS_RUN_DEFAULT_LAYOUT.width,
			height: content.height ?? ACTIONS_RUN_DEFAULT_LAYOUT.height
		}
	);
	const sizes = $derived({
		textSize: content.textSize ?? ACTIONS_RUN_DEFAULT_SIZES.textSize,
		titleSize: content.titleSize ?? ACTIONS_RUN_DEFAULT_SIZES.titleSize,
		paddingX: content.paddingX ?? ACTIONS_RUN_DEFAULT_SIZES.paddingX,
		paddingY: content.paddingY ?? ACTIONS_RUN_DEFAULT_SIZES.paddingY,
		gap: content.gap ?? ACTIONS_RUN_DEFAULT_SIZES.gap,
		radius: content.radius ?? ACTIONS_RUN_DEFAULT_SIZES.radius
	});
	const scene = $derived(resolveActionsRunScene(content, seconds, durationSeconds));
	const statusLabel = $derived(
		{ queued: 'Queued', 'in-progress': 'In progress', failure: 'Failure', success: 'Success' }[
			scene.status
		]
	);
	const owner = $derived(content.repository.split('/')[0]);
	const repo = $derived(content.repository.split('/').slice(1).join('/'));
	const spin = $derived((seconds * 300) % 360);

	function px(value: number): string {
		return `${value}px`;
	}
</script>

{#snippet statusIcon(state: ActionsRunStepState | 'queued' | 'in-progress')}
	<svg class="actions-run__icon" viewBox="0 0 16 16" aria-hidden="true">
		{#if state === 'success'}
			<circle cx="8" cy="8" r="8" fill="#1a7f37" />
			<path d="M4.6 8.2 7 10.5l4.4-4.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
		{:else if state === 'failure'}
			<circle cx="8" cy="8" r="8" fill="#d1242f" />
			<path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
		{:else if state === 'running' || state === 'in-progress'}
			<circle cx="8" cy="8" r="6.5" fill="none" stroke="#eac54f" stroke-width="2" opacity="0.35" />
			<path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="#bf8700" stroke-width="2" stroke-linecap="round" transform={`rotate(${spin} 8 8)`} />
		{:else if state === 'restored'}
			<circle cx="8" cy="8" r="7.25" fill="#eaeef2" stroke="#d0d7de" stroke-width="1" />
			<path d="M4.8 8.2 7 10.3l4.2-4.4" fill="none" stroke="#59636e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
		{:else}
			<circle cx="8" cy="8" r="6.75" fill="none" stroke="#8c959f" stroke-width="1.5" />
		{/if}
	</svg>
{/snippet}

<div
	class="actions-run"
	data-overlay="actions-run"
	style:left={px(layout.x * frame.width)}
	style:top={px(layout.y * frame.height)}
	style:inline-size={px(layout.width * frame.width)}
	style:block-size={px(layout.height * frame.height)}
	style:border-radius={px(sizes.radius * unit)}
	style:font-size={px(sizes.textSize * unit)}
>
	<header class="actions-run__repo" style:padding={`${px(sizes.paddingY * unit * 0.6)} ${px(sizes.paddingX * unit)} 0`}>
		<span class="actions-run__crumb">
			<svg class="actions-run__glyph" viewBox="0 0 16 16" aria-hidden="true"
				><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" fill="currentColor" /></svg
			>
			{owner} / <strong>{repo}</strong>
		</span>
		<nav class="actions-run__tabs">
			<span>Code</span>
			<span>Issues</span>
			<span>Pull requests</span>
			<span class="is-current">Actions</span>
			<span>Settings</span>
		</nav>
	</header>

	<main class="actions-run__body" style:padding={`${px(sizes.paddingY * unit)} ${px(sizes.paddingX * unit)}`} style:gap={px(sizes.gap * unit)}>
		<p class="actions-run__back">← {content.workflow}</p>
		<h1 class="actions-run__title" style:font-size={px(sizes.titleSize * unit)}>
			{@render statusIcon(scene.status)}
			<span data-gfx-readable-id="title">{content.title}</span>
			<span class="actions-run__number">{content.workflow} #{content.runNumber}</span>
		</h1>

		<section class="actions-run__summary">
			<div>
				<span class="actions-run__muted">Triggered via</span>
				<strong class="actions-run__trigger" style:opacity={scene.triggerSwap} style:translate={`0 ${(1 - scene.triggerSwap) * 0.5}em`}
					>{scene.trigger}</strong
				>
			</div>
			<div>
				<span class="actions-run__muted">Status</span>
				<strong class={`actions-run__status is-${scene.status}`}>{statusLabel}</strong>
			</div>
			<div>
				<span class="actions-run__muted">Total duration</span>
				<strong>{scene.totalDuration}</strong>
			</div>
		</section>

		{#if scene.resume}
			<p class="actions-run__flash" style:opacity={scene.resume.appear} style:translate={`0 ${(1 - scene.resume.appear) * -0.4}em`}>
				↻ {scene.resume.label}
			</p>
		{/if}

		<section class="actions-run__job">
			<header class="actions-run__job-head">
				{@render statusIcon(scene.status === 'queued' ? 'pending' : scene.status)}
				<strong>{content.job}</strong>
			</header>
			<ol class="actions-run__steps">
				{#each scene.steps as step (step.key)}
					<li
						class={`actions-run__step is-${step.state}`}
						style:background={step.flash > 0 && step.state !== 'pending'
							? `color-mix(in srgb, ${step.state === 'failure' ? '#ffebe9' : step.state === 'restored' ? '#ddf4ff' : '#dafbe1'} ${Math.round(step.flash * 100)}%, transparent)`
							: undefined}
					>
						<span class="actions-run__chevron">›</span>
						{@render statusIcon(step.state)}
						<span class="actions-run__step-name">{step.name}</span>
						<span class="actions-run__muted">
							{step.state === 'restored' ? 'restored' : (step.duration ?? '')}
						</span>
					</li>
				{/each}
			</ol>
		</section>

		{#if scene.error}
			<section class="actions-run__annotations" style:opacity={scene.error.appear}>
				<header><strong>Annotations</strong> <span class="actions-run__muted">1 error</span></header>
				<p>
					{@render statusIcon('failure')}
					<span>
						<strong>{content.job}</strong>
						<span class="actions-run__error">{scene.error.message}</span>
					</span>
					{#if scene.error.clock}<span class="actions-run__muted">{scene.error.clock}</span>{/if}
				</p>
			</section>
		{/if}
	</main>
</div>

<style>
	/* GitHub's light theme, literal under every Pack (a found document). */
	.actions-run {
		background: #ffffff;
		box-shadow:
			0 1.5em 4em rgb(0 0 0 / 0.45),
			0 0.2em 0.6em rgb(0 0 0 / 0.25);
		color: #1f2328;
		display: flex;
		flex-direction: column;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
		line-height: 1.5;
		overflow: hidden;
		pointer-events: none;
		position: absolute;
	}

	/* The app's global type scale would shrink these; the page sets its own. */
	.actions-run :global(:where(p, ol, li, h1, strong, span)) {
		font-size: inherit;
	}

	.actions-run__repo {
		background: #f6f8fa;
		border-block-end: 0.06em solid #d1d9e0;
		display: flex;
		flex-direction: column;
		gap: 0.5em;
	}

	.actions-run__crumb {
		align-items: center;
		display: flex;
		gap: 0.5em;
		font-size: 1.1em;
	}

	.actions-run__glyph,
	.actions-run__icon {
		block-size: 1em;
		flex: none;
		inline-size: 1em;
	}

	.actions-run__glyph {
		color: #59636e;
	}

	.actions-run__tabs {
		display: flex;
		gap: 1.6em;
	}

	.actions-run__tabs span {
		border-block-end: 0.15em solid transparent;
		padding-block-end: 0.5em;
	}

	.actions-run__tabs .is-current {
		border-color: #fd8c73;
		font-weight: 600;
	}

	.actions-run__body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-block-size: 0;
	}

	.actions-run__back {
		color: #59636e;
		margin: 0;
	}

	.actions-run__title {
		align-items: center;
		display: flex;
		font-weight: 400;
		gap: 0.4em;
		line-height: 1.25;
		margin: 0;
	}

	.actions-run__number,
	.actions-run__muted {
		color: #59636e;
	}

	.actions-run__summary {
		border: 0.06em solid #d1d9e0;
		border-radius: 0.4em;
		display: grid;
		grid-template-columns: 1.4fr 1fr 1fr;
		padding: 0.9em 1.2em;
	}

	.actions-run__summary div {
		display: flex;
		flex-direction: column;
	}

	.actions-run__summary strong {
		font-size: 1.15em;
		font-weight: 600;
	}

	.actions-run__trigger {
		display: inline-block;
	}

	.actions-run__status.is-failure {
		color: #d1242f;
	}

	.actions-run__status.is-success {
		color: #1a7f37;
	}

	.actions-run__status.is-in-progress {
		color: #9a6700;
	}

	.actions-run__flash {
		background: #ddf4ff;
		border: 0.06em solid #54aeff66;
		border-radius: 0.4em;
		color: #1f2328;
		font-weight: 600;
		margin: 0;
		padding: 0.6em 1em;
	}

	.actions-run__job {
		background: #ffffff;
		border: 0.06em solid #d1d9e0;
		border-radius: 0.4em;
		overflow: hidden;
	}

	.actions-run__job-head {
		align-items: center;
		background: #f6f8fa;
		border-block-end: 0.06em solid #d1d9e0;
		display: flex;
		gap: 0.5em;
		padding: 0.7em 1em;
	}

	.actions-run__steps {
		list-style: none;
		margin: 0;
		padding: 0.3em 0;
	}

	.actions-run__step {
		align-items: center;
		display: flex;
		gap: 0.6em;
		padding: 0.45em 1em;
	}

	.actions-run__step-name {
		flex: 1;
	}

	.actions-run__step.is-pending .actions-run__step-name {
		color: #59636e;
	}

	.actions-run__step.is-failure .actions-run__step-name {
		font-weight: 600;
	}

	.actions-run__chevron {
		color: #59636e;
	}

	.actions-run__annotations {
		border: 0.06em solid #d1d9e0;
		border-radius: 0.4em;
	}

	.actions-run__annotations header {
		background: #f6f8fa;
		border-block-end: 0.06em solid #d1d9e0;
		padding: 0.6em 1em;
	}

	.actions-run__annotations p {
		align-items: flex-start;
		display: flex;
		gap: 0.6em;
		margin: 0;
		padding: 0.7em 1em;
	}

	.actions-run__annotations p > span:nth-child(2) {
		display: flex;
		flex: 1;
		flex-direction: column;
	}

	.actions-run__error {
		color: #d1242f;
	}
</style>
