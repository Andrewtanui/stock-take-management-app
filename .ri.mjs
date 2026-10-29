import { build } from "esbuild"; import { readFileSync } from "node:fs";
const out = await build({ entryPoints: [process.argv[2] + "/src/data/recon-items.ts"], bundle: true, format: "esm", platform: "node", write: false });
const { countItems } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
const { lines, variances } = JSON.parse(readFileSync(process.argv[3], "utf8"));
for (const i of countItems(variances, lines, new Set(["AGL", "KPCU", "MAXA", "MCF", "KCCE"]))) console.log(String(i.bags).padStart(9), " ", i.label, " | ", i.lots.slice(0, 4).map((l) => `${l.outturn} ${l.grade} ${l.bags}`).join("; "));
