/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which data source to use: "mock" (default) or "dataverse". */
  readonly VITE_DATA?: string;
}
