// Security roles for IBKY Stock Take. Only stk_ table privileges live here —
// every user also gets the built-in "Basic User" role for platform basics.
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
    },
  },
  {
    name: "STK Operations Admin",
    about: "Runs the stock take: set-up, assignments, approvals, variances, exceptions; signs the Operations gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_stocktake: "CRW",
      stk_assignment: "CRWD",
      stk_countsheet: "RWA",
      stk_stack: "CRW",
      stk_recount: "CRWA",
      stk_variance: "CRW",
      stk_exception: "CRWA",
      stk_signoff: "CR",
      stk_mappingchange: { G: "R", B: "CW" },
      stk_issue: "RWA",
      stk_site: "RP", // P = Append: needed to link warehouses to a stock take (N:N)
    },
  },
  {
    name: "STK Warehouse Manager",
    about: "Approves count sheets, decides variances; signs the Warehouse gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_countsheet: "RW",
      stk_stack: "RW",
      stk_recount: "CRWA",
      stk_variance: "RW",
      stk_exception: "CRWA",
      stk_signoff: "CR",
    },
  },
  {
    name: "STK Trading",
    about: "Direct purchases, contract exceptions, mapping requests; signs the Trading gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_directpurchase: "CRW",
      stk_exception: "CRWA",
      stk_mappingchange: { G: "R", B: "CW" },
      stk_signoff: "CR",
    },
  },
  {
    name: "STK Finance",
    about: "Decides mapping changes and variances, prepares and certifies the position; signs the Finance gate.",
    tables: {
      ...READ_ALL_MGMT,
      stk_mappingchange: "CRW", // decides any request
      stk_basketmap: "CRW", // applies approved changes
      stk_outturnmap: "CRW",
      stk_variance: "RW",
      stk_exception: "CRWA",
      stk_signoff: "CR",
      stk_stocktake: "RW", // records who prepared the pack
    },
  },
  {
    name: "STK IT Admin",
    about: "Warehouses, packing types, settings and problem-report triage.",
    tables: {
      ...READ_ALL_MGMT,
      stk_site: "CRWD",
      stk_packtype: "CRWD",
      stk_setting: "CRWD",
      stk_issue: "RWA",
    },
  },
  {
    name: "STK Importer",
    about: "Loads XBS and Comtras snapshots. Create-only on the locked tables — no role can edit or delete them.",
    tables: {
      stk_site: "R",
      stk_xbsimport: "CRW", // header status: Validating → Imported / Failed / Superseded
      stk_xbsline: "CR",
      stk_comtrasposition: "CR",
    },
  },
];

/** Tables whose rows must never be changed once created. Checked by create-roles.mjs. */
export const LOCKED = ["stk_xbsline", "stk_comtrasposition"];
