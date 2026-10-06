<script lang="ts">
	import { formatClockTime, resolveFrameRate, secondsToFrames } from '$lib/utils/composition-timing';

	import type { Timeline } from './timeline.svelte';
	import { engineState } from './engine-state.svelte';
	import { IS_HOSTED_ORIGIN } from './hosted-origin';

	interface BackdropEntry {
		name: string;
		url: string;
	}

	interface Props {
		timeline: Timeline | null;
		showCheckerboard?: boolean;
		onToggleCheckerboard?: () => void;
		backdropUrl?: string | null;
		onSelectBackdrop?: (url: string | null) => void;
		zoom?: number;
		onZoomIn?: () => void;
		onZoomOut?: () => void;
		onZoomFit?: () => void;
	}

	let {
		timeline,
		showCheckerboard = true,
		onToggleCheckerboard,
		backdropUrl = null,
		onSelectBackdrop,
		zoom = 1,
		onZoomIn,
		onZoomOut,
		onZoomFit
	}: Props = $props();

	// ─── Backdrop picker ─────────────────────────────────────────────────────────
	// Reference stills for judging an overlay over real footage (ADR-0034 §7). The
	// list is re-fetched every open so a still dropped into static/backdrops/
	// appears without a reload. Renders in the top layer (popover), anchored above
	// the trigger on open. The listing reads the checkout, which the hosted origin
	// does not have, so the picker is absent there rather than empty.

	let backdrops = $state<BackdropEntry[]>([]);
	let backdropMenuEl = $state<HTMLDivElement | null>(null);
	let backdropTriggerEl = $state<HTMLButtonElement | null>(null);

	function isBackdropEntry(value: unknown): value is BackdropEntry {
		return (
			typeof value === 'object' &&
			value !== null &&
			typeof (value as Record<string, unknown>)['name'] === 'string' &&
			typeof (value as Record<string, unknown>)['url'] === 'string'
		);
	}

	async function loadBackdrops(): Promise<void> {
		try {
			const response = await fetch('/api/backdrops');
			const data: unknown = await response.json();
			backdrops = Array.isArray(data) ? data.filter(isBackdropEntry) : [];
		} catch (error) {
			console.error('Failed to load backdrops', error);
			backdrops = [];
		}
	}

	function positionBackdropMenu(): void {
		if (!backdropMenuEl || !backdropTriggerEl) return;
		const rect = backdropTriggerEl.getBoundingClientRect();
		backdropMenuEl.style.right = `${window.innerWidth - rect.right}px`;
		backdropMenuEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
	}

	function onBackdropMenuToggle(event: ToggleEvent): void {
		if (event.newState !== 'open') return;
		positionBackdropMenu();
		void loadBackdrops();
	}

	function pickBackdrop(url: string): void {
		onSelectBackdrop?.(url === backdropUrl ? null : url);
		backdropMenuEl?.hidePopover();
	}

	const canZoomIn = $derived(zoom < 4 - 1e-6);
	const canZoomOut = $derived(zoom > 0.5 + 1e-6);
	const zoomLabel = $derived(`${Math.round(zoom * 100)}%`);

	const isPlaying = $derived(timeline?.isPlaying ?? false);
	// Frame counting runs on the exact rational (ADR-0042), matching the
	// export's whole-frame quantization at fractional NTSC rates.
	const currentFrame = $derived.by(() => {
		if (!timeline) return 0;
		const rate = resolveFrameRate(timeline.fps);
		return Math.min(
			Math.max(1, secondsToFrames(timeline.durationSeconds, rate)),
			secondsToFrames(timeline.time, rate) + 1
		);
	});
	const totalFrames = $derived.by(() => {
		if (!timeline) return 0;
		return Math.max(1, secondsToFrames(timeline.durationSeconds, resolveFrameRate(timeline.fps)));
	});
	const currentTime = $derived(timeline ? timeline.time : 0);

	function togglePlayPause(): void {
		timeline?.toggle();
	}

	function jumpToStart(): void {
		timeline?.seek(0);
	}

	function jumpToEnd(): void {
		if (timeline) timeline.seek(timeline.durationSeconds);
	}

	function stepBack(): void {
		timeline?.stepFrames(-1);
	}

	function stepForward(): void {
		timeline?.stepFrames(1);
	}

	const isLooping = $derived(timeline?.loop ?? true);

	function toggleLoop(): void {
		if (timeline) timeline.loop = !timeline.loop;
	}
</script>

