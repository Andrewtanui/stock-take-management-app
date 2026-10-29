// Stage 4 cloud flows, built as solution-aware flows in IBKYStockTake.
// Each flow is a Logic Apps definition stored on a `workflow` row (category 5).
// Connections are reached through connection references, so the solution can
// move between environments and be re-bound there.

// App links in messages follow the environment the scripts target (DATAVERSE_URL, see auth.mjs).
const APPS = {
  "https://orged86d520.crm4.dynamics.com": {
    env: "61203bbf-8829-e6fd-bbdd-bb98d7fa1d56", // NKG_Demo
    management: "56b37b75-e3f7-46cf-9ba0-c4a156bc9fd8",
    counter: "f4369855-d7ae-424c-94ff-b790a89cfedd",
  },
  default: {
    env: "fbbef02c-fb2e-e56f-926c-4fe610004640", // Pathways dev
    management: "415dbc66-f07f-4819-8995-337876f7c185",
    counter: "e66f3a71-e7f8-411e-8443-a0303d39ed78",
  },
};
const APP = APPS[process.env.DATAVERSE_URL ?? ""] ?? APPS.default;
export const APP_LINK = {
  management: `https://apps.powerapps.com/play/e/${APP.env}/a/${APP.management}`,
  counter: `https://apps.powerapps.com/play/e/${APP.env}/a/${APP.counter}`,
};

export const CONNECTION_REFERENCES = {
  dataverse: {
    logicalName: "stk_dataverse",
    displayName: "IBKY Stock Take · Dataverse",
    api: "shared_commondataserviceforapps",
  },
  teams: {
    logicalName: "stk_teams",
    displayName: "IBKY Stock Take · Teams",
    api: "shared_teams",
  },
  approvals: {
    logicalName: "stk_approvals",
    displayName: "IBKY Stock Take · Approvals",
    api: "shared_approvals",
  },
  outlook: {
    logicalName: "stk_outlook",
    displayName: "IBKY Stock Take · Outlook",
    api: "shared_office365",
  },
  copilotstudio: {
    logicalName: "stk_copilotstudio",
    displayName: "IBKY Stock Take · Copilot Studio",
    api: "shared_microsoftcopilotstudio",
  },
};

/** F11: the Stock Assistant agent the Hub's side panel talks to (Copilot Studio schema name). */
const ASSISTANT = "cr327_IBKYStockAssistant";

const SHEET = { inProgress: 614500000, submitted: 614500001, approved: 614500002, sentBack: 614500003 };
const ISSUE = { open: 614500000, inProgress: 614500001, resolved: 614500002 };
const IMPORT = { imported: 614500001 };
const CHANGE = { pending: 614500000, approved: 614500001, rejected: 614500002, basket: 614500000 };
const PRIMARY_BASKET = { Plus: 614500000, FAQ: 614500001, Grinder: 614500002 };
const SIGNOFF = { signed: 614500000, sentBack: 614500001 };
/** stk_gate values (schema.mjs): the first four were renamed in place on 28 Oct 2026. */
const GATE = { operationsLead: 614500000, warehouseManager: 614500001, tradingAdmin: 614500002, countryFinance: 614500003, seniorAccountant: 614500004, chiefAccountant: 614500005 };
const STOCKTAKE = { completed: 614500003, adHoc: 614500002 };
const ALLOCATION = { published: 614500001 };
/** F4: calendar days overdue before each escalation step. */
const ESCALATE = { hodAfterDays: 3, cfmAfterDays: 7 };
/** F8: share of a warehouse's XBS lines that must be counted before its difference is shown. */
const COMPLETE_PCT = 95;
/**
 * "<stock take type>-<gate just signed>" → who signs next (the Hub's CHAINS in repository.ts).
 * Monthly: Senior Accountant → Chief Accountant + Operations Lead → Trading Admin Manager + Warehouse
 * Manager → Country Finance Manager. Ad hoc: Operations Lead → Warehouse Manager. 100%: Operations Lead →
 * Warehouse Manager → Country Finance Manager. The last gate of each chain completes the stock take.
 */
const NEXT_GATE = {
  [`614500000-${GATE.seniorAccountant}`]: "Chief Accountant and Operations Lead (review, either order)",
  [`614500000-${GATE.chiefAccountant}`]: "Operations Lead, if not yet signed; then Trading Admin Manager and Warehouse Manager",
  [`614500000-${GATE.operationsLead}`]: "Chief Accountant, if not yet signed; then Trading Admin Manager and Warehouse Manager",
  [`614500000-${GATE.tradingAdmin}`]: "Warehouse Manager, if not yet signed; then Country Finance Manager",
  [`614500000-${GATE.warehouseManager}`]: "Trading Admin Manager, if not yet signed; then Country Finance Manager",
  [`614500001-${GATE.operationsLead}`]: "Warehouse Manager",
  [`614500001-${GATE.warehouseManager}`]: "Country Finance Manager",
  [`614500002-${GATE.operationsLead}`]: "Warehouse Manager",
};
/** The gate that completes each type of stock take: Warehouse Manager on ad hoc, else Country Finance Manager. */
const LAST_GATE_TEST = `if(equals(outputs('Get_stock_take')?['body/stk_type'], ${STOCKTAKE.adHoc}), equals(triggerOutputs()?['body/stk_gate'], ${GATE.warehouseManager}), equals(triggerOutputs()?['body/stk_gate'], ${GATE.countryFinance}))`;
const EXC = { closed: 614500003, escalated: 614500002, open: 614500000, ownerLevel: 614500000, hodLevel: 614500001, cfmLevel: 614500002, sourceImport: 614500001, kindUnknown: 614500009, deptOperations: 614500000 };

/** Import check (id from importChecks) → exception kind and department. */
const IMPORT_WARNING_RULES = {
  pack: { kind: 614500005, dept: 614500000 }, // Pocket / unit difference · Operations
  basket: { kind: 614500004, dept: 614500002 }, // Mapping error · Trading
  warrant: { kind: 614500010, dept: 614500001 }, // Master data · Warehouse
  loc: { kind: 614500010, dept: 614500001 }, // Master data · Warehouse
  remnant: { kind: 614500005, dept: 614500000 }, // Pocket / unit difference · Operations
};

/* ---------- building blocks ---------- */

const apiId = (api) => `/providers/Microsoft.PowerApps/apis/${api}`;
const auth = "@parameters('$authentication')";

/** Dataverse "When a row is added, modified or deleted". message: 1 added, 3 modified. scope 4 = organisation. */
function rowTrigger(entity, message, { columns, filter } = {}) {
  return {
    type: "OpenApiConnectionWebhook",
    inputs: {
      host: { connectionName: "shared_commondataserviceforapps", operationId: "SubscribeWebhookTrigger", apiId: apiId("shared_commondataserviceforapps") },
      parameters: {
        "subscriptionRequest/message": message,
        "subscriptionRequest/entityname": entity,
        "subscriptionRequest/scope": 4,
        ...(columns ? { "subscriptionRequest/filteringattributes": columns } : {}),
        ...(filter ? { "subscriptionRequest/filterexpression": filter } : {}),
      },
      authentication: auth,
    },
  };
}

/** Dataverse "Get a row by ID". */
function getRow(entitySet, recordId, select, runAfter) {
  return {
    type: "OpenApiConnection",
    inputs: {
      host: { connectionName: "shared_commondataserviceforapps", operationId: "GetItem", apiId: apiId("shared_commondataserviceforapps") },
      parameters: { entityName: entitySet, recordId, $select: select },
      authentication: auth,
    },
    ...(runAfter ? { runAfter: { [runAfter]: ["Succeeded"] } } : { runAfter: {} }),
  };
}

/** Dataverse "List rows"; `fetchXml` runs a FetchXML query instead (e.g. totals). */
function listRows(entitySet, { select, filter, orderBy, top, fetchXml }, runAfter) {
  return {
    type: "OpenApiConnection",
    inputs: {
      host: { connectionName: "shared_commondataserviceforapps", operationId: "ListRecords", apiId: apiId("shared_commondataserviceforapps") },
      parameters: fetchXml
        ? { entityName: entitySet, fetchXml }
        : { entityName: entitySet, $select: select, ...(filter ? { $filter: filter } : {}), ...(orderBy ? { $orderby: orderBy } : {}), ...(top ? { $top: top } : {}) },
      authentication: auth,
    },
    runAfter: runAfter ? { [runAfter]: ["Succeeded"] } : {},
  };
}

