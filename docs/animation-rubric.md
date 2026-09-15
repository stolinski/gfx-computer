# GFX Animation Rubric

This rubric supplies deterministic rules and human review criteria. Critic prose is advisory; only closed-code measured failures route automatic rework, and only an exact-evidence-bound human approval supplies subjective acceptance.

This document is the rubric agents use when designing or reviewing a GFX preset. Every preset shipped from `src/lib/presets/` must satisfy the **General Rules** unless the rule explicitly carves out an exception. Each **Overlay Rule** applies to the specific overlay type named in its heading.

Every rule has three parts:

- **Rule** — the measurable threshold or required behavior.
- **Why** — the production reason for the rule (legibility, broadcast safety, platform constraint, perceptual cue).
- **How to apply** — the preset-engine field(s) to set, or the pipeline behavior to verify.

Field paths refer to the `gfx@1` preset schema in [`docs/preset-format.md`](preset-format.md). When a rule says "the engine clamps this," it means schema validation already enforces it and the agent does not need additional logic.

### Who enforces what (per [ADR-0025](adr/0025-static-linter-checks-safety-and-readability-only.md))

Two layers — do not re-merge them. See [`CONTEXT.md`](CONTEXT.md) → _Preset linter_.

- **Static linter (`lintPreset`, the build gate)** — objective, JSON-computable **video-safety + readability** only, hard errors: G2 / G3 (safe zones), G5 (contrast), G6 pre-mark _floor_ and post-mark read-window, A1 (mark before surface settles), A3 (timing with no segment), L1 (lower-third Y-band), L4 _floor_ (min hold to read), G10 (vestibular, warn). `lintPresetVisual` adds the render-measured readability checks (G4 cap-height floors, G4-density measure).
- **Critic (this doc, judged by eye)** — all motion _taste_: G6 enter/exit duration bands + exit:enter ratio, G7 ease semantics, A2 stagger, the G6 pre-mark _ceiling_, A3 mark-duration bands, L3 (centered reads as title card), L4 hold _ceiling_, G4 cap-height _ceilings_ (signage), title:body ratio, T1 card mass. These are **not** gated — a preset is not rejected at build for them; the Critic flags them against the render.

---

## General Rules

These apply to every preset regardless of overlay type or surface.

### G1. Author at the final delivery resolution

- **Rule** — The horizontal target renders at 3840×2160 (UHD 4K, 16:9). The vertical target renders at 2160×3840 (UHD 4K, 9:16). Frame rate is 30 fps unless the Preset explicitly opts into 60 fps for fast motion.
- **Why** — YouTube long-form is mastered at 16:9 and YouTube Shorts is mastered at 9:16 1080×1920 minimum, 2160×3840 ideal. Authoring at the delivery resolution avoids the soft, anti-aliased look that comes from upscaling 1080p overlays, and keeps every margin/font-size rule below expressed in pixels of the actual output frame.
- **How to apply** — `transport.orientation` selects the aspect, and the pipeline produces 4K output. Set `transport.fps` to 30 unless there is a stated motion-clarity reason to choose 60.

### G2. Respect the safe zones for the target aspect ratio

- **Rule** — Treat the inner 90% of the frame as the **title-safe** rectangle (5% margin all sides) and the inner 93% as the **action-safe** rectangle (3.5% margin). All readable text must sit inside title-safe. Decorative geometry may cross into action-safe but must not touch the frame edge. On 9:16 (Shorts/Reels/TikTok), the safe rectangle is further constrained by platform UI — see G3.
- **Why** — SMPTE ST 2046-1 defines action-safe at 93% and title-safe at 90% for 16:9 production. Even on modern flat-panel TVs and streaming, ~4% overscan still appears in some playback paths. Honoring the standard prevents clipped names, dates, and source URLs.
- **How to apply** — When placing an overlay via `overlays[].position.rect`, keep `x ≥ 0.05`, `y ≥ 0.05`, `x + width ≤ 0.95`, `y + height ≤ 0.95`. For `anchor` + `offset` placement, the minimum offset from any frame edge is 5% of the corresponding dimension (192 px at 3840 wide, 108 px at 2160 wide for 4K vertical).

### G3. Honor platform UI safe zones on vertical

- **Rule** — On `transport.orientation === 'vertical'`, no readable content (text, focal annotation, or callout) may sit in:
  - the top ~6% of the frame (notification/notch + creator handle area),
  - the bottom ~16% of the frame (channel info, music ticker, description),
  - the right ~9% of the frame (like/comment/share rail).
- **Why** — YouTube Shorts, TikTok, and Instagram Reels all overlay platform UI on the same regions. At 1080×1920 those bands are roughly 120 px (top), 300–400 px (bottom — bottom grows when description is expanded, so design for the expanded state), and 96–120 px (right). Anything important that lands under those bands is unreadable for the majority of viewers.
- **How to apply** — For `overlays[].position.anchor`:
  - `top-*` anchors need `offset.y ≥ 0.06 × frameHeight` (≈230 px at 4K vertical).
  - `bottom-*` anchors need `offset.y ≥ 0.16 × frameHeight` (≈615 px at 4K vertical).
  - `*-right` anchors need `offset.x ≥ 0.09 × frameWidth` (≈195 px at 4K vertical).
  - For `surface` content on vertical, the readable column must stay inside roughly `x: [0.05, 0.91]` and `y: [0.06, 0.84]` of the frame.

### G4. Cap-height floors — split by role × surface

The right size for a piece of text depends on **what job it does**, not on its tag name. The same `<p>` element is a different thing inside a lower-third (primary information delivery) versus inside a paper card (atmospheric context surrounding the focal mark). Apply the band that matches the role.

