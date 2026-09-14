<script lang="ts">
	import type { EffectEditorProps } from '$lib/platform/pipelines/types';
	import type { PixelationParams } from './index';

	let { effect = $bindable() }: EffectEditorProps<PixelationParams> = $props();
</script>

<label class="row">
	<span>Pixel size</span>
	<input
		value={effect.params.pixelSize ?? 48}
		oninput={(event) => (effect.params.pixelSize = Number(event.currentTarget.value))}
		max="256"
		min="1"
		step="1"
		type="range"
	/>
</label>
