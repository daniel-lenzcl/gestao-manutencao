import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.dirname(scriptDir);
const importPath = path.join(
  workspace,
  "supabase",
  "seed",
  "daniel-workbook-data.json",
);
const data = JSON.parse(fs.readFileSync(importPath, "utf8"));
const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetEmail = (
  process.env.DANIEL_IMPORT_EMAIL || data.sourceLogin
).toLowerCase();
const sourceWorkbook = data.sourceWorkbook;

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function combineProperties(current, additions) {
  return { ...(current || {}), ...additions };
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${pathname}: ${response.status} ${text}`,
    );
  }

  return payload;
}

async function select(table, filters = {}, columns = "*") {
  const params = new URLSearchParams({ select: columns });
  for (const [name, value] of Object.entries(filters)) {
    params.set(name, value);
  }
  return request(`/rest/v1/${table}?${params}`);
}

async function insert(table, body) {
  const rows = await request(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function update(table, id, body) {
  const rows = await request(`/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function findTargetUser() {
  const payload = await request("/auth/v1/admin/users?page=1&per_page=1000");
  const user = payload.users?.find(
    (candidate) => candidate.email?.toLowerCase() === targetEmail,
  );

  if (!user) {
    throw new Error(
      `O usuario ${targetEmail} ainda nao existe no Supabase Auth.`,
    );
  }

  return user;
}

async function ensureBuilding(ownerId) {
  const types = await select("building_types", { slug: "eq.apartamento" });
  if (!types.length) {
    throw new Error(
      "Tipo de edificacao 'apartamento' ausente. Execute primeiro a nova migracao SQL.",
    );
  }

  const buildings = await select("buildings", { owner_id: `eq.${ownerId}` });
  const reference =
    process.env.DANIEL_BUILDING_REFERENCE || "PLANILHA-APTO";
  let building = buildings.find(
    (item) =>
      normalized(item.reference_code) === normalized(reference) ||
      item.properties?.source_workbook === sourceWorkbook,
  );

  const properties = {
    source_workbook: sourceWorkbook,
    import_owner_email: targetEmail,
    imported_from_spreadsheet: true,
  };

  if (!building) {
    return insert("buildings", {
      owner_id: ownerId,
      building_type_id: types[0].id,
      name: "Apartamento - planilha de trabalho",
      reference_code: reference,
      properties,
    });
  }

  return update("buildings", building.id, {
    building_type_id: building.building_type_id || types[0].id,
    properties: combineProperties(building.properties, properties),
  });
}

async function ensureLocations(ownerId, building) {
  const existing = await select("locations", {
    building_id: `eq.${building.id}`,
  });
  const locations = [...existing];
  const zoneNames = [
    ...new Set(data.ambientes.map((item) => item.zona).filter(Boolean)),
  ];
  const zoneByName = new Map();

  for (let index = 0; index < zoneNames.length; index += 1) {
    const name = zoneNames[index];
    let zone = locations.find(
      (item) =>
        !item.parent_id &&
        item.location_type === "zona" &&
        normalized(item.name) === normalized(name),
    );
    const body = {
      building_id: building.id,
      parent_id: null,
      name,
      location_type: "zona",
      sort_order: (index + 1) * 10,
      properties: combineProperties(zone?.properties, {
        source_workbook: sourceWorkbook,
      }),
    };

    zone = zone
      ? await update("locations", zone.id, body)
      : await insert("locations", body);
    zoneByName.set(normalized(name), zone);
    locations.push(zone);
  }

  const environmentByName = new Map();
  for (let index = 0; index < data.ambientes.length; index += 1) {
    const environment = data.ambientes[index];
    const parent = zoneByName.get(normalized(environment.zona));
    let location = locations.find(
      (item) => normalized(item.name) === normalized(environment.ambiente),
    );
    const body = {
      building_id: building.id,
      parent_id: parent?.id || null,
      name: environment.ambiente,
      location_type: "ambiente",
      sort_order: (index + 1) * 10,
      properties: combineProperties(location?.properties, {
        code: environment.codigo || null,
        zone: environment.zona || null,
        source_workbook: sourceWorkbook,
      }),
    };

    location = location
      ? await update("locations", location.id, body)
      : await insert("locations", body);
    environmentByName.set(normalized(environment.ambiente), location);
    locations.push(location);
  }

  return environmentByName;
}

async function ensureSystems(building) {
  const existing = await select("systems", {
    building_id: `eq.${building.id}`,
  });
  const grouped = new Map();

  for (const row of data.sistemas) {
    const key = normalized(row.sistema);
    const group = grouped.get(key) || {
      name: row.sistema,
      codes: new Set(),
      subsystems: new Set(),
    };
    if (row.codigo) group.codes.add(row.codigo);
    if (row.subsistema) group.subsystems.add(row.subsistema);
    grouped.set(key, group);
  }

  const systemByName = new Map();
  for (const [key, group] of grouped) {
    let system = existing.find(
      (item) => normalized(item.name) === normalized(group.name),
    );
    const body = {
      building_id: building.id,
      name: group.name,
      description: system?.description || null,
      properties: combineProperties(system?.properties, {
        codes: [...group.codes],
        subsystems: [...group.subsystems],
        source_workbook: sourceWorkbook,
      }),
    };

    system = system
      ? await update("systems", system.id, body)
      : await insert("systems", body);
    systemByName.set(key, system);
  }

  return systemByName;
}

async function ensureAssetTypes(ownerId) {
  const existing = await select("asset_types", {
    owner_id: `eq.${ownerId}`,
  });
  const names = new Set([
    ...data.assets.map((item) => item.ativo),
    ...data.rotinas.map((item) => item.ativo),
  ]);
  const typeByName = new Map();

  for (const name of names) {
    const key = normalized(name);
    let assetType = existing.find(
      (item) => normalized(item.name) === key,
    );
    const body = {
      owner_id: ownerId,
      name,
      properties: combineProperties(assetType?.properties, {
        source_workbook: sourceWorkbook,
      }),
    };

    assetType = assetType
      ? await update("asset_types", assetType.id, body)
      : await insert("asset_types", body);
    typeByName.set(key, assetType);
  }

  return typeByName;
}

async function ensureTemplates(ownerId, typeByName) {
  const existing = await select("maintenance_templates", {
    owner_id: `eq.${ownerId}`,
  });

  for (const routine of data.rotinas) {
    const assetType = typeByName.get(normalized(routine.ativo));
    const template = existing.find(
      (item) =>
        item.asset_type_id === assetType.id &&
        normalized(item.system_name) === normalized(routine.sistema) &&
        normalized(item.name) === normalized(routine.acao) &&
        normalized(item.component) === normalized(routine.componente),
    );
    const body = {
      owner_id: ownerId,
      asset_type_id: assetType.id,
      system_name: routine.sistema || null,
      component: routine.componente || null,
      name: routine.acao,
      periodicity_months: numberOrNull(routine.periodicidadeMeses),
      reference_cost: numberOrNull(routine.custoReferencia) || 0,
      responsible: routine.responsavel || null,
      properties: combineProperties(template?.properties, {
        source_workbook: sourceWorkbook,
      }),
    };

    if (template) {
      await update("maintenance_templates", template.id, body);
    } else {
      existing.push(await insert("maintenance_templates", body));
    }
  }
}

async function ensureAssets(
  ownerId,
  building,
  environmentByName,
  systemByName,
  typeByName,
) {
  const existing = await select("assets", { owner_id: `eq.${ownerId}` });
  const assetByCode = new Map();

  for (const source of data.assets) {
    const system = systemByName.get(normalized(source.sistema));
    const assetType = typeByName.get(normalized(source.ativo));
    const location = environmentByName.get(normalized(source.ambiente));
    if (!system || !assetType) {
      throw new Error(`Sistema ou tipo ausente para o ativo ${source.id}.`);
    }

    let asset = existing.find(
      (item) => normalized(item.external_code) === normalized(source.id),
    );
    const body = {
      owner_id: ownerId,
      building_id: building.id,
      location_id: location?.id || null,
      system_id: system.id,
      asset_type_id: assetType.id,
      external_code: source.id,
      name: source.ativo,
      subsystem: source.subsistema || null,
      component: source.componente || null,
      planned_action: source.acao || null,
      quantity: numberOrNull(source.quantidade) || 0,
      unit: source.unidade || null,
      periodicity_months: numberOrNull(source.periodicidadeMeses),
      last_maintenance_date: dateOnly(source.ultimaManutencao),
      next_maintenance_date: dateOnly(source.proximaManutencao),
      estimated_unit_cost: numberOrNull(source.custoUnitario) || 0,
      estimated_total_cost: numberOrNull(source.custoTotal) || 0,
      priority: source.prioridade || null,
      condition: source.estado || null,
      status: source.status || null,
      responsible: source.responsavel || null,
      notes: source.observacoes || null,
      photo_path: source.foto || null,
      properties: combineProperties(asset?.properties, {
        zone: source.zona || null,
        source_workbook: sourceWorkbook,
      }),
    };

    asset = asset
      ? await update("assets", asset.id, body)
      : await insert("assets", body);
    assetByCode.set(source.id, asset);
  }

  return assetByCode;
}

async function ensurePlans(ownerId, building, assetByCode) {
  const existing = await select("maintenance_plans", {
    building_id: `eq.${building.id}`,
  });
  const planByAssetCode = new Map();

  for (const source of data.assets) {
    const asset = assetByCode.get(source.id);
    const name = source.acao || "Manutencao periodica";
    let plan = existing.find(
      (item) =>
        item.asset_id === asset.id && normalized(item.name) === normalized(name),
    );
    const body = {
      owner_id: ownerId,
      building_id: building.id,
      asset_id: asset.id,
      name,
      maintenance_type: "preventiva",
      periodicity_months: numberOrNull(source.periodicidadeMeses),
      estimated_cost: numberOrNull(source.custoTotal) || 0,
      start_date:
        dateOnly(source.ultimaManutencao) ||
        dateOnly(source.proximaManutencao),
      active: true,
      properties: combineProperties(plan?.properties, {
        source_workbook: sourceWorkbook,
      }),
    };

    plan = plan
      ? await update("maintenance_plans", plan.id, body)
      : await insert("maintenance_plans", body);
    planByAssetCode.set(source.id, plan);
  }

  return planByAssetCode;
}

async function upsertEvents(
  ownerId,
  building,
  assetByCode,
  planByAssetCode,
) {
  const rows = data.recurrenceEvents.map((event) => {
    const asset = assetByCode.get(event.assetId);
    const plan = planByAssetCode.get(event.assetId);
    if (!asset) {
      throw new Error(`Ativo ${event.assetId} ausente para evento.`);
    }

    const scheduledDate = dateOnly(event.data);
    const eventType = normalized(event.tipo).startsWith("substit")
      ? "substituicao"
      : "manutencao";
    const completed =
      typeof event.realizada === "boolean" ? event.realizada : null;

    return {
      owner_id: ownerId,
      building_id: building.id,
      asset_id: asset.id,
      plan_id: plan?.id || null,
      external_event_key: `${event.assetId}:${scheduledDate}:${eventType}`,
      event_type: eventType,
      scheduled_date: scheduledDate,
      execution_date: dateOnly(event.dataExecucao),
      status: completed === true
        ? "cumprido"
        : completed === false
          ? "perdido"
          : normalized(event.status) || "programado",
      estimated_cost: numberOrNull(event.custo) || 0,
      actual_cost: numberOrNull(event.custoReal),
      completed,
      cycle_number: numberOrNull(event.ciclo) || 1,
      provision_start_date: dateOnly(event.inicioProvisionamento),
      notes: event.observacoes || null,
      properties: {
        action: event.acao || null,
        environment: event.ambiente || null,
        priority: event.prioridade || null,
        source_workbook: sourceWorkbook,
        system: event.sistema || null,
      },
    };
  });

  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    await request(
      "/rest/v1/maintenance_events?on_conflict=owner_id,external_event_key",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(batch),
      },
    );
  }

  return rows.length;
}

const user = await findTargetUser();
const building = await ensureBuilding(user.id);
const environmentByName = await ensureLocations(user.id, building);
const systemByName = await ensureSystems(building);
const typeByName = await ensureAssetTypes(user.id);
await ensureTemplates(user.id, typeByName);
const assetByCode = await ensureAssets(
  user.id,
  building,
  environmentByName,
  systemByName,
  typeByName,
);
const planByAssetCode = await ensurePlans(user.id, building, assetByCode);
const eventCount = await upsertEvents(
  user.id,
  building,
  assetByCode,
  planByAssetCode,
);

console.log(`Importacao vinculada a ${targetEmail}.`);
console.log(`Edificacao: ${building.name} (${building.reference_code}).`);
console.log(
  `${assetByCode.size} ativos, ${planByAssetCode.size} planos e ` +
    `${eventCount} eventos processados.`,
);
