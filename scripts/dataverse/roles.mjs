// Security roles for IBKY Stock Take. stk_ table privileges, plus a few platform
// privileges in `misc` (organisation-wide). Every user also gets the built-in
// "Basic User" role for platform basics (e.g. reading user records).
//
// Rights per table: C create · R read · W write · D delete · A assign · S share · P append.
// Append / AppendTo are derived: Append with C or W, AppendTo with R.
// Depth: G = whole organisation, B = own records only (user-owned tables).
//   "R"            → read, organisation-wide
//   { G: "R", B: "CW" } → read everyone's, create/write own

const READ_REFERENCE = {
  stk_site: "R",
  stk_packtype: "R",
  stk_setting: "R",
  stk_xbsimport: "R",
  stk_xbsline: "R",
  stk_basketmap: "R",
  stk_outturnmap: "R",
  stk_stocktake: "R",
};

const READ_ALL_MGMT = {
  ...READ_REFERENCE,
  stk_comtrasposition: "R",
  stk_contractinvoice: "R",
  stk_shipment: "R",
  stk_directlot: "R",
  stk_xbsstuffing: "R",
  stk_mappingchange: "R",
  stk_assignment: "R",
  stk_countsheet: "R",
  stk_stack: "R",
  stk_countline: "R",
  stk_recount: "R",
  stk_variance: "R",
  stk_exception: "R",
  stk_signoff: "R",
  stk_directpurchase: "R",
  stk_issue: "R",
  stk_counterprofile: "R",
  stk_allocationrun: "R",
  stk_reconitem: "R",
  stk_kpisnapshot: "R",
  stk_enginerun: "R", // when the Level 1 engine last ran (Hub status)
  Note: "R", // photos on count lines and problem reports
};

