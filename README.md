# StitchPro Studio

A browser-based embroidery digitizing editor. You draw shapes (or bring in pictures, SVG artwork, typed text or existing machine files), choose how each shape is stitched, see the exact needle sequence on screen, and download a machine embroidery file (DST, PES, EXP, JEF, VP3, XXX).

## Layout

| Folder    | What it is |
|-----------|------------|
| `engine/` | `@stitchpro/engine`: pure TypeScript stitch engine (JSTS for polygon operations). No DOM and no network, so it runs in a Web Worker. |
| `editor/` | `@stitchpro/editor`: framework-free editor (Canvas 2D, opentype.js). Embeddable in other web products. |
| `web/`    | `@stitchpro/web`: React + Vite app shell. |
| `server/` | Python FastAPI server. It is the only place machine files are written. |
| `scripts/`| Dev tooling. |

Units: everything is stored in millimetres, and y grows downward. Native files use `.sps` for designs and `.spf` for fonts.

## Requirements

- Node.js 20 or newer (with npm)
- Python 3.10 or newer (only for the server; the web app runs without it)

## Install

From PowerShell or cmd, in the repository folder:

```powershell
npm install
npx playwright install chromium   # only needed for the browser tests
```

The Python environment (`server\.venv`) is created automatically the first time the server or its tests run. It is reinstalled whenever `server\requirements.txt` changes. To pick a specific Python, set `STITCHPRO_PYTHON`, for example `$env:STITCHPRO_PYTHON = "C:\Python313\python.exe"`.

## Run

```powershell
npm run dev       # API on http://127.0.0.1:8000 + web app on http://localhost:5173
npm run server    # API only
npm run build     # production build of the web app (web\dist)
```

Open http://localhost:5173. Vite forwards `/api` to the server. If Python is missing, the web app still runs, but downloads and machine-file import need the server.

## Test

```powershell
npm run typecheck   # tsc for engine, editor and web
npm test            # Vitest (engine, editor) + pytest (server)
npm run e2e         # Playwright (Chromium); starts its own web on 5174 and server on 8001
npm run check       # all three, in that order
```

What the suites cover:

- **Engine (Vitest):** every stitch generator against the same checks (deterministic, stitch counts, stays inside the shape's extent, spacing, longest stitch), the export plan, `.sps`/`.spf` round trips, text layout and fonts, the auto-digitizer, knockout/cut/weld/laydown/applique, threads, hoops, SVG and machine-file import, worksheet numbers and page tiling.
- **Editor (Vitest):** every tool driven with fake pointer and key events, commands and shortcuts, undo, the renderer's caching.
- **Server (pytest):** every machine format written, read back and compared stitch by stitch; validation, entitlement, imports and fonts.
- **Browser (Playwright):** every feature through the real UI, with their own server pair (ports 5174 / 8001) and a fresh temporary fonts folder per run, plus screenshot checks of the main screen, a design, the export dialog and a menu.

### Before each commit

Run `npm run check`: typecheck, unit tests and browser tests, including the screenshot checks. A git hook does this for you; install it once per clone:

```powershell
npm run hooks       # git config core.hooksPath .githooks
```

After an intended UI change, look at the differences Playwright reports (`web\playwright-report`), then accept the new pictures:

```powershell
npm run e2e -- --update-snapshots
```

To run one part:

```powershell
npm test -w @stitchpro/engine
npm test -w @stitchpro/editor
node server/run.mjs test
```

## Thread charts

The thread colour charts in `web/src/threads/` (`.tch` and `.clr`) come from Melco. Melco makes them freely available for use in embroidery software:
https://melco.zendesk.com/hc/en-us/articles/360027079632-Adding-and-Updating-Thread-Charts-in-DesignShop-Melco-OS-and-Bravo-OS

Each line has the form `code,brand,name,,R,G,B`. To add a chart, drop the file into `web/src/threads/`; it is loaded automatically.

## Local-only folders (not in git)

- `fonts_tt/`: your own TrueType fonts
- `fonts_spf/`: fonts saved from the font editor
- `temp/`: scratch files
