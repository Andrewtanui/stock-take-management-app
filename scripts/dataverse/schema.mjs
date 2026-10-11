// IBKY Stock Take — Dataverse schema as data. Source of truth for
// create-schema.mjs; mirrors docs/dataverse-schema.md (approved 2026-10-09).

export const PUBLISHER = { uniquename: "IberoKenya", friendlyname: "Ibero Kenya", prefix: "stk", optionPrefix: 61450 };
export const SOLUTION = { uniquename: "IBKYStockTake", friendlyname: "IBKY Stock Take", version: "1.0.0.0" };

/* ---------- column builders ---------- */
const s = (max = 100) => ({ type: "string", max });
const memo = (max = 2000) => ({ type: "memo", max });
const int = () => ({ type: "int" });
const dec = (precision = 2) => ({ type: "decimal", precision });
const bool = () => ({ type: "bool" });
const date = () => ({ type: "date" });
const dt = () => ({ type: "datetime" });
const choice = (set) => ({ type: "choice", set });
const local = (...options) => ({ type: "localchoice", options });
const file = (kb = 10240) => ({ type: "file", kb });

/* ---------- global choices ---------- */
const ROOT_CAUSES = [
  "Split lot",
  "Unposted receipt",
  "Unposted gate-out",
  "Duplicate entry",
  "Mapping error",
  "Pocket / unit difference",
  "Wrong basket on sale",
  "In transit",
  "Cancelled contract",
  "Not yet known",
];

export const CHOICES = {
  stk_stocktype: ["Stock type", ["Warehouse", "Blocked for processing"]],
  stk_stocktaketype: ["Stock take type", ["Monthly", "100% (zero-out)"]],
  stk_stocktakestatus: ["Stock take status", ["Count in progress", "Reconciliation", "Sign-off", "Completed"]],
  stk_sheetstatus: ["Count sheet status", ["In progress", "Submitted", "Approved", "Sent back"]],
  stk_stackstatus: ["Stack status", ["Not started", "In progress", "Submitted", "Approved", "Sent back"]],
  stk_importstatus: ["Import status", ["Validating", "Imported", "Failed", "Superseded"]],
  stk_primarybasket: ["Primary basket", ["Plus", "FAQ", "Grinder"]],
  stk_stockcategory: [
    "Stock category",
    ["Current stock", "Processing stock", "Work in progress", "Sweepings", "Loose bags", "Disputed stock", "Direct purchase (not in XBS)", "Ex-office stock"],
  ],
  stk_countreason: [
    "Counter's reason",
    [
      "Part of the lot is at another location",
      "Bags moved here, not yet received in XBS",
      "Bags left this stack, not yet posted out",
      "Torn or re-bagged bags",
      "Pocket weighed differently",
      "Tag missing or unreadable",
      "Stack blocked, couldn't reach every bag",
      "Not sure, supervisor to check",
    ],
  ],
  stk_rootcause: ["Root cause", ROOT_CAUSES],
  stk_variancestate: ["Variance state", ["Open", "Recount sent", "Accepted", "Exception raised"]],
  stk_exceptionkind: ["Exception kind", [...ROOT_CAUSES, "Master data", "Third party", "Direct purchase"]],
  stk_exceptionsource: ["Exception source", ["Count", "Import", "Pre-count check", "Reconciliation"]],
  stk_exceptionstatus: ["Exception status", ["Open", "In progress", "Escalated", "Closed"]],
  stk_department: ["Department", ["Operations", "Warehouse", "Trading", "Finance", "Logistics", "Quality", "IT"]],
  stk_gate: ["Sign-off gate", ["Operations", "Warehouse", "Trading", "Finance"]],
  stk_issuecategory: [
    "Problem category",
    ["App not working", "Network or saving", "Lot not on the list", "Tag missing or unreadable", "Stack blocked or unsafe", "Third-party staff not available", "Other"],
  ],
  stk_issuestatus: ["Problem status", ["Open", "In progress", "Resolved"]],
};

/* ---------- tables ----------
   cols:    [logicalName, display, builder]
   lookups: [logicalName, display, targetTable, required?]
   keys:    [[logicalName, ...], ...]                                   */