export const ROLES = [
  {
    name: "STK Counter",
    about: "Counts on the floor with the Stock Take app.",
    tables: {
      ...READ_REFERENCE,
      stk_assignment: "R",
      stk_stack: "CRW", // records third-party stacks, submits stacks
      stk_countsheet: { B: "CRW" },
      stk_countline: { G: "R", B: "CW" }, // sees teammates' lines for duplicate warnings
      stk_recount: { B: "RW" },
      stk_issue: { B: "CRW" },
      Note: { B: "CRW" }, // photo of the tag / of the problem, attached to their own lines
    },
  },
  {
    name: "STK Operations Admin",
    misc: ["ReadRecordAuditHistory", "ReadAuditSummary"], // Set-up › Audit log reads Dataverse audit history across the stk_ tables
    about: "Runs the stock take: set-up, counter allocation, approvals, variances, exceptions; signs the Operations gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_stocktake: "CRW",
      stk_assignment: "CRWD",
      stk_counterprofile: "CRW", // who counts, home rows, third-party clearance
      stk_allocationrun: "CRW", // random counter allocation: generate, swap, publish
      stk_reconitem: "CRWD", // BRIC bridge items (with Finance)
      stk_countsheet: "RWA",
      stk_stack: "CRW",
      stk_recount: "CRWA",
      stk_variance: "CRW",
      stk_exception: "CRWA",
      stk_signoff: "CR",
      stk_kpisnapshot: "CRW", // the Hub refreshes governance KPIs for whoever has it open; frozen at Finance sign-off
      stk_mappingchange: { G: "R", B: "CW" },
      stk_issue: "RWA",
      stk_site: "RP", // P = Append: needed to link warehouses to a stock take (N:N)
    },
  },
  {
    name: "STK Warehouse Manager",
    misc: ["ReadRecordAuditHistory", "ReadAuditSummary"], // Set-up › Audit log reads Dataverse audit history across the stk_ tables
    about: "Approves count sheets, decides variances; signs the Warehouse gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_countsheet: "RW",
      stk_stack: "RW",
      stk_recount: "CRWA",
      stk_variance: "RW",
      stk_exception: "CRWA",
      stk_signoff: "CR",
      stk_kpisnapshot: "CRW", // the Hub refreshes governance KPIs for whoever has it open; frozen at Finance sign-off
    },
  },
  {
    name: "STK Trading",
    misc: ["ReadRecordAuditHistory", "ReadAuditSummary"], // Set-up › Audit log reads Dataverse audit history across the stk_ tables
    about: "Direct purchases, contract exceptions, mapping requests; signs the Trading gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_directpurchase: "CRW",
      stk_exception: "CRWA",
      stk_mappingchange: { G: "R", B: "CW" },
      stk_signoff: "CR",
      stk_kpisnapshot: "CRW", // the Hub refreshes governance KPIs for whoever has it open; frozen at Finance sign-off
    },
  },
  {
    name: "STK Finance",
    misc: ["ReadRecordAuditHistory", "ReadAuditSummary"], // Set-up › Audit log reads Dataverse audit history across the stk_ tables
    about: "Decides mapping changes and variances, prepares and certifies the position; signs the Finance gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_mappingchange: "CRW", // decides any request
      stk_basketmap: "CRW", // applies approved changes
      stk_outturnmap: "CRW",
      stk_variance: "RW",
      stk_exception: "CRWA",
      stk_signoff: "CR",
      stk_kpisnapshot: "CRW", // the Hub refreshes governance KPIs for whoever has it open; frozen at Finance sign-off
      stk_stocktake: "RW", // records who prepared the pack
      stk_reconitem: "CRWD", // prepares the BRIC bridge: afloat and reconciling items
    },
  },
  {
    name: "STK IT Admin",
    misc: ["ReadRecordAuditHistory", "ReadAuditSummary"], // Set-up › Audit log reads Dataverse audit history across the stk_ tables
    about: "Warehouses, packing types, settings and problem-report triage.",
    tables: {
      ...READ_ALL_MGMT,
      stk_site: "CRWD",
      stk_packtype: "CRWD",
      stk_setting: "CRWD",
      stk_issue: "RWA",
      stk_counterprofile: "CRWD",
    },
  },
  {
    name: "STK Importer",
    about: "Loads XBS, Comtras, shipment tracker, XBS stuffing and direct purchase snapshots. Create-only on the locked tables — no role can edit or delete them.",
    tables: {
      stk_site: "R",
      stk_xbsimport: "CRW", // header status: Validating → Imported / Failed / Superseded
      stk_xbsline: "CR",
      stk_comtrasposition: "CR",
      stk_contractinvoice: "CR",
      stk_shipment: "CR",
      stk_directlot: "CR",
      stk_xbsstuffing: "CR",
    },
  },
  {
    name: "STK Engine",
    about:
      "For the Stock Assistant's engine (application user, not a person): reads every stk_ table, raises and updates its own rule exceptions in stk_exception, and keeps its own ibky_ tables (when that solution is installed).",
    tables: {
      ...READ_ALL_MGMT,
      stk_exception: "CRWA", // engine checks upsert on stk_rulekey; A = owned by the department head; no delete
    },
    // Tables of another solution, matched by prefix, granted only where they exist.
    prefixTables: { ibky_: "CRWD" },
  },
  {
    name: "STK Level 1 Engine",
    misc: ["ReadUser"], // counters' names in the explanations, department heads by email
    about:
      "For the server engine stk-level1 (application user, not a person), active only when setting Level1Runs = Engine: turns the count into variances, decides them by the Level 1 rules, sends blind recounts, raises exceptions (owned by the department head) and closes the count with its summary and PDF. Never deletes.",
    tables: {
      ...READ_ALL_MGMT,
      stk_variance: "CRW",
      stk_recount: "CRWA", // A = the recount belongs to the counter who does it
      stk_exception: "CRWA", // A = owned by the department head
      stk_stocktake: "RW", // count closed + Level 1 summary
      stk_enginerun: "CRW", // its run log and lock
      Note: "CRW", // the Level 1 summary PDF on the stock take
    },
  },
];

/** Tables whose rows must never be changed once created. Checked by create-roles.mjs. */
export const LOCKED = ["stk_xbsline", "stk_comtrasposition", "stk_contractinvoice", "stk_shipment", "stk_directlot", "stk_xbsstuffing"];
