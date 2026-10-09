<script lang="ts">
	import { engineState } from './engine-state.svelte';
	import { downloadBlob } from './export-video';
	import { readOpenFilmAsSavedPreset } from './film-state.svelte';
	import { presetToWireFormat } from './preset-pure';
	import {
		appendVisualVerificationIssues,
		verifyPresetArtifact,
		type PresetVerificationIssue
	} from './preset-verification';
	import { runVisualAudit } from './runtime-audit';
	import { compositionMeta } from './composition-meta.svelte';
	import InspectorSection from './InspectorSection.svelte';

	// Interchange: the live Preset artifact as JSON (export) plus the
	// schema+visual verification pass. "Verified" only shows while the
	// verified artifact matches the current composition byte-for-byte.
	const liveArtifact = $derived.by(() => {
		const preset = readOpenFilmAsSavedPreset();
		const wirePreset = presetToWireFormat(preset);
		return {
			preset,
			wirePreset,
			json: JSON.stringify(wirePreset),
			verification: verifyPresetArtifact(wirePreset)
		};
	});
	let verifiedArtifactJson = $state<string | null>(null);
	let verifiedVisualIssues = $state.raw<PresetVerificationIssue[]>([]);
	let lastVerificationPassed = $state(false);
	const isVerificationCurrent = $derived(verifiedArtifactJson === liveArtifact.json);
	const visibleVerificationIssues = $derived(
		isVerificationCurrent ? [...liveArtifact.verification.issues, ...verifiedVisualIssues] : []
	);
	const verificationPassed = $derived(isVerificationCurrent && lastVerificationPassed);

	function exportPresetJson(): void {
		const filename = compositionMeta.userCompositionSlug
			? `${compositionMeta.userCompositionSlug}.json`
			: 'composition.json';
		const blob = new Blob([`${JSON.stringify(liveArtifact.wirePreset, null, '\t')}\n`], {
			type: 'application/json'
		});
		downloadBlob(blob, filename);
	}

	function verifyCurrentComposition(): void {
		const result = appendVisualVerificationIssues(
			liveArtifact.verification,
			runVisualAudit(engineState, liveArtifact.preset.name)
		);
		verifiedVisualIssues = result.issues.filter((issue) => issue.source === 'visual');
		verifiedArtifactJson = liveArtifact.json;
		lastVerificationPassed = result.isValid;
	}

	function verificationIssueKey(issue: PresetVerificationIssue): string {
		return `${issue.source}:${issue.rule ?? ''}:${issue.path}:${issue.message}`;
	}
</script>

<InspectorSection label="Interchange / Validation">
	<div class="interchange-actions">
		<button type="button" class="export-btn" onclick={exportPresetJson}>Export JSON</button>
		<button type="button" class="export-btn" onclick={verifyCurrentComposition}>Verify</button>
	</div>
	{#if verificationPassed}
		<p class="validation-success" role="status">Verified</p>
	{/if}
	{#if visibleVerificationIssues.length > 0}
		<ul class="validation-issues" aria-label="Composition validation issues">
			{#each visibleVerificationIssues as issue (verificationIssueKey(issue))}
				<li class:error={issue.severity === 'error'}>
					<p>
						<span>{issue.source}{issue.rule ? ` / ${issue.rule}` : ''}</span>
						<code>{issue.path}</code>
					</p>
					{issue.message}
				</li>
			{/each}
		</ul>
	{/if}
</InspectorSection>

<style>
	.interchange-actions {
		display: grid;
		gap: var(--vs-xs);
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.export-btn {
		background: var(--chrome-raised);
		border: 1px solid var(--chrome-hairline);
		border-radius: 6px;
		color: var(--chrome-text);
		cursor: pointer;
		font-size: 0.75rem;
		font-weight: 600;
		padding-block: 6px;
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
		width: 100%;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--chrome-hairline);
	}

	.export-btn:focus-visible {
		border-color: #ffd608;
		outline: none;
	}

	.validation-success,
	.validation-issues {
		font-size: 0.75rem;
		margin: 0;
	}

	.validation-success {
		color: #3dbf6e;
		font-family: 'Paper Mono', monospace;
		font-weight: var(--fw-semibold);
	}

	.validation-issues {
		display: grid;
		gap: var(--vs-xs);
		list-style: none;
		padding: 0;
	}

	.validation-issues li {
		color: var(--chrome-text);
		line-height: 1.35;
	}

	.validation-issues li.error {
		color: #f0453d;
	}

	.validation-issues p {
		display: flex;
		gap: var(--vs-xs);
		margin: 0;
	}

	.validation-issues span,
	.validation-issues code {
		color: var(--chrome-muted);
		font-family: 'Paper Mono', monospace;
		font-size: 0.65rem;
	}

	.validation-issues code {
		overflow-wrap: anywhere;
	}
</style>
