/**
 * Loading the Pipeline renderers a composition needs before it becomes the open
 * document.
 *
 * The bundle is resolved from the document itself — its Surface, Blocks,
 * Annotations, Overlays, Effects, the Effects its Pack's chrome contributes to
 * a full-frame piece, and the transition effects its Scene boundaries name — and activation is additive,
 * so readying one document never unloads another's renderers.
 *
 * Any operation that changes what has to render resolves the prospective
 * document here before applying it. That covers more than convenience: a Pack
 * whose chrome Effect has not loaded renders a frame without its chrome, which
 * is silently wrong output rather than a visible failure.
 */
import {
	collectPresetRendererRequirements,
	collectScenePresetRendererRequirements
} from './pipelines/preset-renderer-requirements';
import { compositionEditHistory } from './composition-edit-history';
import { isFilmTransitionEffectBoundary } from './film-schema';
import { scenePresetsOfOpenFilm, type OpenFilmDocument } from './open-film-document';
import { getPack, UnknownPackError } from './packs/registry';
import { ensurePackLoaded } from './user-pack-runtime';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
import {
	refuseCompositionOperation,
	type CompositionOperationFailure
} from './composition-operation-preflight';

import type { Preset } from './engine-schema';
import type { PipelineRendererRequirements } from './pipelines/runtime-loader';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** The part of an open document that decides what has to render: the Film and its legacy envelope. */
export type FilmRendererSubject = Pick<OpenFilmDocument, 'film' | 'legacyPresetEnvelope'>;

/**
 * Load and activate every Pipeline renderer `document` needs. Rejects when a
 * renderer module cannot load, which is what stops an operation from applying a
 * document this browser could not draw.
 */
export async function ensureCompositionRenderersLoaded(document: Preset): Promise<void> {
	// ADR-0055: a User Pack lives in the store until it is loaded; resolve it
	// before the requirements read its chrome, and fail closed on an absent one.
	if ((await ensurePackLoaded(document.pack)).kind === 'missing') {
		throw new UnknownPackError(document.pack);
	}
	const bundle = await pipelineRendererRuntime.resolve(
		collectPresetRendererRequirements(document, { pack: getPack(document.pack) })
	);
	pipelineRendererRuntime.activate(bundle);
}

/**
 * What a Film needs to render, as one set of requirements: the union over its
 * Scenes, under the Film's one Pack (ADR-0068 §1), and the transition effect of
 * every boundary that names one (§4). The Pack must already be registered
 * (`ensurePackLoaded`).
 */
export function collectFilmRendererRequirements(
	document: FilmRendererSubject
): PipelineRendererRequirements {
	const sceneRequirements = collectScenePresetRendererRequirements(
		scenePresetsOfOpenFilm(document),
		{ pack: getPack(document.film.pack) }
	);
	// A boundary that is a transition effect composites its window with that
	// effect's renderer, so it is loaded with the Film too.
	return {
		...sceneRequirements,
		transitions: new Set([
			...sceneRequirements.transitions,
			...document.film.boundaries
				.filter(isFilmTransitionEffectBoundary)
				.map((boundary) => boundary.kind)
		])
	};
}

/**
 * Load and activate the Film's Pack and every Pipeline renderer any of its
 * Scenes needs, before the Film becomes the open document. A cut then swaps
 * engine state to a Scene whose renderers are already here, and never waits on
 * a module load (ADR-0068 §4). Rejects when the Pack is absent or a renderer
 * module cannot load.
 */
export async function ensureFilmRenderersLoaded(document: FilmRendererSubject): Promise<void> {
	if ((await ensurePackLoaded(document.film.pack)).kind === 'missing') {
		throw new UnknownPackError(document.film.pack);
	}
	pipelineRendererRuntime.activate(
		await pipelineRendererRuntime.resolve(collectFilmRendererRequirements(document))
	);
}

/**
 * The refusal an operation returns when this browser cannot load the renderers
 * its prospective document needs. `subject` names what pulled them in — the
 * Surface, the Pack, the Effect — so the caller learns which argument to change
 * rather than that "something failed".
 */
export async function refuseUnloadableCompositionRenderers(
	row: WebmcpOperationRow,
	prospective: Preset,
	subject: string
): Promise<CompositionOperationFailure | null> {
	try {
		await ensureCompositionRenderersLoaded(prospective);
		return null;
	} catch (cause) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'render_failed',
			`This browser could not load the renderers ${subject} needs: ${
				cause instanceof Error ? cause.message : 'a renderer module failed to load'
			}.`
		);
	}
}
