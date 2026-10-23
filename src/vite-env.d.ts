/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which data source to use: "mock" (default) or "dataverse". */
  readonly VITE_DATA?: string;
}

// The real fflate, behind src/vendor/fflate-sync.ts (see vite.config.ts).
declare module "fflate-real" {
  export * from "fflate";
}
