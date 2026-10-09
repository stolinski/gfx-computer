/**
 * What is wrong with a composition without rendering it, in one shape the
 * transaction core, the receipt, and the `validation` family all read
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §3).
 *
 * Three checks answer that question and they are not interchangeable. Schema
 * and semantic findings are blocking — a document carrying either is not a
 * composition the engine will load, so an edit that produces one is rejected
 * before it touches live state. Static-linter findings are advisory video
 * safety and readability (ADR-0025); an author is allowed to hold a piece in a
 * failing state mid-edit, so they travel in the receipt as findings that
 * appeared or cleared rather than as a refusal.
 */
import type { z } from 'zod';

import type { Preset } from './engine-schema';
import { sceneStateForPlayback, validateFilmSemantics } from './film-ingress';
import type { Film } from './film-schema';
import { getPresetBySlug } from './preset-catalog';
import { serializeCompositionState } from './preset-pure';
import { lintPreset } from './preset-rubric';
import { truncateMiddle } from '../utils/string';
import { validatePresetSemantics } from './preset-validation';

export type CompositionFindingSource = 'schema' | 'semantic' | 'lint';

export interface CompositionValidationFinding {
	source: CompositionFindingSource;
	/** The static-linter rule id, or `null` for schema and semantic findings. */
	rule: string | null;
	severity: 'error' | 'warn';
	/**
	 * Where the finding lands: a composition pointer for schema and semantic
	 * findings, the rubric's own dotted path for a static-linter finding.
	 */
	path: string;
	message: string;
}

/** A finding list trimmed to a receipt budget, still reporting its true size. */
export interface BoundedCompositionFindings {
	findings: readonly CompositionValidationFinding[];
	total: number;
	truncated: boolean;
}

export interface CompositionValidationFindingDelta {
	appeared: readonly CompositionValidationFinding[];
	cleared: readonly CompositionValidationFinding[];
}

/**
 * How long a finding message may run inside a receipt. Long enough to name the
 * field and the correction, short enough that a full receipt stays inside the
 * WebMCP result budget.
 */
export const COMPOSITION_FINDING_MESSAGE_MAX_LENGTH = 120;

function boundMessage(message: string): string {
	return truncateMiddle(message, COMPOSITION_FINDING_MESSAGE_MAX_LENGTH);
}

function formatCompositionPointerPath(path: readonly (string | number)[]): string {
	return path.length === 0 ? '' : `/${path.join('/')}`;
}

/** Schema findings for a document the composition schema rejected. */
export function describeCompositionSchemaFindings(
	error: z.ZodError
): readonly CompositionValidationFinding[] {
	return error.issues.map((issue) => ({
		source: 'schema' as const,
		rule: null,
		severity: 'error' as const,
		path: formatCompositionPointerPath(
			issue.path.map((part) =>
				typeof part === 'symbol' ? (part.description ?? part.toString()) : part
			)
		),
		message: boundMessage(issue.message)
	}));
}

/**
 * Schema-valid but not engine-loadable: unknown Pipeline variants, dangling
 * references, overlapping Video clips, unresolvable transition endpoints.
 */
export function collectCompositionSemanticFindings(
	document: Preset
): readonly CompositionValidationFinding[] {
	return validatePresetSemantics(document, {
		resolvePreset: getPresetBySlug,
		packScope: 'runtime'
	}).map((issue) => ({
		source: 'semantic' as const,
		rule: null,
		severity: 'error' as const,
		path: formatCompositionPointerPath(issue.path),
		message: boundMessage(issue.message)
	}));
}

/** Objective video-safety and readability findings (ADR-0025). Advisory, never blocking. */
export function collectCompositionLintFindings(
	document: Preset
): readonly CompositionValidationFinding[] {
	return lintPreset(document).map((issue) => ({
		source: 'lint' as const,
		rule: issue.rule,
		severity: issue.severity,
		path: issue.path,
		message: boundMessage(issue.message)
	}));
}

/** Every semantic and static-linter finding a loaded composition carries. */
export function collectCompositionValidationFindings(
	document: Preset
): readonly CompositionValidationFinding[] {
	return [
		...collectCompositionSemanticFindings(document),
		...collectCompositionLintFindings(document)
	];
}

/**
 * Why a schema-valid Film is not one the engine can open: every Scene's own
 * semantic findings under `/scenes/<index>/state/...`, the Pack once at
 * `/pack`, and the rules that tie the Film's lists together (`validateFilmSemantics`).
 */
export function collectFilmSemanticFindings(film: Film): readonly CompositionValidationFinding[] {
	return validateFilmSemantics(film, {
		resolvePreset: getPresetBySlug,
		packScope: 'runtime'
	}).map((issue) => ({
		source: 'semantic' as const,
		rule: null,
		severity: 'error' as const,
		path: formatCompositionPointerPath(issue.path),
		message: boundMessage(issue.message)
	}));
}

/**
 * Every semantic and static-linter finding a Film carries. Each Scene is linted
 * as the Preset it would be alone, and its findings keep the rubric's dotted
 * path under `scenes.<index>`.
 */
export function collectFilmValidationFindings(film: Film): readonly CompositionValidationFinding[] {
	const findings: CompositionValidationFinding[] = [...collectFilmSemanticFindings(film)];
	for (const [sceneIndex, scene] of film.scenes.entries()) {
		const sceneAsPreset = serializeCompositionState(
			{ name: film.name, description: film.description, kind: 'deliverable' },
			sceneStateForPlayback(film, scene.id),
			film.pack
		);
		for (const finding of collectCompositionLintFindings(sceneAsPreset)) {
			findings.push({ ...finding, path: `scenes.${sceneIndex}.${finding.path}` });
		}
	}
	return findings;
}

function findingKey(finding: CompositionValidationFinding): string {
	return `${finding.source}|${finding.rule ?? ''}|${finding.path}|${finding.message}`;
}

/** The findings an edit introduced, and the ones it resolved. */
export function diffCompositionValidationFindings(
	previous: readonly CompositionValidationFinding[],
	next: readonly CompositionValidationFinding[]
): CompositionValidationFindingDelta {
	const previousKeys = new Set(previous.map(findingKey));
	const nextKeys = new Set(next.map(findingKey));
	return {
		appeared: next.filter((finding) => !previousKeys.has(findingKey(finding))),
		cleared: previous.filter((finding) => !nextKeys.has(findingKey(finding)))
	};
}

export function boundCompositionFindings(
	findings: readonly CompositionValidationFinding[],
	limit: number
): BoundedCompositionFindings {
	if (!Number.isSafeInteger(limit) || limit < 0) {
		throw new TypeError('Bounded composition findings require a non-negative integer limit.');
	}
	return {
		findings: findings.slice(0, limit),
		total: findings.length,
		truncated: findings.length > limit
	};
}

export function formatCompositionValidationFindings(
	findings: readonly CompositionValidationFinding[]
): string {
	return findings.map((finding) => `${finding.path || '<root>'}: ${finding.message}`).join('\n');
}
