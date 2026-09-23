# Getting started

This guide takes you from a clean clone to a composition rendering on screen, and then to a video file you can drop into an edit. Every command below was run against this repository while the guide was written.

GFX is local-first. There is no site to sign into — you run the engine yourself, and the pieces you make stay on your machine.

## What you need

| Tool | Version | Why |
| --- | --- | --- |
| Node | 24 or newer | Node 24 is what CI installs (`.github/workflows/quality.yml`) and what the production image is built on (`Dockerfile`, `node:24.20.0-bookworm-slim`). This guide was written on Node 25.2.1. |
| pnpm | 11 | The same two files pin it; `Dockerfile` sets `PNPM_VERSION=11.1.3`. |
| Google Chrome | Any current version | GFX draws through a Chrome-only canvas feature. See [Render a real frame](#render-a-real-frame). |
| ffmpeg | Any recent build | Encodes the video when you export. You only need it for the export step. |

Check what you have:

```bash
node --version
pnpm --version
ffmpeg -version | head -1
```

No `engines` field enforces these, so a nearby version will usually work. Node 24 and pnpm 11 are the pair everything is tested on.

## Install

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 CI=true pnpm install
```

Plain `pnpm install` works too. The two variables avoid a known local failure: `sharp` builds native code, and if Homebrew's libvips is on your machine `sharp` finds it, tries to compile against it, and the install stops. `SHARP_IGNORE_GLOBAL_LIBVIPS=1` tells it to use its own prebuilt binary instead. `CI=true` keeps the install non-interactive, so a native-build approval prompt cannot stall it.

Both are harmless when you don't need them, which is why this guide uses them everywhere.

## Start the dev server

```bash
pnpm dev
```

The server listens on **http://localhost:7263** (the port is set in `vite.config.ts`). Leave it running — every step below talks to it.

## Open a composition

Open http://localhost:7263. The home page lists the built-in Presets in groups: Captions, Flowcharts, Docu, Lower thirds, Social beats, and Title cards. A Preset is one composition stored as JSON.

Click any card to open it in the Workspace. "Lower-third" opens at `/p/lower-third`.

The top bar carries the whole composition: its name, its kind, the Pack supplying its appearance, an orientation pair (**▭ H** / **▯ V**), the target resolution, and **Export ⇪**. Switching orientation reflows the same piece between 3840×2160 and 2160×3840 — one composition, both shapes.

## Render a real frame

**An ordinary Chrome window shows you a blank canvas.** This is the one step that surprises people.

GFX composites live HTML into a WebGPU canvas using the WICG `CanvasDrawElement` feature, which Chrome keeps behind a flag. Without it `copyElementImageToTexture` does not exist, so there is nothing to copy the HTML into and the canvas stays empty.

Start the Chrome that has the flag:

```bash
scripts/launch-cdp-chrome.sh
```

It launches Chrome with `--enable-blink-features=CanvasDrawElement` and `--enable-unsafe-webgpu`, in its own profile, listening for DevTools connections on port 9223. Running it again is safe: if that Chrome is already up, the script leaves it alone and says so.

Open http://localhost:7263/p/lower-third in that window. Halfway through the timeline, the card looks like this:

<figure class="render">
<img src="/renders/lower-third-syntax.webp" width="1600" height="900" alt="A dark lower-third card reading Chapter 01, Origins, and How it began." />
<figcaption>Lower-third · Syntax</figcaption>
</figure>

The neutral field here stands in for footage. In the Workspace, transparent areas show a checkerboard.

## Check the render from the command line

With the dev server and the flagged Chrome both running:

```bash
pnpm test:browser
```

It captures one frame of `transition-wipe-demo` at full size and checks the pixels are really there:

```
READY=true  FLAG(copyElementImageToTexture in GPUQueue)=true
canvas displayed=960x540 client=960x540 border=0x0 backing=3840x2160
saved .tmp-baselines/transition-wipe-demo/p0.50.png  (t=0.60s)
DONE — 1 frames
browser-render: 6,483,692 differing pixels at 3840x2160
```

Two lines tell you whether the setup is right:

- `FLAG(copyElementImageToTexture in GPUQueue)=true` — you are on the flagged Chrome. If this is `false`, the script found an ordinary one.
- `differing pixels` — how much of the frame is not a single flat colour. Millions means a real composition. Near zero means a blank canvas, which almost always means the flag is missing.

The frame itself is saved to `.tmp-baselines/transition-wipe-demo/p0.50.png`. Open it and you have seen GFX render.

## Export a piece

In the Workspace, click **Export ⇪**. Pick a format, then **Export composition**. Progress replaces the button label, and you can cancel while it runs.

| Format | Extension |
| --- | --- |
| WebM VP9 | `.webm` |
| MOV ProRes 4444 | `.mov` |

The file name tells you which kind of piece you made:

| Piece | File |
| --- | --- |
| Transparent overlay | `gfx-overlay.webm` / `gfx-overlay.mov` |
| Full-frame segment or bumper | `gfx-bumper.webm` / `gfx-bumper.mov` |

A composition is **full-frame** when it declares a background fill, uses a depth stage, or carries a video clip covering its whole duration. Everything else is a **transparent overlay**, encoded with alpha so it sits over your own footage. You never choose between the two — the composition decides, and the name follows.

Turning on **Separate WAV** also downloads `gfx-overlay.wav` (or `gfx-bumper.wav`) beside the video, for compositions that have audio.

The finished file lands wherever your browser saves downloads.

### If the export fails

The browser renders the frames and the dev server encodes them with ffmpeg, so the usual cause is a missing ffmpeg. Confirm the server can find one:

```bash
curl -s http://localhost:7263/api/health
```

```json
{
	"status": "unavailable",
	"release": "gfx@6143cc6f413c70ea4d453037b7422b14a427d981",
	"checks": { "ffmpeg": "ok", "temporaryDisk": "unavailable" }
}
```

Read `checks.ffmpeg` and nothing else. `"ok"` means the server found ffmpeg with the encoders both export lanes need; `"unavailable"` means it is not on the server's `PATH`, and no export can finish until it is.

Ignore the rest of the response here. This endpoint answers a different question — whether a host may admit public traffic — so `temporaryDisk` reports whether 8 GB of scratch space is free, and `status` goes to `unavailable` when it isn't. Neither gates a local export. A normal development machine reports exactly what is shown above and exports fine.

If the Workspace reports **"Export requests must come from this origin"**, the browser's address bar and the address the server believes it is serving have drifted apart. Export refuses any request whose `Origin` does not match the server's own origin exactly, so reach the app at plain `http://localhost:7263` rather than through a reverse proxy, a tunnel, or a custom hostname.

## Where to go next

- [`CONTEXT.md`](CONTEXT.md) — what Preset, Layer, Pack, and Pipeline actually mean here.
- [`preset-format.md`](preset-format.md) — the composition JSON, if you want to write one by hand.
- [The Syntax Pack](packs/syntax/aesthetic.md) — the look one Pack supplies, beside the other Packs.
