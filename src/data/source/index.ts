// Chooses the data source at start-up: VITE_DATA=mock (default) or dataverse.
// Loaded lazily, so the demo data isn't bundled into the Dataverse build path.

import type { DataSource } from "./types";

export type DataKind = "mock" | "dataverse";
export const DATA_KIND: DataKind = import.meta.env.VITE_DATA === "dataverse" || import.meta.env.MODE === "dataverse" ? "dataverse" : "mock";

export async function getSource(): Promise<DataSource> {
  return DATA_KIND === "dataverse" ? (await import("./dataverse")).dataverseSource : (await import("./mock")).mockSource;
}

export type { AllocationData, DataSource, MgmtData, Reference, Signature, Today, XbsUploadToSave } from "./types";
