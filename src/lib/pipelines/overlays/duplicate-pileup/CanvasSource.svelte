<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState } from '$lib/platform/engine-state.svelte';
	import {
		resolveDuplicatePileupLayout,
		resolveDuplicatePileupScene
	} from '$lib/utils/duplicate-pileup-scene';
	import { getVideoFrameSize } from '$lib/utils/video-frame';
	import {
		DUPLICATE_PILEUP_DEFAULT_LAYOUT,
		DUPLICATE_PILEUP_DEFAULT_SIZES,
		type DuplicatePileupContent
	} from './definition';

	interface Props {
		content: DuplicatePileupContent;
	}

	let { content }: Props = $props();

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const durationSeconds = $derived(engineState.transport.durationSeconds);
	const layout = $derived(
		resolveDuplicatePileupLayout(
			{
				x: content.x ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.x,
				y: content.y ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.y,
				width: content.width ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.width,
				height: content.height ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.height,
				arrangement: content.arrangement ?? DUPLICATE_PILEUP_DEFAULT_LAYOUT.arrangement
			},
			content.orientationOverrides,
			engineState.transport.orientation
		)
	);
	const sizes = $derived({
		textSize: content.textSize ?? DUPLICATE_PILEUP_DEFAULT_SIZES.textSize,
		titleSize: content.titleSize ?? DUPLICATE_PILEUP_DEFAULT_SIZES.titleSize,
		labelSize: content.labelSize ?? DUPLICATE_PILEUP_DEFAULT_SIZES.labelSize,
		paddingX: content.paddingX ?? DUPLICATE_PILEUP_DEFAULT_SIZES.paddingX,
		paddingY: content.paddingY ?? DUPLICATE_PILEUP_DEFAULT_SIZES.paddingY,
		gap: content.gap ?? DUPLICATE_PILEUP_DEFAULT_SIZES.gap,
		radius: content.radius ?? DUPLICATE_PILEUP_DEFAULT_SIZES.radius
	});
	const scene = $derived(
		resolveDuplicatePileupScene(
			content,
			layout,
			sizes,
			animState.globalProgress * durationSeconds,
			durationSeconds,
			frame.width,
			frame.height
		)
	);
	const u = $derived(scene.unit);

	function px(value: number): string {
		return `${value}px`;
	}

	// The octicon for an open pull request, in its 16-unit box.
	const PULL_REQUEST_PATH =
		'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
</script>

<div
	class="duplicate-pileup"
	data-overlay="duplicate-pileup"
	style:inline-size={px(frame.width)}
	style:block-size={px(frame.height)}
	style:font-size={px(sizes.textSize * u)}
