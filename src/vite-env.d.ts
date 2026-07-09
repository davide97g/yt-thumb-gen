/// <reference types="vite/client" />

// Build-time constants injected by Vite `define` (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __BUILD_TIME__: string;

declare module "@fontsource/*";

interface ImportMetaEnv {
  readonly VITE_BGREMOVE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
