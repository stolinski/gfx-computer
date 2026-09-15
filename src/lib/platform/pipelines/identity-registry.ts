/**
 * Identity registry — pairs registered Pipelines with their Identity Specs
 * (per ADR-0015), gating Pack-resolved dimensions per ADR-0019.
 *
 * The validator below is called at engine boot via
 * `validateIdentityRegistry`. It refuses to start when:
 *   - any Pipeline\'s Identity Spec dimension is neither
 *     `implementation`-declared nor `viaPack`-declared
 *   - the active Pack manifest does not resolve a `viaPack` Role any
 *     registered Pipeline references
 *
 * `validatePackCoreVocabulary` below is the companion Pack-side gate
 * (ADR-0024): EVERY registered Pack must supply the seven mandatory core Roles
 * with resolver-recognised values — run at boot for the whole PACK_REGISTRY
 * and in `scripts/verify-presets.ts`.
 *
 * The registry pairs Pipeline `type` strings (or annotation `style` strings)
 * with their Identity Spec. Keeping the pairing here, separate from the
 * Pipeline renderer modules themselves, avoids touching 23 `index.ts` files
 * just to add an import — each Pipeline\'s identity.ts can land
 * independently of its index.ts.
 */

import type { IdentitySpec } from './identity';
import { collectViaPackRoles } from './identity';
import {
	getPackRoleContract,
	packRoleHasPipelineConsumer,
	packRolePayload
} from '$lib/platform/packs/role-contract-registry';
import {
	MANDATORY_CORE_ROLES,
	type MandatoryCoreRole,
	type PackManifest,
	type PackRole
} from '$lib/platform/packs/types';

// Surfaces
import { newspaperIdentity } from '$lib/pipelines/surfaces/newspaper/identity';
import { paperIdentity } from '$lib/pipelines/surfaces/paper/identity';
import { plainIdentity } from '$lib/pipelines/surfaces/plain/identity';
import { brandMarkIdentity } from '$lib/pipelines/surfaces/brand-mark/identity';
import { chapterCardIdentity } from '$lib/pipelines/surfaces/chapter-card/identity';
import { pullquoteOnPhotoIdentity } from '$lib/pipelines/surfaces/pullquote-on-photo/identity';
import { titleSequenceIdentity } from '$lib/pipelines/surfaces/title-sequence/identity';
import { typeHeroIdentity } from '$lib/pipelines/surfaces/type-hero/identity';
import { webDocumentIdentity } from '$lib/pipelines/surfaces/web-document/identity';
import { websiteScreenshotIdentity } from '$lib/pipelines/surfaces/website-screenshot/identity';
import { imessageIdentity } from '$lib/pipelines/surfaces/imessage/identity';
import { checklistIdentity } from '$lib/pipelines/surfaces/checklist/identity';

// Captions track
import { captionsIdentity } from '$lib/pipelines/captions/identity';

// Blocks
import { barChartIdentity } from '$lib/pipelines/blocks/bar-chart/identity';
import { columnChartIdentity } from '$lib/pipelines/blocks/column-chart/identity';
import { dotFieldChartIdentity } from '$lib/pipelines/blocks/dot-field-chart/identity';
import { edgeArrowIdentity } from '$lib/pipelines/blocks/edge-arrow/identity';
import { labelIdentity } from '$lib/pipelines/blocks/label/identity';
import { kineticWordIdentity } from '$lib/pipelines/blocks/kinetic-word/identity';
import { nodeIdentity } from '$lib/pipelines/blocks/node/identity';
import { paragraphIdentity } from '$lib/pipelines/blocks/paragraph/identity';
import { statCalloutIdentity } from '$lib/pipelines/blocks/stat-callout/identity';
import { timelineSegmentIdentity } from '$lib/pipelines/blocks/timeline-segment/identity';
import { lineChartIdentity } from '$lib/pipelines/blocks/line-chart/identity';
import { unitGridChartIdentity } from '$lib/pipelines/blocks/unit-grid-chart/identity';

// Annotations
import { boxIdentity } from '$lib/pipelines/annotations/box/identity';
import { circleIdentity } from '$lib/pipelines/annotations/circle/identity';
import { highlightIdentity } from '$lib/pipelines/annotations/highlight/identity';
import { isolateIdentity } from '$lib/pipelines/annotations/isolate/identity';
import { liftOutIdentity } from '$lib/pipelines/annotations/lift-out/identity';
import { magnifyIdentity } from '$lib/pipelines/annotations/magnify/identity';
import { sideNoteIdentity } from '$lib/pipelines/annotations/side-note/identity';
import { strikeIdentity } from '$lib/pipelines/annotations/strike/identity';
import { tearOutIdentity } from '$lib/pipelines/annotations/tear-out/identity';
import { underlineIdentity } from '$lib/pipelines/annotations/underline/identity';

