// Creates the IBKY Stock Take solution in Dataverse from schema.mjs.
// Safe to re-run: anything that already exists is skipped.
//
//   node scripts/dataverse/create-schema.mjs --dry-run   # list what would be created, no sign-in
//   node scripts/dataverse/create-schema.mjs             # create (device-code sign-in on first run)
//
// Order: publisher → solution → global choices → tables (with primary name)
// → columns → lookups → N:N → alternate keys → org auditing → publish.

import { CHOICES, MANY_TO_MANY, PUBLISHER, SOLUTION, TABLES } from "./schema.mjs";

const DRY = process.argv.includes("--dry-run");
const SOL = SOLUTION.uniquename;
const LANG = 1033;
const BASE_VALUE = PUBLISHER.optionPrefix * 10000; // 614500000

const { dv, exists } = DRY ? { dv: null, exists: async () => false } : await import("./api.mjs");

const label = (text) => ({
  "@odata.type": "Microsoft.Dynamics.CRM.Label",
  LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: LANG }],
});
const required = (r) => ({ Value: r ? "ApplicationRequired" : "None", CanBeChanged: true, ManagedPropertyLogicalName: "canmodifyrequirementlevelsettings" });
const options = (names) => names.map((n, i) => ({ Value: BASE_VALUE + i, Label: label(n) }));
const audit = { Value: true, CanBeChanged: true, ManagedPropertyLogicalName: "canmodifyauditsettings" };

let created = 0;
let skipped = 0;
async function step(what, check, make) {
  if (DRY) {
    console.log(`  + ${what}`);
    created++;
    return;
  }
  if (await check()) {
    skipped++;
    return;
  }
  process.stdout.write(`  + ${what} … `);
  await make();
  created++;
  console.log("ok");
}

function columnMetadata(logical, display, c) {
  const common = { SchemaName: logical, DisplayName: label(display), RequiredLevel: required(false), IsAuditEnabled: audit };
  switch (c.type) {
    case "string":
      return { "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", ...common, MaxLength: c.max, FormatName: { Value: "Text" } };
    case "memo":
      return { "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata", ...common, MaxLength: c.max, Format: "TextArea" };
    case "int":
      return { "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata", ...common, Format: "None", MinValue: -2147483648, MaxValue: 2147483647 };
    case "decimal":
      return { "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata", ...common, Precision: c.precision, MinValue: -100000000000, MaxValue: 100000000000 };
    case "bool":
      return {
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
        ...common,
        DefaultValue: false,
        OptionSet: { TrueOption: { Value: 1, Label: label("Yes") }, FalseOption: { Value: 0, Label: label("No") } },
      };
    case "date":
      return { "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", ...common, Format: "DateOnly", DateTimeBehavior: { Value: "DateOnly" } };
    case "datetime":
      return { "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", ...common, Format: "DateAndTime", DateTimeBehavior: { Value: "UserLocal" } };
    case "choice":
      // Must bind by MetadataId — binding by Name is rejected.
      return { "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata", ...common, "GlobalOptionSet@odata.bind": `/GlobalOptionSetDefinitions(${choiceIds[c.set] ?? "00000000-0000-0000-0000-000000000000"})` };
    case "localchoice":
      return {
        "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        ...common,
        OptionSet: { "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata", IsGlobal: false, OptionSetType: "Picklist", Options: options(c.options) },
      };
    case "file":
      return { "@odata.type": "Microsoft.Dynamics.CRM.FileAttributeMetadata", ...common, MaxSizeInKB: c.kb };
    default:
      throw new Error(`Unknown column type ${c.type}`);
  }
}

console.log(`${DRY ? "DRY RUN — " : ""}IBKY Stock Take schema → ${DRY ? "(no connection)" : (await import("./auth.mjs")).ORG_URL}\n`);

