<script lang="ts">
	import type { DiagramNode } from './engine-schema';
	import { uploadUserImage } from '$lib/platform/user-image-upload-transport';
	import Field from './Field.svelte';

	// A node's logo: an uploaded image drawn centred above the node. Its size
	// and gap are geometry, edited in the Geometry section.
	interface Props {
		primitive: DiagramNode;
	}

	let { primitive: el }: Props = $props();

	let logoUploadSequence = 0;

	async function handleLogoFileChange(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const uploadSequence = ++logoUploadSequence;
		input.setCustomValidity('');
		const file = input.files?.[0];
		if (!file) return;

		try {
			const logoUrl = await uploadUserImage(file);
			if (uploadSequence === logoUploadSequence) {
				el.logoUrl = logoUrl;
			}
		} catch (error: unknown) {
			console.error('Node logo image upload failed', error);
			if (uploadSequence === logoUploadSequence) {
				input.setCustomValidity(
					error instanceof Error ? error.message : 'Logo image upload failed'
				);
				input.reportValidity();
			}
		} finally {
			input.value = '';
		}
	}
</script>

<Field label="Logo">
	<input
		accept="image/png,image/jpeg,image/webp"
		aria-label="Choose logo image"
		onchange={handleLogoFileChange}
		type="file"
	/>
	{#if el.logoUrl}
		<button
			type="button"
			class="clear-btn"
			aria-label="Remove logo"
			onclick={() => (el.logoUrl = undefined)}>×</button
		>
	{/if}
</Field>

<style>
	.clear-btn {
		background: transparent;
		border: 0;
		color: var(--chrome-muted);
		cursor: pointer;
		flex: none;
		font-size: 1rem;
		line-height: 1;
		padding: 0 var(--vs-xs);
	}

	.clear-btn:hover {
		color: #f0453d;
	}
</style>
