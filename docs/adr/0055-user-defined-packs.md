# ADR-0055 — User-defined Packs: data-authored pack documents behind a store contract

## Status

**Canon (built 2026-09-01; amendments recorded below).** Ratified 2026-09-01 in planning with Scott and built the same day (epic `p4acg6e0`). Amends the 2026-07-10 pack-catalog ruling ([`../roadmap.md`](../roadmap.md) § The pack catalog): "no runtime pack loading" no longer holds for **user-authored local packs**. It still holds for the catalog: catalog Packs ship in the one shared app bundle, and nothing here adds per-customer builds or licensing gates.

Date: 2026-09-01

Builds on: [ADR-0014](0014-pack-preset-split.md) (Pack/Preset split), [ADR-0023](0023-pack-is-appearance-only.md) (appearance only), [ADR-0024](0024-role-resolution-core-fallback.md) (mandatory cores + specific → core fallback), [ADR-0032](0032-gui-agent-parity-authoring.md) (the User composition store model this mirrors), [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) (Pack-neutral deliverables), [ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md) (the development-only disk-store boundary), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (operations, families, receipts)

## Context

Every renderable Pack today is TypeScript compiled into the app bundle: a manifest module in `src/lib/packs/<slug>/`, side-effectful `@fontsource` imports, and a row in the static `PACK_REGISTRY`. Authoring one means a repo change, so every pack iteration — including the concierge lane the authoring playbook describes — runs through commits before a single pixel can be judged.

Meanwhile the User composition surface proved a different shape: one store contract (`UserCompositionStore`), a disk-backed origin backend for local development, source-aware resolution against the built-in corpus, and GUI ↔ agent parity over the same store. Users author compositions as data in their own files without touching the repo.

Three facts make the same shape cheap for Packs:

1. **A Pack manifest is already data.** `PackManifest` (`src/lib/platform/packs/types.ts`) is a JSON-serializable record — slug, label, description, a flat `roles` map, and `PackFont[]` declarations. The only code-bound part of a pack is `@font-face` registration.
2. **The safety contract already exists.** The ADR-0024 fallback floor (seven mandatory cores) plus `resolveAppearanceVars` guarantees any pack supplying the cores renders correctly under every Preset, and `src/lib/platform/packs/validation.ts` already validates manifests as data: cores, role contracts, chrome effects, font declarations.
3. **The font gate is registration-agnostic.** `fontsReady()` (`src/lib/platform/fonts.ts`) awaits `document.fonts.load()` over declared family/weight pairs — it does not care whether a face arrived via `@fontsource` or a runtime `FontFace`.

What was missing was a ruling on the three hard parts — fonts, portability, and the quality bar — which this ADR records.

## Decision

### A User Pack is a JSON document in a per-user store

A **User Pack** is a pack authored as a validated JSON document conforming to the `PackManifest` shape (plus `label`/`description` metadata and a recorded content hash), living in the user's files — never in the repo, never in the app bundle. It is served through a **`UserPackStore`** contract mirroring `UserCompositionStore`: list / load / fork / save / delete behind one interface, with the backend chosen by runtime profile.

- **v1 backend: the disk-backed origin store only** (`/api/user-packs`, app-data storage), development-profile only per the ADR-0053 boundary. The `public` demo profile does not expose pack authoring; its origin routes refuse, exactly as the composition routes do. A browser-scoped or cloud backend is a later backend behind the same contract, not a v1 obligation.
- Saves **fail closed**: the same structural validation the built-in packs pass at boot (mandatory cores, role contracts, chrome effect names/params, font declarations) runs on every save, and an invalid document is refused, not stored.

### Resolution: built-ins first, no shadowing, fail closed

Pack resolution becomes a two-source chain: the static `PACK_REGISTRY` first, then the user store. A User Pack slug that collides with a registered built-in slug is a validation error — user packs never shadow the catalog, so a Preset's `pack` field stays a plain string with no source qualifier. A composition referencing a User Pack that is absent from the store fails with an actionable error; nothing silently substitutes another look.

### Fonts: all of Google Fonts, materialized at authoring time, never fetched at render time

- A **vendored Google Fonts catalog manifest** (family → real weights, styles, and variable axes, snapshotted from the Google Fonts metadata by a repo script) is the validation authority. "Never synthesize cuts" is enforced offline and deterministically: a User Pack claiming a cut the family does not ship is refused at save.
- A **same-origin font cache** materializes claimed families at save/validation time: the origin downloads the woff2 files into app-data, pins them by content hash, and serves them same-origin thereafter. A save whose fonts cannot be materialized fails closed. Renders only ever load cached bytes — the "nothing fetched from a third party at render time" rule holds unchanged, and hash-pinning means a render never changes because Google updated a family in place.
- At runtime, User Pack faces register via the `FontFace` API against the cache URLs; `fontsReady()` grows active-pack awareness so dynamically registered packs gate capture exactly as bundled ones do. Built-in packs keep their `@fontsource` registration untouched.
- Licensing is a non-issue: everything on Google Fonts is OFL/Apache and self-hosting is explicitly permitted.

