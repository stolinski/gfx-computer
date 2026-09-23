/**
 * GFX-original text-animation effects — per the ADR-0011 amendment\'s
 * two-clause rule (per-unit AND CSS-rasterizable → catalog). Lives outside
 * `raw-catalog/` per the vendoring rule in `raw-catalog/CATALOG_SOURCE.md`
 * (modifications belong outside vendored files). `catalog.ts` merges these
 * into `TEXT_EFFECT_CATALOG` at module load alongside the upstream-vendored
 * effects.
 */

import kerningPop from './kerning-pop.json' with { type: 'json' };
import bracketPop from './bracket-pop.json' with { type: 'json' };
import weightResolve from './weight-resolve.json' with { type: 'json' };

export const GFX_TEXT_EFFECT_MODULES: Readonly<Record<string, unknown>> = {
	'kerning-pop': kerningPop,
	'bracket-pop': bracketPop,
	'weight-resolve': weightResolve
};
