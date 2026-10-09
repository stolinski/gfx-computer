<script lang="ts">
	import type { SurfaceType } from '$lib/platform/engine-schema';

	interface Props {
		type: SurfaceType;
	}

	let { type }: Props = $props();
</script>

<svg
	class="surface-icon"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if type === 'imessage'}
		<!-- chat bubble with a tail -->
		<path
			d="M4 8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3.5a3 3 0 0 1-3 3H9.5L6 18v-3.2A3 3 0 0 1 4 11.5Z"
		/>
		<path d="M8.5 9.5h7M8.5 12h4" />
	{:else if type === 'web-document' || type === 'website-screenshot'}
		<!-- browser window -->
		<rect x="3.5" y="5" width="17" height="14" rx="1.6" />
		<path d="M3.5 9h17" />
		<circle cx="6.2" cy="7" r="0.55" fill="currentColor" stroke="none" />
		<circle cx="8.4" cy="7" r="0.55" fill="currentColor" stroke="none" />
		<circle cx="10.6" cy="7" r="0.55" fill="currentColor" stroke="none" />
	{:else if type === 'newspaper'}
		<!-- masthead + two columns -->
		<rect x="3.5" y="4.5" width="17" height="15" rx="1" />
		<path d="M6.5 8h11" />
		<path d="M6.5 11.5h4.5M6.5 14h4.5M6.5 16.5h4.5" />
		<path d="M13 11.5h4.5M13 14h4.5M13 16.5h4.5" />
	{:else if type === 'paper'}
		<!-- document sheet with a folded corner -->
		<path d="M6.5 3.5h7L18 8v11.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" />
		<path d="M13.5 3.5V8H18" />
		<path d="M9 12h6M9 15h6M9 18h3.5" />
	{:else if type === 'plain'}
		<!-- three text lines -->
		<path d="M5 7.5h14M5 12h14M5 16.5h9" />
	{:else if type === 'chapter-card'}
		<!-- card with a kicker + title -->
		<rect x="4" y="6" width="16" height="12" rx="1.2" />
		<path d="M8 10.5h3" />
		<path d="M8 14h8" />
	{:else if type === 'title-sequence'}
		<!-- centered title stack -->
		<path d="M5 9h14" />
		<path d="M8 13h8" />
		<path d="M10 17h4" />
	{:else if type === 'type-hero'}
		<!-- Aa type specimen -->
		<path d="M4 17.5 7.3 7.5 10.6 17.5M5.1 14.2h4.4" />
		<circle cx="16.3" cy="14.5" r="2.6" />
		<path d="M18.9 11.9v5.6" />
	{:else if type === 'pullquote-on-photo'}
		<!-- photo frame -->
		<rect x="3.5" y="5" width="17" height="14" rx="1.4" />
		<circle cx="8.5" cy="9.5" r="1.3" />
		<path d="M4 16.5 9 12l3.5 3.2L16 12l4 4" />
	{:else}
		<rect x="4" y="5" width="16" height="14" rx="1.4" />
	{/if}
</svg>

<style>
	.surface-icon {
		block-size: 100%;
		display: block;
		inline-size: 100%;
	}
</style>
