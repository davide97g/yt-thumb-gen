/* UI faces: Geist for the chrome, Geist Mono for every readout. The rest are
   canvas display faces offered in the font picker. */
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
import "./fonts/anthropic-sans.css";
import { ClerkProvider } from "@clerk/clerk-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import "./styles.css";
import { registerServiceWorker } from "./lib/pwa";

// Clerk holds the credential (Google sign-in); `AuthGate` still decides who gets the editor,
// because being signed in and being allowed into *this* workspace are different questions —
// only the API can answer the second one.
//
// Baked in at build time and public by design: this is the frontend key, never the secret. An
// empty string keeps the provider from throwing on a build made without it — `/auth/status`
// then tells the front door that sign-in isn't configured, which is a legible screen rather
// than a blank one.
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <AuthGate>
        <App />
      </AuthGate>
    </ClerkProvider>
  </StrictMode>
);

// Build stamp in the console — a hidden spot to confirm which version is running.
console.info(`%cThumb Studio v${__APP_VERSION__} · ${__APP_COMMIT__} · ${__BUILD_TIME__}`, "color:#bdf03a;font-weight:600");

registerServiceWorker();
