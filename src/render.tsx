/* Headless render entry — the page a browser in the render service drives.
 *
 * It mounts the *real* ThumbCanvas at scale 1, so what comes out is the same composition the
 * editor draws and the same one `html-to-image` exports. That's the whole design: an agent
 * that asks for a picture of a project must not be shown a second renderer's opinion of it.
 *
 * Everything the editor does around the canvas — auth gate, IndexedDB, autosave, service
 * worker — is deliberately absent. This page has no state and makes no requests of its own;
 * the document is handed to it, images and all.
 */

// The same font set the editor loads: a display face missing here would silently render as
// Helvetica in every server-side picture.
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/archivo-black";
import "@fontsource/inter/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/900.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/anton/400.css";
import "@fontsource/oswald/400.css";
import "@fontsource/oswald/700.css";
import "@fontsource/league-gothic/400.css";
import "@fontsource/league-spartan/800.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/poppins/800.css";
import "@fontsource/roboto-condensed/700.css";
import "@fontsource/luckiest-guy/400.css";
import "@fontsource/bangers/400.css";
import "@fontsource/crimson-pro/700.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/libre-baskerville/700.css";
import "@fontsource/lobster/400.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/alex-brush/400.css";
import "./fonts/anthropic-sans.css";
import "./styles.css";

import { createRoot } from "react-dom/client";
import { ThumbCanvas } from "./components/ThumbCanvas";
import { canvasSize, migrateDoc, type ThumbDoc } from "./state";

const stage = document.getElementById("stage")!;
const root = createRoot(stage);

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Every `<img>` currently on the stage, settled. Images are inline data URLs by the time
 *  they reach here, so this is fast — but "fast" is not "already done", and a capture taken
 *  a frame early loses the photo the whole design is built around. */
async function imagesSettled(): Promise<void> {
  const images = [...stage.querySelectorAll("img")];
  await Promise.all(
    images.map((img) =>
      img.complete
        ? img.decode().catch(() => undefined)
        : new Promise<void>((res) => {
            img.addEventListener("load", () => res(), { once: true });
            img.addEventListener("error", () => res(), { once: true }); // a broken image must not hang the render
          })
    )
  );
}

declare global {
  interface Window {
    /** Renders a document and resolves with its pixel size once the stage is safe to capture. */
    __renderThumb: (doc: ThumbDoc) => Promise<{ w: number; h: number }>;
  }
}

window.__renderThumb = async (input) => {
  const doc = migrateDoc(input);
  const size = canvasSize(doc.format);
  stage.style.width = `${size.w}px`;
  stage.style.height = `${size.h}px`;

  root.render(
    <ThumbCanvas
      doc={doc}
      scale={1}
      selectedIds={[]}
      exporting /* hides selection chrome, guides and safe areas */
      cropMode={null}
      setCropMode={() => {}}
      drawMode={false}
      setDrawMode={() => {}}
      canvasRef={{ current: null }}
      dispatch={() => {}}
    />
  );

  // One frame lays the layers out, the next lets the WebGL effect backgrounds draw their
  // first pass; fonts and images then have to actually be there.
  await frame();
  await frame();
  await document.fonts.ready;
  await imagesSettled();
  await frame();
  return size;
};