// Overlays
import { achievementIdentity } from '$lib/pipelines/overlays/achievement/identity';
import { counterIdentity } from '$lib/pipelines/overlays/counter/identity';
import { dimensionalTypeIdentity } from '$lib/pipelines/overlays/dimensional-type/identity';
import { cursorTrailIdentity } from '$lib/pipelines/overlays/cursor-trail/identity';
import { instagramFollowIdentity } from '$lib/pipelines/overlays/instagram-follow/identity';
import { instanceStackIdentity } from '$lib/pipelines/overlays/instance-stack/identity';
import { lowerThirdIdentity } from '$lib/pipelines/overlays/lower-third/identity';
import { shaderFillIdentity } from '$lib/pipelines/overlays/shader-fill/identity';
import { text3dIdentity } from '$lib/pipelines/overlays/text-3d/identity';
import { tweetStackIdentity } from '$lib/pipelines/overlays/tweet-stack/identity';
import { washiTapeIdentity } from '$lib/pipelines/overlays/washi-tape/identity';
import { watermarkIdentity } from '$lib/pipelines/overlays/watermark/identity';
import { youtubeSubscribeIdentity } from '$lib/pipelines/overlays/youtube-subscribe/identity';
import { sourceUrlIdentity } from '$lib/pipelines/overlays/source-url/identity';

export const IDENTITY_REGISTRY: Readonly<Record<string, IdentitySpec>> = {
	// Surfaces
	'surface:newspaper': newspaperIdentity,
	'surface:paper': paperIdentity,
	'surface:plain': plainIdentity,
	'surface:brand-mark': brandMarkIdentity,
	'surface:chapter-card': chapterCardIdentity,
	'surface:pullquote-on-photo': pullquoteOnPhotoIdentity,
	'surface:title-sequence': titleSequenceIdentity,
	'surface:type-hero': typeHeroIdentity,
	'surface:web-document': webDocumentIdentity,
	'surface:website-screenshot': websiteScreenshotIdentity,
	'surface:imessage': imessageIdentity,
	'surface:checklist': checklistIdentity,

	// Captions track
	'captions:track': captionsIdentity,

	// Blocks
	'block:paragraph': paragraphIdentity,
	'block:kinetic-word': kineticWordIdentity,
	'block:node': nodeIdentity,
	'block:edge-arrow': edgeArrowIdentity,
	'block:label': labelIdentity,
	'block:stat-callout': statCalloutIdentity,
	'block:timeline-segment': timelineSegmentIdentity,
	'block:bar-chart': barChartIdentity,
	'block:column-chart': columnChartIdentity,
	'block:line-chart': lineChartIdentity,
	'block:unit-grid-chart': unitGridChartIdentity,
	'block:dot-field-chart': dotFieldChartIdentity,

	// Annotations (keyed by style)
	'annotation:box': boxIdentity,
	'annotation:circle': circleIdentity,
	'annotation:highlight': highlightIdentity,
	'annotation:isolate': isolateIdentity,
	'annotation:lift-out': liftOutIdentity,
	'annotation:magnify': magnifyIdentity,
	'annotation:side-note': sideNoteIdentity,
	'annotation:strike': strikeIdentity,
	'annotation:tear-out': tearOutIdentity,
	'annotation:underline': underlineIdentity,

	// Overlays
	'overlay:achievement': achievementIdentity,
	'overlay:counter': counterIdentity,
	'overlay:dimensional-type': dimensionalTypeIdentity,
	'overlay:cursor-trail': cursorTrailIdentity,
	'overlay:instance-stack': instanceStackIdentity,
	'overlay:lower-third': lowerThirdIdentity,
	'overlay:text-3d': text3dIdentity,
	'overlay:tweet-stack': tweetStackIdentity,
	'overlay:shader-fill': shaderFillIdentity,
	'overlay:washi-tape': washiTapeIdentity,
	'overlay:watermark': watermarkIdentity,
	'overlay:youtube-subscribe': youtubeSubscribeIdentity,
	'overlay:instagram-follow': instagramFollowIdentity,
	'overlay:source-url': sourceUrlIdentity
};

