// Stage 4 cloud flows, built as solution-aware flows in IBKYStockTake.
// Each flow is a Logic Apps definition stored on a `workflow` row (category 5).
// Connections are reached through connection references, so the solution can
// move between environments and be re-bound there.

const ENV_ID = "fbbef02c-fb2e-e56f-926c-4fe610004640";
export const APP_LINK = {
  management: `https://apps.powerapps.com/play/e/${ENV_ID}/a/415dbc66-f07f-4819-8995-337876f7c185`,
  counter: `https://apps.powerapps.com/play/e/${ENV_ID}/a/e66f3a71-e7f8-411e-8443-a0303d39ed78`,
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
};

const SHEET = { inProgress: 614500000, submitted: 614500001, approved: 614500002, sentBack: 614500003 };
const ISSUE = { open: 614500000, inProgress: 614500001, resolved: 614500002 };
const IMPORT = { imported: 614500001 };
const CHANGE = { pending: 614500000, approved: 614500001, rejected: 614500002, basket: 614500000 };
const PRIMARY_BASKET = { Plus: 614500000, FAQ: 614500001, Grinder: 614500002 };
const EXC = { open: 614500000, ownerLevel: 614500000, sourceImport: 614500001, kindUnknown: 614500009, deptOperations: 614500000 };

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

/** Dataverse "List rows". */
function listRows(entitySet, { select, filter, orderBy, top }, runAfter) {
  return {
    type: "OpenApiConnection",
    inputs: {
      host: { connectionName: "shared_commondataserviceforapps", operationId: "ListRecords", apiId: apiId("shared_commondataserviceforapps") },
      parameters: { entityName: entitySet, $select: select, ...(filter ? { $filter: filter } : {}), ...(orderBy ? { $orderby: orderBy } : {}), ...(top ? { $top: top } : {}) },
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