/* 1. publisher + solution */
console.log("Publisher & solution");
let publisherId;
await step(
  `publisher ${PUBLISHER.uniquename} (prefix ${PUBLISHER.prefix})`,
  async () => {
    const r = await dv("GET", `publishers?$select=publisherid&$filter=uniquename eq '${PUBLISHER.uniquename}'`);
    publisherId = r.value[0]?.publisherid;
    return !!publisherId;
  },
  async () => {
    await dv("POST", "publishers", {
      uniquename: PUBLISHER.uniquename,
      friendlyname: PUBLISHER.friendlyname,
      customizationprefix: PUBLISHER.prefix,
      customizationoptionvalueprefix: PUBLISHER.optionPrefix,
    });
    const r = await dv("GET", `publishers?$select=publisherid&$filter=uniquename eq '${PUBLISHER.uniquename}'`);
    publisherId = r.value[0].publisherid;
  },
);
await step(
  `solution ${SOL}`,
  async () => (await dv("GET", `solutions?$select=solutionid&$filter=uniquename eq '${SOL}'`)).value.length > 0,
  () =>
    dv("POST", "solutions", {
      uniquename: SOL,
      friendlyname: SOLUTION.friendlyname,
      version: SOLUTION.version,
      "publisherid@odata.bind": `/publishers(${publisherId})`,
    }),
);

/* 2. global choices */
console.log("\nChoices");
for (const [name, [display, values]] of Object.entries(CHOICES)) {
  await step(
    `choice ${name} (${values.length})`,
    () => exists(`GlobalOptionSetDefinitions(Name='${name}')`),
    () =>
      dv(
        "POST",
        "GlobalOptionSetDefinitions",
        {
          "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
          Name: name,
          DisplayName: label(display),
          IsGlobal: true,
          OptionSetType: "Picklist",
          Options: options(values),
        },
        { solution: SOL },
      ),
  );
}

// MetadataIds of the global choices, for binding choice columns.
const choiceIds = {};
if (!DRY)
  for (const name of Object.keys(CHOICES))
    choiceIds[name] = (await dv("GET", `GlobalOptionSetDefinitions(Name='${name}')?$select=MetadataId`)).MetadataId;

/* 3. tables */
console.log("\nTables");
for (const t of TABLES) {
  await step(
    `table ${t.name} — ${t.display} (${t.own === "user" ? "user-owned" : "org-owned"})`,
    () => exists(`EntityDefinitions(LogicalName='${t.name}')?$select=LogicalName`),
    () =>
      dv(
        "POST",
        "EntityDefinitions",
        {
          "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
          SchemaName: t.name,
          DisplayName: label(t.display),
          DisplayCollectionName: label(t.plural),
          OwnershipType: t.own === "user" ? "UserOwned" : "OrganizationOwned",
          IsActivity: false,
          HasActivities: false,
          // Notes hold photos (annotations); once on, Dataverse never turns them off.
          HasNotes: !!t.notes,
          IsAuditEnabled: audit,
          Attributes: [
            {
              "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
              SchemaName: "stk_name",
              IsPrimaryName: true,
              DisplayName: label(t.primary[0]),
              RequiredLevel: required(true),
              MaxLength: t.primary[1],
              FormatName: { Value: "Text" },
            },
          ],
        },
        { solution: SOL },
      ),
  );
}

/* 3b. notes (attachments) on tables created before notes were wanted */
for (const t of TABLES.filter((x) => x.notes)) {
  await step(
    `notes on ${t.name}`,
    async () => (await dv("GET", `EntityDefinitions(LogicalName='${t.name}')?$select=HasNotes`)).HasNotes === true,
    async () => {
      const e = await dv("GET", `EntityDefinitions(LogicalName='${t.name}')`);
      delete e["@odata.context"];
      e.HasNotes = true;
      await dv("PUT", `EntityDefinitions(LogicalName='${t.name}')`, e, { solution: SOL });
    },
  );
}

/* 4. columns */
console.log("\nColumns");
for (const t of TABLES) {
  for (const [logical, display, c] of t.cols) {
    await step(
      `${t.name}.${logical} (${c.type})`,
      () => exists(`EntityDefinitions(LogicalName='${t.name}')/Attributes(LogicalName='${logical}')?$select=LogicalName`),
      () => dv("POST", `EntityDefinitions(LogicalName='${t.name}')/Attributes`, columnMetadata(logical, display, c), { solution: SOL }),
    );
  }
}

