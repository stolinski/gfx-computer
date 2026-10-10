/**
 * What a Scene boundary's magic move may carry
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §5):
 * the rules a pair must meet, as semantic findings with their paths, and the
 * pairs a boundary suggests. The format is `FilmMagicMoveSchema`
 * (`./film-schema.ts`); the frame is made in `./film-boundary-frame.ts`.
 *
 * Overlays are the one kind built. A pair's two Overlays are captured alone and
 * drawn as one quad over the composited frame, so an Overlay can be carried
 * only when a capture of it alone, placed by its measured box, is the Overlay
 * as its Scene shows it.
 */
import type { Overlay } from './engine-schema';
import type { Film, FilmMagicMovePair, FilmScene } from './film-schema';
import { getOverlayDefinition } from './pipelines/definition-registry';
import type { PresetSemanticIssue } from './preset-validation';

/**
 * Why a magic move cannot carry `overlay` of `scene`, as the end of a sentence
 * that names the Overlay, or `null` when it can.
 *
 * - **Its own shader pass.** The Overlay's pixels are made on the GPU over the
 *   whole composition, so a capture of its DOM alone holds none of them.
 * - **A depth stage.** Every Overlay of a staged Scene rides a plane the stage
 *   camera films (the shared plane at the Layer's depth, its own posed plane,
 *   or a body the stage draws), so where it lands in the frame is not where its
 *   DOM box is. Carrying one needs the plane projected through the stage camera
 *   to a quad in the frame, and the solo capture lit and focused as the stage
 *   does it.
 */
export function filmMagicMoveOverlayRefusal(scene: FilmScene, overlay: Overlay): string | null {
	if (getOverlayDefinition(overlay.type)?.ownShaderPass === true) {
		return `is a ${overlay.type} Overlay, which is drawn by its own shader pass and cannot be captured alone`;
	}
	if (scene.state.stage?.type === 'depth') {
		return `sits on the depth stage of Scene "${scene.id}", where the camera places every Overlay and its DOM box is not its place in the frame`;
	}
	return null;
}

function findSceneOverlay(scene: FilmScene, overlayId: string): Overlay | null {
	return scene.state.overlays.find((overlay) => overlay.id === overlayId) ?? null;
}

/**
 * Every magic-move pair a Film cannot carry, each at its own path under
 * `boundaries/<index>/magicMove/pairs/<pair>`:
 *
 * - an id its Scene does not hold, at `from/id` or `to/id`;
 * - an element already carried by an earlier pair of the same boundary, at
 *   that end's `id`;
 * - two Overlays of different types, at the pair;
 * - an Overlay a magic move refuses (`filmMagicMoveOverlayRefusal`), at that
 *   end's `id`.
 *
 * `film` must have one boundary per pair of neighbouring Scenes.
 */
export function listFilmMagicMoveIssues(film: Film): PresetSemanticIssue[] {
	const issues: PresetSemanticIssue[] = [];
	for (const [boundaryIndex, boundary] of film.boundaries.entries()) {
		if (boundary.kind === 'cut' || boundary.magicMove === undefined) continue;
		const scenes = {
			from: film.scenes[boundaryIndex],
			to: film.scenes[boundaryIndex + 1]
		};
		const carriedIds = { from: new Set<string>(), to: new Set<string>() };
		for (const [pairIndex, pair] of boundary.magicMove.pairs.entries()) {
			const pairPath = ['boundaries', boundaryIndex, 'magicMove', 'pairs', pairIndex];
			const overlays: { from: Overlay | null; to: Overlay | null } = { from: null, to: null };
			for (const end of ['from', 'to'] as const) {
				const scene = scenes[end];
				const { id } = pair[end];
				const path = [...pairPath, end, 'id'];
				if (carriedIds[end].has(id)) {
					issues.push({
						path,
						message: `Overlay "${id}" of Scene "${scene.id}" is already carried by an earlier pair of this boundary. An element is in one pair at most.`
					});
					continue;
				}
				carriedIds[end].add(id);
				const overlay = findSceneOverlay(scene, id);
				if (!overlay) {
					const overlayIds = scene.state.overlays.map((candidate) => candidate.id);
					issues.push({
						path,
						message: `Scene "${scene.id}" has no Overlay with id "${id}". ${
							overlayIds.length > 0 ? `Its Overlays are: ${overlayIds.join(', ')}.` : 'It has none.'
						}`
					});
					continue;
				}
				const refusal = filmMagicMoveOverlayRefusal(scene, overlay);
				if (refusal !== null) {
					issues.push({
						path,
						message: `A magic move cannot carry Overlay "${id}": it ${refusal}.`
					});
					continue;
				}
				overlays[end] = overlay;
			}
			if (overlays.from && overlays.to && overlays.from.type !== overlays.to.type) {
				issues.push({
					path: pairPath,
					message: `A magic move carries one element between two Scenes, so both ends are the same Overlay type. "${pair.from.id}" is a ${overlays.from.type} and "${pair.to.id}" is a ${overlays.to.type}.`
				});
			}
		}
	}
	return issues;
}

