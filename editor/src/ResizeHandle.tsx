import React, { useRef, useCallback } from "react";

// Drag handle at the bottom edge of the inline widget.
// Live-resizes the #widget div (and tells SB to resize the hosting iframe),
// then persists the new height into the page's ```excalidraw block on release.

const MIN_HEIGHT = 150;

const syscaller = (name: string, ...args: any[]): Promise<any> =>
  typeof silverbullet !== "undefined"
    ? silverbullet.syscall(name, ...args)
    : syscall(name, ...args);

interface FencedBlock {
  from: number; // start of the opening fence line
  to: number; // end of the closing fence line
  bodyFrom: number;
  bodyTo: number;
  body: string;
}

// Finds fenced ```excalidraw blocks; body is computed the same way SB builds the
// widget's bodyText (lines between the fences, joined with "\n").
function findExcalidrawBlocks(text: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  let openIndex = -1;
  let fence = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (openIndex === -1) {
      const openMatch = line.match(/^\s*(`{3,}|~{3,})\s*excalidraw\b/);
      if (openMatch) {
        openIndex = i;
        fence = openMatch[1];
      }
      continue;
    }
    const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    if (closeMatch && closeMatch[1][0] === fence[0] && closeMatch[1].length >= fence.length) {
      const bodyFrom = lineStarts[openIndex + 1];
      const bodyTo = i > openIndex + 1 ? lineStarts[i] - 1 : bodyFrom;
      blocks.push({
        from: lineStarts[openIndex],
        to: lineStarts[i] + line.length,
        bodyFrom,
        bodyTo,
        body: text.slice(bodyFrom, bodyTo),
      });
      openIndex = -1;
    }
  }
  return blocks;
}

function blockUrl(body: string): string | null {
  const match = body.match(/url:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

// Position of this widget's iframe in the host CodeMirror document, if reachable
// (same-origin iframe, SB exposes globalThis.client on the host).
function hostDocumentPosition(): number | null {
  try {
    const hostClient = (window.parent as any)?.client;
    const frame = window.frameElement;
    if (!hostClient?.editorView || !frame) return null;
    const position = hostClient.editorView.posAtDOM(frame);
    return typeof position === "number" ? position : null;
  } catch {
    return null;
  }
}

function identifyBlock(
  blocks: FencedBlock[],
  originalBody: string,
  fileName: string
): FencedBlock | null {
  const position = hostDocumentPosition();
  if (position !== null) {
    // The widget decoration sits at the block's start, so this is exact; if it isn't
    // inside a matching block (e.g. a Lua-rendered widget), don't guess.
    const containing = blocks.find(
      (block) => block.from <= position && position <= block.to
    );
    return containing && blockUrl(containing.body) === fileName ? containing : null;
  }
  const bodyMatches = blocks.filter((block) => block.body === originalBody);
  if (bodyMatches.length === 1) return bodyMatches[0];
  if (bodyMatches.length > 1) return null; // identical blocks, can't tell which
  const urlMatches = blocks.filter((block) => blockUrl(block.body) === fileName);
  return urlMatches.length === 1 ? urlMatches[0] : null;
}

// Returns the [from, to, insert] edit that sets the block's height line.
function heightEdit(
  text: string,
  block: FencedBlock,
  heightPx: number
): { from: number; to: number; insert: string; newBody: string } {
  const bodyLines = block.body.split("\n");
  let lineOffset = block.bodyFrom;
  let urlLineEnd = -1;
  let urlIndent = "";
  for (const line of bodyLines) {
    const heightMatch = line.match(/^(\s*)height\s*:/i);
    if (heightMatch) {
      const insert = `${heightMatch[1]}height:${heightPx}px`;
      const from = lineOffset;
      const to = lineOffset + line.length;
      const newBody =
        text.slice(block.bodyFrom, from) + insert + text.slice(to, block.bodyTo);
      return { from, to, insert, newBody };
    }
    const urlMatch = line.match(/^(\s*)url\s*:/i);
    if (urlMatch && urlLineEnd === -1) {
      urlLineEnd = lineOffset + line.length;
      urlIndent = urlMatch[1];
    }
    lineOffset += line.length + 1;
  }
  // No height line: add one after the url line (or at the end of the body).
  const insertAt = urlLineEnd !== -1 ? urlLineEnd : block.bodyTo;
  const insert =
    block.body === "" && urlLineEnd === -1
      ? `height:${heightPx}px\n`
      : `\n${urlIndent}height:${heightPx}px`;
  const newBody =
    text.slice(block.bodyFrom, insertAt) + insert + text.slice(insertAt, block.bodyTo);
  return { from: insertAt, to: insertAt, insert, newBody };
}

function documentHeight(): number {
  return Math.max(document.body.offsetHeight, document.documentElement.offsetHeight);
}

// SB only polls the iframe body height for ~2.5s after render, so report it ourselves.
function reportHeightToHost() {
  window.parent?.postMessage({ type: "setHeight", height: documentHeight() }, "*");
}

async function persistHeight(widget: HTMLElement, heightPx: number): Promise<void> {
  const fileName = widget.dataset.filename || "";
  const pageName = decodeURIComponent(widget.dataset.page || "");
  const originalBody = decodeURIComponent(widget.dataset.body || "");
  // Rendered via Lua (excalidraw.render passes no page name): no code block to rewrite.
  if (!pageName || !originalBody) return;
  if ((await syscaller("system.getMode")) === "ro") return;

  const text: string = await syscaller("editor.getText");
  const block = identifyBlock(findExcalidrawBlocks(text), originalBody, fileName);
  if (!block) {
    await syscaller(
      "editor.flashNotification",
      "Excalidraw: couldn't identify the code block to save the new height",
      "error"
    );
    return;
  }
  const edit = heightEdit(text, block, heightPx);
  if (edit.newBody === block.body) return;

  // The edit changes the widget's bodyText, so SB re-creates the widget. Seed SB's
  // widget height cache for the new body so the new iframe starts at the right size
  // instead of SB's 150px default (avoids a collapse/expand jump).
  try {
    (window.parent as any)?.client?.widgetCache?.setCachedWidgetMeta(edit.newBody, {
      height: documentHeight(),
      block: true,
    });
  } catch {
    // best effort, internal API
  }
  await syscaller("editor.replaceRange", edit.from, edit.to, edit.insert);
}

export function ResizeHandle() {
  const dragState = useRef<{
    widget: HTMLElement;
    startY: number;
    startHeight: number;
    currentHeight: number;
    frameRequest: number;
  } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const widget = event.currentTarget.closest<HTMLElement>("#widget");
    if (!widget) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startHeight = widget.getBoundingClientRect().height;
    dragState.current = {
      widget,
      startY: event.clientY,
      startHeight,
      currentHeight: startHeight,
      frameRequest: 0,
    };
    document.documentElement.classList.add("excalidraw-resizing");
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    const newHeight = Math.max(
      MIN_HEIGHT,
      Math.round(state.startHeight + event.clientY - state.startY)
    );
    if (newHeight === state.currentHeight) return;
    state.currentHeight = newHeight;
    state.widget.style.height = `${newHeight}px`;
    if (!state.frameRequest) {
      state.frameRequest = requestAnimationFrame(() => {
        state.frameRequest = 0;
        reportHeightToHost();
      });
    }
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    dragState.current = null;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.documentElement.classList.remove("excalidraw-resizing");
    if (state.frameRequest) cancelAnimationFrame(state.frameRequest);
    reportHeightToHost();
    if (Math.round(state.startHeight) === state.currentHeight) return;
    persistHeight(state.widget, state.currentHeight).catch((error) =>
      console.error("Excalidraw: failed to persist widget height", error)
    );
  }, []);

  return (
    <div
      className="excalidraw-resize-handle"
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="excalidraw-resize-grip" />
    </div>
  );
}
