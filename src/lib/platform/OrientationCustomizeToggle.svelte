<script lang="ts">
	import { engineState } from './engine-state.svelte';
	import InspectorToggle from './InspectorToggle.svelte';

	// The one orientation-override control (ADR-0039 §4): every subject that can
	// be art-directed per orientation shows it in its section header. Turning it
	// on copies the values the active orientation shows now into that
	// orientation's own complete snapshot; turning it off deletes the snapshot,
	// so the orientation returns to the shared values. The owner supplies both
	// writes through `onchange`, each through that subject's own operation.

	interface Props {
		/** Whether the active orientation carries its own snapshot. */
		customized: boolean;
		onchange: (checked: boolean) => void;
		disabled?: boolean;
	}

	let { customized, onchange, disabled = false }: Props = $props();
	const label = $derived(`Customize ${engineState.transport.orientation}`);
</script>

<span class="orientation-customize" data-orientation-customize={engineState.transport.orientation}>
	<span class="orientation-customize__label" aria-hidden="true">{label}</span>
	<InspectorToggle checked={customized} {label} {onchange} {disabled} />
</span>

<style>
	.orientation-customize {
		align-items: center;
		display: inline-flex;
		gap: 6px;
	}

	.orientation-customize__label {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.66rem;
		white-space: nowrap;
	}
</style>