/** Dataverse "Add a new row"; `item` keys are column names (lookups as `x@odata.bind`). */
function createRow(entitySet, item, runAfter) {
  return {
    type: "OpenApiConnection",
    inputs: {
      host: { connectionName: "shared_commondataserviceforapps", operationId: "CreateRecord", apiId: apiId("shared_commondataserviceforapps") },
      parameters: { entityName: entitySet, ...Object.fromEntries(Object.entries(item).map(([k, v]) => [`item/${k}`, v])) },
      authentication: auth,
    },
    runAfter: runAfter ? { [runAfter]: ["Succeeded"] } : {},
  };
}

/** Dataverse "Update a row". */
function updateRow(entitySet, recordId, item, runAfter) {
  return {
    type: "OpenApiConnection",
    inputs: {
      host: { connectionName: "shared_commondataserviceforapps", operationId: "UpdateRecord", apiId: apiId("shared_commondataserviceforapps") },
      parameters: { entityName: entitySet, recordId, ...Object.fromEntries(Object.entries(item).map(([k, v]) => [`item/${k}`, v])) },
      authentication: auth,
    },
    runAfter: runAfter ? { [runAfter]: ["Succeeded"] } : {},
  };
}

/** Condition: `test` is a boolean expression without the leading @. */
const when = (test, yes, no, runAfter) => ({
  type: "If",
  expression: { equals: [`@${test}`, true] },
  actions: yes,
  else: { actions: no ?? {} },
  runAfter: runAfter ? { [runAfter]: ["Succeeded"] } : {},
});

const after = (name) => ({ [name]: ["Succeeded"] });

/** F11: Copilot Studio "Execute Agent and wait" with the Hub's question (and its conversation, for a follow-up). */
function askAssistant(followUp) {
  return {
    type: "OpenApiConnectionWebhook",
    inputs: {
      host: { connectionName: "shared_microsoftcopilotstudio", operationId: "ExecuteCopilotAsyncV2", apiId: apiId("shared_microsoftcopilotstudio") },
      parameters: {
        Copilot: ASSISTANT,
        "body/message": "@triggerBody()?['text']",
        ...(followUp ? { "x-ms-conversation-id": "@triggerBody()?['text_1']" } : {}),
      },
      authentication: auth,
    },
    runAfter: {},
  };
}

/** F11: "Respond to a PowerApp or flow" with the same fields on success and failure. */
function answerHub(body, status) {
  const text = (title) => ({ title, type: "string", "x-ms-content-hint": "TEXT", "x-ms-dynamically-added": true });
  return {
    type: "Response",
    kind: "PowerApp",
    inputs: { statusCode: 200, body, schema: { type: "object", properties: { answer: text("answer"), conversation: text("conversation"), raw: text("raw"), error: text("error") } } },
    runAfter: { New_or_follow_up: status },
  };
}

/** Teams "Post message in a chat or channel" as Flow bot. */
function teamsPost(recipient, html, runAfter) {
  const parameters =
    recipient.kind === "channel"
      ? { poster: "Flow bot", location: "Channel", "body/recipient/groupId": recipient.teamId, "body/recipient/channelId": recipient.channelId, "body/messageBody": html }
      : { poster: "Flow bot", location: "Chat with Flow bot", "body/recipient": recipient.email, "body/messageBody": html };
  return {
    type: "OpenApiConnection",
    inputs: {
      host: { connectionName: "shared_teams", operationId: "PostMessageToConversation", apiId: apiId("shared_teams") },
      parameters,
      authentication: auth,
    },
    runAfter: runAfter ? { [runAfter]: ["Succeeded"] } : {},
  };
}

const field = (action, name) => `@{outputs('${action}')?['body/${name}']}`;
const trig = (name) => `@{triggerOutputs()?['body/${name}']}`;
/** Display text of a choice or lookup on the trigger row (empty lookups fall back). */
const label = (name, fallback = "") => `@{coalesce(triggerOutputs()?['body/${name}@OData.Community.Display.V1.FormattedValue'], '${fallback}')}`;

