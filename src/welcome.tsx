// Entry point for the landing page (welcome.html → /welcome).
//
// It loads three faces and nothing else: Geist for prose, Geist Mono for the readouts, Anton
// for the display type. The editor's entry imports twenty-odd families because the font picker
// offers them to the canvas; a page that only *talks* about that has no reason to download them.
//
// No AuthGate, no storage, no service worker: this page has no session, writes nothing, and is
// the one surface that should always come straight from the network so a changed pitch is the
// pitch people see.

import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/anton/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./components/Landing";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Landing />
  </StrictMode>
);