export const TABLES = [
  {
    name: "stk_site", display: "Warehouse", plural: "Warehouses", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_code", "Code", s(10)],
      ["stk_shortname", "Short name", s(40)],
      ["stk_isthirdparty", "Third party", bool()],
      ["stk_manualentry", "Manual outturn entry", bool()],
      ["stk_ceilingbags", "Count-day ceiling (bags)", int()],
      ["stk_hasbaylayout", "Has bay layout", bool()],
    ],
    keys: [["stk_code"]],
  },
  {
    name: "stk_packtype", display: "Packing type", plural: "Packing types", own: "org", primary: ["Name", 50],
    cols: [
      ["stk_code", "Code", s(10)],
      ["stk_kgperbag", "Kg per bag", dec(2)],
      ["stk_gradepattern", "Default for grades", s(100)],
    ],
    keys: [["stk_code"]],
  },
  {
    name: "stk_setting", display: "Setting", plural: "Settings", own: "org", primary: ["Key", 60],
    cols: [
      ["stk_value", "Value", s(2000)],
      ["stk_description", "Description", s(400)],
    ],
    keys: [["stk_name"]],
  },
  {
    name: "stk_xbsimport", display: "XBS import", plural: "XBS imports", own: "org", primary: ["Import", 30],
    cols: [
      ["stk_snapshotat", "XBS snapshot at", dt()],
      ["stk_filenames", "File names", memo(2000)],
      ["stk_rowcount", "Rows", int()],
      ["stk_status", "Status", choice("stk_importstatus")],
      ["stk_checks", "Check results (JSON)", memo(100000)],
      ["stk_warningcount", "Warnings", int()],
      ["stk_failcount", "Failures", int()],
    ],
    lookups: [["stk_importedby", "Imported by", "systemuser"]],
    keys: [["stk_name"]],
  },
  {
    name: "stk_xbsline", display: "XBS line", plural: "XBS lines", own: "org", primary: ["Batch", 100],
    cols: [
      ["stk_rownumber", "Row number", int()],
      ["stk_stocktype", "Stock type", choice("stk_stocktype")],
      ["stk_zone", "Zone", s(40)],
      ["stk_outturn", "Outturn", s(30)],
      ["stk_grade", "Grade", s(30)],
      ["stk_basketcode", "Basket code", s(10)],
      ["stk_basketname", "Basket name", s(100)],
      ["stk_bags", "Bags", int()],
      ["stk_pocketkg", "Pocket kg", dec(2)],
      ["stk_units", "Units", int()],
      ["stk_kg", "Kg", dec(2)],
      ["stk_growermark", "Grower mark", s(100)],
      ["stk_warrant", "Warrant", s(40)],
      ["stk_certification", "Certification", s(200)],
      ["stk_cupscore", "Cup score", s(40)],
      ["stk_blocked", "Blocked", bool()],
      ["stk_salescontract", "Sales contract", s(20)],
      ["stk_instruction", "Processing instruction", s(40)],
      ["stk_daysinstock", "Days in stock", int()],
      ["stk_cropyear", "Crop year", s(12)],
    ],
    lookups: [
      ["stk_import", "Import", "stk_xbsimport", true],
      ["stk_site", "Warehouse", "stk_site", true],
    ],
    keys: [["stk_import", "stk_rownumber"]],
  },
  {
    name: "stk_comtrasposition", display: "Comtras position", plural: "Comtras positions", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_snapshotdate", "Snapshot date", date()],
      ["stk_basketcode", "Basket code", s(10)],
      ["stk_bags", "Bags", dec(2)],
      ["stk_source", "Source file", s(200)],
    ],
  },
  {
    name: "stk_mappingchange", display: "Mapping change", plural: "Mapping changes", own: "user", primary: ["Reference", 30],
    cols: [
      ["stk_target", "Target", local("Basket", "Outturn")],
      ["stk_targetkey", "Basket code or outturn", s(30)],
      ["stk_from", "From", s(120)],
      ["stk_to", "To", s(120)],
      ["stk_reason", "Reason", memo(2000)],
      ["stk_state", "State", local("Pending", "Approved", "Rejected")],
      ["stk_decidedon", "Decided on", dt()],
    ],
    lookups: [["stk_decidedby", "Decided by", "systemuser"]],
  },
  {
    name: "stk_basketmap", display: "Basket mapping", plural: "Basket mappings", own: "org", primary: ["Name", 120],
    cols: [
      ["stk_basketcode", "Basket code", s(10)],
      ["stk_primarybasket", "Primary basket", choice("stk_primarybasket")],
    ],
    lookups: [["stk_lastchange", "Last change", "stk_mappingchange"]],
    keys: [["stk_basketcode"]],
  },
  {
    name: "stk_outturnmap", display: "Outturn mapping", plural: "Outturn mappings", own: "org", primary: ["Outturn", 30],
    cols: [["stk_basketcode", "Basket code", s(10)]],
    lookups: [["stk_change", "Change", "stk_mappingchange"]],
    keys: [["stk_name"]],
  },
  {
    name: "stk_stocktake", display: "Stock take", plural: "Stock takes", own: "org", primary: ["Title", 100],
    cols: [
      ["stk_type", "Type", choice("stk_stocktaketype")],
      ["stk_status", "Status", choice("stk_stocktakestatus")],
      ["stk_countdate", "Count date", date()],
      ["stk_closedon", "Closed on", dt()],
      ["stk_closecomment", "Close comment", memo(2000)],
    ],
    lookups: [
      ["stk_import", "XBS import", "stk_xbsimport", true],
      ["stk_preparedby", "Reconciliation prepared by", "systemuser"],
    ],
  },
  {
    name: "stk_assignment", display: "Assignment", plural: "Assignments", own: "org", primary: ["Name", 100],
    cols: [["stk_rows", "Rows", s(20)]],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_counter", "Counter", "systemuser", true],
      ["stk_site", "Warehouse", "stk_site", true],
    ],
  },
  {
    name: "stk_countsheet", display: "Count sheet", plural: "Count sheets", own: "user", primary: ["Reference", 30],
    cols: [
      ["stk_status", "Status", choice("stk_sheetstatus")],
      ["stk_submittedon", "Submitted on", dt()],
      ["stk_countercomment", "Counter comment", memo(2000)],
      ["stk_decidedon", "Decided on", dt()],
      ["stk_decisioncomment", "Decision comment", memo(2000)],
      ["stk_linecount", "Lines", int()],
      ["stk_variancecount", "Lines with a variance", int()],
      ["stk_bags", "Bags", int()],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_assignment", "Assignment", "stk_assignment"],
      ["stk_site", "Warehouse", "stk_site", true],
      ["stk_decidedby", "Decided by", "systemuser"],
    ],
  },
  {
    name: "stk_stack", display: "Stack", plural: "Stacks", own: "org", primary: ["Stack", 60],
    cols: [
      ["stk_landmark", "Landmark", s(200)],
      ["stk_status", "Status", choice("stk_stackstatus")],
      ["stk_submittedon", "Submitted on", dt()],
      ["stk_comment", "Comment", memo(2000)],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_site", "Warehouse", "stk_site", true],
      ["stk_countsheet", "Count sheet", "stk_countsheet"],
      ["stk_submittedby", "Submitted by", "systemuser"],
    ],
  },
  {
    name: "stk_variance", display: "Variance", plural: "Variances", own: "org", primary: ["Reference", 30],
    cols: [
      ["stk_outturn", "Outturn", s(30)],
      ["stk_grade", "Grade", s(100)],
      ["stk_expectedunits", "Expected units", int()],
      ["stk_countedunits", "Counted units", int()],
      ["stk_expectedkg", "Expected kg", dec(2)],
      ["stk_countedkg", "Counted kg", dec(2)],
      ["stk_suggestedcause", "Suggested cause", choice("stk_rootcause")],
      ["stk_suggestionwhy", "Why suggested", memo(2000)],
      ["stk_cause", "Cause", choice("stk_rootcause")],
      ["stk_state", "State", choice("stk_variancestate")],
      ["stk_decidedon", "Decided on", dt()],
      // One variance per lot: "<stock take id>|<site>|<stack, or empty at third parties>|<batch>".
      ["stk_lotkey", "Lot key", s(300)],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_site", "Warehouse", "stk_site", true],
      ["stk_stack", "Stack", "stk_stack"],
      ["stk_countline", "Count line", "stk_countline"],
      ["stk_decidedby", "Decided by", "systemuser"],
    ],
    keys: [["stk_lotkey"]],
  },
  {
    name: "stk_recount", display: "Recount", plural: "Recounts", own: "user", primary: ["Reference", 30],
    cols: [
      ["stk_outturn", "Outturn", s(30)],
      ["stk_batch", "Batch", s(100)],
      ["stk_why", "Why", memo(2000)],
      ["stk_status", "Status", local("Open", "Done")],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_stack", "Stack", "stk_stack", true],
      ["stk_variance", "Variance", "stk_variance"],
    ],
  },
  {
    name: "stk_countline", display: "Count line", plural: "Count lines", own: "user", primary: ["Name", 60], notes: true, // photo of the tag
    cols: [
      ["stk_clientid", "Client ID", s(40)],
      ["stk_outturn", "Outturn", s(30)],
      ["stk_batch", "Batch", s(100)],
      ["stk_grade", "Grade", s(30)],
      ["stk_category", "Stock category", choice("stk_stockcategory")],
      ["stk_bags", "Full bags", int()],
      ["stk_pocketbags", "Pocket bags", int()],
      ["stk_pocketkg", "Pocket kg", dec(2)],
      ["stk_units", "Units", int()],
      ["stk_kg", "Kg", dec(2)],
      ["stk_bags60", "60 kg bag equivalents", dec(2)],
      ["stk_reason", "Counter's reason", choice("stk_countreason")],
      ["stk_note", "Note", memo(2000)],
      ["stk_isfound", "Found, not expected here", bool()],
      ["stk_isother", "Other stock", bool()],
      ["stk_isblind", "Blind recount", bool()],
      ["stk_reference", "Contract / delivery note", s(60)],
      ["stk_countedon", "Counted on", dt()],
    ],
    lookups: [
      ["stk_countsheet", "Count sheet", "stk_countsheet", true],
      ["stk_stack", "Stack", "stk_stack", true],
      ["stk_site", "Warehouse", "stk_site", true],
      ["stk_xbsline", "XBS line", "stk_xbsline"],
      ["stk_packtype", "Packing type", "stk_packtype", true],
      ["stk_recount", "Recount", "stk_recount"],
    ],
    keys: [["stk_clientid"]],
  },
  {
    name: "stk_exception", display: "Exception", plural: "Exceptions", own: "user", primary: ["Title", 200],
    cols: [
      ["stk_kind", "Kind", choice("stk_exceptionkind")],
      ["stk_source", "Source", choice("stk_exceptionsource")],
      ["stk_reference", "Reference", s(60)],
      ["stk_department", "Department", choice("stk_department")],
      ["stk_bags", "Bags", int()],
      ["stk_duedate", "Due date", date()],
      ["stk_status", "Status", choice("stk_exceptionstatus")],
      ["stk_escalationlevel", "Escalation level", local("Owner", "Head of department", "Country Finance Manager")],
      ["stk_resolution", "Resolution", memo(2000)],
      ["stk_closedon", "Closed on", dt()],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake"],
      ["stk_variance", "Variance", "stk_variance"],
      ["stk_import", "XBS import", "stk_xbsimport"],
    ],
  },
  {
    name: "stk_signoff", display: "Sign-off", plural: "Sign-offs", own: "org", primary: ["Name", 60],
    cols: [
      ["stk_gate", "Gate", choice("stk_gate")],
      ["stk_action", "Action", local("Signed", "Sent back")],
      ["stk_signedon", "Signed on", dt()],
      ["stk_comment", "Comment", memo(2000)],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_signedby", "Signed by", "systemuser", true],
    ],
  },
  {
    name: "stk_directpurchase", display: "Direct purchase", plural: "Direct purchases", own: "org", primary: ["Contract", 20],
    cols: [
      ["stk_supplier", "Supplier", s(100)],
      ["stk_suppliertype", "Supplier type", local("Co-operative", "Agent")],
      ["stk_outturn", "Outturn", s(30)],
      ["stk_warrant", "Warrant", s(40)],
      ["stk_grade", "Grade", s(30)],
      ["stk_bagscontracted", "Bags contracted", int()],
      ["stk_bagsinvoiced", "Bags invoiced", int()],
      ["stk_bagsdelivered", "Bags delivered", int()],
      ["stk_invoicedate", "Invoice date", date()],
    ],
    keys: [["stk_name"]],
  },
  {
    name: "stk_issue", display: "Problem report", plural: "Problem reports", own: "user", primary: ["Reference", 30], notes: true, // photo from the counter
    cols: [
      ["stk_category", "Category", choice("stk_issuecategory")],
      ["stk_screen", "Screen", s(60)],
      ["stk_description", "Description", memo(4000)],
      ["stk_status", "Status", choice("stk_issuestatus")],
      ["stk_linkedcause", "Variance cause it explains", choice("stk_rootcause")],
      ["stk_resolution", "Reply", memo(2000)],
      ["stk_photo", "Photo", file(10240)],
    ],
    lookups: [
      ["stk_site", "Warehouse", "stk_site"],
      ["stk_assignedto", "Assigned to", "systemuser"],
    ],
  },
];

/** N:N relationships: [schemaName, entity1, entity2] */
export const MANY_TO_MANY = [["stk_stocktake_site", "stk_stocktake", "stk_site"]];
