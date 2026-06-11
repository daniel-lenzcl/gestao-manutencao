import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.dirname(scriptDir);
const seedPath = path.join(
  workspace,
  "prototipo-manutencao-web",
  "data",
  "seed-data.js",
);
const outputPath = path.join(
  workspace,
  "supabase",
  "seed",
  "daniel-workbook-data.json",
);

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(seedPath, "utf8"), context);

const seed = context.window.MANUTENCAO_SEED;
const assets = seed.assets.filter((asset) => asset.ativo && asset.sistema);

function findEventAsset(event) {
  if (event.assetId) {
    return assets.find((asset) => asset.id === event.assetId);
  }

  return assets.find(
    (asset) =>
      asset.ativo === event.ativo &&
      asset.sistema === event.sistema &&
      asset.ambiente === event.ambiente,
  );
}

const recurrenceEvents = seed.recurrenceEvents
  .map((event) => {
    const asset = findEventAsset(event);
    return asset ? { ...event, assetId: asset.id } : null;
  })
  .filter(Boolean);

const payload = {
  generatedAt: new Date().toISOString(),
  sourceWorkbook: "base_manutencao_predial_apartamento_trabalho.xlsx",
  sourceLogin: "danieulenz@gmail.com",
  assets,
  recurrenceEvents,
  ambientes: seed.ambientes.filter((item) => item.ambiente),
  sistemas: seed.sistemas.filter((item) => item.sistema),
  rotinas: seed.rotinas.filter((item) => item.ativo && item.acao),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `Arquivo preparado: ${payload.assets.length} ativos, ` +
    `${payload.recurrenceEvents.length} eventos, ` +
    `${payload.ambientes.length} ambientes e ${payload.rotinas.length} rotinas.`,
);
