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
import "./fonts/anthropic-sans.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerServiceWorker } from "./lib/pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Build stamp in the console — a hidden spot to confirm which version is running.
console.info(`%cThumb Studio v${__APP_VERSION__} · ${__APP_COMMIT__} · ${__BUILD_TIME__}`, "color:#d97757;font-weight:600");

registerServiceWorker();
