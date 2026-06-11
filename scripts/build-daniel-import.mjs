import fs from "node:fs/promises";
import vm from "node:vm";

const seedPath = new URL(
  "../prototipo-manutencao-web/data/seed-data.js",
  import.meta.url,
);
const outputPath = new URL(
  "../supabase/seed/daniel-workbook-data.json",
  import.meta.url,
);

const context = { window: {} };
vm.createContext(context);
vm.runInContext(await fs.readFile(seedPath, "utf8"), context);

const seed = context.window.MANUTENCAO_SEED;
const assets = seed.assets.filter((asset) => asset.ativo && asset.sistema);
const assetIds = new Set(assets.map((asset) => asset.id));

const payload = {
  sourceWorkbook: "base_manutencao_predial_apartamento_trabalho.xlsx",
  generatedAt: new Date().toISOString(),
  environments: seed.ambientes.filter((item) => item.ambiente),
  systems: seed.sistemas.filter((item) => item.sistema),
  routines: seed.rotinas,
  assets,
  events: seed.recurrenceEvents.filter((event) => assetIds.has(event.assetId)),
};

await fs.mkdir(new URL("../supabase/seed/", import.meta.url), {
  recursive: true,
});
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `Carga preparada: ${payload.assets.length} ativos e ${payload.events.length} eventos.`,
);