/**
 * Every pipeline key whose Identity Spec declares FULL Pack-immunity
 * (ADR-0038 — `packImmunity` present with no `claimable` slots). The Critic's
 * two-Pack pixel-diff regression check enumerates the NON-immune pipelines
 * from this list's complement over `IDENTITY_REGISTRY` — a pipeline that
 * ignores the Pack without appearing here is a bug, not an exemption.
 * PARTIALLY immune pipelines (ADR-0039 §2 — `claimable` present) are
 * deliberately NOT in this list: their claimable chrome must still visibly
 * respond to a pack swap, so the diff lock keeps them in the must-change set
 * (the expected delta is chrome-scale, not document-scale).
 */
export const PACK_IMMUNE_PIPELINE_KEYS: readonly string[] = Object.entries(IDENTITY_REGISTRY)
	.filter(
		([, spec]) => spec.packImmunity !== undefined && spec.packImmunity.claimable === undefined
	)
	.map(([pipelineKey]) => pipelineKey);

/**
 * Registry-visible immunity query (ADR-0038): does this pipeline's Identity
 * Spec declare its artifact FULLY Pack-immune? Keys use the registry shape
 * (`surface:imessage`, `annotation:highlight`, …). Unregistered keys are not
 * immune. A partially immune pipeline (ADR-0039 §2) answers false here — its
 * mounts inject a filtered var set instead of skipping injection; use
 * `isAppearanceSlotPackClaimable` / `filterPackAppearanceVarsForImmunity` for
 * the per-slot decision.
 */
export function isPackImmune(pipelineKey: string): boolean {
	const immunity = IDENTITY_REGISTRY[pipelineKey]?.packImmunity;
	return immunity !== undefined && immunity.claimable === undefined;
}

/**
 * Per-slot immunity query (ADR-0039 §2 partial substrate immunity): may the
 * active Pack claim this appearance slot on this pipeline? Slot names are
 * Role suffixes (`'accent'`, `'kicker-ink'`, `'depth'`, `'edge'`, `'fill'`,
 * …). No immunity declared ⇒ every slot is claimable; full immunity ⇒ none
 * is; partial immunity ⇒ exactly the declared `claimable` slots are.
 * Structural consumers (edge/depth/print resolution in renderer code) gate
 * their Pack reads on this; CSS-var consumers go through
 * `filterPackAppearanceVarsForImmunity`.
 */
export function isAppearanceSlotPackClaimable(pipelineKey: string, slot: string): boolean {
	const immunity = IDENTITY_REGISTRY[pipelineKey]?.packImmunity;
	if (immunity === undefined) return true;
	return immunity.claimable?.includes(slot) ?? false;
}

/**
 * Filter a `resolveAppearanceVars` result down to what this pipeline's
 * immunity declaration lets the Pack claim (ADR-0039 §2): unchanged for a
 * non-immune pipeline, empty for a fully immune one, and only the claimable
 * chrome slots for a partially immune one. Var names are `--<suffix>`; the
 * suffix is matched against the `claimable` slot list verbatim.
 */
export function filterPackAppearanceVarsForImmunity(
	pipelineKey: string,
	vars: Record<string, string>
): Record<string, string> {
	const immunity = IDENTITY_REGISTRY[pipelineKey]?.packImmunity;
	if (immunity === undefined) return vars;
	const claimable = immunity.claimable;
	if (claimable === undefined) return {};
	return Object.fromEntries(
		Object.entries(vars).filter(([name]) => claimable.includes(name.slice('--'.length)))
	);
}

export interface IdentityValidationError {
	pipeline: string;
	kind:
		| 'unimplemented-dimension'
		| 'both-impl-and-via-pack'
		| 'unknown-pack-role-contract'
		| 'pack-role-consumer-mismatch'
		| 'missing-pack-role';
	dimension?: string;
	role?: string;
	message: string;
}

/**
 * Validate every registered Identity Spec against the active Pack manifest.
 * Returns the list of errors; empty list means valid. The engine boot path
 * should refuse to start if this returns a non-empty list.
 *
 * Per ADR-0019, a dimension must declare exactly one of `implementation` or
 * `viaPack`. The shared type already enforces this at the type level
 * (`& ({ implementation; viaPack?: never } | { implementation?: never;
 * viaPack })`); the runtime check catches dimensions that bypassed the type
 * via `as` casts.
 */
