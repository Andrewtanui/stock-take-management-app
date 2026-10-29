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
// Added 11 Oct 2026 from the Finance and Logistics discovery sessions. Appended
// (never inserted) so existing option values, which flows use, stay the same.
const NEW_CAUSES = ["Partial delivery: rest still at third party", "Weight loss: claim from warehouse", "Posting timing / late posting"];

export const CHOICES = {
  stk_stocktype: ["Stock type", ["Warehouse", "Blocked for processing"]],
  stk_stocktaketype: ["Stock take type", ["Monthly", "100% (zero-out)", "Ad hoc"]], // Ad hoc added 27 Oct 2026
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
  stk_rootcause: ["Root cause", [...ROOT_CAUSES, ...NEW_CAUSES]],
  stk_variancestate: ["Variance state", ["Open", "Recount sent", "Accepted", "Exception raised"]],
  stk_exceptionkind: ["Exception kind", [...ROOT_CAUSES, "Master data", "Third party", "Direct purchase", ...NEW_CAUSES]],
  // "IBKY engine" (added 25 Oct 2026): checks raised by Jones's engine (mass balance, master data, ...).
  stk_exceptionsource: ["Exception source", ["Count", "Import", "Pre-count check", "Reconciliation", "IBKY engine"]],
  stk_exceptionstatus: ["Exception status", ["Open", "In progress", "Escalated", "Closed"]],
  stk_department: ["Department", ["Operations", "Warehouse", "Trading", "Finance", "Logistics", "Quality", "IT"]],
  // Finance's signature block (28 Oct 2026). The first four were Operations, Warehouse, Trading and
  // Finance; renamed in place, so 614500003 is still the last signature (it certifies and completes).
  stk_gate: ["Sign-off gate", ["Operations Lead", "Warehouse Manager", "Trading Admin Manager", "Country Finance Manager", "Senior Accountant", "Chief Accountant"]],
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
      // From the Comtras P526 report (one row per contract line):
      ["stk_linetype", "Line type", s(20)], // Inventory · Longs · Short
      ["stk_contract", "Contract", s(20)],
      ["stk_origin", "Origin", s(60)], // e.g. Arabica Kenya
      ["stk_counterparty", "Counterparty", s(60)],
      ["stk_kg", "Kg", dec(2)],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake"]],
  },
  // Comtras "537" contract invoicing journal (added 26 Oct 2026): one row per booked invoice or
  // credit-note line, Kenya (company CC) only, loaded once per stock take and never changed.
  // stk_salescontract is the number XBS shows as "sales contract blocked to".
  {
    name: "stk_contractinvoice", display: "Contract invoice line", plural: "Contract invoice lines", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_rownumber", "Row in the file", int()],
      ["stk_source", "Source file", s(200)],
      ["stk_side", "Side", local("Customer", "Supplier")], // FIBU2 D / K
      ["stk_account", "Account", s(20)], // FIBU3
      ["stk_counterparty", "Counterparty", s(60)], // Kurz-Name
      ["stk_profile", "Profile", s(10)],
      ["stk_bookedon", "Booked on", date()],
      ["stk_voucherdate", "Voucher date", date()],
      ["stk_voucher", "Voucher", s(20)],
      ["stk_doctype", "Document type", int()], // Symbol: 11 purchase invoice, 21 sales invoice, 65 / 71 credit notes...
      ["stk_purchasecontract", "Purchase contract", s(20)],
      ["stk_purchasecontractdate", "Purchase contract date", date()],
      ["stk_salescontract", "Sales contract", s(20)],
      ["stk_salescontractdate", "Sales contract date", date()],
      ["stk_buybags", "Bought: bags", dec(2)],
      ["stk_buykg", "Bought: kg", dec(2)],
      ["stk_buy60", "Bought: 60 kg bags", dec(2)],
      ["stk_buyvalue", "Bought: value", dec(2)],
      ["stk_sellbags", "Sold: bags", dec(2)],
      ["stk_sellkg", "Sold: kg", dec(2)],
      ["stk_sell60", "Sold: 60 kg bags", dec(2)],
      ["stk_sellvalue", "Sold: value", dec(2)],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake", true]],
    keys: [["stk_stocktake", "stk_rownumber"]],
  },
  // Shipment tracker (Trade / Logistics, Kenya_Operational_PL.xlsx sheet KENYA; added 27 Oct 2026): one
  // row per sales contract + shipping instruction, loaded once per stock take and never changed.
  // stk_salescontract joins the 537 (S.Ctr.) and XBS ("sales contract blocked to").
  {
    name: "stk_shipment", display: "Shipment", plural: "Shipments", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_rownumber", "Row in the file", int()],
      ["stk_source", "Source file", s(200)],
      ["stk_salescontract", "Sales contract", s(20)],
      ["stk_purchasecontract", "Purchase contract", s(40)],
      ["stk_si", "Shipping instruction", s(20)],
      ["stk_buyer", "Buyer", s(100)],
      ["stk_bags", "Bags", dec(2)],
      ["stk_qualitycode", "Quality code", s(10)],
      ["stk_quality", "Quality basket / grade", s(100)],
      ["stk_packaging", "Packaging", s(60)],
      ["stk_destination", "Destination country", s(60)],
      ["stk_contractdate", "Contract date", date()],
      ["stk_stuffedon", "Stuffed on", date()],
      ["stk_sailedon", "Sailed on", date()],
      ["stk_etapod", "ETA at port of discharge", date()],
      ["stk_bl", "B/L number", s(40)],
      ["stk_vessel", "Vessel", s(100)],
      ["stk_status", "Contract status", s(20)], // Open · Closed · Cancelled, as Trade keys it
      ["stk_usdvalue", "USD value", dec(2)],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake", true]],
    keys: [["stk_stocktake", "stk_rownumber"]],
  },
  // Direct purchase lots (Trading's list, Daniel; added 27 Oct 2026): one row per outturn and grade
  // bought on a direct contract (905xx), loaded once per stock take and never changed. Explains
  // coffee counted but not yet in XBS (received, not uploaded) and gives each outturn's baskets.
  {
    name: "stk_directlot", display: "Direct purchase lot", plural: "Direct purchase lots", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_rownumber", "Order in the upload", int()],
      ["stk_source", "Source file", s(200)],
      ["stk_sheet", "Sheet", s(40)],
      ["stk_contract", "Contract", s(20)], // 905xx; "90579/90580" when the sheet doesn't say which
      ["stk_contractdate", "Contract date", date()],
      ["stk_grower", "Grower / mark", s(100)],
      ["stk_outturn", "Outturn", s(20)],
      ["stk_grade", "Grade", s(20)],
      ["stk_bags", "Bags", dec(2)],
      ["stk_pocketkg", "Pocket kg", dec(2)],
      ["stk_kg", "Kg bought", dec(2)],
      ["stk_cert", "Certification", s(60)],
      ["stk_primary", "Primary basket", s(40)],
      ["stk_secondary", "Secondary basket", s(60)],
      ["stk_warrant", "Warrant", s(40)],
      ["stk_warrantkg", "Warrant kg", dec(2)],
      ["stk_receivedkg", "Received kg", dec(2)],
      ["stk_warehouse", "Warehouse", s(40)],
      ["stk_receivedon", "Received on", date()],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake", true]],
    keys: [["stk_stocktake", "stk_rownumber"]],
  },
  // XBS stuffing dates (added 29 Oct 2026): XBS's "All Party Shipped Quantity Per Contract" report,
  // summed per sales contract + SI + stuffing date - the warehouse's record of when coffee left,
  // which corrects the shipment tracker's dates for afloat. One report per month; never changed.
  {
    name: "stk_xbsstuffing", display: "XBS stuffing", plural: "XBS stuffings", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_source", "Source file", s(200)],
      ["stk_salescontract", "Sales contract", s(20)],
      ["stk_si", "Shipping instruction", s(20)],
      ["stk_stuffedon", "Stuffed on", date()],
      ["stk_bags", "Bags (60 kg)", dec(2)],
      ["stk_lots", "Lots", int()],
      // "contract|SI|date": short enough for an alternate key (the name column is not).
      ["stk_key", "Key", s(60)],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake", true]],
    keys: [["stk_stocktake", "stk_key"]],
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
    name: "stk_stocktake", display: "Stock take", plural: "Stock takes", own: "org", primary: ["Title", 100], notes: true, // Level 1 summary PDF
    cols: [
      ["stk_type", "Type", choice("stk_stocktaketype")],
      ["stk_status", "Status", choice("stk_stocktakestatus")],
      ["stk_countdate", "Count date", date()],
      ["stk_closedon", "Closed on", dt()],
      ["stk_closecomment", "Close comment", memo(2000)],
      // Counting closed automatically (every stack in, no recounts open, every variance decided);
      // flow F10 sends the Level 1 summary written here.
      ["stk_countclosedon", "Count closed on", dt()],
      ["stk_l1summary", "Level 1 summary", memo(20000)], // branded HTML, also the body of flow F10's email
      // What is counted, as JSON {"sites":["IBR","AGL"],"sections":["D","B1-7"]}; empty = everything.
      // Used by ad hoc counts (added 27 Oct 2026); sections are Ibero section tokens (src/shared/sections.ts).
      ["stk_scope", "Scope", memo(4000)],
    ],
    lookups: [
      ["stk_import", "XBS import", "stk_xbsimport", true],
      ["stk_preparedby", "Reconciliation prepared by", "systemuser"],
    ],
  },
  // Counter allocation (added 18 Oct 2026): who counts, where they normally work, and
  // each random allocation run - so a count can be shuffled fairly and audited.
  {
    name: "stk_counterprofile", display: "Counter profile", plural: "Counter profiles", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_homerows", "Home rows", s(40)], // "D,E" - rows they work in day to day (not allocated to them)
      ["stk_thirdpartyok", "Cleared for third-party sites", bool()],
      ["stk_active", "Active counter", bool()],
      ["stk_notes", "Notes", memo(2000)],
    ],
    lookups: [
      ["stk_user", "Person", "systemuser", true],
      ["stk_homesite", "Home warehouse", "stk_site"],
    ],
    keys: [["stk_user"]],
  },
  {
    // Finance's bridge from the Comtras (BRIC) total to the Ibero stock position: coffee afloat and the
    // reconciling items (deliveries after the count, longs, broker's account…), per stock take.
    name: "stk_reconitem", display: "Reconciling item", plural: "Reconciling items", own: "org", primary: ["Item", 200],
    cols: [
      ["stk_kind", "Kind", local("Coffee afloat", "Reconciling item")],
      ["stk_bags", "Bags (60 kg)", dec(2)],
      ["stk_inxbs", "Also in the XBS column", bool()],
      ["stk_note", "Note", memo(2000)],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake", true]],
  },
  // Governance KPIs (added 26 Oct 2026): one row per stock take per KPI (src/data/kpi.ts).
  // The Hub refreshes them while the stock take is open and freezes them when Finance signs;
  // frozen rows are never recalculated. Read by Power BI and the Stock Assistant.
  {
    name: "stk_kpisnapshot", display: "KPI snapshot", plural: "KPI snapshots", own: "org", primary: ["Name", 200],
    cols: [
      ["stk_code", "KPI code", s(40)],
      ["stk_kpiname", "KPI", s(100)],
      ["stk_kpisource", "Target source", s(60)], // e.g. SOP-UG-LOG #104
      ["stk_owner", "Owner", s(60)],
      ["stk_value", "Value", dec(4)],
      ["stk_display", "Value as shown", s(60)],
      ["stk_target", "Target", s(60)],
      ["stk_status", "Status", local("On target", "Off target", "Running", "For information", "Not measurable")],
      ["stk_detail", "Detail", memo(1000)],
      ["stk_measuredon", "Measured on", dt()],
      ["stk_frozenon", "Frozen on", dt()], // set at Finance sign-off; the row no longer changes
      // "<stock take id>|<KPI code>": one row per stock take per KPI.
      ["stk_kpikey", "KPI key", s(200)],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake", true]],
    keys: [["stk_kpikey"]],
  },
  // Level 1 engine runs (added 26 Oct 2026): one row per run of stk-level1 on the server, also its
  // run lock. stk_lock holds the stock take id while a run writes (alternate key, so a second run
  // can't take it) and is emptied when the run ends; a lock older than 15 minutes counts as stale.
  {
    name: "stk_enginerun", display: "Engine run", plural: "Engine runs", own: "org", primary: ["Run", 200],
    cols: [
      ["stk_mode", "Mode", local("Engine", "Dry run")],
      ["stk_startedon", "Started on", dt()],
      ["stk_finishedon", "Finished on", dt()],
      ["stk_outcome", "Outcome", local("Running", "Done", "Failed", "Skipped")],
      ["stk_result", "Result", memo(4000)],
      ["stk_writes", "Records written", int()],
      ["stk_lock", "Lock", s(100)],
    ],
    lookups: [["stk_stocktake", "Stock take", "stk_stocktake"]],
    keys: [["stk_lock"]],
  },
  {
    name: "stk_allocationrun", display: "Allocation run", plural: "Allocation runs", own: "org", primary: ["Reference", 30],
    cols: [
      ["stk_status", "Status", local("Draft", "Published", "Superseded")],
      ["stk_seed", "Random seed", int()],
      ["stk_present", "Counters present (JSON)", memo(4000)],
      ["stk_plan", "Plan (JSON)", memo(100000)],
      ["stk_swaps", "Swaps and changes (JSON)", memo(4000)],
      ["stk_rules", "Rules applied (JSON)", memo(1000)],
      ["stk_spreadpct", "Workload spread %", dec(2)],
      ["stk_publishedon", "Published on", dt()],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_ranby", "Run by", "systemuser"],
      ["stk_publishedby", "Published by", "systemuser"],
    ],
  },
  {
    name: "stk_assignment", display: "Assignment", plural: "Assignments", own: "org", primary: ["Name", 100],
    cols: [
      ["stk_rows", "Rows", s(20)],
      // Bay sections, e.g. "D1-7,D8-14,C/D" (row + bay range, or a between-rows pair). Empty = use stk_rows.
      ["stk_sections", "Sections", s(400)],
      ["stk_plannedbags", "Planned bags", int()],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake", true],
      ["stk_counter", "Counter", "systemuser", true],
      ["stk_site", "Warehouse", "stk_site", true],
      ["stk_allocationrun", "Allocation run", "stk_allocationrun"],
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
      // A third-party site the counter found empty (no lines; the comment says why). Its XBS lots count as 0.
      ["stk_nothinghere", "Nothing to count", bool()],
      // The counter finished a third-party site: every XBS lot there that wasn't counted counts as 0.
      ["stk_sitefinished", "Site finished", bool()],
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
      // By size in 60 kg bags (settings ExceptionHighBags / ExceptionLowBags); Low ones are one list per warehouse.
      ["stk_priority", "Priority", local("High", "Medium", "Low")],
      // Rule that raised it and a unique key per rule + subject, so a rule re-run updates its row
      // instead of adding a duplicate (spec 8.5 / 12.3: one open exception per rule + key).
      ["stk_rule", "Rule", s(20)],
      ["stk_rulekey", "Rule key", s(200)],
      ["stk_resolution", "Resolution", memo(2000)],
      ["stk_closedon", "Closed on", dt()],
    ],
    lookups: [
      ["stk_stocktake", "Stock take", "stk_stocktake"],
      ["stk_variance", "Variance", "stk_variance"],
      ["stk_import", "XBS import", "stk_xbsimport"],
    ],
    keys: [["stk_rulekey"]],
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
