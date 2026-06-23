/// <reference types="vite/client" />

declare module "@fontsource/*";

interface ImportMetaEnv {
  readonly VITE_BGREMOVE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
