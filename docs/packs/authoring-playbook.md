# Pack Authoring Playbook

The repeatable pipeline for authoring a **Pack** — distilled from the sessions that proved it (the Syntax re-dress to the real brand, 2026-07-09, and the CRT Terminal tube-chrome payoff, 2026-07-10). Any pack-authoring session — house archetype or concierge customer pack — follows this checklist top to bottom. The catalog rule binds throughout: **one pack at a time; a pack enters the catalog only with a Scott-ratified Calibration Trio** (see `docs/CONTEXT.md` § Pack catalog).

The one-sentence law everything below serves: **brand tokens ≠ brand grammar.** A pack that only swaps hue + font reads as one design system in a new colorway (the honest verdict on the first CRT demo: "it's just colors really"). A real pack claims _structural_ roles — depth, edge, material, form, chrome — and at least one inversion that changes what the element **is**, not what color it wears.

---

## 1 — Intake (no ceremony)

Accept whatever brand material exists; do not demand a formal brief:

- **A brand doc / style guide** — treat stated tokens as claims to verify, not truth.
- **CSS / a repo** — the strongest source. Real computed values beat any doc (the Syntax truth was `github.com/randyrektor/syntax-overlay`'s CSS, not the old aesthetic doc).
- **A website** — screenshot at real scale, read computed styles, eyedrop real pixels.
- **A house archetype** (catalog work) — a direction line plus a reference reel you assemble.

The intake bar: **enough real pixels to ground every claim.** Never author a value from memory of a brand or from taste alone — measure it, or derive it from a measured neighbor and say so in a comment.

## 2 — Extract the contract

Distill the material into the pack's contract _before_ writing a manifest line:

1. **Tokens.** Palette as a job table (field, card/plate, ink ladder, accent(s), semantic colors), each value measured. Note the saturated-hue budget (Q4: ≤ 3 visible at once).
2. **Voice + label voice, at TRUE font cuts.** Identify the display face and the label/chrome face. For every weight/stretch you intend to claim, verify the cut **exists** (check the `@fontsource` package's actual files). **Never synthesize weight or stretch** — Space Grotesk has no 900/condensed; the browser's synthetic squeeze rendered off-brand and this is now a form-suffix (`stretch`) a pack must claim honestly. When the Pack supports kinetic weight, import a distinct real variable face and declare `variable-weight-treatment` with an art-directed minimum/rest/maximum inside that face's actual `wght` range. List all three coordinates under that variable family in `manifest.fonts` so capture preloads them; do not replace the ordinary static face or expose the font's technical maximum when the brand would never use it.
3. **Card/chrome system, proportioned to the ELEMENT.** Extract _ratios of the element_, not absolute pixels: border ≈ N% of card height, radius ≈ N%, shadow steps ≈ N%, padding ≈ N%. The first Syntax pass scaled 1080p values ×2 for the 4K frame and rendered hairline — chrome scales with the card it dresses, not the frame it sits in.
4. **Motion grammar.** Which parts of the shared motion vocabulary the brand leans into and out of (Syntax: settled-place, stroke-draw, no gloss sweeps; CRT: sharp snaps, decay exits, "a machine does not wobble"). A Pack never adds motion — ADR-0023 — but the aesthetic doc must say which intrinsic moves read on-brand so Preset authors choose well.
5. **Sound is outside the Pack contract.** Sound resolves through engine-default event samples plus per-motion `sound.event`, `sound.sample`, and `sound.mute` overrides. A Pack carries appearance only; do not encode a brand sound palette in its manifest or aesthetic contract.
6. **Substrate ≠ chrome.** Found artifacts keep their own physics only when their Pipeline's Identity Spec declares Pack immunity. Only what the _channel adds_ — cards, chips, lower-thirds, diagram strokes — should wear the Pack. `PACK_IMMUNE_PIPELINE_KEYS` is the complete runtime authority; never infer or copy its contents from substrate categories.
7. **Capability ≠ brand membership.** The engine's features are not all this brand's features. A pack may rule a capability out of its aesthetic (CRT forbids tape) — but it still supplies **defensive values** for that capability's roles, so a re-skinned Preset that carries it anyway can't leak another pack's tones. Never curate the engine or the Critics to one pack (`docs/adr/` — the engine stays general).

## 3 — Author the artifacts

Anatomy of a pack (three files + one registration):

1. **`src/lib/packs/<slug>/fonts.ts`** — `@fontsource` side-effect imports (self-hosted; nothing fetched at render time) plus the exported `PackFont[]` declaration. Family strings must match the `font-family` values the roles reference **exactly**; declare every weight you claim so capture gates on real cuts. The family named first in `font-treatment` must appear here — HTML-in-Canvas capture awaits it before rasterizing.
2. **`src/lib/packs/<slug>/manifest.ts`** — in this order:
   - **The seven mandatory cores** (`fill/ink/accent/field/edge/depth/light-treatment`, ADR-0024). `validatePackCoreVocabulary` refuses the pack at boot without them. These are the fallback floor — every unclaimed slot in every pipeline eventually lands here, so choose values that survive _anywhere_. `field-treatment` is the pack's full-frame field (what `backgroundFill: "pack"` renders, ADR-0039 §3) — it is NOT the card `fill-treatment`; on dark packs the two differ completely (syntax: cream cards on a warm-black field).
   - **Optional cores** where the brand claims them: `field-ink-treatment` (foreground paired with `field-treatment` for direct-on-field content; falls back to `ink-treatment`), `font-treatment` (the universal type voice, emitted as `--font`), `font-label-treatment` (pairs a label/chrome voice with the display voice), `material-treatment` (grain/scanline — how ink sits on the substrate).
   - **`chrome` role** (kind `'chrome'`) only if the brand dresses opaque pieces — an effect recipe `composition-frame-renderer.ts` appends after the preset's own effects **only when `backgroundFill` is declared** (`appendPackChrome`). Chrome never appears in preset JSON, and transparent overlays never get it. The GUI shows it read-only with a PACK tag — invisible auto-applied treatments read as bugs.
   - **Per-pipeline overrides** only where the pack diverges — the chain is specific → core (`resolveAppearanceVars`); a partial pack is legitimate (only `syntax` must resolve every `viaPack` reference, as `REFERENCE_PACK_SLUG`).
   - **Form dress** only through an exact Role in `PACK_ROLE_CONTRACT_REGISTRY`; every Role names its CSS variable, value contract, fallback, and real Pipeline consumer. Current form slots include border, radius, padding, gap, tracking, weight, case, shadow, font, label font, stretch, and the registered status-voice slots. Reference `var(--cqmin)` so widths scale with the frame. If the closed registry lacks the Role, add its real consumer and contract before using it in a manifest.
   - **Comment the why on every non-obvious value** — the existing manifests are the model: each hex traces to a measurement, a Critic finding, or an aesthetic-doc law.
3. **`docs/packs/<slug>/aesthetic.md`** — the doc the Critic verifies against, grounded in the real pixels from intake: voice, palette job-table, type system, surface treatment (the structural claims and their inversions), motion vocabulary preferences, **anti-aesthetic** (what this pack is _not_ — the most load-bearing section), reference reel. Model: `docs/packs/crt-terminal/aesthetic.md`.
4. **Register for rendering** in `PACK_REGISTRY` (`src/lib/platform/packs/registry.ts`) and add a `draft` entry to `PACK_CATALOG_REGISTRY` (`src/lib/platform/packs/catalog.ts`). Render registration does not imply catalog approval. There is no default pack — every Preset names its own.

## 4 — Machine gates

Run all three before any human review:

1. **Manifest + Identity validator** — `pnpm verify-presets` validates registry key/slug identity, metadata, the mandatory core vocabulary, font-role-to-manifest declarations and weight integrity, chrome Effect names/params, and the full reference-Pack Identity contract for every registered Pack, alongside Preset schema + semantic checks. An invalid Pack never advances to pixel review.
2. **Pixel-diff lock** — `npx tsx scripts/probe-pack-diff.ts --packs syntax,<slug>` while iterating, then the no-flag full catalog matrix before ratification — every non-immune pipeline must visibly re-skin **inside its own region mask** under every pack pair, and every Pack-immune pipeline must hold the inverse (its region stays stable). A registered non-immune pipeline with no covering preset is a **failure**, not a warning. The report stores source hashes; `--check` re-validates freshness without Chrome. This evidence is 25%-scale machine proof only — never cite it as Calibration Trio evidence (§ 5).
3. **Deterministic native render verification.** Run the native render matrix and inspect the same deterministic frame inputs at zoom in the app. Machine checks establish reproducible inputs and technical correctness; they do not make the aesthetic decision. If a change "doesn't take," prove the path runs with a garish diagnostic color before tuning the real value.

## 5 — The Calibration Trio loop (the human gate)

The trio: **`docu-timeline-build`**, the **`lower-third` house card**, and **`type-hero-vantage`** — the three Scott-ratified references (task `7sshp8rj`). Review the exact unsuffixed canonical Presets under the target Pack:

- Open each canonical built-in Preset in the app with `?source=builtin`, then select the draft Pack through the authoring Pack control: `/p/docu-timeline-build?source=builtin`, `/p/lower-third?source=builtin`, and `/p/type-hero-vantage?source=builtin`. The built-in source is mandatory because a same-slug User composition is different content. Do not copy or modify a Pack-specific Preset for ratification.
- If an authored override fights the Pack, correct the canonical Preset in a Pack-neutral way and recheck it under every Pack. Where a Role cannot express the brand, add the real consumer and Role contract rather than a Preset hack.
- Legacy `<name>-<pack>.json` Calibration re-dresses are non-authoritative engine-gap history. They remain directly loadable fixtures but are never ratification input or catalog precedent.
- Run `node --experimental-strip-types scripts/print-pack-calibration-bundles.ts` to print the exact source-bound bundle ID and fixed native frame specs. The ID binds the target Pack manifest, all three canonical Preset values, the frame specs, shared rendering sources, and only that Pack's directory from the documented sorted tree in `scripts/pack-calibration-render-source-fingerprint.ts` (including bundled asset declarations). A sibling Pack change cannot stale this approval. Catalog approval metadata is excluded so recording approval does not invalidate itself.
- Inspect all three canonical Presets at human scale in the app and iterate live with Scott. The app is the review surface; screenshots are not approval evidence and the machine never grants aesthetic approval.
- After Scott approves that exact bundle, change the Pack's catalog record to `ratified` and commit `humanRatifiedAt`, the printed `verificationBundleId`, and the unchanged Trio frame specs. `npm run verify-presets` uses the same input loader as the print command and rejects stale approvals.

No human-ratified current bundle → the Pack remains renderable for authoring but is not in the public catalog, and the next Pack does not start.

## 6 — Gotchas ledger (each one cost a session)

- **Additive WGSL tints zero with black.** Backdrop `light`/`glow`/band/particle roles are additive — `#000000` _disables_ them, and `top == bottom` kills a gradient. Use black to flatten deliberately; never to "paint black."
- **Chrome scales with the card, not the frame.** Extract ratios of the element (§ 2.3).
- **Event names lie — audition samples** (§ 2.5).
- **Render-verify at zoom; never trust intent** (§ 4.3).
- **Never synthesize font cuts or axes** — claim only weights/stretches the face ships; a `variable-weight-treatment` stays inside the real `wght` axis and inside the brand's art-directed range (§ 2.2).
- **Measure rendered contrast, not spec hex.** A treatment stack (element opacity × material raster × chrome) attenuates text ~25–30%; G5 is judged on rendered pixels. CRT's dim phosphor passed on paper and failed on glass.
- **Status voice = size/caps/tracking, never dimness** under any lossy chrome — a dimmed small voice structurally cannot clear the G5 floor once the chrome takes its cut.
- **Shader masks must be luminance-compensated** (`maskRGB / maskMean`) or they silently regress G5 on dim text.
- **Sub-pitch hairlines null under a raster.** Any hairline form dress must span ≥ 1 raster pitch of the pack's chrome or it reads as broken dashes.
- **Silent roles must stay byte-identical.** Form dress wraps `var(--suffix, <exact current value>)` in the pipeline — a pack with no claim must not move a pixel (the pixel-diff lock's inverse, checked by byte-compare on syntax).
- **In-page pack flips fork compositions.** Swapping `packState` from the console requires the app's `?t=`-versioned module URL AND a `transitionState.capturing = true` bracket, or `/p/[slug]` autosave forks the composition into `user-compositions/`.
- **Defensive values for ruled-out capabilities** (§ 2.7) — an aesthetic-doc prohibition is not a runtime guarantee.

## 7 — Promotion lane (User Pack → catalog)

A **User Pack** ([ADR-0055](../adr/0055-user-defined-packs.md), [`user-pack-workflows.md`](../user-pack-workflows.md)) is where a customer's look is drafted: fork a built-in in the Pack control, re-dress the cores and type live, iterate with no repo commit per tweak. It is renderable and selectable, and that is all it is. Promotion to the catalog is this playbook, not a button:

1. **A User Pack is not evidence.** Nothing drafted in the store — its document, its renders, a review on gfx-review — counts toward ratification. The Calibration Trio judges a repo pack built through §§ 1–5, and the machine gates (§ 4) enumerate `PACK_REGISTRY` alone.
2. **Rebuild it as a real pack.** Create `src/lib/packs/<slug>/` from a fresh intake (§ 1, real pixels of the reference, not the draft's swatches), extract the contract (§ 2) — the draft's cores are a starting claim, its fonts a starting voice, both re-verified against the source — then author the manifest, `@fontsource` registration, and aesthetic doc (§ 3). A fork carries only the built-in's cores, chrome, and fonts, so the per-Pipeline claims a catalog pack needs are authored here, not copied.
3. **Slug collision is intentional.** The repo pack takes the slug; the User Pack of the same slug becomes unsaveable (the store refuses shadowing) and should be deleted from the Pack control once the catalog pack lands, so compositions rebind to the real thing.
4. **Then the gates and the Trio** (§§ 4–5), and Scott's ratification, exactly as for any pack.
