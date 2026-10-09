/** GUI-layer state for the active composition's provenance (not engine state). */
export const compositionMeta = $state({
	isUserComposition: false,
	userCompositionSlug: null as string | null,
	/** The Starter the open Film's first Scene was seeded from; null for a Starter opened read-only. */
	forkedFrom: null as string | null,
	persistenceError: null as string | null
});