export function validateIdentityRegistry(
	manifest: PackManifest
): readonly IdentityValidationError[] {
	const errors: IdentityValidationError[] = [];

	for (const [pipelineKey, spec] of Object.entries(IDENTITY_REGISTRY)) {
		for (const dim of spec.dimensions) {
			// Preserve the shared field before the exclusive union narrows malformed
			// runtime-only branches to `never`.
			const dimensionName = dim.name;
			const hasImpl = dim.implementation !== undefined;
			const hasViaPack = dim.viaPack !== undefined;

			if (!hasImpl && !hasViaPack) {
				errors.push({
					pipeline: pipelineKey,
					kind: 'unimplemented-dimension',
					dimension: dimensionName,
					message: `Pipeline ${pipelineKey} dimension "${dimensionName}" declares neither implementation nor viaPack.`
				});
				continue;
			}

			if (hasImpl && hasViaPack) {
				errors.push({
					pipeline: pipelineKey,
					kind: 'both-impl-and-via-pack',
					dimension: dimensionName,
					message: `Pipeline ${pipelineKey} dimension "${dimensionName}" declares both implementation and viaPack; exactly one is allowed.`
				});
			}
		}

		for (const role of collectViaPackRoles(spec)) {
			const contract = getPackRoleContract(role);
			if (contract === undefined) {
				errors.push({
					pipeline: pipelineKey,
					kind: 'unknown-pack-role-contract',
					role,
					message: `Pipeline ${pipelineKey} references unknown Pack Role contract "${role}".`
				});
			} else if (!packRoleHasPipelineConsumer(role, pipelineKey)) {
				errors.push({
					pipeline: pipelineKey,
					kind: 'pack-role-consumer-mismatch',
					role,
					message: `Pack Role "${role}" does not declare ${pipelineKey} as a real pixel consumer.`
				});
			}
			if (!(role in manifest.roles)) {
				errors.push({
					pipeline: pipelineKey,
					kind: 'missing-pack-role',
					role,
					message: `Pack "${manifest.slug}" does not resolve Role "${role}" referenced by ${pipelineKey}.`
				});
			}
		}
	}

	return errors;
}

export interface PackCoreVocabularyError {
	pack: string;
	role: MandatoryCoreRole;
	kind: 'missing-core-role' | 'invalid-core-value';
	message: string;
}

/**
 * Validate a Pack's mandatory core vocabulary (ADR-0024): every registered
 * Pack — not just the completeness-reference one — must supply all seven core
 * Roles (`fill` / `ink` / `accent` / `field` / `edge` / `depth` /
 * `light`-treatment) with values their resolvers recognise, so the specific → core fallback
 * chain always lands on a real value and no CanvasSource literal fallback
 * decides a Pack's pixels. Returns the list of errors; empty means valid.
 */
export function validatePackCoreVocabulary(
	manifest: PackManifest
): readonly PackCoreVocabularyError[] {
	const errors: PackCoreVocabularyError[] = [];

	for (const core of MANDATORY_CORE_ROLES) {
		const role: PackRole | undefined = manifest.roles[core];
		if (role === undefined) {
			errors.push({
				pack: manifest.slug,
				role: core,
				kind: 'missing-core-role',
				message: `Pack "${manifest.slug}" is missing the mandatory core Role "${core}".`
			});
			continue;
		}

		const contract = getPackRoleContract(core);
		if (
			contract === undefined ||
			contract.availability !== 'mandatory' ||
			role.kind !== contract.permittedKind ||
			!contract.validateValue(packRolePayload(role))
		) {
			errors.push({
				pack: manifest.slug,
				role: core,
				kind: 'invalid-core-value',
				message: `Pack "${manifest.slug}" core Role "${core}" has an unrecognised value (expected ${contract?.valueDescription ?? 'a mandatory closed Role contract'}).`
			});
		}
	}

	return errors;
}

/**
 * Assert a Pack's mandatory core vocabulary is complete and well-shaped.
 * Throws a single aggregated error if not. Called at engine boot for every
 * Pack in the registry.
 */
export function assertPackCoreVocabularyValid(manifest: PackManifest): void {
	const errors = validatePackCoreVocabulary(manifest);
	if (errors.length === 0) {
		return;
	}
	const summary = errors.map((e) => `  - ${e.message}`).join('\n');
	throw new Error(
		`Pack core-vocabulary validation failed for "${manifest.slug}" (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${summary}`
	);
}

/**
 * Assert that the identity registry validates against the active Pack.
 * Throws a single aggregated error if validation fails. Called at engine
 * boot.
 */
export function assertIdentityRegistryValid(manifest: PackManifest): void {
	const errors = validateIdentityRegistry(manifest);
	if (errors.length === 0) {
		return;
	}
	const summary = errors.map((e) => `  - ${e.message}`).join('\n');
	throw new Error(
		`Identity registry validation failed against Pack "${manifest.slug}" (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${summary}`
	);
}
