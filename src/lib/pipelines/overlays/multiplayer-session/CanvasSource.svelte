<script lang="ts">
	import { animState } from '$lib/platform/anim-state.svelte';
	import { engineState, packState } from '$lib/platform/engine-state.svelte';
	import { getPack } from '$lib/platform/packs/registry';
	import { resolveFieldInkColor, resolvePackRoleColor } from '$lib/platform/packs/resolve';
	import {
		resolveMultiplayerSessionLayout,
		resolveMultiplayerSessionScene
	} from '$lib/utils/multiplayer-session-scene';
	import { getVideoFrameSize } from '$lib/utils/video-frame';
	import {
		MULTIPLAYER_SESSION_DEFAULT_LAYOUT,
		MULTIPLAYER_SESSION_DEFAULT_SIZES,
		type MultiplayerSessionContent
	} from './definition';

	interface Props {
		content: MultiplayerSessionContent;
	}

	let { content }: Props = $props();

	const frame = $derived(getVideoFrameSize(engineState.transport.orientation));
	const durationSeconds = $derived(engineState.transport.durationSeconds);
	const layout = $derived(
		resolveMultiplayerSessionLayout(
			{
				x: content.x ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.x,
				y: content.y ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.y,
				width: content.width ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.width,
				height: content.height ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.height,
				forkSide: content.forkSide ?? MULTIPLAYER_SESSION_DEFAULT_LAYOUT.forkSide
			},
			content.orientationOverrides,
			engineState.transport.orientation
		)
	);
	const sizes = $derived({ ...MULTIPLAYER_SESSION_DEFAULT_SIZES, ...definedSizes(content) });
	const scene = $derived(
		resolveMultiplayerSessionScene(
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
		content.windowColor ??
			resolvePackRoleColor(pack, 'multiplayer-session.window', 'field-treatment')
	);
	const inkColor = $derived(resolveFieldInkColor(pack, content.inkColor));
	const accentColor = $derived(
		content.accentColor ??
			resolvePackRoleColor(pack, 'multiplayer-session.accent', 'accent-treatment')
	);

	function definedSizes(source: MultiplayerSessionContent): Partial<typeof MULTIPLAYER_SESSION_DEFAULT_SIZES> {
		return Object.fromEntries(
			Object.keys(MULTIPLAYER_SESSION_DEFAULT_SIZES)
				.map((key) => [key, source[key as keyof typeof MULTIPLAYER_SESSION_DEFAULT_SIZES]])
				.filter(([, value]) => typeof value === 'number')
		);
	}

	function px(value: number): string {
		return `${value}px`;
	}

	// A cursor's arrow, tip at the origin, in a 24-unit box.
	const CURSOR_PATH = 'M0 0 L0 19 L5.2 14.2 L8.6 22 L12 20.5 L8.7 12.9 L15.5 12.9 Z';
</script>

<div
	class="multiplayer-session"
	data-overlay="multiplayer-session"
	style:--ink={inkColor}
	style:--window={windowColor}
	style:--accent={accentColor}
	style:inline-size={px(frame.width)}
	style:block-size={px(frame.height)}
	style:font-size={px(sizes.textSize * u)}
>
	<svg
		class="multiplayer-session__links"
		width={frame.width}
		height={frame.height}
		viewBox={`0 0 ${frame.width} ${frame.height}`}
		aria-hidden="true"
	>
		{#each scene.forks as fork (fork.key)}
			<path
				d={fork.connector}
				fill="none"
				stroke={inkColor}
				stroke-opacity="0.45"
				stroke-width={u * 0.35}
				pathLength="1"
				style:stroke-dasharray={`${Math.min(1, fork.pop)} 1`}
			/>
		{/each}
	</svg>

	{#each scene.forks as fork (fork.key)}
		<div
			class="multiplayer-session__fork"
			style:left={px(fork.rect.x)}
			style:top={px(fork.rect.y)}
			style:inline-size={px(fork.rect.width)}
			style:block-size={px(fork.rect.height)}
			style:border-radius={px(sizes.radius * u * 0.7)}
			style:padding={`${px(sizes.gap * u)} ${px(sizes.paddingX * u * 0.7)}`}
			style:opacity={Math.min(1, fork.pop * 2)}
			style:scale={0.6 + 0.4 * fork.pop}
		>
			<span class="multiplayer-session__fork-label">⑂ {fork.label}</span>
			<span class="multiplayer-session__fork-detail">{fork.detail ?? 'running…'}</span>
		</div>
	{/each}

	<div
		class="multiplayer-session__window"
		style:left={px(scene.window.x)}
		style:top={px(scene.window.y)}
		style:inline-size={px(scene.window.width)}
		style:block-size={px(scene.window.height)}
		style:border-radius={px(sizes.radius * u)}
	>
		<div
			class="multiplayer-session__header"
			style:block-size={px(scene.window.headerHeight)}
			style:padding-inline={px(sizes.paddingX * u)}
			style:font-size={px(sizes.titleSize * u)}
		>
			<span class="multiplayer-session__title" data-gfx-readable-id="title">{content.title}</span>
		</div>
	</div>

	<span
		class="multiplayer-session__status"
		class:is-waiting={scene.status.isWaiting}
		style:left={px(scene.status.x)}
		style:top={px(scene.status.centerY)}
		style:font-size={px(sizes.titleSize * u * 0.72)}
	>
		<span class="multiplayer-session__status-dot"></span>
		{scene.status.label}
	</span>

	{#each scene.avatars as avatar (avatar.userId)}
		<span
			class="multiplayer-session__avatar"
			style:left={px(avatar.x)}
			style:top={px(avatar.y)}
			style:inline-size={px(avatar.size)}
			style:block-size={px(avatar.size)}
			style:background={avatar.color}
			style:font-size={px(avatar.size * 0.5)}
			style:scale={avatar.pop}
		>
			{avatar.initial}
		</span>
	{/each}

	<div
		class="multiplayer-session__log"
		style:left={px(scene.logViewport.x)}
		style:top={px(scene.logViewport.y)}
		style:inline-size={px(scene.logViewport.width)}
		style:block-size={px(scene.logViewport.height)}
	>
		{#each scene.log as entry (entry.key)}
			<div
				class={`multiplayer-session__entry is-${entry.kind}`}
				style:top={px(entry.rect.y - scene.logViewport.y)}
				style:block-size={px(entry.rect.height)}
				style:opacity={entry.opacity}
				style:border-radius={px(sizes.radius * u * 0.5)}
			>
				{#if entry.kind === 'message'}
					<span class="multiplayer-session__who" style:color={entry.color}>{entry.name}</span>
					<span class="multiplayer-session__said">{entry.text}</span>
					{#if entry.tag}
						<span class="multiplayer-session__tag" style:border-color={entry.color}>{entry.tag}</span>
					{/if}
				{:else if entry.kind === 'step'}
					<span class="multiplayer-session__tick" class:is-done={entry.isDone}>{entry.isDone ? '✓' : '●'}</span>
					<span class="multiplayer-session__tool">{entry.tool}</span>
					<span class="multiplayer-session__said">{entry.text}</span>
				{:else if entry.kind === 'fork'}
					<span class="multiplayer-session__tick">⑂</span>
					<span class="multiplayer-session__said">forked: {entry.text}</span>
				{:else}
					<span class="multiplayer-session__wait-text">⏸ {entry.text}</span>
					<span class="multiplayer-session__wait-actions">
						<span class="multiplayer-session__approve">Approve</span>
						<span class="multiplayer-session__deny">Deny</span>
						{#if entry.timer}
							<span class="multiplayer-session__timer">⏱ {entry.timer}</span>
						{/if}
					</span>
				{/if}
			</div>
		{/each}
	</div>

	<div
		class="multiplayer-session__prompt"
		style:left={px(scene.prompt.x)}
		style:top={px(scene.prompt.y)}
		style:inline-size={px(scene.prompt.width)}
		style:block-size={px(scene.prompt.height)}
		style:border-radius={px(sizes.radius * u * 0.6)}
	></div>
	{#each scene.prompt.rows as row (row.userId)}
		<span class="multiplayer-session__row-dot" style:left={px(scene.prompt.x + sizes.gap * u + sizes.textSize * u * 0.45)} style:top={px(row.centerY)} style:background={row.color}></span>
		<span
			class="multiplayer-session__draft"
			style:left={px(row.textX)}
			style:top={px(row.centerY)}
		>
			{row.text}<span
				class="multiplayer-session__caret"
				style:background={row.color}
				style:opacity={row.isTyping || row.text.length > 0 ? 1 : 0}
			></span>
		</span>
	{/each}
	<span
		class="multiplayer-session__send"
		style:left={px(scene.prompt.send.x)}
		style:top={px(scene.prompt.send.y)}
		style:inline-size={px(scene.prompt.send.size)}
		style:block-size={px(scene.prompt.send.size)}
		style:scale={1 - scene.prompt.send.press * 0.12}
	>↑</span>

	{#each scene.cursors as cursor (cursor.userId)}
		<div
			class="multiplayer-session__cursor"
			style:left={px(cursor.x)}
			style:top={px(cursor.y)}
			style:opacity={cursor.opacity}
		>
			{#if cursor.click > 0}
				<span
					class="multiplayer-session__click"
					style:border-color={cursor.color}
					style:inline-size={px(sizes.cursorSize * u * (0.4 + cursor.click * 1.4))}
					style:block-size={px(sizes.cursorSize * u * (0.4 + cursor.click * 1.4))}
					style:opacity={1 - cursor.click}
				></span>
			{/if}
			<svg
				width={sizes.cursorSize * u}
				height={sizes.cursorSize * u}
				viewBox="0 0 24 24"
				aria-hidden="true"
				class="multiplayer-session__arrow"
			>
				<path d={CURSOR_PATH} fill={cursor.color} stroke="white" stroke-width="1.4" stroke-linejoin="round" />
			</svg>
			<span
				class="multiplayer-session__name"
				style:background={cursor.color}
				style:font-size={px(sizes.nameSize * u)}
				style:margin-left={px(sizes.cursorSize * u * 0.55)}
				style:margin-top={px(sizes.cursorSize * u * 0.8)}
			>
				{cursor.name}{#if cursor.status}<span class="multiplayer-session__name-status">{cursor.status}</span>{/if}
			</span>
		</div>
	{/each}
</div>

<style>
	.multiplayer-session {
		color: var(--ink);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		inset-block-start: 0;
		inset-inline-start: 0;
		pointer-events: none;
		position: absolute;
	}

	.multiplayer-session > *,
	.multiplayer-session__log > * {
		position: absolute;
	}

	.multiplayer-session__links {
		display: block;
		inset: 0;
		max-inline-size: none;
		overflow: visible;
	}

	/* Box-shadow and borders only: no backdrop filter, which the HTML-in-Canvas capture cannot paint. */
	.multiplayer-session__window,
	.multiplayer-session__fork {
		background: var(--window);
		border: 0.12em solid color-mix(in srgb, var(--ink) 14%, transparent);
		box-shadow:
			0 1.2em 3em rgb(0 0 0 / 0.45),
			0 0.2em 0.6em rgb(0 0 0 / 0.3);
		box-sizing: border-box;
	}

	.multiplayer-session__header {
		align-items: center;
		border-block-end: 0.06em solid color-mix(in srgb, var(--ink) 12%, transparent);
		box-sizing: border-box;
		display: flex;
		font-weight: 700;
	}

	.multiplayer-session__status {
		align-items: center;
		border-radius: 99em;
		background: color-mix(in srgb, #3ddc84 16%, transparent);
		color: #3ddc84;
		display: flex;
		gap: 0.5em;
		padding: 0.3em 0.8em;
		translate: 0 -50%;
		white-space: nowrap;
	}

	.multiplayer-session__status.is-waiting {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
	}

	.multiplayer-session__status-dot {
		background: currentColor;
		border-radius: 50%;
		block-size: 0.6em;
		inline-size: 0.6em;
	}

	.multiplayer-session__avatar {
		align-items: center;
		border: 0.12em solid var(--window);
		border-radius: 50%;
		box-sizing: border-box;
		color: #111;
		display: flex;
		font-family: var(--font, 'Archivo', sans-serif);
		font-weight: 800;
		justify-content: center;
		translate: -50% -50%;
	}

	.multiplayer-session__log {
		overflow: hidden;
	}

	.multiplayer-session__entry {
		align-items: center;
		box-sizing: border-box;
		display: flex;
		gap: 0.8em;
		inset-inline: 0;
		overflow: hidden;
		white-space: nowrap;
	}

	.multiplayer-session__entry.is-wait {
		align-items: flex-start;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		border: 0.08em solid color-mix(in srgb, var(--accent) 55%, transparent);
		flex-direction: column;
		justify-content: center;
		gap: 0.5em;
		padding-inline: 0.9em;
	}

	.multiplayer-session__who {
		font-weight: 700;
	}

	.multiplayer-session__said {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.multiplayer-session__tag {
		border: 0.08em solid;
		border-radius: 0.4em;
		font-size: 0.7em;
		padding: 0.1em 0.5em;
		text-transform: uppercase;
	}

	.multiplayer-session__tick {
		color: color-mix(in srgb, var(--ink) 55%, transparent);
	}

	.multiplayer-session__tick.is-done {
		color: #3ddc84;
	}

	.multiplayer-session__tool {
		background: color-mix(in srgb, var(--ink) 10%, transparent);
		border-radius: 0.3em;
		color: color-mix(in srgb, var(--ink) 75%, transparent);
		padding: 0 0.4em;
	}

	.multiplayer-session__wait-text {
		color: var(--accent);
		font-weight: 700;
	}

	.multiplayer-session__wait-actions {
		align-items: center;
		display: flex;
		gap: 0.6em;
		font-size: 0.85em;
	}

	.multiplayer-session__approve,
	.multiplayer-session__deny {
		border-radius: 0.4em;
		padding: 0.15em 0.7em;
	}

	.multiplayer-session__approve {
		background: var(--accent);
		color: #111;
		font-weight: 700;
	}

	.multiplayer-session__deny {
		border: 0.08em solid color-mix(in srgb, var(--ink) 35%, transparent);
	}

	.multiplayer-session__timer {
		color: color-mix(in srgb, var(--ink) 75%, transparent);
	}

	.multiplayer-session__prompt {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		border: 0.08em solid color-mix(in srgb, var(--ink) 18%, transparent);
		box-sizing: border-box;
	}

	.multiplayer-session__row-dot {
		block-size: 0.5em;
		border-radius: 50%;
		inline-size: 0.5em;
		translate: -50% -50%;
	}

	.multiplayer-session__draft {
		align-items: center;
		display: flex;
		translate: 0 -50%;
		white-space: pre;
	}

	.multiplayer-session__caret {
		block-size: 1.2em;
		display: inline-block;
		inline-size: 0.12em;
		margin-inline-start: 0.08em;
	}

	.multiplayer-session__send {
		align-items: center;
		background: var(--accent);
		border-radius: 50%;
		color: #111;
		display: flex;
		font-weight: 800;
		justify-content: center;
		translate: -50% -50%;
	}

	.multiplayer-session__fork {
		display: flex;
		flex-direction: column;
		gap: 0.3em;
		justify-content: center;
		transform-origin: left center;
	}

	.multiplayer-session__fork-label {
		font-weight: 700;
	}

	.multiplayer-session__fork-detail {
		color: color-mix(in srgb, var(--ink) 60%, transparent);
		font-size: 0.85em;
	}

	.multiplayer-session__cursor {
		block-size: 0;
		inline-size: 0;
	}

	.multiplayer-session__arrow {
		filter: drop-shadow(0 0.15em 0.3em rgb(0 0 0 / 0.45));
		left: 0;
		max-inline-size: none;
		position: absolute;
		top: 0;
	}

	.multiplayer-session__click {
		border: 0.12em solid;
		border-radius: 50%;
		position: absolute;
		translate: -50% -50%;
	}

	.multiplayer-session__name {
		border-radius: 0.45em;
		box-shadow: 0 0.15em 0.4em rgb(0 0 0 / 0.35);
		color: #111;
		display: flex;
		font-family: var(--font, 'Archivo', sans-serif);
		font-weight: 700;
		gap: 0.5em;
		padding: 0.2em 0.6em;
		position: absolute;
		white-space: nowrap;
	}

	.multiplayer-session__name-status {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 600;
		opacity: 0.8;
	}
</style>
