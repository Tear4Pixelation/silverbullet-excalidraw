import React, { useRef, useCallback, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
// import "@excalidraw/excalidraw/index.css";
import { ExcalidrawApiBridge } from "./ExcalidrawAPI";
import type {
  ExcalidrawImperativeAPI,
  InteractionConfig,
} from "@excalidraw/excalidraw/types";
import { Excalidraw, THEME } from "@excalidraw/excalidraw";
import { getBlob, getExtension } from "./helpers";
import { normalizeTheme, resolveSpaceTheme } from "./theme";
import { ResizeHandle } from "./ResizeHandle";

declare global {
  var silverbullet: {
    syscall: (name: string, ...args: any[]) => Promise<any>;
    sendMessage: (name: string, ...args: any[]) => Promise<any>;
    addEventListener: (name: string, callback: (args: any) => void) => void;
  };
}

const syscaller =
  typeof silverbullet !== "undefined" ? silverbullet.syscall : syscall;

// While the embed is locked, Excalidraw runs non-interactive: it doesn't
// attach its wheel/touch/gesture listeners, ignores pointer drag-panning and
// sets `touch-action: auto` on the canvas, so wheel and touch scrolling fall
// through to the SilverBullet page. `browserZoom` keeps ctrl+wheel / pinch
// acting on the page too, as if the embed weren't there; `links` keeps element
// links clickable like in view mode.
const LOCKED_INTERACTION: InteractionConfig = {
  enabled: { links: true, browserZoom: true },
};

interface AppProps {
  doc: ExcalidrawInitialDataState;
  fileName: string;
  theme: string;
  viewMode: boolean;
  themeRoot?: HTMLElement; // set => follow live SB theme changes
}


function App({ doc, fileName, theme, viewMode, themeRoot }: AppProps) {

  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const apiBridge = useRef(
    new ExcalidrawApiBridge(excalidrawApiRef, fileName, "widget")
  ).current;

  const onChange = useCallback(() => {
    apiBridge.debouncedSave();
  },
    [apiBridge]
  );

  const startEditing = useCallback(async () => {
    await syscaller("editor.navigate", fileName);
  }, [fileName]);

  // Locked by default on every load: the viewport can't move and scrolling
  // over the embed scrolls the page.
  const [isLocked, setIsLocked] = useState(true);

  const toggleLock = useCallback(() => {
    const willLock = !isLocked;
    const readyApi = excalidrawApiRef.current;
    if (willLock && readyApi) {
      // re-fit so the locked embed always shows the whole diagram
      readyApi.setViewport({
        target: readyApi.getSceneElements(),
        fit: "scale-down",
        animation: false,
      });
    }
    setIsLocked(willLock);
  }, [isLocked]);


  const excalidrawRef = useCallback(
    async (excalidrawApi: ExcalidrawImperativeAPI) => {
      // excalidrawApi.onEvent("editor:mount", ({ excalidrawAPI, container }) => {
      //   console.log(container);
      // });

      excalidrawApi.onEvent("editor:initialize").then((readyApi) => {
        excalidrawApiRef.current = readyApi;
        readyApi.setViewport({
          target: readyApi.getSceneElements(),
          fit: "scale-down",
          animation: false,
        });
      });
      const data = await syscaller("space.readFile", fileName);
      const blob = getBlob(data, getExtension(fileName));
      apiBridge.load({ blob: blob, viewMode: true, theme: theme });
      if (themeRoot) apiBridge.followSpaceTheme(themeRoot, theme);
    },
    [fileName, apiBridge]
  );


  const EditButton = () => (
    <button
      className="button"
      id="edit-button"
      onClick={startEditing}
      title="Edit"
    >
      ✎
    </button>
  );

  const LockButton = () => (
    <button
      className="button"
      id="lock-button"
      onClick={toggleLock}
      title={
        isLocked
          ? "Locked: scrolling moves the page. Click to pan/zoom the diagram"
          : "Unlocked: scroll/drag pans and zooms the diagram. Click to lock"
      }
      aria-pressed={isLocked}
    >
      {isLocked ? "🔒" : "🔓"}
    </button>
  );

  return (
    <div className={"excalidraw-viewer"}>
      <Excalidraw
        onExcalidrawAPI={excalidrawRef}
        isCollaborating={false}
        initialData={doc}
        onChange={onChange}
        viewModeEnabled={true}
        interaction={isLocked ? LOCKED_INTERACTION : true}
        zenModeEnabled={true}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveAsImage: false,
            saveToActiveFile: false,
          },
        }}
        renderTopRightUI={(isMobile, appState) =>
          null
        }
      >
        <div className="widget-buttons">
          <LockButton />
          {!viewMode && <EditButton />}
        </div>
        <ResizeHandle />
      </Excalidraw>
    </div>
  );
}

export async function renderWidget(rootElement: HTMLElement) {
  const fileName = rootElement.dataset.filename!;
  const explicitTheme = normalizeTheme(rootElement.dataset.theme);
  const theme = explicitTheme ?? resolveSpaceTheme(rootElement.dataset.storeTheme);

  let data = await syscaller("space.readFile", fileName);
  let json: string;
  try {
    json = new TextDecoder("utf-8").decode(data); // latest edge docker build (:v2 tag)
  } catch {
    json = data;
  }
  const doc: ExcalidrawInitialDataState = JSON.parse(json);
  const isRoMode = (await syscaller("system.getMode")) === "ro";
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App doc={doc} theme={theme} viewMode={isRoMode} fileName={fileName} themeRoot={explicitTheme ? undefined : rootElement} />);
}

