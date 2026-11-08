import "./styles.css";

import { renderWidget } from "./widget";
import { renderEditor } from "./editor";
import { renderSvgEditorElement } from "./svgeditor";

(function init() {
    console.info("Excalidraw editor: fork build 0.2.0-t4p");
    const editorElement = document.getElementById("editor");
    const widgetElement = document.getElementById("widget");
    const svgEditorElement = document.getElementById("svgeditor");
    console.log({ widgetElement, editorElement });

    if (editorElement) {
        renderEditor(editorElement);
    } else if (widgetElement && typeof silverbullet === "undefined") { // workaround to stop widget to open unnecessarily 
        renderWidget(widgetElement);
    } else if (svgEditorElement) {
        renderSvgEditorElement(svgEditorElement);
    } else {
        console.error("Excalidraw: No editor or widget element found");
    }
})();
