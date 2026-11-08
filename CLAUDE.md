# silverbullet-excalidraw — dev notes

SilverBullet (SB v2) plug that embeds Excalidraw diagrams.

## Layout

- `excalidraw.plug.yaml` / `excalidraw.ts` — the plug (runs in SB's plug worker). Commands,
  slash completion, the `excalidraw` code widget (`showWidget`), the document editor for
  `.excalidraw` files (`openExcalidrawEditor`) and the fullscreen modal for svg/png (`openFullScreenEditor`).
  `getHtmlJs()` builds the HTML + JS for all three modes.
- `editor/` — Vite React app bundled as one IIFE (`editor/dist/excalidraw_editor.js`).
  `src/index.tsx` picks the mode by element id:
  - `#widget` → `widget.tsx` (inline embed, view-mode only, ✎ button navigates to the file)
  - `#editor` → `editor.tsx` (document editor for `.excalidraw` pages)
  - `#svgeditor` → `svgeditor.tsx` (fullscreen modal editor for `.svg`/`.png`)
  - `ExcalidrawAPI.ts` — load/save bridge shared by all modes; `styles.css` — shared CSS.
- `excalidraw/` — git submodule of upstream excalidraw (source-aliased by `editor/vite.config.ts`).
  Its URL is `git@github.com:...`; use `git -c url."https://github.com/".insteadOf="git@github.com:" submodule update --init` without SSH keys.
- `Silverbullet-Excalidraw/` — files shipped into the user's space as a SB Library
  (`PLUG.md` frontmatter lists them). **The plug loads the editor JS from the space at
  `Library/LogeshG5/Silverbullet-Excalidraw/excalidraw_editor.js`**, not from plug assets.
  `build:editor` copies `editor/dist/excalidraw_editor.js` there.

## Build

```
yarn setup            # installs excalidraw/, editor/, root deps
yarn build:editor     # vite build + copy to Silverbullet-Excalidraw/
yarn build:plugin     # plug-compile → excalidraw.plug.js
```

## How the widget is hosted by SB (verified against SB source, client/sandbox/*)

- Code widgets render in a pooled **same-origin `about:blank` iframe** (no `sandbox` attr).
  `window.parent.document` is reachable.
- SB writes the html, sets `<html data-theme="dark|light">` from the host **before** evaling
  the script, and auto-sizes the iframe height from `body` height (so changing the widget
  div height resizes the iframe).
- Syscalls from the iframe go through `silverbullet.syscall(...)`.
- Theme source of truth in SB v2 is `<html data-theme>` on the host. `uiOptions.darkMode`
  is `undefined` when following the OS; `clientStore.get("darkMode")` is unreliable for that.
- Offline: the SB service worker only stores non-`.md` files locally when the space config has
  `sync.documents = true` (default false). Otherwise `.excalidraw` files 404 offline.
