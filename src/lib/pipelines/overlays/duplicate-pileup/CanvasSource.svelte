<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState, packState } from '$lib/platform/engine-state.svelte';
	import { getPack } from '$lib/platform/packs/registry';
	import { resolveFieldInkColor, resolvePackRoleColor } from '$lib/platform/packs/resolve';
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
	const pack = $derived(getPack(packState.slug));
	const windowColor = $derived(
		content.windowColor ?? resolvePackRoleColor(pack, 'duplicate-pileup.window', 'field-treatment')
	);
	const inkColor = $derived(resolveFieldInkColor(pack, content.inkColor));
	const alertColor = $derived(
		content.alertColor ?? resolvePackRoleColor(pack, 'duplicate-pileup.alert', 'accent-treatment')
	);
	const goodColor = $derived(
		content.goodColor ?? resolvePackRoleColor(pack, 'duplicate-pileup.good', 'accent-treatment')
	);

	function px(value: number): string {
		return `${value}px`;
	}
</script>

<div
	class="duplicate-pileup"
	data-overlay="duplicate-pileup"
	style:--ink={inkColor}
	style:--window={windowColor}
	style:--alert={alertColor}
	style:--good={goodColor}
	style:inline-size={px(frame.width)}
	style:block-size={px(frame.height)}
	style:font-size={px(sizes.textSize * u)}
>
	{#each scene.panels as panel (panel.key)}
		<section
			class="duplicate-pileup__panel"
			class:is-clean={panel.isClean}
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
				style:font-size={px(sizes.titleSize * u)}
			>
				<span>{panel.kind === 'inbox' ? '✉' : '⑂'} {panel.title}</span>
				{#if panel.count > 0}
					<span class="duplicate-pileup__count" class:is-alert={panel.count > 1 && !panel.isClean}
						>{panel.isClean ? `✓ ${panel.count}` : panel.count}</span
					>
				{/if}
			</header>
			<div
				class="duplicate-pileup__list"
				style:inset={`${px(panel.headerHeight + sizes.paddingY * u * 0.6)} ${px(sizes.paddingX * u)} ${px(sizes.paddingY * u)}`}
			>
				{#each panel.rows as row (row.key)}
					<div
						class="duplicate-pileup__row"
						class:is-duplicate={row.isDuplicate}
						style:top={px(row.y)}
						style:block-size={px(row.height)}
						style:opacity={row.opacity}
						style:border-radius={px(sizes.radius * u * 0.5)}
					>
						<span class="duplicate-pileup__mark">{panel.kind === 'inbox' ? 'A' : '⑂'}</span>
						<span class="duplicate-pileup__text">
							<span class="duplicate-pileup__title">
								{#if row.number !== undefined}<span class="duplicate-pileup__number">#{row.number}</span>{/if}
								{row.title}
							</span>
							{#if row.meta}<span class="duplicate-pileup__meta">{row.meta}</span>{/if}
						</span>
						{#if row.isDuplicate}
							<span class="duplicate-pileup__tag">duplicate</span>
						{:else if panel.isClean}
							<span class="duplicate-pileup__tag is-good">once</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/each}

	{#if scene.restart}
		<span
			class="duplicate-pileup__stamp is-alert"
			style:left={px(scene.restart.x)}
			style:top={px(scene.restart.y)}
			style:opacity={scene.restart.opacity}
			style:scale={scene.restart.scale}
			style:font-size={px(sizes.labelSize * u * 0.75)}>↻ {scene.restart.label}</span
		>
	{/if}
	{#if scene.collapse}
		<span
			class="duplicate-pileup__stamp is-good"
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
	.duplicate-pileup {
		color: var(--ink);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		inset-block-start: 0;
		inset-inline-start: 0;
		pointer-events: none;
		position: absolute;
	}

	.duplicate-pileup > * {
		position: absolute;
	}

	/* Box-shadow and borders only: the HTML-in-Canvas capture cannot paint a backdrop filter. */
	.duplicate-pileup__panel {
		background: var(--window);
		border: 0.12em solid color-mix(in srgb, var(--ink) 14%, transparent);
		box-shadow:
			0 1.2em 3em rgb(0 0 0 / 0.45),
			0 0.2em 0.6em rgb(0 0 0 / 0.3);
		box-sizing: border-box;
		overflow: hidden;
	}

	.duplicate-pileup__panel.is-clean {
		border-color: color-mix(in srgb, var(--good) 60%, transparent);
	}

	.duplicate-pileup__header {
		align-items: center;
		border-block-end: 0.06em solid color-mix(in srgb, var(--ink) 12%, transparent);
		box-sizing: border-box;
		display: flex;
		font-weight: 700;
		justify-content: space-between;
	}

	.duplicate-pileup__count {
		background: color-mix(in srgb, var(--ink) 12%, transparent);
		border-radius: 99em;
		font-size: 0.8em;
		padding: 0.15em 0.7em;
	}

	.duplicate-pileup__count.is-alert {
		background: var(--alert);
		color: #111;
	}

	.duplicate-pileup__panel.is-clean .duplicate-pileup__count {
		background: var(--good);
		color: #111;
	}

	.duplicate-pileup__list {
		overflow: hidden;
		position: absolute;
	}

	.duplicate-pileup__row {
		align-items: center;
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		border: 0.06em solid color-mix(in srgb, var(--ink) 12%, transparent);
		box-sizing: border-box;
		display: flex;
		gap: 0.8em;
		inset-inline: 0;
		padding-inline: 0.8em;
		position: absolute;
	}

	.duplicate-pileup__row.is-duplicate {
		background: color-mix(in srgb, var(--alert) 10%, transparent);
		border-color: color-mix(in srgb, var(--alert) 45%, transparent);
	}

	.duplicate-pileup__mark {
		align-items: center;
		background: color-mix(in srgb, var(--ink) 14%, transparent);
		block-size: 1.8em;
		border-radius: 50%;
		display: flex;
		flex: none;
		font-weight: 700;
		inline-size: 1.8em;
		justify-content: center;
	}

	.duplicate-pileup__text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.2em;
		min-inline-size: 0;
	}

	.duplicate-pileup__title {
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.duplicate-pileup__number {
		color: color-mix(in srgb, var(--ink) 55%, transparent);
		margin-inline-end: 0.5em;
	}

	.duplicate-pileup__meta {
		color: color-mix(in srgb, var(--ink) 55%, transparent);
		font-size: 0.8em;
	}

	.duplicate-pileup__tag {
		border: 0.08em solid var(--alert);
		border-radius: 0.4em;
		color: var(--alert);
		flex: none;
		font-size: 0.7em;
		padding: 0.1em 0.5em;
		text-transform: uppercase;
	}

	.duplicate-pileup__tag.is-good {
		border-color: var(--good);
		color: var(--good);
	}

	.duplicate-pileup__stamp {
		border-radius: 0.4em;
		color: #111;
		font-weight: 800;
		padding: 0.25em 0.7em;
		translate: -50% -50%;
		white-space: nowrap;
	}

	.duplicate-pileup__stamp.is-alert {
		background: var(--alert);
	}

	.duplicate-pileup__stamp.is-good {
		background: var(--good);
	}
</style>