/**
 * The pairs a boundary suggests (ADR-0068 §5): every Overlay with the same id
 * and the same Overlay type in the boundary's two Scenes that a magic move can
 * carry, in the outgoing Scene's Layer order. The author confirms a suggestion;
 * nothing is paired until it is in `magicMove.pairs`.
 *
 * Throws a `RangeError` when the Film has no boundary at `boundaryIndex`.
 */
export function suggestFilmMagicMovePairs(film: Film, boundaryIndex: number): FilmMagicMovePair[] {
	if (
		!Number.isInteger(boundaryIndex) ||
		boundaryIndex < 0 ||
		boundaryIndex >= film.boundaries.length
	) {
		throw new RangeError(
			`The Film has ${film.boundaries.length} Scene boundaries; there is none at index ${boundaryIndex}.`
		);
	}
	const outgoing = film.scenes[boundaryIndex];
	const incoming = film.scenes[boundaryIndex + 1];
	const pairs: FilmMagicMovePair[] = [];
	for (const overlay of outgoing.state.overlays) {
		const partner = findSceneOverlay(incoming, overlay.id);
		if (!partner || partner.type !== overlay.type) continue;
		if (
			filmMagicMoveOverlayRefusal(outgoing, overlay) !== null ||
			filmMagicMoveOverlayRefusal(incoming, partner) !== null
		) {
			continue;
		}
		pairs.push({
			from: { kind: 'overlay', id: overlay.id },
			to: { kind: 'overlay', id: partner.id }
		});
	}
	return pairs;
}

/** True when two pairs name the same two elements. */
export function isSameFilmMagicMovePair(a: FilmMagicMovePair, b: FilmMagicMovePair): boolean {
	return (
		a.from.kind === b.from.kind &&
		a.from.id === b.from.id &&
		a.to.kind === b.to.kind &&
		a.to.id === b.to.id
	);
}

/** One pair as the inspector offers it: a toggle that names the Overlay. */
export interface FilmMagicMovePairChoice {
	pair: FilmMagicMovePair;
	/** The Overlay's display label, with its id only where two choices would read alike. */
	label: string;
	/** True when the boundary carries the pair now. */
	isCarried: boolean;
}

/**
 * The pairs a boundary's inspector lists: every pair it carries, in draw
 * order, then every suggested pair it does not carry yet. A carried pair that
 * is not a suggestion (two Overlays with different ids, set by an agent) is
 * listed too, so it can be taken off. A cut lists none.
 *
 * A pair is named for its Overlay type (`definition.label`). Its ids are added
 * when they differ from each other, or when another choice has the same name.
 *
 * Throws a `RangeError` when the Film has no boundary at `boundaryIndex`.
 */
export function listFilmMagicMovePairChoices(
	film: Film,
	boundaryIndex: number
): FilmMagicMovePairChoice[] {
	const suggested = suggestFilmMagicMovePairs(film, boundaryIndex);
	const boundary = film.boundaries[boundaryIndex];
	// A cut has no window to move an element through.
	if (boundary.kind === 'cut') return [];
	const carried = boundary.magicMove?.pairs ?? [];
	const outgoing = film.scenes[boundaryIndex];
	const choices = [
		...carried.map((pair) => ({ pair, isCarried: true })),
		...suggested
			.filter((pair) => !carried.some((carriedPair) => isSameFilmMagicMovePair(carriedPair, pair)))
			.map((pair) => ({ pair, isCarried: false }))
	].map(({ pair, isCarried }) => {
		const overlay = findSceneOverlay(outgoing, pair.from.id);
		const typeLabel = overlay
			? (getOverlayDefinition(overlay.type)?.label ?? overlay.type)
			: pair.from.id;
		return { pair, isCarried, typeLabel };
	});
	return choices.map(({ pair, isCarried, typeLabel }) => {
		const isNameShared = choices.filter((choice) => choice.typeLabel === typeLabel).length > 1;
		const ids =
			pair.from.id !== pair.to.id
				? `${pair.from.id} → ${pair.to.id}`
				: isNameShared && typeLabel !== pair.from.id
					? pair.from.id
					: null;
		return { pair, isCarried, label: ids === null ? typeLabel : `${typeLabel} · ${ids}` };
	});
}
