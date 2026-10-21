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
