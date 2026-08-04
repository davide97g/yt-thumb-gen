/// <reference types="vite/client" />

// Build-time constants injected by Vite `define` (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __BUILD_TIME__: string;

declare module "@fontsource/*";

interface ImportMetaEnv {
  readonly VITE_BGREMOVE_URL?: string;
  /** Clerk frontend key. Baked in at build time, which is why the web image takes it as a
   *  build arg (see Dockerfile) — it is public by design, unlike CLERK_SECRET_KEY. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