### Renderable, never catalog

A User Pack is renderable and selectable, and that is all:

- It never enters `PACK_CATALOG_REGISTRY`, is never Calibration Trio ratification input, and never appears in the creator catalog. Catalog admission stays exactly the human-owned bar it is today.
- Every deterministic deliverable gate stays scoped to `PACK_REGISTRY` built-ins: `verify-presets` pack gates, `probe-pack-diff`, calibration bundles, the layout-contract matrix. User packs are not deliverables and produce no verification evidence.
- **ADR-0039's Pack-neutrality obligation is judged against catalog Packs only.** Deliverable Presets owe nothing to any User Pack; a User Pack in turn gets the fallback-floor _correctness_ guarantee, and safe-area/layout obligations live with Presets and blank elements, not with packs. There is no aesthetic gate on a User Pack — the user's taste is the user's; any legibility signal is advisory, per the Critic's standing non-authority.

### Promotion is the playbook, not a button

The only path from User Pack to catalog is the existing authoring playbook: a User Pack that earns it is rebuilt as a real `src/lib/packs/<slug>/` pack — measured intake, structural claims, machine gates, Calibration Trio, Scott's ratification. The User Pack surface is the **drafting lane for the concierge pack pipeline**: iterate a customer's look live in the GUI with no repo commit per tweak, then promote deliberately. It is not an end-user theming feature and is not marketed as one.

### Every capability is an operation

Per ADR-0054, each User Pack capability (list, fork-from-built-in, save, delete, validate, and selecting one via the existing `appearance.set-pack`, which now accepts user slugs) is a row in the operation inventory, owned by the **`appearance`** family, reachable from both the GUI and its WebMCP tool, returning bounded receipts. No new family, no new transport, no tool that edits pack JSON by pointer.

### Portability is deferred, with the hook recorded

v1 assumes packs and compositions share a machine. The content hash recorded on every save is the future divergence-detection hook; standalone composition interchange does not yet embed pack documents, and a future cloud backend is one more `UserPackStore` implementation. None of that is built until demand activates it.

## Consequences

- The roadmap's pack-catalog section is amended: runtime pack loading exists for user-authored local packs; the catalog offer (shared bundle, one-at-a-time ratification) is unchanged.
- `getPack` callers move to the source-aware resolution chain; `fontsReady()`'s memoized all-registry sweep becomes active-pack-aware (its own comment already anticipated this).
- ADR-0053's development-only disk-store surface list grows the user pack store and font cache.
- The authoring playbook gains the promotion lane; `docs/user-composition-workflows.md` gains its pack sibling.
- What would reject this design later: evidence that runtime-loaded packs leak into deliverable verification evidence, or that the drafting lane erodes the catalog bar. Both are guarded by the registry scoping above; if either guard fails in practice, revisit here.

## Amendments at build (2026-09-01)

Each was decided with Scott during implementation and is the form that shipped:

- **File URLs resolve at save time, never in the snapshot.** The vendored Google Fonts catalog holds families, cuts, and axes only; the origin asks Google's CSS API for the current woff2 URLs when it materializes a claim, then pins the bytes by hash. Google versions and rotates those URLs, so a snapshotted one would fail saves for a font that still exists.
- **A fork takes the built-in's cores, User-Pack-materializable optional cores, chrome, and fonts — never its per-Pipeline overrides or built-in-only font aliases.** clean-light carries about a hundred such overrides and they beat the cores under ADR-0024, so a fork that copied them rendered as the built-in whatever its cores said. Built-in variable families use capture-safe `@fontsource` aliases such as `Geist Variable`; those aliases are not Google Fonts family names, so a fork omits the alias and `variable-weight-treatment` instead of claiming a face the User Pack cache cannot materialize. A User Pack may add the capability deliberately with the source Google family name only when the vendored catalog records a real `wght` axis covering its complete range. The drafting lane edits cores; a promoted pack authors its per-Pipeline claims in the repo.
- **Preset semantic validation gained a `packScope`** (`registry` default for every deliverable gate; `runtime` for the open document and drafts; `stored` for the composition store's own documents), so a composition whose User Pack was deleted still loads for rebinding and fails at resolution with the slug named.
- **Live preview beside the saved document.** The runtime keeps a preview manifest per slug while the author edits; a refused save restores the saved look on the render and keeps the draft in the editor with the issues named per role.
- **The store and font cache sit beside the composition store** in app data and inherit its verification jail through the composition variables; no new environment variable.
- **WebMCP rows** are `appearance.inspect-user-pack-store`, `fork-user-pack`, `save-user-pack`, `delete-user-pack`, `validate-user-pack`, gated by two store-answered preconditions that also require an open composition, so the cold page keeps its short menu and a browser-scoped host registers none. Their revision token is the document `contentHash`. `appearance.set-pack` accepts a User Pack slug beside the catalog enum. An agent's delete refuses while the open composition wears the pack; the GUI's delete rebinds first.