function clientdata(triggerName, trigger, actions) {
  // Every connection named anywhere in the actions, nested ones included.
  const used = new Set(["shared_commondataserviceforapps", ...[...JSON.stringify(actions).matchAll(/"connectionName":"([^"]+)"/g)].map((m) => m[1])]);
  const refs = {};
  for (const ref of Object.values(CONNECTION_REFERENCES))
    if (used.has(ref.api))
      refs[ref.api] = { runtimeSource: "embedded", connection: { connectionReferenceLogicalName: ref.logicalName }, api: { name: ref.api } };
  return {
    properties: {
      connectionReferences: refs,
      definition: {
        $schema: "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        contentVersion: "1.0.0.0",
        parameters: { $connections: { defaultValue: {}, type: "Object" }, $authentication: { defaultValue: {}, type: "SecureObject" } },
        triggers: { [triggerName]: trigger },
        actions,
      },
    },
    schemaVersion: "1.0.0.0",
  };
}

/* ---------- the flows ---------- */

/** @param {{ teamId: string, channelId: string }} cfg */
export function flows(cfg) {
  const channel = { kind: "channel", teamId: cfg.teamId, channelId: cfg.channelId };
  return [
    {
      name: "IBKY F1 · XBS import done → exceptions + Operations",
      description: "When an XBS import finishes, raise an exception for each warning check and post a summary to the channel.",
      data: clientdata("When_an_import_is_done", rowTrigger("stk_xbsimport", 3, { columns: "stk_status", filter: `stk_status eq ${IMPORT.imported}` }), {
        Checks: { type: "Compose", inputs: "@json(coalesce(triggerOutputs()?['body/stk_checks'], '[]'))", runAfter: {} },
        Warnings: { type: "Query", inputs: { from: "@outputs('Checks')", where: "@equals(item()?['result'], 'warn')" }, runAfter: after("Checks") },
        Rules: { type: "Compose", inputs: IMPORT_WARNING_RULES, runAfter: after("Warnings") },
        Get_SLA: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'ExceptionSlaWorkingDays'", top: 1 }, "Rules"),
        // Due date = SLA working days from today (a weekend start counts from Friday).
        Due_date: {
          type: "Compose",
          inputs:
            "@formatDateTime(addDays(utcNow(), add(add(int(coalesce(first(outputs('Get_SLA')?['body/value'])?['stk_value'], '5')), " +
            "mul(2, div(add(if(or(equals(dayOfWeek(utcNow()), 0), equals(dayOfWeek(utcNow()), 6)), 4, sub(dayOfWeek(utcNow()), 1)), int(coalesce(first(outputs('Get_SLA')?['body/value'])?['stk_value'], '5'))), 5))), " +
            "if(equals(dayOfWeek(utcNow()), 0), -2, if(equals(dayOfWeek(utcNow()), 6), -1, 0)))), 'yyyy-MM-dd')",
          runAfter: after("Get_SLA"),
        },
        Last_exception: listRows("stk_exceptions", { select: "stk_name", filter: "startswith(stk_name, 'EX-')", orderBy: "stk_name desc", top: 1 }, "Due_date"),
        Init_number: {
          type: "InitializeVariable",
          inputs: { variables: [{ name: "n", type: "integer", value: "@if(empty(outputs('Last_exception')?['body/value']), 0, int(substring(first(outputs('Last_exception')?['body/value'])?['stk_name'], 3, 3)))" }] },
          runAfter: after("Last_exception"),
        },
        Init_raised: { type: "InitializeVariable", inputs: { variables: [{ name: "raised", type: "array", value: [] }] }, runAfter: after("Init_number") },
        For_each_warning: {
          type: "Foreach",
          foreach: "@body('Warnings')",
          runtimeConfiguration: { concurrency: { repetitions: 1 } },
          actions: {
            Next_number: { type: "IncrementVariable", inputs: { name: "n", value: 1 }, runAfter: {} },
            Name: {
              type: "Compose",
              inputs: "@concat('EX-', formatNumber(variables('n'), '000'), ' — ', triggerOutputs()?['body/stk_name'], ': ', items('For_each_warning')?['label'], ' (', string(items('For_each_warning')?['count']), ' rows)')",
              runAfter: after("Next_number"),
            },
            Raise_exception: createRow(
              "stk_exceptions",
              {
                stk_name: "@outputs('Name')",
                stk_kind: `@coalesce(outputs('Rules')?[items('For_each_warning')?['id']]?['kind'], ${EXC.kindUnknown})`,
                stk_department: `@coalesce(outputs('Rules')?[items('For_each_warning')?['id']]?['dept'], ${EXC.deptOperations})`,
                stk_source: EXC.sourceImport,
                stk_reference: "@triggerOutputs()?['body/stk_name']",
                stk_duedate: "@outputs('Due_date')",
                stk_status: EXC.open,
                stk_escalationlevel: EXC.ownerLevel,
                "stk_import@odata.bind": "@concat('/stk_xbsimports(', triggerOutputs()?['body/stk_xbsimportid'], ')')",
              },
              "Name",
            ),
            Remember: { type: "AppendToArrayVariable", inputs: { name: "raised", value: "@first(split(outputs('Name'), ' — '))" }, runAfter: after("Raise_exception") },
          },
          runAfter: after("Init_raised"),
        },
        Post_to_operations: teamsPost(
          channel,
          `<p><b>XBS import done</b> — ${trig("stk_name")}: ${trig("stk_rowcount")} rows, ${trig("stk_warningcount")} warnings</p>` +
            `<p>@{if(empty(variables('raised')), 'No warnings, so no exceptions raised.', concat('Raised for follow-up: ', join(variables('raised'), ', ')))}</p>` +
            `<p><a href="${APP_LINK.management}">Open Exceptions in the management app</a></p>`,
          "For_each_warning",
        ),
      }),
    },
    {
      name: "IBKY F2 · Sheet submitted → supervisors",
      description: "When a counter submits a count sheet, post it to the supervisors' Teams channel.",
      data: clientdata("When_a_sheet_is_submitted", rowTrigger("stk_countsheet", 3, { columns: "stk_status", filter: `stk_status eq ${SHEET.submitted}` }), {
        Get_counter: getRow("systemusers", trig("_createdby_value"), "fullname", null),
        Get_warehouse: getRow("stk_sites", trig("_stk_site_value"), "stk_name", "Get_counter"),
        Post_to_supervisors: teamsPost(
          channel,
          `<p><b>Count sheet submitted</b> — ${field("Get_counter", "fullname")} submitted <b>${trig("stk_name")}</b> at ${field("Get_warehouse", "stk_name")}.</p>` +
            `<p>${trig("stk_linecount")} lots · ${trig("stk_bags")} bags · ${trig("stk_variancecount")} differ from XBS</p>` +
            `<p><a href="${APP_LINK.management}">Review it in the management app</a></p>`,
          "Get_warehouse",
        ),
      }),
    },
    {
      name: "IBKY F3a · Sheet sent back → counter",
      description: "When a supervisor sends a count sheet back, tell the counter in Teams with the reason.",
      data: clientdata("When_a_sheet_is_sent_back", rowTrigger("stk_countsheet", 3, { columns: "stk_status", filter: `stk_status eq ${SHEET.sentBack}` }), {
        Get_counter: getRow("systemusers", trig("_createdby_value"), "fullname,internalemailaddress", null),
        Tell_the_counter: teamsPost(
          { kind: "chat", email: field("Get_counter", "internalemailaddress") },
          `<p><b>Your count sheet was sent back</b> — ${trig("stk_name")}</p>` +
            `<p>Reason: ${trig("stk_decisioncomment")}</p>` +
            `<p><a href="${APP_LINK.counter}">Open the stock take app</a> to fix it and submit again.</p>`,
          "Get_counter",
        ),
      }),
    },
    {
      name: "IBKY F3b · Recount ordered → counter",
      description: "When a supervisor orders a recount, tell the counter it's assigned to in Teams.",
      data: clientdata("When_a_recount_is_ordered", rowTrigger("stk_recount", 1), {
        Get_counter: getRow("systemusers", trig("_ownerid_value"), "fullname,internalemailaddress", null),
        Get_stack: getRow("stk_stacks", trig("_stk_stack_value"), "stk_name", "Get_counter"),
        Tell_the_counter: teamsPost(
          { kind: "chat", email: field("Get_counter", "internalemailaddress") },
          `<p><b>Recount needed</b> — lot <b>${trig("stk_outturn")}</b> on stack ${field("Get_stack", "stk_name")}</p>` +
            `<p>Why: ${trig("stk_why")}</p>` +
            `<p><a href="${APP_LINK.counter}">Open the stock take app → Recounts</a></p>`,
          "Get_stack",
        ),
      }),
    },
    {
      name: "IBKY F4 · Exception escalation (weekdays 07:00)",
      description: "Each weekday morning: remind owners of overdue exceptions; 3+ days overdue → head of department; 7+ days → Country Finance Manager.",
      data: clientdata(
        "Every_weekday_morning",
        {
          type: "Recurrence",
          recurrence: {
            frequency: "Week",
            interval: 1,
            schedule: { weekDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], hours: ["7"], minutes: [0] },
            timeZone: "E. Africa Standard Time",
          },
        },
        {
          Get_heads: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'HeadsOfDepartment'", top: 1 }, null),
          Get_CFM: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'CountryFinanceManager'", top: 1 }, "Get_heads"),
          Heads: { type: "Compose", inputs: "@json(coalesce(first(outputs('Get_heads')?['body/value'])?['stk_value'], '{}'))", runAfter: after("Get_CFM") },
          Get_overdue: listRows(
            "stk_exceptions",
            {
              select: "stk_exceptionid,stk_name,stk_duedate,stk_escalationlevel,stk_department,_ownerid_value",
              filter: `stk_status ne ${EXC.closed} and stk_duedate lt @{formatDateTime(utcNow(), 'yyyy-MM-dd')}`,
            },
            "Heads",
          ),
          For_each_overdue: {
            type: "Foreach",
            foreach: "@outputs('Get_overdue')?['body/value']",
            runtimeConfiguration: { concurrency: { repetitions: 1 } },
            actions: {
              Days_overdue: {
                type: "Compose",
                inputs: "@div(sub(ticks(startOfDay(utcNow())), ticks(items('For_each_overdue')?['stk_duedate'])), 864000000000)",
                runAfter: {},
              },
              Level_due: {
                type: "Compose",
                inputs: `@if(greaterOrEquals(outputs('Days_overdue'), ${ESCALATE.cfmAfterDays}), ${EXC.cfmLevel}, if(greaterOrEquals(outputs('Days_overdue'), ${ESCALATE.hodAfterDays}), ${EXC.hodLevel}, ${EXC.ownerLevel}))`,
                runAfter: after("Days_overdue"),
              },
              Get_owner: getRow("systemusers", "@{items('For_each_overdue')?['_ownerid_value']}", "fullname,internalemailaddress", "Level_due"),
              Remind_owner: teamsPost(
                { kind: "chat", email: field("Get_owner", "internalemailaddress") },
                "<p><b>Overdue exception</b> — @{items('For_each_overdue')?['stk_name']}</p>" +
                  "<p>Due @{formatDateTime(items('For_each_overdue')?['stk_duedate'], 'dd MMM yyyy')}, now @{outputs('Days_overdue')} day(s) overdue. " +
                  `It escalates to your head of department at ${ESCALATE.hodAfterDays} days and to the Country Finance Manager at ${ESCALATE.cfmAfterDays}.</p>` +
                  `<p><a href="${APP_LINK.management}">Close it in the management app → Exceptions</a></p>`,
                "Get_owner",
              ),
              Escalate_if_due: when(
                "greater(outputs('Level_due'), items('For_each_overdue')?['stk_escalationlevel'])",
                {
                  Raise_level: updateRow(
                    "stk_exceptions",
                    "@{items('For_each_overdue')?['stk_exceptionid']}",
                    { stk_escalationlevel: "@outputs('Level_due')", stk_status: EXC.escalated },
                    null,
                  ),
                  Escalate_to: {
                    type: "Compose",
                    inputs: `@if(equals(outputs('Level_due'), ${EXC.hodLevel}), coalesce(outputs('Heads')?[items('For_each_overdue')?['stk_department@OData.Community.Display.V1.FormattedValue']], first(outputs('Get_CFM')?['body/value'])?['stk_value']), first(outputs('Get_CFM')?['body/value'])?['stk_value'])`,
                    runAfter: after("Raise_level"),
                  },
                  Tell_escalation: teamsPost(
                    { kind: "chat", email: "@{outputs('Escalate_to')}" },
                    "<p><b>Exception escalated to you</b> — @{items('For_each_overdue')?['stk_name']}</p>" +
                      `<p>@{items('For_each_overdue')?['stk_department@OData.Community.Display.V1.FormattedValue']} · owner ${field("Get_owner", "fullname")} · @{outputs('Days_overdue')} day(s) overdue.</p>` +
                      `<p><a href="${APP_LINK.management}">Open Exceptions in the management app</a></p>`,
                    "Escalate_to",
                  ),
                },
                null,
                "Remind_owner",
              ),
            },
            runAfter: after("Get_overdue"),
          },
        },
      ),
    },
    {
      name: "IBKY F5 · Sign-off chain",
      description: "On each sign-off row: announce it and who signs next; on a send-back say sign-off restarts; one person signs one gate; after the chain's last gate (Country Finance Manager, or Warehouse Manager on an ad hoc count) email the pack and mark the stock take Completed.",
      data: clientdata("When_a_gate_signs_or_sends_back", rowTrigger("stk_signoff", 1), {
        Get_stock_take: getRow("stk_stocktakes", trig("_stk_stocktake_value"), "stk_name,stk_countdate,stk_type", null),
        Get_signer: getRow("systemusers", trig("_stk_signedby_value"), "fullname,internalemailaddress", "Get_stock_take"),
        Get_SoD: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'EnforceSeparationOfDuties'", top: 1 }, "Get_signer"),
        // Signatures before the latest send-back no longer count.
        Get_last_send_back: listRows(
          "stk_signoffs",
          { select: "stk_signedon", filter: `_stk_stocktake_value eq @{triggerOutputs()?['body/_stk_stocktake_value']} and stk_action eq ${SIGNOFF.sentBack}`, orderBy: "stk_signedon desc", top: 1 },
          "Get_SoD",
        ),
        Get_signers_other_gates: listRows(
          "stk_signoffs",
          {
            select: "stk_gate",
            filter:
              `_stk_stocktake_value eq @{triggerOutputs()?['body/_stk_stocktake_value']} and stk_action eq ${SIGNOFF.signed} and _stk_signedby_value eq @{triggerOutputs()?['body/_stk_signedby_value']} ` +
              `and stk_gate ne @{triggerOutputs()?['body/stk_gate']} and stk_signedon gt @{coalesce(first(outputs('Get_last_send_back')?['body/value'])?['stk_signedon'], '1900-01-01T00:00:00Z')}`,
          },
          "Get_last_send_back",
        ),
        Signed_or_sent_back: when(
          `equals(triggerOutputs()?['body/stk_action'], ${SIGNOFF.sentBack})`,
          {
            Announce_send_back: teamsPost(
              channel,
              `<p><b>Sign-off sent back</b> — ${label("stk_gate")} (${field("Get_signer", "fullname")}) sent back ${field("Get_stock_take", "stk_name")}.</p>` +
                `<p>Reason: ${trig("stk_comment")}</p><p>Sign-off starts again from the first gate once it's fixed.</p>`,
              null,
            ),
          },
          {
            Signer_has_another_gate: when(
              `and(equals(toLower(coalesce(first(outputs('Get_SoD')?['body/value'])?['stk_value'], 'false')), 'true'), greater(length(outputs('Get_signers_other_gates')?['body/value']), 0))`,
              {
                // Separation of duties: one person signs one gate.
                Remove_signature: {
                  type: "OpenApiConnection",
                  inputs: {
                    host: { connectionName: "shared_commondataserviceforapps", operationId: "DeleteRecord", apiId: apiId("shared_commondataserviceforapps") },
                    parameters: { entityName: "stk_signoffs", recordId: trig("stk_signoffid") },
                    authentication: auth,
                  },
                  runAfter: {},
                },
                Tell_the_signer: teamsPost(
                  { kind: "chat", email: field("Get_signer", "internalemailaddress") },
                  `<p><b>Your ${label("stk_gate")} sign-off on ${field("Get_stock_take", "stk_name")} was removed</b> — you already signed another gate, and one person signs one gate. Ask the gate's signer or their stand-in to sign it.</p>`,
                  "Remove_signature",
                ),
              },
              {
                Last_gate: when(
                  LAST_GATE_TEST,
                  {
                    Get_distribution: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'SignOffDistribution'", top: 1 }, null),
                    Get_signatures: listRows(
                      "stk_signoffs",
                      { select: "stk_gate,stk_action,stk_signedon,stk_comment,_stk_signedby_value", filter: "_stk_stocktake_value eq @{triggerOutputs()?['body/_stk_stocktake_value']}", orderBy: "stk_signedon asc" },
                      "Get_distribution",
                    ),
                    Signature_rows: {
                      type: "Select",
                      inputs: {
                        from: "@outputs('Get_signatures')?['body/value']",
                        select: {
                          Gate: "@item()?['stk_gate@OData.Community.Display.V1.FormattedValue']",
                          Action: "@item()?['stk_action@OData.Community.Display.V1.FormattedValue']",
                          By: "@item()?['_stk_signedby_value@OData.Community.Display.V1.FormattedValue']",
                          On: "@formatDateTime(item()?['stk_signedon'], 'dd MMM yyyy HH:mm')",
                          Comment: "@coalesce(item()?['stk_comment'], '')",
                        },
                      },
                      runAfter: after("Get_signatures"),
                    },
                    Signature_table: { type: "Table", inputs: { from: "@body('Signature_rows')", format: "HTML" }, runAfter: after("Signature_rows") },
                    Get_variances: listRows(
                      "stk_variances",
                      { select: "stk_name,stk_outturn,stk_grade,stk_expectedunits,stk_countedunits,stk_expectedkg,stk_countedkg,stk_cause,stk_state,_stk_site_value,_stk_stack_value", filter: "_stk_stocktake_value eq @{triggerOutputs()?['body/_stk_stocktake_value']}", orderBy: "stk_name asc" },
                      "Signature_table",
                    ),
                    Variance_rows: {
                      type: "Select",
                      inputs: {
                        from: "@outputs('Get_variances')?['body/value']",
                        select: {
                          Variance: "@item()?['stk_name']",
                          Warehouse: "@item()?['_stk_site_value@OData.Community.Display.V1.FormattedValue']",
                          Stack: "@item()?['_stk_stack_value@OData.Community.Display.V1.FormattedValue']",
                          Outturn: "@item()?['stk_outturn']",
                          Grade: "@item()?['stk_grade']",
                          "XBS units": "@item()?['stk_expectedunits']",
                          "Counted units": "@item()?['stk_countedunits']",
                          "XBS kg": "@item()?['stk_expectedkg']",
                          "Counted kg": "@item()?['stk_countedkg']",
                          Cause: "@item()?['stk_cause@OData.Community.Display.V1.FormattedValue']",
                          State: "@item()?['stk_state@OData.Community.Display.V1.FormattedValue']",
                        },
                      },
                      runAfter: after("Get_variances"),
                    },
                    Variance_CSV: { type: "Table", inputs: { from: "@body('Variance_rows')", format: "CSV" }, runAfter: after("Variance_rows") },
                    Get_open_exceptions: listRows("stk_exceptions", { select: "stk_name", filter: `stk_status ne ${EXC.closed}` }, "Variance_CSV"),
                    Email_the_pack: {
                      type: "OpenApiConnection",
                      inputs: {
                        host: { connectionName: "shared_office365", operationId: "SendEmailV2", apiId: apiId("shared_office365") },
                        parameters: {
                          "emailMessage/To": "@{first(outputs('Get_distribution')?['body/value'])?['stk_value']}",
                          "emailMessage/Subject": `Stock take signed off: ${field("Get_stock_take", "stk_name")}`,
                          "emailMessage/Body":
                            `<p><b>${field("Get_stock_take", "stk_name")}</b> (count date ${field("Get_stock_take", "stk_countdate")}) has been signed off by every gate and is now <b>Completed</b>.</p>` +
                            "<p>@{length(outputs('Get_variances')?['body/value'])} variances (attached as CSV) · @{length(outputs('Get_open_exceptions')?['body/value'])} exceptions still open.</p>" +
                            "<h3>Sign-off</h3>@{body('Signature_table')}" +
                            `<p><a href="${APP_LINK.management}">Open the management app</a> for the full reconciliation.</p>`,
                          "emailMessage/Attachments": [{ Name: `Variances - ${field("Get_stock_take", "stk_name")}.csv`, ContentBytes: "@{base64(body('Variance_CSV'))}" }],
                          "emailMessage/Importance": "Normal",
                        },
                        authentication: auth,
                      },
                      runAfter: after("Get_open_exceptions"),
                    },
                    Mark_completed: updateRow(
                      "stk_stocktakes",
                      trig("_stk_stocktake_value"),
                      { stk_status: STOCKTAKE.completed, stk_closedon: "@utcNow()", stk_closecomment: "Signed off by every gate of its sign-off chain." },
                      "Email_the_pack",
                    ),
                    Announce_completed: teamsPost(
                      channel,
                      `<p><b>Stock take signed off</b> — ${field("Get_stock_take", "stk_name")} is Completed. ${label("stk_gate")} (${field("Get_signer", "fullname")}) signed last; the pack was emailed to the distribution list.</p>`,
                      "Mark_completed",
                    ),
                  },
                  {
                    Announce_next_gate: teamsPost(
                      channel,
                      `<p><b>${label("stk_gate")} signed</b> ${field("Get_stock_take", "stk_name")} — ${field("Get_signer", "fullname")}${"@{if(empty(triggerOutputs()?['body/stk_comment']), '', concat(': ', triggerOutputs()?['body/stk_comment']))}"}</p>` +
                        `<p>Next: <b>@{coalesce(json('${JSON.stringify(NEXT_GATE)}')?[concat(string(outputs('Get_stock_take')?['body/stk_type']), '-', string(triggerOutputs()?['body/stk_gate']))], 'see Sign-off')}</b></p>` +
                        `<p><a href="${APP_LINK.management}">Open Sign-off in the management app</a></p>`,
                      null,
                    ),
                  },
                  null,
                ),
              },
              null,
            ),
          },
          "Get_signers_other_gates",
        ),
      }),
    },
    {
      name: "IBKY F6 · Mapping change → Finance approval",
      description: "When a mapping change is requested, ask the approvers in MappingApprovers. Approved changes are applied to the basket/outturn map; the requester is told the outcome.",
      data: clientdata("When_a_mapping_change_is_requested", rowTrigger("stk_mappingchange", 1), {
        Get_requester: getRow("systemusers", trig("_createdby_value"), "fullname,internalemailaddress", null),
        Get_approvers: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'MappingApprovers'", top: 1 }, "Get_requester"),
        Get_SoD: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'EnforceSeparationOfDuties'", top: 1 }, "Get_approvers"),
        Ask_Finance: {
          type: "OpenApiConnectionWebhook",
          inputs: {
            host: { connectionName: "shared_approvals", operationId: "StartAndWaitForAnApproval", apiId: apiId("shared_approvals") },
            parameters: {
              approvalType: "Basic",
              "WebhookApprovalCreationInput/title": `Mapping change ${trig("stk_name")}: ${label("stk_target")} ${trig("stk_targetkey")} — ${trig("stk_from")} → ${trig("stk_to")}`,
              "WebhookApprovalCreationInput/assignedTo": "@{first(outputs('Get_approvers')?['body/value'])?['stk_value']}",
              "WebhookApprovalCreationInput/details": `Requested by ${field("Get_requester", "fullname")}.\n\nReason: ${trig("stk_reason")}\n\nApproving changes the mapping used for reconciliation from now on.`,
              "WebhookApprovalCreationInput/itemLink": APP_LINK.management,
              "WebhookApprovalCreationInput/itemLinkDescription": "Open Mapping in the management app",
              "WebhookApprovalCreationInput/enableNotifications": true,
              "WebhookApprovalCreationInput/enableReassignment": true,
            },
            authentication: auth,
          },
          runAfter: after("Get_SoD"),
        },
        Outcome: { type: "Compose", inputs: "@body('Ask_Finance')?['outcome']", runAfter: after("Ask_Finance") },
        Responder: { type: "Compose", inputs: "@first(body('Ask_Finance')?['responses'])", runAfter: after("Outcome") },
        // The app may have decided it while the approval was open.
        Get_current: getRow("stk_mappingchanges", trig("stk_mappingchangeid"), "stk_state", "Responder"),
        Same_person_blocked: {
          type: "Compose",
          inputs:
            "@and(equals(toLower(coalesce(first(outputs('Get_SoD')?['body/value'])?['stk_value'], 'false')), 'true'), equals(toLower(outputs('Responder')?['responder']?['email']), toLower(outputs('Get_requester')?['body/internalemailaddress'])))",
          runAfter: after("Get_current"),
        },
        Decide: when(
          `and(equals(outputs('Get_current')?['body/stk_state'], ${CHANGE.pending}), not(outputs('Same_person_blocked')))`,
          {
            Find_responder: listRows("systemusers", { select: "systemuserid,fullname", filter: "internalemailaddress eq '@{outputs('Responder')?['responder']?['email']}'", top: 1 }, null),
            Record_decision: updateRow(
              "stk_mappingchanges",
              trig("stk_mappingchangeid"),
              {
                stk_state: `@if(equals(outputs('Outcome'), 'Approve'), ${CHANGE.approved}, ${CHANGE.rejected})`,
                stk_decidedon: "@utcNow()",
                "stk_decidedby@odata.bind": "@concat('/systemusers(', first(outputs('Find_responder')?['body/value'])?['systemuserid'], ')')",
              },
              "Find_responder",
            ),
            Apply_if_approved: when(
              "equals(outputs('Outcome'), 'Approve')",
              {
                Basket_or_outturn: when(
                  `equals(triggerOutputs()?['body/stk_target'], ${CHANGE.basket})`,
                  {
                    Find_basket: listRows("stk_basketmaps", { select: "stk_basketmapid", filter: "stk_basketcode eq '@{triggerOutputs()?['body/stk_targetkey']}'", top: 1 }, null),
                    Update_basket: updateRow(
                      "stk_basketmaps",
                      "@{first(outputs('Find_basket')?['body/value'])?['stk_basketmapid']}",
                      {
                        stk_primarybasket: `@json('${JSON.stringify(PRIMARY_BASKET)}')?[triggerOutputs()?['body/stk_to']]`,
                        "stk_lastchange@odata.bind": "@concat('/stk_mappingchanges(', triggerOutputs()?['body/stk_mappingchangeid'], ')')",
                      },
                      "Find_basket",
                    ),
                  },
                  {
                    Find_outturn: listRows("stk_outturnmaps", { select: "stk_outturnmapid", filter: "stk_name eq '@{triggerOutputs()?['body/stk_targetkey']}'", top: 1 }, null),
                    Create_or_update: when(
                      "empty(outputs('Find_outturn')?['body/value'])",
                      {
                        Create_outturn_map: createRow(
                          "stk_outturnmaps",
                          {
                            stk_name: "@triggerOutputs()?['body/stk_targetkey']",
                            stk_basketcode: "@first(split(triggerOutputs()?['body/stk_to'], ' '))",
                            "stk_change@odata.bind": "@concat('/stk_mappingchanges(', triggerOutputs()?['body/stk_mappingchangeid'], ')')",
                          },
                          null,
                        ),
                      },
                      {
                        Update_outturn_map: updateRow(
                          "stk_outturnmaps",
                          "@{first(outputs('Find_outturn')?['body/value'])?['stk_outturnmapid']}",
                          {
                            stk_basketcode: "@first(split(triggerOutputs()?['body/stk_to'], ' '))",
                            "stk_change@odata.bind": "@concat('/stk_mappingchanges(', triggerOutputs()?['body/stk_mappingchangeid'], ')')",
                          },
                          null,
                        ),
                      },
                      "Find_outturn",
                    ),
                  },
                  null,
                ),
              },
              null,
              "Record_decision",
            ),
            Tell_the_requester: teamsPost(
              { kind: "chat", email: field("Get_requester", "internalemailaddress") },
              `<p><b>Mapping change ${trig("stk_name")} @{if(equals(outputs('Outcome'), 'Approve'), 'approved', 'rejected')}</b> by @{outputs('Responder')?['responder']?['displayName']}</p>` +
                `<p>${label("stk_target")} ${trig("stk_targetkey")}: ${trig("stk_from")} → ${trig("stk_to")}</p>` +
                `<p>@{coalesce(outputs('Responder')?['comments'], '')}</p>`,
              "Apply_if_approved",
            ),
          },
          {
            Tell_if_blocked: when(
              "outputs('Same_person_blocked')",
              {
                Explain: teamsPost(
                  { kind: "chat", email: "@{outputs('Responder')?['responder']?['email']}" },
                  `<p><b>${trig("stk_name")} not applied</b> — you requested this change, so someone else must approve it. It's still pending in the management app.</p>`,
                  null,
                ),
              },
              null,
              null,
            ),
          },
          "Same_person_blocked",
        ),
      }),
    },
    {
      name: "IBKY F8 · Count report the day after the count (daily 06:30)",
      description: "Each morning: if a stock take was counted yesterday, email counted vs XBS per warehouse, sheet status and the biggest differences to CountReportDistribution, and post a short note in the channel.",
      data: clientdata(
        "Every_morning",
        { type: "Recurrence", recurrence: { frequency: "Day", interval: 1, schedule: { hours: ["6"], minutes: [30] }, timeZone: "E. Africa Standard Time" } },
        {
          Get_distribution: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'CountReportDistribution'", top: 1 }, null),
          Get_date_override: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'CountReportDate'", top: 1 }, "Get_distribution"),
          // Yesterday in Nairobi, unless the setting names a date (for a re-send or a test).
          Report_date: {
            type: "Compose",
            inputs:
              "@if(or(empty(first(outputs('Get_date_override')?['body/value'])?['stk_value']), equals(toLower(coalesce(first(outputs('Get_date_override')?['body/value'])?['stk_value'], 'auto')), 'auto')), " +
              "formatDateTime(addDays(convertFromUtc(utcNow(), 'E. Africa Standard Time'), -1), 'yyyy-MM-dd'), first(outputs('Get_date_override')?['body/value'])?['stk_value'])",
            runAfter: after("Get_date_override"),
          },
          Count_day: { type: "Compose", inputs: "@formatDateTime(outputs('Report_date'), 'd MMM yyyy')", runAfter: after("Report_date") },
          Get_sites: listRows("stk_sites", { select: "stk_siteid,stk_name" }, "Count_day"),
          Get_stock_takes: listRows("stk_stocktakes", { select: "stk_stocktakeid,stk_name,stk_countdate,_stk_import_value", filter: "stk_countdate eq @{outputs('Report_date')}" }, "Get_sites"),
          // Variables live at the top level; each stock take resets them.
          Init_rows: { type: "InitializeVariable", inputs: { variables: [{ name: "rows", type: "string", value: "" }] }, runAfter: after("Get_stock_takes") },
          Init_totals: { type: "InitializeVariable", inputs: { variables: [{ name: "totals", type: "array", value: [] }] }, runAfter: after("Init_rows") },
          For_each_stock_take: {
            type: "Foreach",
            foreach: "@outputs('Get_stock_takes')?['body/value']",
            runtimeConfiguration: { concurrency: { repetitions: 1 } },
            actions: {
              XBS_by_warehouse: listRows(
                "stk_xbslines",
                {
                  fetchXml:
                    "<fetch aggregate='true'><entity name='stk_xbsline'><attribute name='stk_site' groupby='true' alias='site'/><attribute name='stk_kg' aggregate='sum' alias='kg'/>" +
                    "<attribute name='stk_xbslineid' aggregate='count' alias='lines'/><filter><condition attribute='stk_import' operator='eq' value='@{items('For_each_stock_take')?['_stk_import_value']}'/></filter></entity></fetch>",
                },
                null,
              ),
              Counted_by_warehouse: listRows(
                "stk_countlines",
                {
                  fetchXml:
                    "<fetch aggregate='true'><entity name='stk_countline'><attribute name='stk_site' groupby='true' alias='site'/><attribute name='stk_kg' aggregate='sum' alias='kg'/>" +
                    "<attribute name='stk_countlineid' aggregate='count' alias='lines'/><filter><condition attribute='stk_isother' operator='ne' value='1'/></filter>" +
                    "<link-entity name='stk_countsheet' from='stk_countsheetid' to='stk_countsheet' link-type='inner'><filter><condition attribute='stk_stocktake' operator='eq' value='@{items('For_each_stock_take')?['stk_stocktakeid']}'/></filter></link-entity></entity></fetch>",
                },
                "XBS_by_warehouse",
              ),
              Reset_rows: { type: "SetVariable", inputs: { name: "rows", value: "" }, runAfter: after("Counted_by_warehouse") },
              Reset_totals: { type: "SetVariable", inputs: { name: "totals", value: [] }, runAfter: after("Reset_rows") },
              For_each_warehouse: {
                type: "Foreach",
                foreach: "@reverse(sort(outputs('XBS_by_warehouse')?['body/value'], 'kg'))",
                runtimeConfiguration: { concurrency: { repetitions: 1 } },
                actions: {
                  Counted_here: { type: "Query", inputs: { from: "@outputs('Counted_by_warehouse')?['body/value']", where: "@equals(string(item()?['site']), string(items('For_each_warehouse')?['site']))" }, runAfter: {} },
                  Warehouse_name: { type: "Query", inputs: { from: "@outputs('Get_sites')?['body/value']", where: "@equals(string(item()?['stk_siteid']), string(items('For_each_warehouse')?['site']))" }, runAfter: after("Counted_here") },
                  Figures: {
                    type: "Compose",
                    inputs: {
                      name: "@coalesce(first(body('Warehouse_name'))?['stk_name'], 'Warehouse')",
                      xbs: "@div(float(coalesce(items('For_each_warehouse')?['kg'], 0)), 60)",
                      counted: "@if(empty(body('Counted_here')), 0, div(float(coalesce(first(body('Counted_here'))?['kg'], 0)), 60))",
                      countedLines: "@if(empty(body('Counted_here')), 0, first(body('Counted_here'))?['lines'])",
                      xbsLines: "@items('For_each_warehouse')?['lines']",
                    },
                    runAfter: after("Warehouse_name"),
                  },
                  // Share of the warehouse's XBS lines that have a count line. Below
                  // COMPLETE_PCT a difference would only show an unfinished count.
                  Coverage: {
                    type: "Compose",
                    inputs: "@if(equals(int(coalesce(outputs('Figures')?['xbsLines'], 0)), 0), 0, div(mul(float(outputs('Figures')?['countedLines']), 100), float(outputs('Figures')?['xbsLines'])))",
                    runAfter: after("Figures"),
                  },
                  Add_row: {
                    type: "AppendToStringVariable",
                    inputs: {
                      name: "rows",
                      value:
                        "<tr><td>@{outputs('Figures')?['name']}</td><td style='text-align:right'>@{formatNumber(outputs('Figures')?['xbs'], 'N1')}</td>" +
                        "<td style='text-align:right'>@{if(equals(outputs('Figures')?['countedLines'], 0), 'not counted', formatNumber(outputs('Figures')?['counted'], 'N1'))}</td>" +
                        "<td style='text-align:right'>@{if(equals(outputs('Figures')?['countedLines'], 0), '', if(less(outputs('Coverage'), " + COMPLETE_PCT + "), 'count incomplete', formatNumber(sub(outputs('Figures')?['counted'], outputs('Figures')?['xbs']), 'N1')))}</td>" +
                        "<td style='text-align:right'>@{outputs('Figures')?['countedLines']} of @{outputs('Figures')?['xbsLines']} (@{formatNumber(outputs('Coverage'), 'N0')}%)</td></tr>",
                    },
                    runAfter: after("Coverage"),
                  },
                  Add_total: {
                    type: "AppendToArrayVariable",
                    inputs: { name: "totals", value: "@outputs('Figures')" },
                    runAfter: after("Add_row"),
                  },
                },
                runAfter: after("Reset_totals"),
              },
              Counted_warehouses: { type: "Query", inputs: { from: "@variables('totals')", where: "@greater(item()?['countedLines'], 0)" }, runAfter: after("For_each_warehouse") },
              Get_sheets: listRows("stk_countsheets", { select: "stk_status", filter: "_stk_stocktake_value eq @{items('For_each_stock_take')?['stk_stocktakeid']}" }, "Counted_warehouses"),
              Sheets_approved: { type: "Query", inputs: { from: "@outputs('Get_sheets')?['body/value']", where: `@equals(item()?['stk_status'], ${SHEET.approved})` }, runAfter: after("Get_sheets") },
              Sheets_waiting: { type: "Query", inputs: { from: "@outputs('Get_sheets')?['body/value']", where: `@equals(item()?['stk_status'], ${SHEET.submitted})` }, runAfter: after("Sheets_approved") },
              Get_variances: listRows(
                "stk_variances",
                { select: "stk_name,stk_outturn,stk_expectedunits,stk_countedunits,stk_expectedkg,stk_countedkg,stk_suggestedcause,stk_cause,_stk_site_value,_stk_stack_value", filter: "_stk_stocktake_value eq @{items('For_each_stock_take')?['stk_stocktakeid']}" },
                "Sheets_waiting",
              ),
              Variance_rows: {
                type: "Select",
                inputs: {
                  from: "@outputs('Get_variances')?['body/value']",
                  select: {
                    Variance: "@item()?['stk_name']",
                    Warehouse: "@item()?['_stk_site_value@OData.Community.Display.V1.FormattedValue']",
                    Stack: "@coalesce(item()?['_stk_stack_value@OData.Community.Display.V1.FormattedValue'], '')",
                    Outturn: "@item()?['stk_outturn']",
                    "XBS units": "@item()?['stk_expectedunits']",
                    "Counted units": "@item()?['stk_countedunits']",
                    "Difference eq60": "@formatNumber(div(sub(float(coalesce(item()?['stk_countedkg'], 0)), float(coalesce(item()?['stk_expectedkg'], 0))), 60), 'N1')",
                    Cause: "@coalesce(item()?['stk_cause@OData.Community.Display.V1.FormattedValue'], item()?['stk_suggestedcause@OData.Community.Display.V1.FormattedValue'], '')",
                    // Size of the difference either way, to rank them.
                    size: "@if(less(float(coalesce(item()?['stk_countedkg'], 0)), float(coalesce(item()?['stk_expectedkg'], 0))), sub(float(coalesce(item()?['stk_expectedkg'], 0)), float(coalesce(item()?['stk_countedkg'], 0))), sub(float(coalesce(item()?['stk_countedkg'], 0)), float(coalesce(item()?['stk_expectedkg'], 0))))",
                  },
                },
                runAfter: after("Get_variances"),
              },
              Biggest: {
                type: "Select",
                inputs: {
                  from: "@take(reverse(sort(body('Variance_rows'), 'size')), 10)",
                  select: {
                    Variance: "@item()?['Variance']", Warehouse: "@item()?['Warehouse']", Stack: "@item()?['Stack']", Outturn: "@item()?['Outturn']",
                    "XBS units": "@item()?['XBS units']", "Counted units": "@item()?['Counted units']", "Difference eq60": "@item()?['Difference eq60']", Cause: "@item()?['Cause']",
                  },
                },
                runAfter: after("Variance_rows"),
              },
              Biggest_rows: {
                type: "Select",
                inputs: {
                  from: "@body('Biggest')",
                  select:
                    "@concat('<tr><td>', item()?['Variance'], '</td><td>', item()?['Warehouse'], '</td><td>', item()?['Stack'], '</td><td>', item()?['Outturn'], " +
                    "'</td><td style=\"text-align:right\">', string(item()?['XBS units']), '</td><td style=\"text-align:right\">', string(item()?['Counted units']), " +
                    "'</td><td style=\"text-align:right\">', item()?['Difference eq60'], '</td><td>', item()?['Cause'], '</td></tr>')",
                },
                runAfter: after("Biggest"),
              },
              Biggest_table: {
                type: "Compose",
                inputs:
                  "<table border='1' cellpadding='6' style='border-collapse:collapse'><tr><th>Variance</th><th>Warehouse</th><th>Stack</th><th>Outturn</th>" +
                  "<th>XBS units</th><th>Counted units</th><th>Difference eq60</th><th>Cause</th></tr>@{join(body('Biggest_rows'), '')}</table>",
                runAfter: after("Biggest_rows"),
              },
              Email_the_report: {
                type: "OpenApiConnection",
                inputs: {
                  host: { connectionName: "shared_office365", operationId: "SendEmailV2", apiId: apiId("shared_office365") },
                  parameters: {
                    "emailMessage/To": "@{first(outputs('Get_distribution')?['body/value'])?['stk_value']}",
                    "emailMessage/Subject": "Stock take count report: @{items('For_each_stock_take')?['stk_name']} (counted @{outputs('Count_day')})",
                    "emailMessage/Body":
                      "<p>The count for <b>@{items('For_each_stock_take')?['stk_name']}</b> took place on @{outputs('Count_day')}. First results, before supervisors finish their review:</p>" +
                      "<h3>Counted vs XBS, 60 kg equivalents</h3><table border='1' cellpadding='6' style='border-collapse:collapse'>" +
                      "<tr><th>Warehouse</th><th>XBS</th><th>Counted</th><th>Difference</th><th>Lines counted</th></tr>@{variables('rows')}</table>" +
                      "<p>@{length(body('Counted_warehouses'))} of @{length(variables('totals'))} warehouses counted. Count sheets: @{length(body('Sheets_approved'))} approved, @{length(body('Sheets_waiting'))} waiting for approval, @{length(outputs('Get_sheets')?['body/value'])} in total.</p>" +
                      "<h3>Biggest differences so far</h3>@{if(empty(body('Biggest')), '<p>No variances recorded yet. They appear once the Hub has processed the submitted stacks.</p>', outputs('Biggest_table'))}" +
                      `<p>Not counted: no count lines for that warehouse yet (third parties are usually confirmed, not counted). Count incomplete: under ${COMPLETE_PCT}% of the warehouse's XBS lines counted, so a difference would only show unfinished counting. Full detail: <a href="${APP_LINK.management}">Stock Management Hub → Reports</a>.</p>` +
                      "<p style='color:#666'>Contains XBS figures: do not forward to counters (counting is blind).</p>",
                    "emailMessage/Importance": "Normal",
                  },
                  authentication: auth,
                },
                runAfter: after("Biggest_table"),
              },
              Post_to_channel: teamsPost(
                channel,
                "<p><b>Count report sent</b> — @{items('For_each_stock_take')?['stk_name']} (counted @{outputs('Count_day')}): @{length(body('Counted_warehouses'))} warehouses counted, @{length(outputs('Get_variances')?['body/value'])} variances so far. The summary is in your email.</p>",
                "Email_the_report",
              ),
            },
            runAfter: after("Init_totals"),
          },
        },
      ),
    },
    {
      name: "IBKY F7a · Problem reported → supervisors",
      description: "When a counter reports a problem from the app, post it to the supervisors' Teams channel.",
      data: clientdata("When_a_problem_is_reported", rowTrigger("stk_issue", 1), {
        Get_reporter: getRow("systemusers", trig("_createdby_value"), "fullname", null),
        Post_to_supervisors: teamsPost(
          channel,
          `<p><b>Problem reported</b> — ${trig("stk_name")} from ${field("Get_reporter", "fullname")} at ${label("_stk_site_value", "no warehouse")}</p>` +
            `<p>${label("stk_category")}: ${trig("stk_description")}</p>` +
            `<p>Screen: ${trig("stk_screen")}</p>` +
            `<p><a href="${APP_LINK.management}">Triage it in the management app → Problem reports</a></p>`,
          "Get_reporter",
        ),
      }),
    },
    {
      name: "IBKY F7b · Problem assigned → owner",
      description: "When a problem report gets an owner, tell that person in Teams.",
      data: clientdata("When_a_problem_is_assigned", rowTrigger("stk_issue", 3, { columns: "stk_assignedto", filter: "_stk_assignedto_value ne null" }), {
        Get_owner: getRow("systemusers", trig("_stk_assignedto_value"), "fullname,internalemailaddress", null),
        Tell_the_owner: teamsPost(
          { kind: "chat", email: field("Get_owner", "internalemailaddress") },
          `<p><b>Problem report assigned to you</b> — ${trig("stk_name")} (${label("stk_category")})</p>` +
            `<p>${trig("stk_description")}</p>` +
            `<p><a href="${APP_LINK.management}">Open it in the management app → Problem reports</a></p>`,
          "Get_owner",
        ),
      }),
    },
    {
      name: "IBKY F9 · Allocation published → counters",
      description:
        "When Operations publishes a counter allocation, tell each counter in Teams where they count. Areas only: no planned bags, which come from XBS (blind counting).",
      // 4 = added or modified: a run is created as Published; a Draft could also be published later.
      data: clientdata(
        "When_an_allocation_is_published",
        rowTrigger("stk_allocationrun", 4, { columns: "stk_status", filter: `stk_status eq ${ALLOCATION.published}` }),
        {
          Get_stock_take: getRow("stk_stocktakes", trig("_stk_stocktake_value"), "stk_name", null),
          List_assignments: listRows(
            "stk_assignments",
            { select: "stk_name,_stk_counter_value", filter: `_stk_allocationrun_value eq ${trig("stk_allocationrunid")} and statecode eq 0` },
            "Get_stock_take",
          ),
          For_each_assignment: {
            type: "Foreach",
            foreach: "@outputs('List_assignments')?['body/value']",
            actions: {
              Get_counter: getRow("systemusers", "@{items('For_each_assignment')?['_stk_counter_value']}", "fullname,internalemailaddress", null),
              Tell_the_counter: teamsPost(
                { kind: "chat", email: field("Get_counter", "internalemailaddress") },
                `<p><b>Your counting area</b> — ${field("Get_stock_take", "stk_name")}</p>` +
                  // stk_name is "<counter> · <site> <sections>"; keep the part after the name.
                  `<p>${"@{last(split(items('For_each_assignment')?['stk_name'], ' · '))}"}</p>` +
                  `<p>Allocation ${trig("stk_name")}. Your stacks are on the checklist in the stock take app; count only those.</p>` +
                  `<p><a href="${APP_LINK.counter}">Open the stock take app</a></p>`,
                "Get_counter",
              ),
            },
            runAfter: after("List_assignments"),
          },
        },
      ),
    },
    {
      name: "IBKY F10 · Count closed → Level 1 summary",
      description:
        "When counting closes on its own (every stack in, no recounts open, every variance decided), email the Level 1 summary the Hub wrote to CountReportDistribution in NKG branding, with the Level 1 PDF the Hub saved on the stock take attached, and post a short note in the channel. It shows XBS figures: never send it to counters.",
      data: clientdata(
        "When_the_count_closes",
        rowTrigger("stk_stocktake", 3, { columns: "stk_countclosedon", filter: "stk_countclosedon ne null" }),
        {
          Get_distribution: listRows("stk_settings", { select: "stk_value", filter: "stk_name eq 'CountReportDistribution'", top: 1 }, null),
          // The PDF the Hub saved as the stock take's "Level 1 summary" note (none: the email goes without it).
          Get_the_pdf: listRows(
            "annotations",
            { select: "filename,documentbody", filter: `_objectid_value eq ${trig("stk_stocktakeid")} and subject eq 'Level 1 summary'`, top: 1 },
            "Get_distribution",
          ),
          Attachments: {
            type: "Select",
            // The note holds base64 text; Outlook wants the file's bytes, or the PDF arrives corrupted.
            inputs: { from: "@outputs('Get_the_pdf')?['body/value']", select: { Name: "@item()?['filename']", ContentBytes: "@base64ToBinary(item()?['documentbody'])" } },
            runAfter: after("Get_the_pdf"),
          },
          Email_the_summary: {
            type: "OpenApiConnection",
            inputs: {
              host: { connectionName: "shared_office365", operationId: "SendEmailV2", apiId: apiId("shared_office365") },
              parameters: {
                "emailMessage/To": "@{first(outputs('Get_distribution')?['body/value'])?['stk_value']}",
                "emailMessage/Subject": `Counting closed: ${trig("stk_name")} - Level 1 summary`,
                // The Hub's look in tables and inline styles (Outlook): grey page, white card, the green top
                // bar, a headline, the summary block the Hub wrote, the primary button. Outlook blocks
                // embedded images, so the bar carries the name in type; the logo is in the attached PDF.
                "emailMessage/Body":
                  `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5"><tr><td align="center" style="padding:24px 12px">` +
                  `<table width="720" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e8e8;border-radius:16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#000000">` +
                  `<tr><td style="background:#006330;border-radius:16px 16px 0 0;padding:16px 24px">` +
                  `<table width="100%" cellpadding="0" cellspacing="0"><tr>` +
                  `<td style="font-family:Georgia,'Times New Roman',serif;font-size:19px;color:#ffffff">NKG East Africa</td>` +
                  `<td style="text-align:right;font-size:13px;font-weight:700;color:#ffffff">Stock Management Hub</td></tr></table></td></tr>` +
                  `<tr><td style="padding:26px 18px 6px">` +
                  `<div style="font-size:26px;font-weight:800;padding:0 6px">Level 1 reconciliation complete</div>` +
                  `<div style="font-size:16px;color:#5f5f5f;padding:4px 6px 0">${trig("stk_name")}</div>` +
                  `<div style="font-size:14px;color:#5f5f5f;padding:10px 6px 22px">Every stack is in, no recount is open and every variance is decided. The stock take has moved to Reconciliation; Level 2 (Comtras) is next, then sign-off.</div>` +
                  "@{replace(coalesce(triggerOutputs()?['body/stk_l1summary'], ''), decodeUriComponent('%0A'), '<br>')}" +
                  `<div style="padding:24px 6px 10px"><a href="${APP_LINK.management}" style="background:#006330;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:12px;display:inline-block">Open the Stock Management Hub</a></div>` +
                  `</td></tr>` +
                  `<tr><td style="padding:14px 24px 20px;border-top:1px solid #e8e8e8;font-size:12px;color:#949494">` +
                  `The summary is attached as a PDF. Internal: it contains XBS figures, so do not forward it to counters.<br>Sent by the Stock Management Hub &middot; Ibero Kenya Limited</td></tr>` +
                  `</table></td></tr></table>`,
                "emailMessage/Attachments": "@body('Attachments')",
                "emailMessage/Importance": "Normal",
              },
              authentication: auth,
            },
            runAfter: after("Attachments"),
          },
          Post_to_the_channel: teamsPost(
            channel,
            `<p><b>Counting closed</b> — ${trig("stk_name")} is in Reconciliation. The Level 1 summary went to the count report list.</p>` +
              `<p><a href="${APP_LINK.management}">Open the management app</a></p>`,
            "Email_the_summary",
          ),
        },
      ),
    },
    {
      name: "IBKY F11 · Hub asks the Stock Assistant",
      description:
        "Called by the Stock Management Hub's Stock Assistant panel (management roles only, never the counter app). Sends the question to the Copilot Studio agent with Execute Agent and wait, in a new conversation or the one the Hub passes back, and returns the answer and the conversation id to the Hub.",
      data: clientdata(
        "When_the_Hub_asks",
        {
          type: "Request",
          kind: "PowerAppV2",
          inputs: {
            schema: {
              type: "object",
              properties: {
                text: { title: "Question", type: "string", description: "What the user asked", "x-ms-content-hint": "TEXT", "x-ms-dynamically-added": true },
                text_1: { title: "Conversation", type: "string", description: "Conversation id from the last answer, empty for a new conversation", "x-ms-content-hint": "TEXT", "x-ms-dynamically-added": true },
              },
              required: ["text"],
            },
          },
        },
        {
          // A follow-up continues the agent's conversation, so "and AGL?" keeps its context.
          New_or_follow_up: when(
            "empty(coalesce(triggerBody()?['text_1'], ''))",
            { Ask_new: askAssistant(false) },
            { Ask_follow_up: askAssistant(true) },
          ),
          Answer_the_Hub: answerHub(
            {
              answer: "@{coalesce(body('Ask_new')?['lastResponse'], body('Ask_follow_up')?['lastResponse'], '')}",
              conversation: "@{coalesce(body('Ask_new')?['conversationId'], body('Ask_follow_up')?['conversationId'], triggerBody()?['text_1'], '')}",
              // The agent's whole reply, so the panel can show what it sent while the answer field is confirmed.
              raw: "@{string(coalesce(body('Ask_new'), body('Ask_follow_up')))}",
              error: "",
            },
            ["Succeeded"],
          ),
          // Without this the Hub only sees "BadGateway / NoResponse" when the agent call fails
          // (e.g. "Agent is not published"): it always gets an answer, with the reason.
          Tell_the_Hub_it_failed: answerHub(
            {
              answer: "",
              conversation: "@{coalesce(triggerBody()?['text_1'], '')}",
              raw: "@{string(coalesce(body('Ask_new'), body('Ask_follow_up')))}",
              // A failed connector call keeps its reason on the action's error, not in its body.
              error: "@{coalesce(actions('Ask_new')?['error']?['message'], actions('Ask_follow_up')?['error']?['message'], body('Ask_new')?['message'], body('Ask_follow_up')?['message'], 'The Stock Assistant did not answer.')}",
            },
            ["Failed", "TimedOut"],
          ),
        },
      ),
    },
    {
      name: "IBKY F7c · Problem resolved → reporter",
      description: "When a problem report is resolved, send the reply to the counter who reported it.",
      data: clientdata("When_a_problem_is_resolved", rowTrigger("stk_issue", 3, { columns: "stk_status", filter: `stk_status eq ${ISSUE.resolved}` }), {
        Get_reporter: getRow("systemusers", trig("_createdby_value"), "fullname,internalemailaddress", null),
        Tell_the_reporter: teamsPost(
          { kind: "chat", email: field("Get_reporter", "internalemailaddress") },
          `<p><b>Your problem report was resolved</b> — ${trig("stk_name")}</p>` +
            `<p>Reply: ${trig("stk_resolution")}</p>` +
            `<p>You'll also see it in the stock take app under your reports.</p>`,
          "Get_reporter",
        ),
      }),
    },
  ];
}