- **Rule** — At 4K, every rendered text element must hit its cap-height **band** for its role × surface combination. A band has both a minimum and a maximum — text far above the floor is also wrong (oversized body reads as signage, not paper).

  | Role × surface                                                                                              | Horizontal band (cap-height px) | Vertical band (cap-height px) |
  | ----------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------- |
  | **Overlay display** (full-frame bumper centrepiece, typographic hero)                                       | 140–320                         | 180–400                       |
  | **Overlay primary** (lower-third title, caption)                                                            | 96–144                          | 120–180                       |
  | **Overlay secondary** (lower-third subtitle, caption-2)                                                     | 80–112                          | 96–136                        |
  | **Overlay corner-chip** (lower-third spanning ≤25% frame width, corner-anchored; primary/title)             | 56–84                           | 72–108                        |
  | **Overlay corner-chip secondary** (role/subtitle on a corner chip)                                          | 32–52                           | 44–68                         |
  | **Overlay cinematic corner plate** (lower-third spanning >25–≤35% frame width, corner-anchored; name/title) | 64–96                           | 84–124                        |
  | **Overlay cinematic corner plate secondary** (role/subtitle on a cinematic corner plate)                    | 36–60                           | 48–76                         |
  | **Overlay source citation** (short URL plate identifying a showcased site)                                  | 48–72                           | 56–84                         |
  | **Surface display** (full-frame typographic hero — the word IS the composition)                             | 320–560                         | 400–720                       |
  | **Surface title** (paper / plain card title slot)                                                           | **60–110**                      | 76–138                        |
  | **Surface body** (paper / plain card body, marked or unmarked)                                              | **32–56**                       | 44–72                         |
  | **Surface label** (source / kicker / byline / date label, footer)                                           | **24–48**                       | 32–60                         |
  | **Found-document body** (baked post/article body inside faithful platform chrome)                           | **30–54**                       | 40–70                         |
  | **Found-document title** (post/article heading inside faithful platform chrome)                             | **40–76**                       | 44–84                         |
  | **Found-document metadata** (handle, date, action labels inside faithful platform chrome)                   | **18–34**                       | 24–44                         |
  | **Diagram headline** (`surface.diagram[]` title / section label)                                            | 60–110                          | 76–138                        |
  | **Diagram node / caption label** (node `text`, `label` primitive, stat-callout caption)                     | 24–48                           | 32–60                         |
  | **Diagram stat value** (stat-callout built number — the diagram's focal figure)                             | 60–110                          | 76–138                        |
  | **Caption track — social styles** (`state.captions` karaoke line / word-pop statement word)                 | 72–140                          | 80–160                        |

Note on band sources: the **binding source** for surface titles and bodies is empirical — real research-paper / document footage on YouTube renders body at roughly **40–55 px cap-height at 4K** and title at roughly **80–110 px**. The published bands (32–56 body, 60–110 title) bracket those observations with a small headroom margin so presets aren't forced to hit the exact center. A second-pass sanity-check derivation from print typography (title ~14–17 pt, body ~9–11 pt × ~4 for 4K × ~0.7 viewing-distance scale) lands at ~25–31 px body / ~40–48 px title — close enough to confirm the empirical floor isn't arbitrary, but slightly _below_ the empirical observation. When the two sources disagree the empirical observation wins because it matches the visual target the rule actually exists to enforce: cards that read as photographic documents, not as signage. Overlay text uses broadcast lower-third standards which are larger because the overlay IS the message. The earlier rubric mistake was applying broadcast-overlay floors to surface body — that produced cards that looked like signage, not paper.

Note on the display band: a full-frame typographic hero — a type-hero bumper where a single word IS the composition — renders far above the overlay-display ceiling (~444 px cap-height is normal). That is **Surface display**, a band distinct from Overlay display: an overlay composites over other content and is sized to coexist with it, whereas a surface-display hero owns the whole frame and pushes to 320–560 px (400–720 vertical). Below this band the hero word reads as a title card, not a hero; above it, it clips the safe area.

Note on marked focal text: a highlighted/underlined/circled phrase inside surface body uses the _same_ cap-height as surrounding body. Visual emphasis comes from the mark stroke, not larger type — a research paper does not enlarge the highlighted phrase, it draws a highlight stroke over it.

Note on found-document titles: a title inside faithful Reddit, GitHub, Wikipedia, Hacker News, news, or YouTube chrome follows that site's denser UI scale. It is larger and heavier than the adjacent found-document body but does not use the paper/plain-card title floor; doing so turns a recognizable site artifact into a generic title card.

Note on source citations: the short URL plate in a website showcase identifies the demonstrated artifact; it is neither primary broadcast copy nor tiny in-document browser chrome. Its dedicated band keeps a full URL readable without forcing the plate wider than the showcased browser's safe geometry.

Note on the caption-track row: this row is for the `state.captions` social styles and is empirically anchored to the creator tools the register imitates (CapCut / TikTok / Submagic karaoke defaults run ~5.5–7% of frame width as font-size on vertical → ~86–110 px caps at 4K). It is distinct from the "caption" in **Overlay primary**, which is broadcast lower-third copy. Social karaoke is a statement the viewer reads instead of the footage — sub-band captions (the 40 px "legal disclaimer" size) are a G4 failure, not a taste call. Word-pop's single statement word sits in the upper half of the band; the `pack` caption style is editorial by declaration and may sit below this row's floor, judged against the pack's own type voice instead.

Cap-height is computed at runtime as `fontSize × capHeightRatio(font)`, where `capHeightRatio` is the font's measured cap-height ratio (default 0.70 for sans/serif, 0.68 for condensed, 0.72 for mono). The visual audit harness reads cap-height directly off the rendered DOM — do not approximate from font-size alone.

Note on the Diagram Block group: `surface.diagram[]` text (ADR-0036 — node labels, `label` primitives, stat-callout numbers and captions) is document typography, not signage, so it maps to the **surface** bands, not the overlay bands — a diagram sits inside the piece as a drawn document, it is not the message the way an overlay lower-third is. Judge each diagram role against its explicit row above rather than by nearest-role analogy: a node/caption label is a surface label (24–48 / 32–60), a diagram headline is a surface title (60–110 / 76–138), and a stat-callout's built number is the diagram's focal figure — it may ride the top of the surface-title band, but pushed into overlay-display scale it stops reading as a document stat and becomes a bumper.

Note on span measurement (corner-chip and cinematic corner plate): span is measured on the overlay's **laid-out rect** — the DOM layout box of the overlay root at 4K, the same plane the visual audit harness reads cap-heights from — **never on rendered plate/scrim pixels**. An earlier revision measured the plate's ≥50%-alpha extent, but that extent is Pack chrome: crt-terminal renders a solid plate while syntax fades a scrim, so a byte-identical composition measured different spans — and flipped cap-height bands — across Packs. Compositions are Pack-neutral ([ADR-0039](adr/0039-pack-neutral-compositions-and-listing-hygiene.md)); classification must be too. The laid-out rect is identical under every Pack, and it is a **DOM-plane** measure (pre-chrome layout), not a post-chrome pixel measure.

Note on the cinematic corner plate band: a cinematic lower-third's laid-out rect (~27–31% of frame width) sits between the corner-chip line (≤25%) and a full-width broadcast lower-third — wide enough that corner-chip caps would whisper, narrow enough that Overlay-primary caps (96 px floor) would shout on a corner-anchored plate. Its band admits the observed cinematic register (name ~73 px caps, role ~45 px caps at 4K horizontal — see `CinematicCanvasSource.svelte`). Above 35% span a lower-third is broadcast-scale and takes the Overlay primary/secondary bands.

- **Why** — Overlay text and surface body text are different jobs. An overlay caption IS the message; it must be large enough that the viewer can read it without effort. Surface body inside a paper card is **atmospheric context** — the viewer skims it, the highlighted phrase is what they actually read. Forcing 64 px body cap-height on a paper card produces ~3-word lines that sprawl four lines for a single sentence; the card stops looking like paper and starts looking like a typographic slide. Real research-paper/document footage on YouTube renders body at roughly 40–55 px cap-height at 4K, which gives 7–10 words per line — the typographic measure where dense bodies feel like documents. The upper bounds in each band exist for the same reason: a 100 px paper body would look like signage.
- **How to apply** — The surface pipeline sets font sizes proportional to the card's render width. `lintPresetVisual` in the runtime visual audit measures actual rendered cap-height at 4K; this is separate from `verify-presets`' static lint. If a preset's content is too dense to fit at the required size, **shorten the content** before shrinking type below the band floor; if the body looks oversized inside the card, **tighten the body ratio** before reducing content.

### G4-density. Bodies must read as bodies

Cap-height is one dimension of legibility. The other two are **measure** (how many characters per line) and **leading** (line-height). When a body of text fails on those axes it reads as a slide, not a document — even with cap-height in band.

- **Rule** — For every paragraph block of body text (surface body and overlay body):

  | Property                                    | Band                                                      |
  | ------------------------------------------- | --------------------------------------------------------- |
  | Characters per line (measure)               | **45–80**                                                 |
  | Line-height — serif body                    | **1.28–1.42**                                             |
  | Line-height — sans / condensed / mono body  | **1.32–1.50**                                             |
  | Lines per paragraph (rendered)              | **1–8** (≥ 9 lines means the paragraph is doing too much) |
  | Title : body cap-height ratio (per surface) | **1.5–2.5**                                               |

- **Why** — Bringhurst's _Elements of Typographic Style_ lands the "ideal measure" at 45–75 characters; broadcast practice extends to ~80 before the eye loses its place. Serif body at line-height < 1.28 collides ascenders/descenders; > 1.42 disconnects lines into floating slabs. Sans needs slightly more leading for clarity. A body paragraph that wraps to nine or more rendered lines stops reading as a paragraph and reads as a list of fragments. Title-to-body ratio below 1.8 flattens the hierarchy (you can't tell what's primary); above 3.0 makes the title dominate so heavily it overshadows the focal content.
- **How to apply** — The visual audit harness measures, per paragraph: rendered `getBoundingClientRect()` dimensions, count of line-boxes (via `Range.getClientRects()` or computed `lineHeight`), computed `line-height`, and character count to derive characters-per-line. The title : body ratio is computed from the per-role cap-heights. Out-of-band values fail the preset.

### G5. Maintain 4.5:1 contrast against every frame the text covers

- **Rule** — The contrast ratio between text color and the local background (paper, surface, or transparent-over-footage) must be ≥ 4.5:1 for body text and ≥ 3:1 for large text (≥ 96 px / ≥ 60 px bold). For overlays sitting on transparent output (delivered as a key over footage), assume a worst-case mid-gray (#7f7f7f) background and verify against that.
- **Why** — WCAG 2.2 AA contrast thresholds (4.5:1 / 3:1) are the floor for legibility under normal viewing. GFX exports are transparent and will be composited over unknown footage, so we cannot rely on the surface color the agent picks. Verifying against a mid-gray neutral is the standard "worst case" check.
- **How to apply** — When choosing `typography.inkColor` against `typography.paperColor`, hit 4.5:1. For overlay text drawn directly on transparent (e.g. a future overlay variant with no chrome), require an additional legibility treatment (semi-transparent plate, drop shadow ≥ 4 px blur at 60% opacity, or a stroke ≥ 2 px) — single-color text on transparent is rejected.
- **Residual contrast under fading plates.** A semi-transparent plate satisfies G5 only where it actually backs the text. Where a plate or scrim fades **below ~50% alpha under text** — a cascade-reveal tail, a plate that ramps out beneath a trailing subtitle — the text, **including its own shadow/stroke**, must _independently_ satisfy 4.5:1 (body) / 3:1 (large) against worst-case mid-gray (#7f7f7f). A plate that drops to ≈3.2:1 under its trailing subtitle fails: strengthen the tail's shadow/stroke, hold the plate above 50% alpha under all text, or shorten the text so it stays on the solid plate. The plate's _presence_ is not the guarantee — the achieved ratio at the fade is. Measured at the plate's sub-50%-alpha regions by the visual audit / Critic.
- **Diagram DOM ink.** `surface.diagram[]` ink resolves to the surface body ink. On a **transparent** piece (no `backgroundFill`, no stage) the engine paints a two-zone legibility halo by default (`bd7e5e7`) so the worst-case-footage floor holds; on a **full-frame opaque** piece the halo is skipped and the diagram ink must clear 4.5:1 against `backgroundFill` — statically gated by `checkDiagramContrast` in `preset-rubric.ts`. A stage-backed diagram has no single static field, so its contrast is Critic/visual-audit territory.

### G6. Animation duration baseline

- **Rule** — Default durations for any single tween:
  - **Enter** — 250–400 ms (`duration` of 0.05–0.08 on a 5 s preset, 0.04–0.06 on an 8 s preset).
  - **Exit** — 180–280 ms, always 20–30% shorter than the matching enter.
  - **Mark / emphasis — scales with the marked content.** A marker stroke is a physical gesture: a 1-word highlight is fast; an 18-word highlight is a long pull. The band is `[max(250, words × 60), max(500, words × 90)]` ms for **decorative** marks (highlight, underline, strike, circle, box, side-note) and `[max(450, words × 60), max(800, words × 110)]` ms for **focal** marks (magnify, lift-out, tear-out, isolate). Words is the marked segment's word count. Both bands cap at 1500 ms.

    | Marked words | Decorative band (ms) | Focal band (ms) |
    | ------------ | -------------------- | --------------- |
    | 1            | 250–500              | 450–800         |
    | 5            | 300–500              | 450–800         |
    | 10           | 600–900              | 600–1100        |
    | 18           | 1080–1500            | 1080–1500       |
    | 25           | 1500–1500            | 1500–1500       |

  - **Hold-on-screen — split into pre-mark and post-mark windows, per mark.**
    - **Pre-mark window (establishment) — title is a glance, not a read.** Between `surface.enter.end` and the **first** mark's `start`, the viewer needs ~**0.7–1.2 s** flat to register the title and locate the focal area. Titles, kickers, and bylines are _glanceable_ — they take in as visual shapes, not as words read sub-vocally at 200 wpm. The 200 wpm reading model applies to **body content the viewer is expected to read line-by-line**, not to short top-of-card identifiers. If the surface also has body text the viewer is expected to scan before the mark, add that body's read time on top.
    - **Post-mark window (absorption), per mark** — between the mark's `end` and the next event that disrupts it (next mark start, or `surface.exit.start`), the viewer must be able to read the marked segment **1.5×** at 200 wpm. Required seconds = `markedWords × 60 / 200 × 1.5`. This is the editorial moment: the viewer needs time to absorb the focal phrase with its emphasis.
    - For overlay-only content (captions, lower-thirds with no marks), the overlay's screen-time must satisfy 2× reading of the overlay's content. The 2× rule is preserved for caption/lower-third hierarchy only.

- **Why** — UI animation research (NN/g, Material Design, Val Head) converges on 250–500 ms as the band where small UI motion feels intentional but not sluggish. Marker strokes are a different category — they're a continuous physical gesture across measurable distance, and their natural duration scales with stroke length. 60–110 ms per word maps to ~3–4 words per second of stroke, which is roughly how a person physically marks paper. The asymmetric enter/exit (longer in, shorter out) reflects that the brain accepts arrival but resents lingering. The 1.5× post-mark rule replaces the broadcast 2× rule because the marked phrase has already been seen during the establish phase — the post-mark window is for re-reading with the emphasis, not first-pass comprehension. Captions still get 2× because each new caption is unfamiliar content.
- **How to apply** — All `start`/`duration` fields in `surface.enter`/`exit`, `overlays[].enter`/`exit`, and `marks.timings[i]` are normalized 0..1 of `transport.durationSeconds`. Convert: `durationSecondsForTween = normalizedDuration × transport.durationSeconds`. Pick the normalized values so the absolute milliseconds land in the bands above. When a preset can't satisfy the post-mark window, **shorten the marked phrase** — don't shrink the type and don't shorten the mark stroke.
- **Relationship to [Q15](quality-rubric.md#q15-effects-animate-in-and-out--never-pop)** — G6's absolute ms bands are the no-pop perceptual floor Q15 references. On presets long enough that 10% of an element's on-screen time exceeds G6's ms ceiling, G6 binds (a 7 s on-screen surface still gets a 180–280 ms exit, not a 700 ms one). On short presets where 10% of element lifetime lands inside G6's band, both rules agree by construction.
- **Keyframe channels — lint the envelope, judge the inside ([ADR-0035](adr/0035-generalized-keyframes-and-cascade.md) §6).** When an element declares `animation.channels`, the composition owns its motion and there is no single enter/exit window. The window rules read the derived **enter envelope** instead: for opacity, the fade-in's landing is the _first keyframe attaining the track's peak_ and the departure is the _last keyframe still at the peak_ — A1's settle buffer measures from the landing, L4's read hold spans the plateau between them. What happens **inside** the envelope — a scale dip-then-land, a double-take, an overshoot ridden through several keyframes — is exactly the craft the model exists for; it is Critic-taste territory, never machine-linted. Cascade-welded elements are linted at their **resolved** starts (`resolveCascadeTimings`), so a chain that re-times still gets judged where it actually lands.

### G7. Ease semantics — pick the curve for the job

- **Rule** — Use the GFX `Ease` vocabulary deliberately. The mapping is fixed in `engine-schema.ts`:

  | Ease      | GSAP curve            | Use for                                                                                                                  |
  | --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
  | `smooth`  | `power3.out`          | Default. Most exits. Marks that should settle without theatrics.                                                         |
  | `settled` | `back.out(1.2)`       | Surface/overlay entries. A small overshoot reads as "placed with intent." Do not use on exits.                           |
  | `sharp`   | `expo.out`            | Snap-in callouts, beat-synced emphasis marks, anything that needs to feel cut, not slid.                                 |
  | `bouncy`  | `elastic.out(1, 0.5)` | Playful flourishes only. Strikes, circles where a wobble adds personality. Never on body text or lower-third typography. |

- **Why** — Ease is the largest single carrier of "personality" in motion. `power3.out` is the broadcast-safe default because it decelerates without flair. `back.out` is the YouTube/explainer house style for cards landing — the overshoot is what makes a lower-third look "designed" rather than "faded in." `expo.out` is what makes emphasis feel like a beat hit. `elastic` is loud and earns its place only when the content is itself playful.
- **How to apply** — Set `ease` on every timing block. Do not leave it to the engine default unless the default is the right choice. When in doubt: `enter: 'settled'`, `exit: 'smooth'`, `mark: 'smooth'` for editorial content, `mark: 'sharp'` for explainer/news content.
- **Per-property, on keyframe channels ([ADR-0035](adr/0035-generalized-keyframes-and-cascade.md) §5)** — each keyframe's `ease` is the curve INTO it, per segment, per channel, so the same jobs apply per property: a transform segment landing into rest wants `settled`/`smooth` (decelerate in); an opacity fade-out authored in channels should land AT its final keyframe, not head-load — author the fade with `smooth` over a short final segment rather than a long one (the sugar's automatic `.inOut` opacity-exit default applies only to `enter`/`exit` sugar; authored channels run exactly the curve they declare). A dip-then-land (`scale 0.96 → 1.02 smooth → 1 settled`) is the canonical multi-segment use: the overshoot lives in the VALUES, the eases stay in the constrained vocabulary.
- **Variable-font axes are typography, not transforms.** Animate only an axis the active Pack supplies as a real variable face, store semantic normalized values, and resolve them through the Pack's art-directed range. Never fake `wght`, `wdth`, or `slnt` with scale, skew, synthetic bold, or a staircase of static cuts. When weight is the emphasis hit, it may use `sharp` over a shorter beat-centered interval while position/scale continue to settle with `smooth`; this dual-speed contrast is preferable to applying one ease to every property. For TextAnimation weight work, run `pnpm probe:text-animation-weight` against the jailed server and sanctioned Chrome; it gates real loaded ranges, intermediate coordinates, `font-synthesis: none`, settled layout boxes, live Pack swaps, replay identity, and both native orientations.

### G8. Apply the relevant principles of animation

The 12 Disney principles all apply, but five carry the weight for motion graphics overlays:

- **G8a. Anticipation** — Before a large motion, allow a tiny counter-motion or pre-pose (e.g. a lower-third dips down 4–8 px before flying up). Encoded as a brief lead-in tween on the same property, ≤ 80 ms.
- **G8b. Follow-through** — After the main move ends, allow the easing to overshoot and settle (`settled`/`bouncy`) or let secondary elements (subtitle line, source URL) arrive 60–120 ms after the primary headline. Encoded by staggering `start` values across overlay tweens.
- **G8c. Arcs** — Movement along straight lines reads as mechanical. When sliding a card in from off-frame, prefer a path that curves slightly (X distance > 0 with a small Y component) over pure axis-aligned slides. For shaders/transforms, this means combining translate + a small rotate or translate-X with a translate-Y bias.
- **G8d. Secondary action** — A primary mark (e.g. a circle) gets a secondary action (the line weight thickening over the last 80 ms; a faint pen-pull-back). Secondary action must end before the primary tween ends — it supports the moment, it does not extend it.
- **G8e. Slow-in/slow-out (ease)** — Linear motion is forbidden. Every tween uses one of the four named eases. Linear is only acceptable for continuous deterministic motion (a scrolling ticker on a background paper, where ease would visibly speed up and slow down).
- **Why** — These five are what separates a "fade in / fade out" overlay from one that reads as designed. Skipping arcs and follow-through is the single most common failure mode of AI-generated motion presets.
- **How to apply** — When composing a preset, an agent should be able to point to which tween realizes each of arc, anticipation, follow-through, and secondary action. If a preset has none of those, it is unfinished.

### G9. Frame-addressable and deterministic

- **Rule** — Every animated value must be derivable from the timeline `progress` (`0..1`) alone. No `Math.random()` at render time, no `Date.now()`, no `performance.now()` reads inside `pipeline.render({...})`. Randomness for paper grain, jitter, hand-drawn wobble, etc. is allowed only if seeded from `progress` (or a stable per-mark index).
- **Why** — GFX preview and export call the same request-object `renderCompositionFrameTo` seam. If a preset's appearance depends on wall-clock state, the exported video drifts from preview and exports re-run on the same input produce different files. The whole timeline architecture in `src/lib/platform/timeline.svelte.ts` exists to guarantee this.
- **How to apply** — Pipelines must read all randomness from a seeded source. Presets must not contain fields that imply non-deterministic motion. If a preset asks for "natural variation," it gets it via per-mark seed + frame index, not real randomness.

### G10. Respect reduced motion when delivered to the browser; honor motion safety at all times

- **Rule** — Even though GFX output is a baked video and the viewer's browser cannot apply `prefers-reduced-motion` to it, two motion-safety constraints still apply at authoring time:
  - **No full-frame zoom/pan exceeding 25%** in less than 600 ms. Large fast translations of the whole composition are the dominant vestibular trigger.
  - **No flashing.** Avoid alternating fills/strokes faster than 3 Hz on regions ≥ 25% of the frame. WCAG 2.3.1 (three-flash threshold) is the broadcast floor.
- **Why** — Over a third of adults have experienced vestibular symptoms. The same gestures (whip pans, fast zooms, strobing color shifts) that trigger discomfort on the web trigger it on video as well. A preset shipped from GFX will end up on a 50" TV or a phone in someone's hand — design for both.
- **How to apply** — Whole-frame camera motion exists only on the dimensional depth stage: inspect `stage.camera.move` (`static` / `push` / `drift`) and `stage.camera.amount` together with the clip duration. Keep the resulting move inside the 25% / 600 ms safety bound, and do not combine a strong camera move with a simultaneous large luminance or visibility change.

### G11. One Preset, genuinely reflowed across vertical and horizontal

- **Rule** — One Preset must render intentionally at both transport orientations; do not create orientation-suffix sibling Presets. Switching to vertical is not merely changing the canvas aspect. The renderer's reflow must produce these differences:
  - **Motion direction prefers Y over X.** Cards/lower thirds enter from the bottom edge or the top edge, not the side. Horizontal slides on 9:16 read as "edge twitches."
  - **One readable column.** No multi-column layouts. The single column lives between roughly `x ∈ [0.06, 0.94]` of the frame.
  - **Larger type, concise shared copy.** Apply the higher vertical minimums from G4 and author copy short enough to survive both targets; do not fork the text by orientation.
  - **Subject lives in the middle 60% vertically.** Top and bottom bands belong to platform UI (G3); important focal annotations (magnify, lift-out, isolate) must center inside `y ∈ [0.20, 0.80]`.
  - **Pacing survives both targets.** Choose one duration and reading cadence that works in the faster vertical context without rushing the horizontal render.
- **Why** — TikTok/Reels/Shorts engagement data shows native vertical outperforms cropped-horizontal at >90%. The platform-specific staging — center-weighted, Y-motion, short — is what "native vertical" actually means. Reusing horizontal staging on 9:16 produces the cropped-look the algorithm down-ranks.
- **How to apply** — Switch `transport.orientation` in the GUI and verify the same Preset at both native resolutions. Fix automatic layout in orientation-aware Pipeline/safe-area logic; when authored Overlay or Diagram geometry must materially re-stage, use complete orientation snapshots inside the same Preset rather than an orientation-suffix sibling. Safe-area lint reports violations but never clamps the authored geometry.

### G12. Transparency is the default; opacity must be declared

- **Rule** — A Preset with neither `state.backgroundFill` nor `state.stage` must preserve transparent frame edges. A Preset may intentionally declare either to become a full-frame segment/bumper. Post-process `effects[]` must not accidentally make a transparent piece opaque to its edges.
- **Why** — GFX produces both keyable overlays and self-contained full-frame pieces. The export path must infer the right delivery from explicit composition state rather than an accidental painted background.
- **How to apply** — WebGPU render passes use `clearValue: [0, 0, 0, 0]` and the canvas context uses `alphaMode: 'premultiplied'`. `isEngineStateOpaque` classifies `backgroundFill` or a depth `stage` as opaque; a transition is opaque only when both endpoints are opaque. Verify transparent pieces retain zero-alpha edges and full-frame pieces paint to every edge.

---

## Per-Overlay Rules

### Lower Thirds

A lower third is a name/source/identity tag pinned to the lower portion of the frame. The `lower-third` overlay type in the engine carries `{ kicker, title, subtitle? }`.

- **L1. Vertical band: bottom 18–28% of frame on horizontal; bottom 22–34% on vertical (above the platform UI band from G3).**
  - **Why** — The conventional "lower third" is literally the lower third of the frame, but modern broadcasting compresses to roughly 20% of frame height because faces and B-roll subjects sit lower in widescreen framing. On vertical, the band shifts up because the bottom 16% is platform UI.
  - **How to apply** — For 4K horizontal (2160 tall): top of the lower-third lives at `y ≈ 0.62–0.72` (≈1340–1555 px from top), height ≈ 0.10–0.18 of frame. For 4K vertical (3840 tall): top at `y ≈ 0.62–0.74` (≈2380–2840 px), height ≈ 0.10–0.16, and the entire block must clear the 0.84 line.

- **L2. Horizontal extent: ≤ 60% of frame width on horizontal, ≤ 90% on vertical.**
  - **Why** — On 16:9, a lower third spanning more than 60% competes with the subject and looks like a chyron banner. On 9:16, the frame is narrower so the same readable block is a larger fraction of width — letting it run to 90% is fine and necessary for type size.
  - **How to apply** — Constrain `overlays[].position.rect.width` accordingly, or for `anchor + offset` positioning, set right-edge padding to match.

- **L3. Anchor to a corner, not centered.**
  - **Why** — Centered lower-thirds read as title cards. Corner-anchored (`bottom-left` for English, `bottom-right` for cultures where that suits) is the broadcast convention because it leaves the opposite corner free for logos/bugs and balances the composition.
  - **How to apply** — `overlays[].position.anchor: 'bottom-left'` by default; override only with intent.

- **L4. On-screen time: 4–6 seconds for typical "Name / Title / Affiliation"; up to 8 seconds if the subtitle line is dense.**
  - **Why** — Industry convention. Under 3 s and the viewer hasn't finished reading; over 8 s and it overstays. The 4–6 s band is what news, podcast clips, and explainer YouTube channels converge on. For longer copy, the 2× reading-rule (G6) governs.
  - **How to apply** — `screenTime = transport.durationSeconds × (overlay.exit.start − (overlay.enter.start + overlay.enter.duration))`. Pick `enter.start` and `exit.start` to land in that window.

- **L5. Enter from below; exit by sliding or fading down/out, not up.**
  - **Why** — A lower third entering from the top reads as a notification, not a name plate. Slide-up entry + slide-down (or scale-down + fade) exit is the convention. On vertical, "below" can also be from the side opposite the action rail.
  - **How to apply** — The engine handles transform via the pipeline. Pick `enter.ease: 'settled'` (back overshoot reads "placed") and `exit.ease: 'smooth'` (decelerate out, no overshoot).

- **L6. Hierarchy: kicker (smallest, all-caps), title (largest, weight 600–800), subtitle (mid, weight 400–500).**
  - **Why** — A three-line stack with one weight reads as a paragraph. Differentiated weights and casing make the name pop and the affiliation recede.
  - **How to apply** — `typography.fontFamily: 'condensed'` or `'sans'` is preferred over `'serif'` for the lower-third stack at video viewing distance. `kicker` cap-height ≈ 50% of title cap-height; `subtitle` cap-height ≈ 60% of title.

- **L7. Maximum two lines of subtitle.**
  - **Why** — Beyond two lines, the lower-third becomes a card and should be re-classified as a Title Card (see below). Three-line subtitles also fail the 2× reading-rule at 4 s screen time.
  - **How to apply** — Reject preset content that wraps `subtitle` to a third line at the chosen type size.

### Title Cards & Chapter Markers

A full-frame or near-full-frame card introducing the video, a section, or a chapter. GFX currently models this via `surface.type: 'paper'` with a `title` slot; future overlay variants may add a dedicated `title-card` type.

- **T1. Card visual mass — presence first, area second, with bleed allowed.**

  A card must feel like a real document on a desk, not a postage stamp floating in space. Two presence checks, then an area sanity check.
  - **Presence: longer-dim occupancy.** The card's _longer dimension_ (height for portrait, width for landscape, either for near-square) must occupy at least:
    - **Horizontal frame (paper surface): ≥ 0.85** of the matching frame dimension.
    - **Horizontal frame (other surface types): ≥ 0.70**.
    - **Vertical frame: ≥ 0.85**.

  - **Bleed permitted.** A portrait card on a horizontal frame _may extend past the bottom of the frame_ — the bleed is the visual rhyme that says "this is a real sheet of paper, you're looking at the top of it." The constraints when bleeding:
    - The card's top edge must sit at `y ≤ frameHeight × 0.05` (top of frame, with a small breathing margin).
    - All _readable text_ must remain inside the title-safe rectangle (G2). The bleed area must contain no readable text — only paper chrome.
    - The bleed length must be **≤ 30%** of the card's height. Beyond that the card stops feeling like a document and starts feeling like a backdrop.
    - The longer-dim occupancy check is computed against the **visible** card rect (clipped to frame), not the laid-out rect — so bleed counts as 100% occupancy on that axis.

  - **Area band by orientation × card aspect (sanity check, applied after presence):**

    | Orientation     | Card aspect (W:H)                 | Visible-area band (% of frame) |
    | --------------- | --------------------------------- | ------------------------------ |
    | Horizontal 16:9 | Near-square (0.8–1.2)             | 40–70                          |
    | Horizontal 16:9 | Portrait (≤ 0.8, e.g. A4 = 0.707) | 38–60                          |
    | Horizontal 16:9 | Landscape (≥ 1.2)                 | 45–75                          |
    | Vertical 9:16   | Portrait (≤ 0.8)                  | 50–80                          |
    | Vertical 9:16   | Near-square / landscape           | 35–60                          |

  - **Why** — The earlier version (0.70 occupancy, A4 portrait at 26–45%) was a mathematical compromise that produced renders looking like notes pinned in space. Real document-on-camera footage either (a) fills the frame substantially (the wider end of the area band, often via bleed) or (b) is centered between focal elements where its full presence reads. The bleed allowance lets A4 papers feel anchored to the bottom of frame — a recognizable "paper on desk" composition — while preserving title-safe for the readable content. 0.85 horizontal occupancy on paper translates to a card that fills the frame vertically with the bleed convention, which is what 4K research-paper/document overlay footage looks like in published video work.

  - **How to apply** — In the pipeline: compute the laid-out card rect, then the _visible_ rect by intersecting with the frame. Visible width × visible height drives area; visible longer-dim drives occupancy. If `cardRect.bottom > frame.height`, the bleed length is `cardRect.bottom - frame.height` and the card layout must guarantee no readable text in `y ∈ [frame.height, cardRect.bottom]`. The pipeline's existing card-layout code (`src/lib/pipelines/surfaces/paper/CanvasSource.svelte`) is the place to introduce the bleed mode.

- **T2. Headline: 5–9 words; subheadline (if present): 8–14 words.**
  - **Why** — Cap-height of a title card is large enough that >9 words wrap awkwardly, and the viewer's eye treats a card as a single read, not a paragraph.
  - **How to apply** — Author content with these limits. Long source/citation lines belong in the `source` or `dateLabel` slots, not the headline.

- **T3. Enter 300–500 ms; hold 1.5–4 s; exit 250–400 ms.**
  - **Why** — A title card carries more visual mass than a lower third, so its motion can take slightly longer. But hold ≥ 4 s on a 6 s short reads as a still frame.
  - **How to apply** — On a 5 s vertical preset: `enter.duration ≈ 0.07`, hold ≈ 0.55, `exit.start ≈ 0.85`, `exit.duration ≈ 0.07`.

- **T4. Stage camera is reserved for genuinely dimensional title cards.**
  - **Why** — Camera motion earns its place when planes, parallax, and focus make the move spatially meaningful. Applying a camera vocabulary to a flat card adds motion without depth information.
  - **How to apply** — Use optional `state.stage.camera` (`static` / `push` / `drift`) only with the dimensional depth stage. Flat title cards use Surface, text, and keyframe motion; they carry no Surface camera field.

### Callouts & Annotations

These are the mark layer: highlight, underline, strike, circle, box, side-note (decorative) and magnify, lift-out, tear-out, isolate (focal). They sit on body text.

- **A1. Marks must arrive after the underlying text is fully on-screen.**
  - **Why** — A mark animating onto text that is still flying in fights for attention and produces two competing readings. The mark should feel like a deliberate gesture on a placed page.
  - **How to apply** — For each `marks.timings[i].start`, ensure `start > surface.enter.start + surface.enter.duration + 0.02` (a small buffer). Mark `start` typically lands at 0.18–0.50.

- **A2. One emphasis at a time; stagger ≥ 120 ms between marks.**
  - **Why** — Simultaneous emphasis flattens the hierarchy. The eye can track one new mark per ~200 ms; staggering by ≥ 120 ms preserves the sense that someone is annotating in real time.
  - **How to apply** — Sort `marks.timings` by `start` and ensure consecutive `start` values differ by ≥ 0.04 on a 3 s preset, ≥ 0.025 on a 5 s preset, ≥ 0.015 on an 8 s preset.

- **A3. Decorative marks: 250–500 ms; focal marks: 450–800 ms.**
  - **Why** — A highlight is a stroke of a marker — fast. A magnify/lift-out reorganizes the page — needs longer to be readable. These durations match the perceptual weight of each operation.
  - **How to apply** — `marks.timings[i].duration` normalized to those millisecond bands per G6.

- **A4. Color choice: highlight/underline/strike colors come from a 3-color palette per preset; never per-mark random.**
  - **Why** — Mark color is one of the loudest signals in the frame. Random per-mark color reads as noise. Three colors max (a warm highlight, a cool underline, a contrast strike) holds the composition together.
  - **How to apply** — `marks.defaults[style]` sets the palette; only override `marks.timings[i].color` when the third color is needed for a single critical mark (see `research-paper-critique.json` for the canonical example).

- **A5. Focal marks (magnify, lift-out, tear-out, isolate) must dim the surrounding context.**
  - **Why** — The whole point of "focal" is suppression of everything else. A magnify that doesn't dim the rest of the page is just a zoom.
  - **How to apply** — Pipelines for focal marks lower `surface.backgroundVisibility` for the mark's duration, or use the composition shader's suppression term. Verify in the rendered preset.

### Pop-ups & B-roll Overlays

Image-with-caption pop-ins, source citations, stat reveals, side-of-frame info cards. GFX does not yet have a dedicated `pop-up` overlay type — these rules govern future variants and any current preset that approximates them with `lower-third` + `surface`.

- **P1. Anchor to an edge or corner, never centered.**
  - **Why** — A centered pop-up blocks the underlying footage. Edge-anchored leaves a usable 60%+ of the frame for the host's footage.
  - **How to apply** — Use `top-right` / `bottom-right` (or left mirrors). For vertical, prefer `top-*` since `bottom-*` is encumbered by platform UI.

- **P2. Width ≤ 35% of frame on horizontal, ≤ 70% on vertical.**
  - **Why** — Same logic as L2 — the pop-up must coexist with the host's footage, not replace it.

- **P3. On-screen time tied to spoken duration. 2–5 s for a stat or quote, up to 7 s for a citation with reader-required precision.**
  - **Why** — Pop-ups support a voiceover beat. If the host moves on, the overlay should be gone before the next beat lands.
  - **How to apply** — Apply the 2× reading rule (G6) as the floor and the spoken-beat duration as the ceiling.

- **P4. Enter with `settled`, exit with `smooth`. No bouncy on pop-ups.**
  - **Why** — Pop-ups carry information (a number, a citation, an image). `bouncy` distracts from that information. `settled` says "here it is"; `smooth` says "and now we move on."

### Tweet stacks

The `tweet-stack` Overlay is a focal montage rather than a supporting pop-up. These rules supersede P1–P2 for that Pipeline; G2–G11 remain binding.

- **TS1. Cards arrive one at a time; no two cards share an arrival start.**
  - **Why** — The stagger is what communicates a flood of independent reactions rather than one precomposed collage.
  - **How to apply** — Partition `content.pileWindow` by card index and derive every arrival from explicit composition progress.
- **TS2. Each card lands in 250–400 ms and the final pile holds completely still.**
  - **Why** — A post must feel decisively placed while the stable hold supplies the reading window.
- **TS3. Use 2–8 cards and keep the complete pile inside title/platform safe areas in both orientations.**
  - **Why** — Fewer than two is not a stack; more than eight becomes unreadable texture. Vertical reflows the same authored Preset rather than using a sibling.
- **TS4. Live network content is forbidden during preview and export.**
  - **Why** — External layout, deletion, authentication, and response timing violate frame determinism. Share URLs are resolved once during authoring and baked into `content.posts`.
- **TS5. The fully landed top card is the reading target; the rest of the pile communicates reaction gist.**
  - **Why** — A reaction flood is a focal montage, not caption or lower-third hierarchy. G6's 2× overlay reading rule does not apply to every partially occluded post; the top card must instead hold fully readable before the reverse exit.

### Captions & Subtitles

Spoken-word captions for the host audio. First-class as the `state.captions` track (SRT-welded cues, karaoke / word-pop / pack styles) — these rules govern that track and any open-captions case.

**Speech-welded carve-out.** Cues in `state.captions` carry absolute milliseconds welded to the speech — the spoken duration IS the screen time. For this track, **C3 supersedes G6's 2× reading rule** (a 6-word cue spoken in 1.4 s is 257 wpm by construction; a 2× read hold would detach the caption from the voice it transcribes). Likewise cue enters/exits are **hard cuts by identity declaration** — broadcast-faithful, exempt from [Q15](quality-rubric.md#q15-effects-animate-in-and-out--never-pop)'s fade envelope. G6's 2× rule remains binding for non-welded caption/lower-third overlays (no timing source in the audio).

- **C1. Single line preferred; two lines maximum.**
  - **Why** — Broadcast caption standards (BBC, Netflix) cap at two lines. Three-line captions block too much of the frame and exceed reading-speed bandwidth.

- **C2. ≤ 42 characters per line.**
  - **Why** — Professional broadcast standard; longer lines force the eye to track horizontally and lose place.

- **C3. Each caption stays on screen for the spoken duration of the words, but never less than 1 s and never more than 7 s.**
  - **Why** — Reading speed is ~180 wpm; sub-1 s captions can't be read; >7 s captions outlast the spoken phrase and confuse the viewer.

- **C4. Sans-serif typeface, weight ≥ 600, with a 4–6 px stroke or 60% opacity plate behind the text.**
  - **Why** — Captions sit on unknown footage. The stroke/plate is what makes them legible against bright or busy backgrounds (G5). Sans-serif and heavy weight survive the small letter sizes that captions land at.

- **C5. Position: centered horizontally, bottom 15–25% of frame on horizontal; on vertical, bottom 22–34% (above the platform UI band).**
  - **Why** — Caption convention is bottom-centered. Vertical raises the band for the same platform-UI reason as L1.

---

## Authoring Checklist

When an agent finishes a preset, the agent must verify the following before considering the preset shipped. This list is the literal pass/fail rubric.

1. **G1** — Orientation set; fps is 30 unless justified.
2. **G2** — All readable content inside the 90% title-safe rectangle, measured at the 4K render size by the visual audit harness.
3. **G3** — On vertical, no readable content in the top 6%, bottom 16%, or right 9%.
4. **G4** — Every rendered text role hits its cap-height floor for the orientation (body / title / caption / kicker per the G4 table), measured at 4K by the visual audit harness.
5. **G5** — Text/background contrast ≥ 4.5:1 (3:1 for large text); transparent-target overlays carry a legibility treatment.
6. **G6** — Every `enter`/`exit` ms lands in band; `enter` > `exit` by 20–30%. Every mark `duration` lands in the scaled decorative/focal band for its segment word count. The pre-mark window satisfies 1× read of the establish content; every post-mark window satisfies 1.5× read of its marked segment (captions / lower-thirds with no marks use the 2× rule on their own screen-time).
7. **G7** — Every timing block has an explicit `ease`. The chosen ease matches the job per the table in G7. `settled` never appears on an exit.
8. **G8** — At least one of arc, anticipation, follow-through, or secondary action is present and identifiable in the pipeline-rendered animation (verified by inspecting the pipeline source, not the JSON).
9. **G9** — No timing field implies non-deterministic motion.
10. **G10** — No camera move or color flip exceeds the vestibular/flash floors.
11. **G11** — The same Preset is rendered at both orientations and genuinely reflows (motion direction, copy length, type size, and safe placement); no orientation sibling is introduced.
12. **G12** — Transparent output is preserved when no full-frame state is declared; `backgroundFill` / `stage` pieces paint opaquely to every edge and classify correctly.
13. **Per-overlay rules (L1–L7, T1–T4, A1–A5, P1–P4, TS1–TS4, C1–C5)** — every overlay in the preset satisfies the rules for its type. T1 uses the aspect-aware area band table from T1.

A preset that fails any of the above is not done. There is no "good enough" tier below this rubric — those failures are what make AI-generated overlays look AI-generated.

## Verification

Two tools enforce this checklist:

- **`scripts/verify-presets.ts`** — structural + semantic + Pack/Identity gate for every Preset, plus `lintPreset`'s objective safety/readability checks for deliverables. It does **not** enforce motion taste or the R/Q/G rubric wholesale; those remain Critic judgments per ADR-0025.
- **`scripts/audit-presets-visual.ts`** — runtime audit harness. Drives `/p/<slug>` in Chrome with the `chrome-devtools` MCP, measures the source DOM at 4K-equivalent dimensions, and checks the pixel-level rules (G2 placement, G4 cap-heights, T1 card mass). Errors fail the script.

A preset is **not shippable** until both scripts report clean. The static linter alone is necessary but not sufficient — pixel-level rules require the visual harness.