/* 5. lookups (1:N relationships). Restrict deletes; RemoveLink for user lookups. */
console.log("\nLookups");
for (const t of TABLES) {
  for (const [logical, display, target, req] of t.lookups ?? []) {
    // Relationship names must carry the publisher prefix: stk_<table>_<column>.
    const schema = `stk_${t.name.replace("stk_", "")}_${logical.replace("stk_", "")}`;
    await step(
      `${t.name}.${logical} → ${target}${req ? " (required)" : ""}`,
      () => exists(`RelationshipDefinitions(SchemaName='${schema}')?$select=SchemaName`),
      () =>
        dv(
          "POST",
          "RelationshipDefinitions",
          {
            "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
            SchemaName: schema,
            ReferencedEntity: target,
            ReferencingEntity: t.name,
            CascadeConfiguration: {
              Assign: "NoCascade",
              Delete: target === "systemuser" ? "RemoveLink" : "Restrict",
              Merge: "NoCascade",
              Reparent: "NoCascade",
              Share: "NoCascade",
              Unshare: "NoCascade",
            },
            Lookup: {
              "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
              SchemaName: logical,
              DisplayName: label(display),
              RequiredLevel: required(!!req),
            },
          },
          { solution: SOL },
        ),
    );
  }
}

/* 6. N:N */
console.log("\nMany-to-many");
for (const [schema, e1, e2] of MANY_TO_MANY) {
  const menu = (l) => ({ Behavior: "UseLabel", Group: "Details", Label: label(l), Order: 10000 });
  await step(
    `${schema} (${e1} ↔ ${e2})`,
    () => exists(`RelationshipDefinitions(SchemaName='${schema}')?$select=SchemaName`),
    () =>
      dv(
        "POST",
        "RelationshipDefinitions",
        {
          "@odata.type": "Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata",
          SchemaName: schema,
          Entity1LogicalName: e1,
          Entity2LogicalName: e2,
          IntersectEntityName: schema,
          Entity1AssociatedMenuConfiguration: menu("Warehouses"),
          Entity2AssociatedMenuConfiguration: menu("Stock takes"),
        },
        { solution: SOL },
      ),
  );
}

/* 7. alternate keys (Dataverse builds the index in the background) */
console.log("\nAlternate keys");
for (const t of TABLES) {
  for (const cols of t.keys ?? []) {
    const schema = `${t.name}_key_${cols.map((c) => c.replace("stk_", "")).join("_")}`;
    await step(
      `${t.name} key (${cols.join(", ")})`,
      async () => {
        const r = await dv("GET", `EntityDefinitions(LogicalName='${t.name}')/Keys?$select=SchemaName`);
        return r.value.some((k) => k.SchemaName.toLowerCase() === schema);
      },
      () =>
        dv("POST", `EntityDefinitions(LogicalName='${t.name}')/Keys`, { SchemaName: schema, DisplayName: label(cols.join(" + ")), KeyAttributes: cols }, { solution: SOL }),
    );
  }
}

/* 8. organisation auditing (table/column audit flags only work when this is on) */
console.log("\nAuditing");
await step(
  "organisation auditing on",
  async () => {
    const r = await dv("GET", "organizations?$select=organizationid,isauditenabled");
    return r.value[0].isauditenabled;
  },
  async () => {
    const r = await dv("GET", "organizations?$select=organizationid");
    await dv("PATCH", `organizations(${r.value[0].organizationid})`, { isauditenabled: true });
  },
);

/* 9. publish */
if (!DRY && created > 0) {
  process.stdout.write("\nPublishing customisations … ");
  await dv("POST", "PublishAllXml", {});
  console.log("ok");
}
console.log(`\nDone. ${created} ${DRY ? "would be created" : "created"}, ${skipped} already existed.`);