>
	{#each scene.panels as panel (panel.key)}
		<section
			class={`duplicate-pileup__panel is-${panel.kind}`}
			style:left={px(panel.rect.x)}
			style:top={px(panel.rect.y)}
			style:inline-size={px(panel.rect.width)}
			style:block-size={px(panel.rect.height)}
			style:border-radius={px(sizes.radius * u)}
			style:opacity={Math.min(1, panel.pop * 2)}
			style:scale={0.85 + 0.15 * panel.pop}
			style:rotate={`${panel.lean}deg`}
		>
			<header
				class="duplicate-pileup__header"
				style:block-size={px(panel.headerHeight)}
				style:padding-inline={px(sizes.paddingX * u)}
				style:font-size={px(sizes.titleSize * u * 0.62)}
			>
				{#if panel.kind === 'inbox'}
					<span class="duplicate-pileup__search">⌕ Search mail</span>
				{:else}
					<span class="duplicate-pileup__repo">{panel.title}</span>
					<span class="duplicate-pileup__tab">Pull requests <span class="duplicate-pileup__counter">{panel.count}</span></span>
				{/if}
			</header>
			{#if panel.kind === 'inbox'}
				<nav class="duplicate-pileup__gmail-tabs" style:padding-inline={px(sizes.paddingX * u * 0.5)}>
					<span class="is-current">
						{panel.title}
						{#if panel.count > 0 && !panel.isClean}<span class="duplicate-pileup__new">{panel.count} new</span>{/if}
					</span>
					<span>Promotions</span>
					<span>Social</span>
				</nav>
			{:else}
				<div class="duplicate-pileup__gh-bar" style:padding-inline={px(sizes.paddingX * u * 0.5)}>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d={PULL_REQUEST_PATH} fill="currentColor" /></svg>
					<strong>{panel.count} Open</strong>
					<span class="duplicate-pileup__muted">✓ 0 Closed</span>
				</div>
			{/if}
			<div class="duplicate-pileup__list">
				{#each panel.rows as row (row.key)}
					<div
						class="duplicate-pileup__row"
						style:top={px(row.y)}
						style:block-size={px(row.height)}
						style:opacity={row.opacity}
						style:background={row.fresh > 0
							? `color-mix(in srgb, #fff8c5 ${Math.round(row.fresh * 100)}%, #ffffff)`
							: undefined}
						style:padding-inline={px(sizes.paddingX * u * 0.5)}
					>
						{#if panel.kind === 'inbox'}
							<span class="duplicate-pileup__check"></span>
							<span class="duplicate-pileup__star">☆</span>
							<strong class="duplicate-pileup__sender">{row.meta ?? ''}</strong>
							<span class="duplicate-pileup__subject">
								<strong>{row.title}</strong>
								{#if row.snippet}<span class="duplicate-pileup__snippet"> – {row.snippet}</span>{/if}
							</span>
							{#if row.time}<strong class="duplicate-pileup__time">{row.time}</strong>{/if}
						{:else}
							<svg class="duplicate-pileup__pr" viewBox="0 0 16 16" aria-hidden="true"><path d={PULL_REQUEST_PATH} fill="#1a7f37" /></svg>
							<span class="duplicate-pileup__pr-text">
								<span class="duplicate-pileup__pr-title">
									<strong>{row.title}</strong>
									{#if row.label}<span class="duplicate-pileup__label">{row.label}</span>{/if}
								</span>
								<span class="duplicate-pileup__muted">
									#{row.number} opened 2 minutes ago{#if row.meta}{` by ${row.meta}`}{/if}
								</span>
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/each}

	{#if scene.restart}
		<span
			class="duplicate-pileup__stamp is-restart"
			style:left={px(scene.restart.x)}
			style:top={px(scene.restart.y)}
			style:opacity={scene.restart.opacity}
			style:scale={scene.restart.scale}
			style:font-size={px(sizes.labelSize * u * 0.75)}>↻ {scene.restart.label}</span
		>
	{/if}
	{#if scene.collapse}
		<span
			class="duplicate-pileup__stamp is-clean"
			data-gfx-readable-id="collapse"
			style:left={px(scene.collapse.x)}
			style:top={px(scene.collapse.y)}
			style:opacity={scene.collapse.opacity}
			style:scale={scene.collapse.scale}
			style:font-size={px(sizes.labelSize * u)}>✓ {scene.collapse.label}</span
		>
	{/if}
</div>

<style>
	/* Gmail's and GitHub's light themes, literal under every Pack (found documents). */
	.duplicate-pileup {
		color: #1f2328;
		inset-block-start: 0;
		inset-inline-start: 0;
		pointer-events: none;
		position: absolute;
	}

	.duplicate-pileup > * {
		position: absolute;
	}

	/* The app's global type scale would shrink these; the panels set their own. */
	.duplicate-pileup :global(:where(p, span, strong)) {
		font-size: inherit;
	}

	.duplicate-pileup__panel {
		background: #ffffff;
		box-shadow:
			0 1.5em 4em rgb(0 0 0 / 0.45),
			0 0.2em 0.6em rgb(0 0 0 / 0.25);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.duplicate-pileup__panel.is-inbox {
		background: #f8fafd;
		color: #1f1f1f;
		font-family: 'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
	}

	.duplicate-pileup__panel.is-pull-requests {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
	}

	.duplicate-pileup__header {
		align-items: center;
		box-sizing: border-box;
		display: flex;
		flex: none;
		gap: 1em;
	}

	.is-pull-requests .duplicate-pileup__header {
		background: #f6f8fa;
		border-block-end: 0.06em solid #d1d9e0;
		justify-content: space-between;
	}

	.duplicate-pileup__search {
		background: #e9eef6;
		border-radius: 99em;
		color: #444746;
		flex: 1;
		padding: 0.55em 1.1em;
	}

	.duplicate-pileup__repo {
		font-weight: 600;
	}

	.duplicate-pileup__tab {
		border-block-end: 0.15em solid #fd8c73;
		font-weight: 600;
		padding-block: 0.3em;
	}

	.duplicate-pileup__counter {
		background: #818b981f;
		border-radius: 99em;
		font-size: 0.85em;
		padding: 0 0.5em;
	}

	.duplicate-pileup__gmail-tabs {
		background: #ffffff;
		border-block-end: 0.06em solid #e0e0e0;
		border-start-start-radius: 0.8em;
		border-start-end-radius: 0.8em;
		display: flex;
		flex: none;
		gap: 2.2em;
		margin-inline: 0.6em;
	}

	.duplicate-pileup__gmail-tabs span {
		align-items: center;
		border-block-end: 0.18em solid transparent;
		color: #444746;
		display: flex;
		gap: 0.5em;
		padding: 0.7em 0.4em;
	}

	.duplicate-pileup__gmail-tabs .is-current {
		border-color: #0b57d0;
		color: #0b57d0;
		font-weight: 600;
	}

	.duplicate-pileup__gmail-tabs .duplicate-pileup__new {
		background: #0b57d0;
		border-radius: 0.4em;
		color: #ffffff;
		font-size: 0.75em;
		padding: 0.05em 0.45em;
	}

	.duplicate-pileup__gh-bar {
		align-items: center;
		background: #f6f8fa;
		border-block-end: 0.06em solid #d1d9e0;
		display: flex;
		flex: none;
		gap: 0.5em;
		padding-block: 0.7em;
	}

	.duplicate-pileup__gh-bar svg {
		block-size: 1em;
		inline-size: 1em;
	}

	.duplicate-pileup__muted {
		color: #59636e;
	}

	.duplicate-pileup__list {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.is-inbox .duplicate-pileup__list {
		background: #ffffff;
		margin-inline: 0.6em;
	}

	.duplicate-pileup__row {
		align-items: center;
		background: #ffffff;
		border-block-end: 0.06em solid #eceff1;
		box-sizing: border-box;
		display: flex;
		gap: 0.8em;
		inset-inline: 0;
		position: absolute;
	}

	.is-pull-requests .duplicate-pileup__row {
		border-block-end-color: #d1d9e0;
	}

	.duplicate-pileup__check {
		block-size: 0.9em;
		border: 0.12em solid #747775;
		border-radius: 0.15em;
		flex: none;
		inline-size: 0.9em;
	}

	.duplicate-pileup__star {
		color: #747775;
		flex: none;
	}

	.duplicate-pileup__sender {
		flex: none;
		inline-size: 7em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.duplicate-pileup__subject {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.duplicate-pileup__snippet {
		color: #5f6368;
	}

	.duplicate-pileup__time {
		flex: none;
		font-size: 0.85em;
	}

	.duplicate-pileup__pr {
		align-self: flex-start;
		block-size: 1.1em;
		flex: none;
		inline-size: 1.1em;
		margin-block-start: 0.85em;
	}

	.duplicate-pileup__pr-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.15em;
		min-inline-size: 0;
	}

	.duplicate-pileup__pr-title {
		align-items: center;
		display: flex;
		gap: 0.5em;
		white-space: nowrap;
	}

	.duplicate-pileup__pr-text .duplicate-pileup__muted {
		font-size: 0.8em;
	}

	.duplicate-pileup__label {
		background: #d73a4a;
		border-radius: 99em;
		color: #ffffff;
		font-size: 0.7em;
		font-weight: 600;
		padding: 0.05em 0.6em;
	}

	.duplicate-pileup__stamp {
		border-radius: 0.4em;
		color: #ffffff;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
		font-weight: 700;
		padding: 0.3em 0.8em;
		translate: -50% -50%;
		white-space: nowrap;
	}

	.duplicate-pileup__stamp.is-restart {
		background: #1f2328;
	}

	.duplicate-pileup__stamp.is-clean {
		background: #1a7f37;
	}
</style>