<div class="controls-bar">
	<!-- Left: transport -->
	<div class="controls-bar__cluster">
		<button class="controls-bar__btn" type="button" aria-label="Jump to start" onclick={jumpToStart}>
			<svg
				class="controls-bar__flip"
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 18 18"
				aria-hidden="true"
			>
				<path
					d="M16.25 3C15.836 3 15.5 3.336 15.5 3.75V14.25C15.5 14.664 15.836 15 16.25 15C16.664 15 17 14.664 17 14.25V3.75C17 3.336 16.664 3 16.25 3Z"
					fill="currentColor"
				/>
				<path
					d="M13.539 7.988L7.983 3.967C7.602 3.691 7.102 3.652 6.681 3.866C6.261 4.08 5.99899 4.507 5.99899 4.979V6.5H2.75C1.785 6.5 1 7.285 1 8.25V9.75C1 10.715 1.785 11.5 2.75 11.5H6V13.021C6 13.493 6.261 13.919 6.681 14.134C6.862 14.226 7.056 14.271 7.25 14.271C7.508 14.271 7.76399 14.191 7.98199 14.033L13.538 10.012C13.862 9.778 14.055 9.399 14.055 8.999C14.055 8.599 13.861 8.221 13.538 7.987L13.539 7.988Z"
					fill="currentColor"
					fill-opacity="0.4"
				/>
			</svg>
		</button>

		<button
			class="controls-bar__btn"
			type="button"
			aria-label="Step back one frame"
			onclick={stepBack}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<path
					d="M10.5 3.5 5.5 8l5 4.5"
					stroke="currentColor"
					stroke-width="1.6"
					fill="none"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path d="M4.25 3.5v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
			</svg>
		</button>

		<button
			class="controls-bar__btn controls-bar__btn--play"
			type="button"
			aria-label={isPlaying ? 'Pause' : 'Play'}
			onclick={togglePlayPause}
		>
			{#if isPlaying}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
					<rect x="4.25" y="2.5" width="3.25" height="13" rx="0.9" fill="currentColor" fill-opacity="0.5" />
					<rect x="10.5" y="2.5" width="3.25" height="13" rx="0.9" fill="currentColor" />
				</svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
					<path
						d="M15.1 7.478L5.608 2.222C5.055 1.916 4.402 1.925 3.859 2.245C3.321 2.562 3 3.122 3 3.744V14.256C3 14.878 3.321 15.438 3.859 15.755C4.138 15.919 4.445 16.002 4.754 16.002C5.047 16.002 5.34 15.927 5.608 15.779L15.099 10.523C15.655 10.216 16 9.632 16 9.001C16 8.37 15.655 7.785 15.1 7.478Z"
						fill="currentColor"
					/>
				</svg>
			{/if}
		</button>

		<button
			class="controls-bar__btn"
			type="button"
			aria-label="Step forward one frame"
			onclick={stepForward}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<path
					d="m5.5 3.5 5 4.5-5 4.5"
					stroke="currentColor"
					stroke-width="1.6"
					fill="none"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path d="M11.75 3.5v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
			</svg>
		</button>

		<button class="controls-bar__btn" type="button" aria-label="Jump to end" onclick={jumpToEnd}>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
				<path
					d="M16.25 3C15.836 3 15.5 3.336 15.5 3.75V14.25C15.5 14.664 15.836 15 16.25 15C16.664 15 17 14.664 17 14.25V3.75C17 3.336 16.664 3 16.25 3Z"
					fill="currentColor"
				/>
				<path
					d="M13.539 7.988L7.983 3.967C7.602 3.691 7.102 3.652 6.681 3.866C6.261 4.08 5.99899 4.507 5.99899 4.979V6.5H2.75C1.785 6.5 1 7.285 1 8.25V9.75C1 10.715 1.785 11.5 2.75 11.5H6V13.021C6 13.493 6.261 13.919 6.681 14.134C6.862 14.226 7.056 14.271 7.25 14.271C7.508 14.271 7.76399 14.191 7.98199 14.033L13.538 10.012C13.862 9.778 14.055 9.399 14.055 8.999C14.055 8.599 13.861 8.221 13.538 7.987L13.539 7.988Z"
					fill="currentColor"
					fill-opacity="0.4"
				/>
			</svg>
		</button>

		<button
			class="controls-bar__btn"
			class:controls-bar__btn--looping={isLooping}
			type="button"
			aria-label="Toggle loop playback"
			aria-pressed={isLooping}
			onclick={toggleLoop}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<path
					d="M3 8a5 5 0 0 1 5-5h3.5M13 8a5 5 0 0 1-5 5H4.5"
					stroke="currentColor"
					stroke-width="1.5"
					fill="none"
					stroke-linecap="round"
				/>
				<path
					d="m10 1.5 2 1.5-2 1.5M6 11.5 4 13l2 1.5"
					stroke="currentColor"
					stroke-width="1.5"
					fill="none"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>

	<!-- Center: time / frame / rate display -->
	<div class="controls-bar__cluster controls-bar__cluster--center">
		<span class="controls-bar__time">{formatClockTime(currentTime)}</span>
		<span class="controls-bar__frames">{currentFrame} / {totalFrames}</span>
		<span class="controls-bar__rate">{engineState.transport.fps} fps</span>
	</div>

	<!-- Right: canvas framing controls -->
	<div class="controls-bar__cluster controls-bar__cluster--right">
		<button
			class="controls-bar__btn"
			type="button"
			aria-label="Zoom out"
			disabled={!canZoomOut}
			onclick={onZoomOut}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M4 8h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		</button>

		<button
			class="controls-bar__zoom"
			type="button"
			aria-label="Reset zoom to fit"
			onclick={onZoomFit}
		>
			{zoomLabel}
		</button>

		<button
			class="controls-bar__btn"
			type="button"
			aria-label="Zoom in"
			disabled={!canZoomIn}
			onclick={onZoomIn}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M8 4v8M4 8h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
		</button>

		<span class="controls-bar__divider" aria-hidden="true"></span>

		<button
			class="controls-bar__btn"
			class:controls-bar__btn--active={showCheckerboard && !backdropUrl}
			type="button"
			aria-label="Toggle checkerboard"
			onclick={onToggleCheckerboard}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<rect x="0" y="0" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
				<rect x="4" y="4" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
				<rect x="8" y="0" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
				<rect x="12" y="4" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
				<rect x="0" y="8" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
				<rect x="4" y="12" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
				<rect x="8" y="8" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
				<rect x="12" y="12" width="4" height="4" fill="currentColor" fill-opacity="0.7" />
			</svg>
		</button>

		{#if !IS_HOSTED_ORIGIN}
		<button
			class="controls-bar__btn"
			class:controls-bar__btn--active={backdropUrl !== null}
			type="button"
			aria-label="Pick reference backdrop"
			popovertarget="backdrop-menu"
			bind:this={backdropTriggerEl}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
				<path
					fill-rule="evenodd"
					clip-rule="evenodd"
					d="M2.00098 4.75C2.00098 3.23119 3.23217 2 4.75098 2H13.251C14.7698 2 16.001 3.23119 16.001 4.75V13.25C16.001 14.7688 14.7698 16 13.251 16H4.75098C3.23217 16 2.00098 14.7688 2.00098 13.25V4.75Z"
					fill="currentColor"
					fill-opacity="0.4"
				/>
				<path
					d="M16.001 13.25V12.1893L13.1953 9.38367C12.1214 8.30977 10.3806 8.30977 9.30667 9.38367L3.18172 15.5086C3.62674 15.8184 4.16765 16 4.75098 16H13.251C14.7698 16 16.001 14.7688 16.001 13.25Z"
					fill="currentColor"
				/>
				<path
					d="M6.25098 8.5C6.94138 8.5 7.50098 7.9404 7.50098 7.25C7.50098 6.5596 6.94138 6 6.25098 6C5.56058 6 5.00098 6.5596 5.00098 7.25C5.00098 7.9404 5.56058 8.5 6.25098 8.5Z"
					fill="currentColor"
				/>
			</svg>
		</button>
		{/if}

	</div>
</div>

<!-- Top-layer backdrop picker — opens upward from the trigger, thumbnails are
     the labels. Picking the active still again returns to the checkerboard. -->
<div
	class="backdrop-menu"
	id="backdrop-menu"
	popover
	bind:this={backdropMenuEl}
	ontoggle={onBackdropMenuToggle}
>
	{#if backdrops.length === 0}
		<span class="backdrop-menu__empty">No stills in static/backdrops/</span>
	{:else}
		{#each backdrops as backdrop (backdrop.url)}
			<button
				class="backdrop-menu__item"
				class:backdrop-menu__item--active={backdrop.url === backdropUrl}
				type="button"
				onclick={() => pickBackdrop(backdrop.url)}
			>
				<img class="backdrop-menu__thumb" src={backdrop.url} alt="" loading="lazy" />
				<span class="backdrop-menu__name">{backdrop.name}</span>
			</button>
		{/each}
	{/if}
</div>

<style>
	/* The transport deck — one full-width strip between viewer and timeline.
	   Step/play/loop left, the timecode readout dead-center, framing right. */
	.controls-bar {
		align-items: center;
		background: var(--chrome-deck);
		border-block-start: 1px solid var(--chrome-hairline);
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		min-block-size: 52px;
		padding-block: 0;
		padding-inline: 16px;
	}

	.controls-bar__cluster {
		display: flex;
		gap: 2px;
	}

	.controls-bar__cluster--center {
		align-items: baseline;
		gap: var(--vs-s);
		justify-content: center;
	}

	.controls-bar__btn.controls-bar__btn--play {
		background: var(--chrome-raised, #1a1a1d);
		border: 1px solid var(--chrome-hairline, #26262a);
		border-radius: 6px;
		block-size: 32px;
		color: var(--chrome-text);
		inline-size: 36px;
	}

	/* Loop-on reads in the transport cyan — the one hue reserved for
	   transport/selection chrome. */
	.controls-bar__btn--looping {
		color: #2de8ee;
	}

	.controls-bar__btn--looping:hover {
		color: #2de8ee;
	}

	.controls-bar__rate {
		border: 1px solid var(--chrome-hairline, #26262a);
		border-radius: 4px;
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.59375rem;
		font-weight: 400;
		padding: 2px 6px;
	}

	.controls-bar__cluster--right {
		justify-content: flex-end;
	}

	.controls-bar__btn {
		align-items: center;
		background: transparent;
		border: 0;
		border-radius: 6px;
		color: var(--chrome-muted);
		cursor: pointer;
		display: inline-flex;
		block-size: 30px;
		inline-size: 30px;
		justify-content: center;
		padding: 0;
		transition: background-color 100ms ease, color 100ms ease;
	}

	.controls-bar__btn:hover {
		background: var(--chrome-raised);
		color: var(--chrome-text);
	}

	.controls-bar__btn:disabled {
		color: var(--chrome-muted);
		cursor: default;
		opacity: 0.45;
	}

	.controls-bar__btn:disabled:hover {
		background: transparent;
	}

	/* Active view toggles read in the transport cyan, matching the loop state. */
	.controls-bar__btn--active {
		color: #2de8ee;
	}

	.controls-bar__btn--active:hover {
		color: #2de8ee;
	}

	/* Jump-to-start reuses the jump-to-end glyph, mirrored. */
	.controls-bar__flip {
		transform: scaleX(-1);
	}

	/* Zoom readout doubles as the fit/reset control (click → 100%). */
	.controls-bar__zoom {
		background: transparent;
		border: 1px solid var(--chrome-hairline);
		border-radius: 5px;
		color: var(--chrome-text);
		cursor: pointer;
		font-family: 'Paper Mono', monospace;
		font-size: 0.65625rem;
		font-weight: 400;
		min-inline-size: 3.1rem;
		padding-block: 4px;
		padding-inline: 9px;
		text-align: center;
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.controls-bar__zoom:hover {
		background: var(--chrome-raised);
	}

	.controls-bar__divider {
		align-self: center;
		background: var(--chrome-hairline);
		block-size: 20px;
		inline-size: 1px;
		margin-inline: 6px;
	}

	/* Top-layer backdrop picker — same popover treatment as the timeline add
	   menu: escapes clipping, opens upward, right-edge anchored to the trigger. */
	.backdrop-menu {
		background: var(--chrome-raised);
		border: 1px solid var(--chrome-hairline);
		border-radius: var(--br-s);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
		flex-direction: column;
		gap: var(--vs-xs);
		inset: auto;
		margin: 0;
		max-block-size: 60vh;
		opacity: 1;
		overflow-y: auto;
		padding: var(--vs-xs);
		position: fixed;
		transform: translateY(0) scale(1);
		transform-origin: bottom right;
		transition:
			opacity 120ms ease,
			transform 160ms var(--ease-smooth),
			overlay 160ms allow-discrete,
			display 160ms allow-discrete;
	}

	/* Layout display only while open — an unconditional author `display` beats
	   the UA's closed-popover display:none and leaves an invisible click-eating
	   overlay at the popover's static position. */
	.backdrop-menu:popover-open {
		display: flex;
	}

	.backdrop-menu:not(:popover-open) {
		opacity: 0;
		transform: translateY(6px) scale(0.97);
	}

	@starting-style {
		.backdrop-menu:popover-open {
			opacity: 0;
			transform: translateY(6px) scale(0.97);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop-menu {
			transition-duration: 1ms;
		}
	}

	.backdrop-menu__empty {
		color: var(--chrome-muted);
		font-size: 0.72rem;
		padding: var(--vs-xs) var(--vs-s);
		white-space: nowrap;
	}

	.backdrop-menu__item {
		background: transparent;
		border: 0;
		border-radius: 4px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 4px;
		text-align: start;
		transition: background-color 100ms ease;
	}

	.backdrop-menu__item:hover {
		background: var(--chrome-raised);
	}

	.backdrop-menu__thumb {
		aspect-ratio: 16 / 9;
		border-radius: 4px;
		display: block;
		inline-size: 11rem;
		object-fit: cover;
	}

	.backdrop-menu__item--active .backdrop-menu__thumb {
		box-shadow: 0 0 0 2px #ffd608;
	}

	.backdrop-menu__name {
		color: var(--chrome-muted);
		font-size: 0.72rem;
		padding-inline: 2px;
	}

	.backdrop-menu__item--active .backdrop-menu__name {
		color: var(--chrome-text);
	}

	.controls-bar__time {
		color: var(--chrome-text);
		font-family: 'Paper Mono', monospace;
		font-size: 1.1875rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.controls-bar__frames {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
	}
</style>
