# GFX

A motion-graphics engine on a web stack. It runs on your own machine, where the
full ProRes export lane lives, and at [gfx.computer](https://gfx.computer),
where the browser renders and encodes every export itself and the origin keeps
nothing. The docs are at [docs.gfx.computer](https://docs.gfx.computer).

GFX renders broadcast-quality motion pieces at native 4K: **transparent
overlays** you composite over footage in an editor, and **full-frame** segments
and bumpers. A piece is a JSON **Preset** that composes five Layers (Surface,
Block, Annotation, Overlay, Effect) from a Pipeline registry. A swappable
**Pack** supplies the appearance — the engine is general, the look is not. Every
piece reflows between horizontal (YouTube) and vertical (TikTok, Reels) targets
with platform safe-areas.

A person authors in the browser GUI. An agent authors through WebMCP. Both act
on the same visible composition.

Rendering is TypeGPU/WebGPU plus WICG HTML-in-Canvas, animated with GSAP and
encoded through Mediabunny and ffmpeg. Every frame is driven from an explicit
timestamp, so preview and export produce the same pixels at the same time.

## Running it locally

Node 24 or newer, and pnpm.

```sh
pnpm install
pnpm dev        # http://localhost:7263
```

Chrome needs `--enable-blink-features=CanvasDrawElement` to render the canvas.
An unflagged browser is gated: the app shows a full-screen notice with the
launch command instead of rendering anything approximate. Start the combined
CanvasDrawElement+WebMCP agent browser — the default for local agent use — with:

```sh
CDP_BROWSER_MODE=agent scripts/launch-cdp-chrome.sh   # CDP port 9229
```

## Checks

```sh
pnpm check           # svelte-check, eslint, discoverability
pnpm test            # vitest
pnpm verify-presets  # render and measure the Preset corpus
```

## License

Copyright 2026 Break Code LLC.

Except for third-party components that carry their own license notices, GFX is
available under the [GNU Affero General Public License, version 3 or
later](LICENSE.md) (`AGPL-3.0-or-later`), with an additional permission to combine
it with GSAP. Versions made available before 2026-10-08 were offered under
`FSL-1.1-ALv2`, and that grant stands for those versions. Why:
[ADR-0069](docs/adr/0069-agpl-licence-for-the-strudel-score.md).

## Where to read next

- [`AGENTS.md`](AGENTS.md) — the binding rules, and which doc to read for which task.
- [`docs/CONTEXT.md`](docs/CONTEXT.md) — the glossary. One spelling per concept.
- [`docs/engine-architecture.md`](docs/engine-architecture.md) — how the engine works today.
- [`docs/preset-format.md`](docs/preset-format.md) — the Preset JSON format.
- [`docs/adr/`](docs/adr/) — why each decision was made.
