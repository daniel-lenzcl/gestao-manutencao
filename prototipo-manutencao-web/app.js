const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const supabaseConfig = window.SUPABASE_CONFIG || {};
const authStorageKey = "gestao-predial-auth-v1";
const storageKeyBase = "manutencao-prototipo-state-v2";
let storageKey = `${storageKeyBase}-guest`;
let currentSession = null;
let currentUserId = "";
let currentUserEmail = "";
let appRendered = false;
let authMode = "login";
let buildingData = {
  buildings: [],
  buildingTypes: [],
  locations: [],
  systems: [],
  loaded: false,
};
const openBuildingIds = new Set();
const pendingBuildingKey = "__pending__";
const reportBuildingSelections = {
  assets: new Set(),
  dashboard: new Set(),
  timeline: new Set(),
  finance: new Set(),
};
const normativeSystems = [
  {
    key: "nbr15575-2-estrutural",
    name: "Sistemas estruturais",
    standard: "ABNT NBR 15575-2",
    description: "Elementos estruturais e sua estabilidade, segurança e durabilidade.",
    group: "NBR 15575",
  },
  {
    key: "nbr15575-3-pisos",
    name: "Sistemas de pisos",
    standard: "ABNT NBR 15575-3",
    description: "Camadas do piso, revestimentos, contrapiso e interfaces.",
    group: "NBR 15575",
  },
  {
    key: "nbr15575-4-vedacoes",
    name: "Vedações verticais internas e externas",
    standard: "ABNT NBR 15575-4",
    description: "Paredes, fachadas, divisórias, portas e janelas integradas às vedações.",
    group: "NBR 15575",
  },
  {
    key: "nbr15575-5-coberturas",
    name: "Sistemas de coberturas",
    standard: "ABNT NBR 15575-5",
    description: "Telhados, impermeabilização, calhas e componentes da cobertura.",
    group: "NBR 15575",
  },
  {
    key: "nbr15575-6-hidrossanitario",
    name: "Sistemas hidrossanitários",
    standard: "ABNT NBR 15575-6",
    description: "Abastecimento de água, esgoto sanitário e águas pluviais.",
    group: "NBR 15575",
  },
  {
    key: "nbr5410-eletrico",
    name: "Instalações elétricas de baixa tensão",
    standard: "ABNT NBR 5410",
    description: "Entrada, quadros, circuitos, tomadas, iluminação e proteção elétrica.",
    group: "Complementares",
  },
  {
    key: "nbr5419-spda",
    name: "Proteção contra descargas atmosféricas",
    standard: "ABNT NBR 5419",
    description: "SPDA, aterramento e medidas de proteção contra surtos.",
    group: "Complementares",
  },
  {
    key: "nbr15526-gas",
    name: "Instalações internas de gases combustíveis",
    standard: "ABNT NBR 15526",
    description: "Tubulações, válvulas, medição e pontos de consumo de gás.",
    group: "Complementares",
  },
  {
    key: "nbr16401-climatizacao",
    name: "Climatização",
    standard: "ABNT NBR 16401",
    description: "Sistemas de ar-condicionado, ventilação e qualidade do ar interior.",
    group: "Complementares",
  },
  {
    key: "nbr16858-elevadores",
    name: "Elevadores",
    standard: "ABNT NBR 16858",
    description: "Elevadores de passageiros e cargas, seus componentes e segurança.",
    group: "Complementares",
  },
];

let state = loadState();
let editingPhoto = "";
let editingMaintenanceActions = [];
let editingMaintenanceDetailsPhotos = [];
let editingMaintenanceRulePhotos = [];
let focusedAssetId = "";
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let timelineCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const newChoiceValue = "__new__";

function supabaseRequest(path, options = {}) {
  const headers = {
    apikey: supabaseConfig.publishableKey,
    "Content-Type": "application/json",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };

  return fetch(`${String(supabaseConfig.url || "").replace(/\/$/, "")}${path}`, {
    method: options.method || "GET",
    headers: { ...headers, ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).then(async (response) => {
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || data?.error_description || "Não foi possível concluir a operação.");
      error.status = response.status;
      throw error;
    }
    return data;
  });
}

function saveSession(session) {
  currentSession = session;
  if (session) localStorage.setItem(authStorageKey, JSON.stringify(session));
  else localStorage.removeItem(authStorageKey);
}

async function refreshSession(session) {
  if (!session?.refresh_token) return null;
  const refreshed = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: session.refresh_token },
  });
  saveSession(refreshed);
  return refreshed;
}

async function validateSession(session) {
  if (!session?.access_token) return null;
  try {
    const user = await supabaseRequest("/auth/v1/user", { token: session.access_token });
    return { session, user };
  } catch (error) {
    if (error.status !== 401) throw error;
    const refreshed = await refreshSession(session);
    if (!refreshed) return null;
    const user = await supabaseRequest("/auth/v1/user", { token: refreshed.access_token });
    return { session: refreshed, user };
  }
}

function showLogin(message = "") {
  saveSession(null);
  setAuthMode("login");
  document.body.classList.remove("auth-pending", "auth-ready");
  document.body.classList.add("auth-required");
  setAuthMessage(message);
  document.querySelector("#login-password").value = "";
  document.querySelector("#signup-password-confirmation").value = "";
}

function setAuthMessage(message = "", type = "error") {
  const element = document.querySelector("#auth-message");
  element.textContent = message;
  element.classList.toggle("success", type === "success");
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  document.body.classList.toggle("auth-signup", signup);
  document.querySelector("#auth-title").textContent = signup
    ? "Crie sua conta"
    : "Acesse suas edificações";
  document.querySelector(".auth-intro").textContent = signup
    ? "Cadastre-se para criar seus próprios modelos, edificações, ambientes e sistemas."
    : "Entre para consultar modelos, ambientes, sistemas e o planejamento de cada edificação.";
  document.querySelector("#login-submit").textContent = signup ? "Criar conta" : "Entrar";
  document.querySelector("#auth-mode-toggle").textContent = signup
    ? "Já tenho uma conta"
    : "Ainda não tenho conta";
  document.querySelector("#signup-name").required = signup;
  document.querySelector("#signup-password-confirmation").required = signup;
  document.querySelector("#login-password").autocomplete = signup ? "new-password" : "current-password";
  setAuthMessage();
}

function showApplication(user, session) {
  saveSession(session);
  currentUserId = user.id;
  currentUserEmail = String(user.email || "").trim().toLowerCase();
  storageKey = `${storageKeyBase}-${user.id}`;
  state = loadState();
  document.querySelector("#session-user-name").textContent =
    user.user_metadata?.display_name || user.email || "Usuário";
  document.body.classList.remove("auth-pending", "auth-required");
  document.body.classList.add("auth-ready");
  document.querySelector("#auth-message").textContent = "";
  if (!appRendered) appRendered = true;
  render();
  loadBuildingData();
}

async function initializeAuth() {
  if (!supabaseConfig.url || !supabaseConfig.publishableKey) {
    showLogin("A conexão com o Supabase ainda não foi configurada.");
    return;
  }

  let savedSession = null;
  try {
    savedSession = JSON.parse(localStorage.getItem(authStorageKey) || "null");
  } catch {
    localStorage.removeItem(authStorageKey);
  }

  if (!savedSession) {
    showLogin();
    return;
  }

  try {
    const authenticated = await validateSession(savedSession);
    if (authenticated) showApplication(authenticated.user, authenticated.session);
    else showLogin();
  } catch {
    showLogin("Sua sessão expirou. Entre novamente.");
  }
}

async function signIn(email, password) {
  return supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

async function signUp(displayName, email, password) {
  return supabaseRequest("/auth/v1/signup", {
    method: "POST",
    body: {
      email,
      password,
      data: { display_name: displayName },
    },
  });
}

function emptyUserState() {
  return {
    assets: [],
    recurrenceEvents: [],
    ambientes: [],
    sistemas: [],
    rotinas: [],
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setDataMessage(id, message = "", type = "error") {
  const element = document.querySelector(`#${id}`);
  element.textContent = message;
  element.classList.toggle("success", type === "success");
}

async function loadBuildingData() {
  if (!currentSession?.access_token) return;
  setDataMessage("buildings-message", "Carregando edificações...", "success");
  try {
    const token = currentSession.access_token;
    const [buildings, buildingTypes, locations, systems] = await Promise.all([
      supabaseRequest("/rest/v1/buildings?select=*&order=name.asc", { token }),
      supabaseRequest("/rest/v1/building_types?select=*&order=name.asc", { token }),
      supabaseRequest("/rest/v1/locations?select=*&order=sort_order.asc,name.asc", { token }),
      supabaseRequest("/rest/v1/systems?select=*&order=name.asc", { token }),
    ]);
    buildingData = { buildings, buildingTypes, locations, systems, loaded: true };
    setDataMessage("buildings-message");
    renderBuildings();
    renderSystemsView();
    populateBuildingTypeOptions();
    await loadOperationalData();
  } catch (error) {
    console.error("Falha ao carregar dados do Supabase:", error);
    setDataMessage("buildings-message", "Não foi possível carregar as edificações do Supabase.");
    setDataMessage("systems-message", "Não foi possível carregar os sistemas.");
  }
}

function mapDatabaseAsset(asset, plansByAsset) {
  const location = buildingData.locations.find((item) => item.id === asset.location_id);
  const system = buildingData.systems.find((item) => item.id === asset.system_id);
  const plan = plansByAsset.get(asset.id);
  const gallery = Array.isArray(asset.properties?.galeria)
    ? asset.properties.galeria
    : (asset.photo_path ? [{ url: asset.photo_path, legenda: "" }] : []);
  const proximaManutencao = asset.next_maintenance_date || nextDate(
    asset.last_maintenance_date || asset.installation_date || "",
    Number(asset.periodicity_months || 0),
  );
  return {
    id: asset.external_code,
    dbId: asset.id,
    planDbId: plan?.id || "",
    tipoManutencao: plan?.maintenance_type || "preventiva",
    planoAtivo: plan?.active !== false,
    planoDataInicio: plan?.start_date || "",
    technicalBuildingId: asset.building_id,
    buildingId: asset.properties?.building_assignment_pending === false ? asset.building_id : "",
    buildingAssignmentPending: asset.properties?.building_assignment_pending !== false,
    dbProperties: asset.properties || {},
    locationId: asset.location_id || "",
    systemId: asset.system_id || "",
    ambiente: location?.name || "",
    zona: location?.properties?.zone || "",
    sistema: system?.name || "",
    subsistema: asset.subsystem || "",
    ativo: asset.name,
    componente: asset.component || "",
    acao: asset.planned_action || plansByAsset.get(asset.id)?.name || "",
    quantidade: Number(asset.quantity || 0),
    unidade: asset.unit || "",
    periodicidadeMeses: Number(asset.periodicity_months || 0),
    ultimaManutencao: asset.last_maintenance_date || "",
    proximaManutencao,
    custoUnitario: Number(asset.estimated_unit_cost || 0),
    custoTotal: Number(asset.estimated_total_cost || 0),
    dataInstalacao: asset.installation_date || "",
    expectativaVidaAnos: Number(asset.expected_life_years || 0),
    valorAtivo: Number(asset.acquisition_value || 0),
    fimVida: asset.end_of_life_action || "encerrar",
    totalCiclos: Number(asset.total_cycles || 1),
    prioridade: asset.priority || "",
    estado: asset.condition || "",
    status: asset.status || "",
    responsavel: asset.responsible || "",
    observacoes: asset.notes || "",
    foto: gallery[0]?.url || asset.photo_path || "",
    galeria: gallery,
  };
}

function mapDatabaseEvent(event, externalCodeByAsset) {
  return {
    dbId: event.id,
    planDbId: event.plan_id || "",
    externalEventKey: event.external_event_key,
    assetId: externalCodeByAsset.get(event.asset_id) || "",
    technicalBuildingId: event.building_id,
    data: event.scheduled_date,
    dataExecucao: event.execution_date || "",
    sistema: event.properties?.system || "",
    ambiente: event.properties?.environment || "",
    ativo: event.properties?.asset_name || "",
    acao: event.properties?.action || "",
    responsavel: event.properties?.responsible || "",
    custo: Number(event.estimated_cost || 0),
    custoReal: event.actual_cost === null ? null : Number(event.actual_cost),
    status: event.status || "programado",
    prioridade: event.properties?.priority || "",
    tipo: event.event_type === "substituicao" ? "Substitui\u00e7\u00e3o" : "Manuten\u00e7\u00e3o",
    tipoManutencao: event.properties?.maintenance_type || "preventiva",
    periodicidadeMeses: Number(event.properties?.recurrence_months || 0),
    manualEntry: event.properties?.manual_entry === true,
    recurrenceGroup: event.properties?.recurrence_group || "",
    alarmeAntecedenciaDias: Number(event.properties?.alarm_lead_days || 7),
    alarmeNoDia: event.properties?.alarm_on_due_date !== false,
    alarmeCanais: Array.isArray(event.properties?.alarm_channels) ? event.properties.alarm_channels : ["email"],
    alarmeEmail: event.properties?.alarm_email || "",
    alarmeTelefone: event.properties?.alarm_phone || "",
    descricao: event.notes || "",
    galeria: Array.isArray(event.properties?.galeria) ? event.properties.galeria : [],
    ciclo: Number(event.cycle_number || 1),
    provisionStart: event.provision_start_date || "",
    realizada: event.completed === null ? undefined : event.completed,
  };
}

async function loadOperationalData() {
  if (!currentSession?.access_token || !buildingData.buildings.length) {
    state = { ...emptyUserState(), settings: state.settings };
    render();
    return;
  }

  const token = currentSession.access_token;
  const [assetTypes, templates, assets, plans, events] = await Promise.all([
    supabaseRequest("/rest/v1/asset_types?select=*&order=name.asc", { token }),
    supabaseRequest("/rest/v1/maintenance_templates?select=*&order=name.asc", { token }),
    supabaseRequest("/rest/v1/assets?select=*&order=name.asc", { token }),
    supabaseRequest("/rest/v1/maintenance_plans?select=*", { token }),
    supabaseRequest("/rest/v1/maintenance_events?select=*&order=scheduled_date.asc", { token }),
  ]);
  const plansByAsset = new Map(plans.map((plan) => [plan.asset_id, plan]));
  const externalCodeByAsset = new Map(assets.map((asset) => [asset.id, asset.external_code]));
  const buildingLocations = buildingData.locations;
  const buildingSystems = buildingData.systems;

  state.assets = assets.map((asset) => mapDatabaseAsset(asset, plansByAsset));
  const uiAssetByCode = new Map(state.assets.map((asset) => [asset.id, asset]));
  state.recurrenceEvents = events
    .map((event) => mapDatabaseEvent(event, externalCodeByAsset))
    .filter((event) => event.assetId)
    .map((event) => {
      const asset = uiAssetByCode.get(event.assetId);
      return {
        ...event,
        buildingId: asset?.buildingId || "",
        buildingAssignmentPending: asset?.buildingAssignmentPending !== false,
        ativo: event.ativo || asset?.ativo || "",
        sistema: event.sistema || asset?.sistema || "",
        ambiente: event.ambiente || asset?.ambiente || "",
        acao: event.acao || asset?.acao || "",
      };
    });
  state.ambientes = buildingLocations
    .filter((location) => location.location_type === "ambiente")
    .map((location) => ({
      codigo: location.properties?.code || "",
      ambiente: location.name,
      zona: location.properties?.zone || "",
    }));
  state.sistemas = buildingSystems.flatMap((system) => {
    const subsystems = system.properties?.subsystems || [""];
    return subsystems.length
      ? subsystems.map((subsystem) => ({
          codigo: system.properties?.codes?.[0] || "",
          sistema: system.name,
          subsistema: subsystem,
        }))
      : [{ codigo: "", sistema: system.name, subsistema: "" }];
  });
  state.rotinas = templates.map((template) => ({
    sistema: template.system_name || "",
    ativo: assetTypes.find((type) => type.id === template.asset_type_id)?.name || "",
    componente: template.component || "",
    acao: template.name,
    periodicidadeMeses: Number(template.periodicity_months || 0),
    custoReferencia: Number(template.reference_cost || 0),
    responsavel: template.responsible || "",
  }));
  initializeReportBuildingSelections();
  renderReportBuildingFilters();
  saveState();
  render();
}

function buildingName(buildingId) {
  return buildingData.buildings.find((building) => building.id === buildingId)?.name || "Edificação não encontrada";
}

function buildingHorizonYears(buildingId) {
  const building = buildingData.buildings.find((item) => item.id === buildingId);
  return Math.max(1, Number(building?.properties?.planning_horizon_years || 50));
}

function buildingAssignedAssets(buildingId) {
  return state.assets.filter(
    (asset) => !asset.buildingAssignmentPending && asset.buildingId === buildingId,
  );
}

function buildingTimeStart(buildingId) {
  const installationDates = buildingAssignedAssets(buildingId)
    .map((asset) => safeDate(asset.dataInstalacao))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const building = buildingData.buildings.find((item) => item.id === buildingId);
  return installationDates[0] ||
    safeDate(building?.properties?.supervision_start) ||
    new Date();
}

function buildingSupervisionStart(buildingId) {
  const building = buildingData.buildings.find((item) => item.id === buildingId);
  return safeDate(building?.properties?.supervision_start) || buildingTimeStart(buildingId);
}

function buildingTimeEnd(buildingId) {
  return addYears(buildingTimeStart(buildingId), buildingHorizonYears(buildingId));
}

function selectedReportBuildingIds(report) {
  return buildingData.buildings
    .map((building) => building.id)
    .filter((buildingId) => reportBuildingSelections[report]?.has(buildingId));
}

function reportTimeBounds(report) {
  const buildingIds = selectedReportBuildingIds(report);
  if (!buildingIds.length) {
    const eventDates = reportEvents(report).map((event) => safeDate(event.data)).filter(Boolean).sort((a, b) => a - b);
    const start = eventDates[0] || new Date();
    const end = eventDates[eventDates.length - 1] || addYears(start, 50);
    return { start, end, supervisionStart: start };
  }

  const starts = buildingIds.map(buildingTimeStart).sort((a, b) => a - b);
  const ends = buildingIds.map(buildingTimeEnd).sort((a, b) => a - b);
  const supervisionStarts = buildingIds.map(buildingSupervisionStart).sort((a, b) => a - b);
  return {
    start: starts[0],
    end: ends[ends.length - 1],
    supervisionStart: supervisionStarts[0],
  };
}

function reportHorizonDescription(report) {
  const buildingIds = selectedReportBuildingIds(report);
  if (!buildingIds.length) return "Nenhuma edificação selecionada";
  return buildingIds.map((buildingId) =>
    `${buildingName(buildingId)}: ${buildingHorizonYears(buildingId)} anos`
  ).join(" · ");
}

function initializeReportBuildingSelections() {
  const available = [...buildingData.buildings.map((building) => building.id), pendingBuildingKey];
  Object.values(reportBuildingSelections).forEach((selection) => {
    if (!selection.size) available.forEach((key) => selection.add(key));
    [...selection].forEach((key) => {
      if (!available.includes(key)) selection.delete(key);
    });
  });
}

function reportIncludesAsset(asset, report) {
  const key = asset.buildingAssignmentPending ? pendingBuildingKey : asset.buildingId;
  return reportBuildingSelections[report]?.has(key);
}

function reportAssets(report) {
  return state.assets.filter((asset) => reportIncludesAsset(asset, report));
}

function reportEvents(report) {
  const allowedAssetIds = new Set(reportAssets(report).map((asset) => asset.id));
  return state.recurrenceEvents.filter((event) => {
    if (!allowedAssetIds.has(event.assetId)) return false;
    const asset = state.assets.find((item) => item.id === event.assetId);
    const date = safeDate(event.data);
    if (!asset?.buildingId || !date) return true;
    return date >= buildingTimeStart(asset.buildingId) && date <= buildingTimeEnd(asset.buildingId);
  });
}

function renderReportBuildingFilters() {
  ["assets", "dashboard", "timeline", "finance"].forEach((report) => {
    const container = document.querySelector(`#${report}-building-filter`);
    if (!container) return;
    const options = [
      ...buildingData.buildings.map((building) => ({ key: building.id, label: building.name })),
      { key: pendingBuildingKey, label: "Pendentes" },
    ];
    container.innerHTML = options.map((option) => `<label class="building-check">
      <input type="checkbox" value="${option.key}" ${reportBuildingSelections[report].has(option.key) ? "checked" : ""} />
      ${escapeHtml(option.label)}
    </label>`).join("");
    const selectedLabels = options.filter((option) => reportBuildingSelections[report].has(option.key)).map((option) => option.label);
    document.querySelector(`#${report}-building-summary`).textContent =
      selectedLabels.length === options.length ? "Todas" : selectedLabels.join(", ") || "Nenhuma selecionada";
  });
}

function buildingTypeName(typeId) {
  return buildingData.buildingTypes.find((type) => type.id === typeId)?.name || "Tipo não informado";
}

function locationTypeLabel(type) {
  return {
    bloco: "Bloco",
    pavimento: "Pavimento",
    unidade: "Unidade",
    ambiente: "Ambiente",
    area_comum: "Área comum",
    area_tecnica: "Área técnica",
    area_externa: "Área externa",
  }[type] || type || "Ambiente";
}

function locationTreeHtml(buildingId, parentId = null) {
  const children = buildingData.locations
    .filter((location) => location.building_id === buildingId && location.parent_id === parentId)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.name.localeCompare(b.name, "pt-BR"));
  if (!children.length) return "";
  return `<ul class="location-tree">${children.map((location) => `<li class="location-node">
    <div class="location-item">
      <strong>${escapeHtml(location.name)}</strong>
      <span class="location-type">${escapeHtml(locationTypeLabel(location.location_type))}</span>
      <button class="location-edit-button edit-location" data-location-id="${location.id}" type="button">Editar</button>
    </div>
    ${locationTreeHtml(buildingId, location.id)}
  </li>`).join("")}</ul>`;
}

function renderBuildings() {
  const container = document.querySelector("#buildings-list");
  if (!buildingData.loaded) {
    container.innerHTML = `<div class="empty-state">Carregando...</div>`;
    return;
  }
  if (!buildingData.buildings.length) {
    container.innerHTML = `<div class="empty-state empty-state-large">
      <strong>Nenhuma edificação cadastrada</strong>
      <span>Crie a primeira edificação e depois monte sua árvore de ambientes.</span>
    </div>`;
    return;
  }
  container.innerHTML = buildingData.buildings.map((building) => {
    const locations = buildingData.locations.filter((location) => location.building_id === building.id);
    const systems = buildingData.systems.filter((system) => system.building_id === building.id);
    const timeStart = buildingTimeStart(building.id);
    const timeEnd = buildingTimeEnd(building.id);
    const supervisionStart = buildingSupervisionStart(building.id);
    return `<details class="building-card" data-building-id="${building.id}" ${openBuildingIds.has(building.id) ? "open" : ""}>
      <summary class="building-summary">
        <button class="building-toggle" data-building-id="${building.id}" type="button" aria-label="${openBuildingIds.has(building.id) ? "Fechar" : "Abrir"} árvore">${openBuildingIds.has(building.id) ? "−" : "+"}</button>
        <div class="building-title" data-building-id="${building.id}" role="button" tabindex="0">
          <h3>${escapeHtml(building.name)}</h3>
          <p>${escapeHtml(buildingTypeName(building.building_type_id))}</p>
          ${building.properties?.address ? `<p class="building-address">${escapeHtml(building.properties.address)}</p>` : ""}
          <p class="building-time-summary">Tempo: ${formatDate(timeStart)} a ${formatDate(timeEnd)} · Supervisão: ${formatDate(supervisionStart)} · ${buildingHorizonYears(building.id)} anos</p>
        </div>
        <span class="building-code">${escapeHtml(building.reference_code)}</span>
        <span>${locations.length} ambientes · ${systems.length} sistemas</span>
        <button class="ghost-button edit-building" data-building-id="${building.id}" type="button">Editar</button>
      </summary>
      <div class="building-body">
        <div class="building-body-header">
          <div><strong>Ambientes e subambientes</strong></div>
          <button class="ghost-button add-location" data-building-id="${building.id}" type="button">Adicionar ambiente</button>
        </div>
        ${locationTreeHtml(building.id) || `<div class="empty-state">A árvore ainda está vazia.</div>`}
      </div>
    </details>`;
  }).join("");
}

function populateBuildingTypeOptions() {
  const select = document.querySelector("#building-type");
  select.innerHTML = buildingData.buildingTypes
    .map((type) => `<option value="${type.id}">${escapeHtml(type.name)}</option>`)
    .join("");
}

function populateLocationParentOptions(buildingId) {
  populateLocationParentOptionsForEdit(buildingId);
}

function locationDescendantIds(locationId) {
  const descendants = new Set();
  const visit = (parentId) => {
    buildingData.locations
      .filter((location) => location.parent_id === parentId)
      .forEach((location) => {
        descendants.add(location.id);
        visit(location.id);
      });
  };
  visit(locationId);
  return descendants;
}

function populateLocationParentOptionsForEdit(buildingId, locationId = "", selectedParentId = "") {
  const select = document.querySelector("#location-parent");
  const excludedIds = locationId ? locationDescendantIds(locationId) : new Set();
  if (locationId) excludedIds.add(locationId);
  const locations = buildingData.locations.filter(
    (location) => location.building_id === buildingId && !excludedIds.has(location.id),
  );
  select.innerHTML = `<option value="">Na raiz da edificação</option>${locations
    .map((location) => `<option value="${location.id}">${escapeHtml(location.name)} · ${escapeHtml(locationTypeLabel(location.location_type))}</option>`)
    .join("")}`;
  select.value = selectedParentId || "";
}

function selectedSystemsBuildingId() {
  return document.querySelector("#systems-building-filter").value;
}

function renderSystemsView() {
  const filter = document.querySelector("#systems-building-filter");
  const previous = filter.value;
  filter.innerHTML = buildingData.buildings.length
    ? buildingData.buildings.map((building) => `<option value="${building.id}">${escapeHtml(building.name)}</option>`).join("")
    : `<option value="">Nenhuma edificação</option>`;
  filter.value = buildingData.buildings.some((building) => building.id === previous)
    ? previous
    : buildingData.buildings[0]?.id || "";

  const buildingId = selectedSystemsBuildingId();
  const registered = buildingData.systems.filter((system) => system.building_id === buildingId);
  const registeredKeys = new Set(registered.map((system) => system.properties?.catalog_key).filter(Boolean));
  document.querySelector("#standards-catalog").innerHTML = normativeSystems.map((system) => {
    const added = registeredKeys.has(system.key);
    return `<article class="standard-card ${added ? "is-added" : ""}">
      <div>
        <span class="standard-reference">${escapeHtml(system.standard)} · ${escapeHtml(system.group)}</span>
        <h3>${escapeHtml(system.name)}</h3>
        <p>${escapeHtml(system.description)}</p>
      </div>
      <button class="${added ? "ghost-button" : "primary-button"} add-standard-system" data-system-key="${system.key}" type="button" ${added || !buildingId ? "disabled" : ""}>${added ? "Adicionado" : "Adicionar"}</button>
    </article>`;
  }).join("");

  document.querySelector("#building-systems-list").innerHTML = registered.length
    ? registered.map((system) => `<article class="registered-system">
      <div>
        <span class="standard-reference">${escapeHtml(system.properties?.standard || "Sistema personalizado")}</span>
        <h3>${escapeHtml(system.name)}</h3>
        <p>${escapeHtml(system.description || "Sem descrição.")}</p>
      </div>
      <button class="danger-button delete-building-system" data-system-id="${system.id}" type="button">Excluir</button>
    </article>`).join("")
    : `<div class="empty-state">Nenhum sistema cadastrado nesta edificação.</div>`;
}

async function saveBuildingRecord() {
  const buildingId = document.querySelector("#building-id").value;
  const name = document.querySelector("#building-name").value.trim();
  const referenceCode = document.querySelector("#building-code").value.trim();
  const buildingTypeId = document.querySelector("#building-type").value;
  const address = document.querySelector("#building-address").value.trim();
  const supervisionStart = document.querySelector("#building-supervision-start").value;
  const planningHorizonYears = Math.max(1, Number(document.querySelector("#building-planning-horizon").value || 50));
  if (!name || !referenceCode || !buildingTypeId) return;
  try {
    await supabaseRequest(buildingId
      ? `/rest/v1/buildings?id=eq.${encodeURIComponent(buildingId)}`
      : "/rest/v1/buildings", {
      method: buildingId ? "PATCH" : "POST",
      token: currentSession.access_token,
      headers: { Prefer: "return=representation" },
      body: {
        ...(buildingId ? {} : { owner_id: currentUserId }),
        building_type_id: buildingTypeId,
        name,
        reference_code: referenceCode,
        properties: {
          ...(buildingData.buildings.find((building) => building.id === buildingId)?.properties || {}),
          address,
          supervision_start: supervisionStart || null,
          planning_horizon_years: planningHorizonYears,
        },
      },
    });
    document.querySelector("#building-dialog").close();
    document.querySelector("#building-form").reset();
    if (buildingId) openBuildingIds.add(buildingId);
    setDataMessage("buildings-message", buildingId ? "Edificação atualizada." : "Edificação criada.", "success");
    await loadBuildingData();
  } catch (error) {
    setDataMessage("buildings-message", error.status === 409 ? "Esta identificação já está em uso." : "Não foi possível salvar a edificação.");
  }
}

async function saveLocationRecord() {
  const locationId = document.querySelector("#location-id").value;
  const buildingId = document.querySelector("#location-building-id").value;
  const name = document.querySelector("#location-name").value.trim();
  if (!buildingId || !name) return;
  try {
    const siblings = buildingData.locations.filter((location) =>
      location.building_id === buildingId &&
      (location.parent_id || "") === document.querySelector("#location-parent").value
    );
    await supabaseRequest(locationId
      ? `/rest/v1/locations?id=eq.${encodeURIComponent(locationId)}`
      : "/rest/v1/locations", {
      method: locationId ? "PATCH" : "POST",
      token: currentSession.access_token,
      headers: { Prefer: "return=representation" },
      body: {
        ...(locationId ? {} : { building_id: buildingId }),
        parent_id: document.querySelector("#location-parent").value || null,
        name,
        location_type: document.querySelector("#location-type").value,
        ...(locationId ? {} : { sort_order: (siblings.length + 1) * 10 }),
      },
    });
    openBuildingIds.add(buildingId);
    document.querySelector("#location-dialog").close();
    document.querySelector("#location-form").reset();
    setDataMessage("buildings-message", locationId ? "Ambiente atualizado." : "Ambiente adicionado.", "success");
    await loadBuildingData();
  } catch {
    setDataMessage("buildings-message", "Não foi possível salvar o ambiente. Verifique se já existe outro com o mesmo nome nesse nível.");
  }
}

function openBuildingDialog(building = null) {
  document.querySelector("#building-form").reset();
  document.querySelector("#building-id").value = building?.id || "";
  document.querySelector("#building-dialog-eyebrow").textContent = building ? "Editar estrutura" : "Nova estrutura";
  document.querySelector("#building-dialog-title").textContent = building ? "Editar edificação" : "Criar edificação";
  document.querySelector("#save-building").textContent = building ? "Salvar alterações" : "Criar edificação";
  populateBuildingTypeOptions();
  document.querySelector("#building-name").value = building?.name || "";
  document.querySelector("#building-code").value = building?.reference_code || "";
  document.querySelector("#building-address").value = building?.properties?.address || "";
  document.querySelector("#building-supervision-start").value = dateInputValue(building?.properties?.supervision_start || "");
  document.querySelector("#building-planning-horizon").value = buildingHorizonYears(building?.id);
  if (building?.building_type_id) document.querySelector("#building-type").value = building.building_type_id;
  document.querySelector("#building-dialog").showModal();
}

function openLocationDialog(buildingId, location = null) {
  document.querySelector("#location-form").reset();
  document.querySelector("#location-id").value = location?.id || "";
  document.querySelector("#location-building-id").value = buildingId;
  document.querySelector("#location-dialog-title").textContent = location ? "Editar ambiente" : "Novo ambiente";
  document.querySelector("#save-location").textContent = location ? "Salvar alterações" : "Adicionar";
  document.querySelector("#location-name").value = location?.name || "";
  document.querySelector("#location-type").value = location?.location_type || "ambiente";
  populateLocationParentOptionsForEdit(buildingId, location?.id || "", location?.parent_id || "");
  openBuildingIds.add(buildingId);
  document.querySelector("#location-dialog").showModal();
}

function toggleBuilding(buildingId) {
  if (openBuildingIds.has(buildingId)) openBuildingIds.delete(buildingId);
  else openBuildingIds.add(buildingId);
  renderBuildings();
}

async function createNormativeSystem(systemKey) {
  const buildingId = selectedSystemsBuildingId();
  const catalogSystem = normativeSystems.find((system) => system.key === systemKey);
  if (!buildingId || !catalogSystem) return;
  try {
    await supabaseRequest("/rest/v1/systems", {
      method: "POST",
      token: currentSession.access_token,
      headers: { Prefer: "return=representation" },
      body: {
        building_id: buildingId,
        name: catalogSystem.name,
        description: catalogSystem.description,
        properties: {
          catalog_key: catalogSystem.key,
          standard: catalogSystem.standard,
          standard_group: catalogSystem.group,
        },
      },
    });
    setDataMessage("systems-message", "Sistema adicionado.", "success");
    await loadBuildingData();
  } catch {
    setDataMessage("systems-message", "Não foi possível adicionar o sistema. Ele pode já estar cadastrado.");
  }
}

async function createCustomSystem() {
  const buildingId = selectedSystemsBuildingId();
  const name = document.querySelector("#custom-system-name").value.trim();
  if (!buildingId || !name) return;
  try {
    await supabaseRequest("/rest/v1/systems", {
      method: "POST",
      token: currentSession.access_token,
      headers: { Prefer: "return=representation" },
      body: {
        building_id: buildingId,
        name,
        description: document.querySelector("#custom-system-description").value.trim(),
        properties: {
          standard: document.querySelector("#custom-system-standard").value.trim(),
          custom: true,
        },
      },
    });
    document.querySelector("#system-dialog").close();
    document.querySelector("#system-form").reset();
    setDataMessage("systems-message", "Sistema personalizado adicionado.", "success");
    await loadBuildingData();
  } catch {
    setDataMessage("systems-message", "Não foi possível adicionar o sistema.");
  }
}

async function deleteBuildingSystem(systemId) {
  if (!window.confirm("Excluir este sistema da edificação?")) return;
  try {
    await supabaseRequest(`/rest/v1/systems?id=eq.${encodeURIComponent(systemId)}`, {
      method: "DELETE",
      token: currentSession.access_token,
    });
    setDataMessage("systems-message", "Sistema excluído.", "success");
    await loadBuildingData();
  } catch {
    setDataMessage("systems-message", "Não foi possível excluir o sistema.");
  }
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  let localData = {};
  try {
    localData = saved ? JSON.parse(saved) : {};
  } catch {
    localData = {};
  }
  const data = emptyUserState();
  const savedHorizon = Number(localData.settings?.planningHorizonYears || 0);
  data.settings = {
    ...(localData.settings || {}),
    planningHorizonYears: !savedHorizon || savedHorizon === 20 ? 50 : savedHorizon,
  };
  return data;
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify({ settings: state.settings }));
}

function byDate(a, b) {
  return safeDate(a.data || a.proximaManutencao) - safeDate(b.data || b.proximaManutencao);
}

function safeDate(dateValue) {
  if (!dateValue) return null;
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === "number") return new Date(Date.UTC(1899, 11, 30) + dateValue * 86400000);
  const normalized = String(dateValue).includes("T") ? String(dateValue) : `${dateValue}T00:00:00`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(dateValue) {
  const date = safeDate(dateValue);
  return date ? dateFmt.format(date) : "Sem data";
}

function parseCurrencyInput(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/[^\d.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrencyInput(value) {
  const number = typeof value === "number" ? value : parseCurrencyInput(value);
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusFor(dateValue) {
  if (!dateValue) return "Sem data";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = safeDate(dateValue);
  if (!date) return "Sem data";
  const diffDays = Math.ceil((date - today) / 86400000);
  if (diffDays < 0) return "Vencido";
  if (diffDays <= 30) return "Próx. 30 dias";
  if (diffDays <= 90) return "Próx. 90 dias";
  return "Programado";
}

function nextDate(baseDate, months) {
  if (!baseDate || !months) return "";
  const date = new Date(`${baseDate}T00:00:00`);
  date.setMonth(date.getMonth() + Number(months));
  return date.toISOString().slice(0, 10);
}

function dateInputValue(dateValue) {
  if (!dateValue) return "";
  if (typeof dateValue === "string" && dateValue.includes("T")) return dateValue.slice(0, 10);
  if (typeof dateValue === "string") return dateValue;
  const date = safeDate(dateValue);
  return date ? date.toISOString().slice(0, 10) : "";
}

function addYears(date, years) {
  const copy = new Date(date);
  copy.setFullYear(copy.getFullYear() + Number(years || 0));
  return copy;
}

function maintenanceDatesUntil({ installationDate, lifeYears, periodicityMonths }) {
  const start = safeDate(installationDate);
  if (!start || !lifeYears || !periodicityMonths) return [];
  const end = addYears(start, lifeYears);
  const dates = [];
  let cursor = new Date(start);
  cursor.setMonth(cursor.getMonth() + Number(periodicityMonths));
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor);
    cursor.setMonth(cursor.getMonth() + Number(periodicityMonths));
  }
  return dates;
}

function getLifeEndMode() {
  return document.querySelector('input[name="asset-fim-vida"]:checked')?.value || "renovar";
}

function planningHorizonYears(buildingId = "") {
  if (buildingId) return buildingHorizonYears(buildingId);
  const selected = selectedReportBuildingIds("timeline");
  return selected.length ? Math.max(...selected.map(buildingHorizonYears)) : 50;
}

function maxCyclesForLife(lifeYears, buildingId = "") {
  const life = Number(lifeYears || 0);
  return life > 0 ? Math.max(1, Math.floor(planningHorizonYears(buildingId) / life)) : null;
}

function clampCycles(totalCycles, lifeYears, buildingId = "") {
  const requested = Math.max(1, Number(totalCycles || 1));
  const maximum = maxCyclesForLife(lifeYears, buildingId);
  return maximum ? Math.min(requested, maximum) : requested;
}

function groupSum(items, key, valueKey) {
  return items.reduce((acc, item) => {
    const label = item[key] || "Não informado";
    acc[label] = (acc[label] || 0) + Number(item[valueKey] || 0);
    return acc;
  }, {});
}

function planningWindowEvents(report = "dashboard") {
  return reportEvents(report).filter((event) => {
    const date = safeDate(event.data);
    const asset = state.assets.find((item) => item.id === event.assetId);
    if (!date || !asset?.buildingId) return false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return date >= start && date <= buildingTimeEnd(asset.buildingId);
  });
}

function plannedExecutionCost() {
  return planningWindowEvents("dashboard").reduce((sum, event) => sum + Number(event.custo || 0), 0);
}

function selectedMonthlyProvision() {
  const selectedMonth = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const { provision } = financeSeries("dashboard");
  const value = Number(provision[monthKey(selectedMonth)] || 0);
  const provisionKeys = Object.keys(provision).sort();
  const lastProvisionKey = provisionKeys[provisionKeys.length - 1];
  const lastProvisionMonth = lastProvisionKey
    ? new Date(Number(lastProvisionKey.slice(0, 4)), Number(lastProvisionKey.slice(5, 7)) - 1, 1)
    : selectedMonth;
  const searchLimit = Math.max(1, monthDistance(selectedMonth, lastProvisionMonth) + 2);
  let changeDate = null;
  let nextValue = null;

  for (let offset = 1; offset <= searchLimit; offset += 1) {
    const candidate = addMonths(selectedMonth, offset);
    const candidateValue = Number(provision[monthKey(candidate)] || 0);
    if (Math.abs(candidateValue - value) > 0.005) {
      changeDate = candidate;
      nextValue = candidateValue;
      break;
    }
  }

  return { value, changeDate, nextValue };
}

function eventsByYear(report = "timeline") {
  return reportEvents(report).reduce((acc, event) => {
    const year = event.data?.slice(0, 4);
    if (!year) return acc;
    acc[year] = (acc[year] || 0) + Number(event.custo || 0);
    return acc;
  }, {});
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return monthFmt.format(new Date(year, month - 1, 1)).replace(".", "");
}

function addMonths(date, months) {
  const copy = new Date(date.getFullYear(), date.getMonth(), 1);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function monthDistance(start, end) {
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
}

function financeSeries(report = "dashboard") {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const execution = {};
  const provision = {};
  const executionEvents = {};

  reportEvents(report).forEach((event) => {
    const executionDate = safeDate(event.data);
    const cost = Number(event.custo || 0);
    if (!executionDate || !cost) return;

    const executionMonth = new Date(executionDate.getFullYear(), executionDate.getMonth(), 1);
    const executionKey = monthKey(executionMonth);
    execution[executionKey] = (execution[executionKey] || 0) + cost;
    if (!executionEvents[executionKey]) executionEvents[executionKey] = [];
    executionEvents[executionKey].push({ ...event, custo: cost });

    const provisionStart = safeDate(event.provisionStart) || start;
    const provisionStartMonth = new Date(provisionStart.getFullYear(), provisionStart.getMonth(), 1);
    const monthsUntilExecution = monthDistance(provisionStartMonth, executionMonth);
    if (monthsUntilExecution <= 0) return;
    const monthlyShare = cost / monthsUntilExecution;
    for (let i = 0; i < monthsUntilExecution; i += 1) {
      const key = monthKey(addMonths(provisionStartMonth, i));
      provision[key] = (provision[key] || 0) + monthlyShare;
    }
  });

  return { execution, provision, executionEvents };
}

function yearsFromSeries(...series) {
  return [
    ...new Set(
      series.flatMap((item) =>
        Object.keys(item)
          .map((key) => key.slice(0, 4))
          .filter(Boolean),
      ),
    ),
  ].sort();
}

function render() {
  renderKpis();
  renderSystemBars();
  renderNextEvents();
  renderCalendar();
  renderFilters();
  renderAssets();
  renderTimeline();
  renderTimelineCalendar();
  renderFinance();
}

function compactMoney(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `R$ ${(number / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (number >= 1000) return `R$ ${(number / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return money.format(number);
}

function renderDashboardChart() {
  const { execution, provision } = financeSeries("dashboard");
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(calendarCursor, index - 1);
    const key = monthKey(date);
    return {
      key,
      date,
      label: monthFmt.format(date).replace(".", ""),
      year: date.getFullYear(),
      execution: Number(execution[key] || 0),
      provision: Number(provision[key] || 0),
    };
  });
  const maximum = Math.max(...Object.values(execution), ...Object.values(provision), 1);
  const width = 640;
  const height = 225;
  const margin = { top: 18, right: 14, bottom: 34, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const groupWidth = plotWidth / months.length;
  const barWidth = Math.min(12, groupWidth * 0.28);
  const y = (value) => margin.top + plotHeight - (value / maximum) * plotHeight;
  const ticks = Array.from({ length: 4 }, (_, index) => maximum * (index / 3));
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const rangeLabel = `${firstMonth.label} ${firstMonth.year} – ${lastMonth.label} ${lastMonth.year}`;

  document.querySelector("#dashboard-chart-title").textContent = `Meses x valores · ${rangeLabel}`;
  document.querySelector("#dashboard-monthly-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Provisionamento mensal e gastos entre ${rangeLabel}">
    ${months
      .map((item, index) =>
        index === 1
          ? `<rect class="chart-selected-month" x="${margin.left + index * groupWidth}" y="${margin.top}" width="${groupWidth}" height="${plotHeight}" rx="4" />`
          : "",
      )
      .join("")}
    ${ticks
      .map((value) => {
        const tickY = y(value);
        return `<line class="chart-grid-line" x1="${margin.left}" y1="${tickY}" x2="${width - margin.right}" y2="${tickY}" />
          <text class="chart-axis-value" x="${margin.left - 7}" y="${tickY + 3}" text-anchor="end">${compactMoney(value)}</text>`;
      })
      .join("")}
    ${months
      .map((item, index) => {
        const center = margin.left + index * groupWidth + groupWidth / 2;
        const provisionHeight = (item.provision / maximum) * plotHeight;
        const executionHeight = (item.execution / maximum) * plotHeight;
        return `<g class="chart-month">
          <rect class="chart-bar provision" x="${center - barWidth - 1}" y="${y(item.provision)}" width="${barWidth}" height="${provisionHeight}" rx="2">
            <title>${item.label} ${item.year} · Provisionamento: ${money.format(item.provision)}</title>
          </rect>
          <rect class="chart-bar execution" x="${center + 1}" y="${y(item.execution)}" width="${barWidth}" height="${executionHeight}" rx="2">
            <title>${item.label} ${item.year} · Gastos: ${money.format(item.execution)}</title>
          </rect>
          <text class="chart-month-label ${index === 1 ? "selected" : ""}" x="${center}" y="${height - 12}" text-anchor="middle">
            <tspan x="${center}">${item.label}</tspan>
            ${item.date.getMonth() === 0 || index === 0 ? `<tspan class="chart-month-year" x="${center}" dy="10">${item.year}</tspan>` : ""}
          </text>
        </g>`;
      })
      .join("")}
  </svg>`;
}

function calendarDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const calendarEventColors = {
  completed: "#2F7D69",
  missed: "#C4513D",
  futureMaintenance: "#E5A82E",
  futureReplacement: "#E87528",
};

function calendarEventCategory(event, dateKey, todayKey) {
  const eventStatus = String(event.status || "").toLocaleLowerCase("pt-BR");
  const explicitlyCompleted = ["conclu", "cumpr", "realiz", "execut"].some((status) => eventStatus.includes(status));
  const asset = state.assets.find((item) => item.id === event.assetId);
  const matchesLastMaintenance = asset?.ultimaManutencao && dateInputValue(asset.ultimaManutencao) === dateKey;
  const completed = event.realizada === true || (event.realizada === undefined && (explicitlyCompleted || matchesLastMaintenance));

  if (dateKey < todayKey) return completed ? "completed" : "missed";
  return String(event.tipo || "").startsWith("Substit") ? "futureReplacement" : "futureMaintenance";
}

function eventScheduleKey(event) {
  if (event.externalEventKey) return event.externalEventKey;
  const normalizedType = String(event.tipo || "").startsWith("Substit") ? "replacement" : "maintenance";
  return `${event.assetId || ""}|${dateInputValue(event.data)}|${normalizedType}|${event.ciclo || 1}`;
}

function isEventCompleted(event) {
  if (event.realizada !== undefined) return event.realizada === true;
  const status = String(event.status || "").toLocaleLowerCase("pt-BR");
  if (["conclu", "cumpr", "realiz", "execut"].some((item) => status.includes(item))) return true;
  const asset = state.assets.find((item) => item.id === event.assetId);
  return Boolean(asset?.ultimaManutencao && dateInputValue(asset.ultimaManutencao) === dateInputValue(event.data));
}

function calendarEventBackground(categories) {
  const colors = categories.map((category) => calendarEventColors[category]);
  if (colors.length === 1) return colors[0];
  const width = 100 / colors.length;
  const stops = colors.flatMap((color, index) => [`${color} ${index * width}%`, `${color} ${(index + 1) * width}%`]);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function calendarMonthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function calendarBounds(report = "dashboard") {
  const timeline = reportTimeBounds(report);
  const min = new Date(timeline.start.getFullYear(), timeline.start.getMonth(), 1);
  const max = new Date(timeline.end.getFullYear(), timeline.end.getMonth(), 1);
  const supervision = new Date(timeline.supervisionStart.getFullYear(), timeline.supervisionStart.getMonth(), 1);
  return {
    min,
    max,
    supervision,
    minIndex: calendarMonthIndex(min),
    maxIndex: calendarMonthIndex(max),
  };
}

function clampCalendarCursor() {
  const bounds = calendarBounds();
  const currentIndex = calendarMonthIndex(calendarCursor);
  if (currentIndex < bounds.minIndex) calendarCursor = new Date(bounds.min);
  if (currentIndex > bounds.maxIndex) calendarCursor = new Date(bounds.max);
  return bounds;
}

function calendarSliderLabel(date) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" }).format(date).replace(".", "");
}

function updateCalendarSlider(bounds) {
  const slider = document.querySelector("#calendar-slider");
  const offset = calendarMonthIndex(calendarCursor) - bounds.minIndex;
  slider.max = Math.max(0, bounds.maxIndex - bounds.minIndex);
  slider.value = Math.max(0, Math.min(Number(slider.max), offset));
  document.querySelector("#calendar-slider-min").textContent = calendarSliderLabel(bounds.min);
  document.querySelector("#calendar-slider-max").textContent = calendarSliderLabel(bounds.max);
  document.querySelector("#calendar-today-date").textContent = calendarSliderLabel(new Date());
  const today = new Date();
  const todayIndex = Math.max(bounds.minIndex, Math.min(bounds.maxIndex, calendarMonthIndex(today)));
  const supervisionIndex = Math.max(bounds.minIndex, Math.min(bounds.maxIndex, calendarMonthIndex(bounds.supervision)));
  const realStart = Number(slider.max) ? ((supervisionIndex - bounds.minIndex) / Number(slider.max)) * 100 : 0;
  const realProgress = Number(slider.max) ? ((todayIndex - bounds.minIndex) / Number(slider.max)) * 100 : 0;
  slider.style.setProperty("--real-start", `${realStart}%`);
  slider.style.setProperty("--real-progress", `${Math.max(realStart, realProgress)}%`);
}

function calendarFlowTarget(kind) {
  const selectedDay = document.querySelector(".calendar-day.is-selected")?.dataset.date;
  const monthStart = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const parsedSelectedDate = safeDate(selectedDay);
  const selectedDate =
    parsedSelectedDate && calendarMonthIndex(parsedSelectedDate) === calendarMonthIndex(monthStart) ? parsedSelectedDate : null;
  const forward = kind === "maintenance" || kind === "replacement";
  const reference = selectedDate || monthStart;
  const todayKey = calendarDateKey(new Date());

  return reportEvents("dashboard")
    .filter((event) => {
      const date = safeDate(event.data);
      if (!date) return false;
      if (forward) {
        const type = String(event.tipo || "").startsWith("Substit") ? "replacement" : "maintenance";
        return type === kind && (selectedDate ? date > reference : date >= reference);
      }
      const category = calendarEventCategory(event, calendarDateKey(date), todayKey);
      return category === kind && date < reference;
    })
    .sort((a, b) => {
      const difference = safeDate(a.data) - safeDate(b.data);
      return forward ? difference : -difference;
    })[0];
}

function navigateCalendarFlow(kind) {
  const target = calendarFlowTarget(kind);
  if (!target) return;
  const date = safeDate(target.data);
  calendarCursor = new Date(date.getFullYear(), date.getMonth(), 1);
  renderCalendar();
  renderKpis();
  const dateKey = calendarDateKey(date);
  const day = document.querySelector(`.calendar-month.current .calendar-day[data-date="${dateKey}"]`);
  const events = reportEvents("dashboard").filter((event) => dateInputValue(event.data) === dateKey);
  if (day && events.length) {
    showCalendarDay(day, events);
    renderCalendarFlowSummary(calendarDateKey(new Date()));
  }
}

function renderCalendarFlowSummary(todayKey) {
  const counts = { completed: 0, missed: 0 };
  const selectedMonthStart = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const scheduled = {
    maintenance: { passed: 0, future: 0 },
    replacement: { passed: 0, future: 0 },
  };

  reportEvents("dashboard").forEach((event) => {
    const date = safeDate(event.data);
    if (!date) return;
    const category = calendarEventCategory(event, calendarDateKey(date), todayKey);
    if (category === "completed" || category === "missed") counts[category] += 1;

    const type = String(event.tipo || "").startsWith("Substit") ? "replacement" : "maintenance";
    if (date < selectedMonthStart) scheduled[type].passed += 1;
    if (date >= selectedMonthStart) scheduled[type].future += 1;
  });

  const flowButton = (type, label) => {
    const item = scheduled[type];
    const total = item.passed + item.future;
    const progress = total ? (item.passed / total) * 100 : 0;
    return `<button class="flow-item ${type}" data-flow-kind="${type}" style="--flow-progress:${progress}%" type="button" ${calendarFlowTarget(type) ? "" : "disabled"}>
      <i class="flow-progress"></i>
      <strong>${item.passed}</strong><small>${label}</small><strong>${item.future}</strong>
    </button>`;
  };

  document.querySelector("#calendar-flow-summary").innerHTML = `
    <div class="calendar-flow past" aria-label="Resumo de a\u00e7\u00f5es passadas">
      <button class="flow-item completed" data-flow-kind="completed" type="button" ${calendarFlowTarget("completed") ? "" : "disabled"}><strong>${counts.completed}</strong><small>cumpridas</small></button>
      <button class="flow-item missed" data-flow-kind="missed" type="button" ${calendarFlowTarget("missed") ? "" : "disabled"}><strong>${counts.missed}</strong><small>perdidas</small></button>
    </div>
    <div class="calendar-flow-spacer" aria-hidden="true"></div>
    <div class="calendar-flow future" aria-label="Resumo de a\u00e7\u00f5es programadas">
      ${flowButton("maintenance", "manuten\u00e7\u00f5es")}
      ${flowButton("replacement", "trocas")}
    </div>`;

  document.querySelectorAll("[data-flow-kind]").forEach((button) => {
    button.addEventListener("click", () => navigateCalendarFlow(button.dataset.flowKind));
  });
}

function renderCalendar() {
  const bounds = clampCalendarCursor();
  updateCalendarSlider(bounds);
  const eventsByDate = reportEvents("dashboard").reduce((groups, event) => {
    const date = safeDate(event.data);
    if (!date) return groups;
    const key = calendarDateKey(date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
    return groups;
  }, {});
  const todayKey = calendarDateKey(new Date());
  renderCalendarFlowSummary(todayKey);
  const prevButton = document.querySelector("#calendar-prev");
  const nextButton = document.querySelector("#calendar-next");
  const currentMonthIndex = calendarMonthIndex(calendarCursor);
  prevButton.disabled = currentMonthIndex <= bounds.minIndex;
  nextButton.disabled = currentMonthIndex >= bounds.maxIndex;

  document.querySelector("#calendar-title").textContent = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(calendarCursor);

  const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short" });
  document.querySelector("#calendar-months").innerHTML = [-1, 0, 1]
    .map((offset) => {
      const cursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + offset, 1);
      const cursorIndex = calendarMonthIndex(cursor);
      if (cursorIndex < bounds.minIndex || cursorIndex > bounds.maxIndex) {
        return `<div class="calendar-month unavailable" aria-hidden="true"></div>`;
      }
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const gridStart = new Date(year, month, 1 - cursor.getDay());
      const days = Array.from({ length: 42 }, (_, index) => {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + index);
        const dateMonthIndex = calendarMonthIndex(date);
        if (dateMonthIndex < bounds.minIndex || dateMonthIndex > bounds.maxIndex) {
          return `<span class="calendar-day unavailable" aria-hidden="true"></span>`;
        }
        const key = calendarDateKey(date);
        const events = eventsByDate[key] || [];
        const outside = date.getMonth() !== month;
        const categories = [...new Set(events.map((event) => calendarEventCategory(event, key, todayKey)))];
        const background = categories.length ? `style="--event-background: ${calendarEventBackground(categories)}"` : "";
        const textTone = categories.length === 1 && categories[0] === "futureMaintenance" ? "dark-text" : "light-text";
        return `<button class="calendar-day ${outside ? "outside" : ""} ${key === todayKey ? "today" : ""} ${events.length ? `has-events ${textTone}` : ""}" data-date="${key}" type="button" ${background}>
          <span class="calendar-day-number">${date.getDate()}</span>
        </button>`;
      }).join("");
      const position = offset === 0 ? "current" : offset < 0 ? "previous" : "next";
      return `<section class="calendar-month ${position}">
        <h3>${monthFormatter.format(cursor)} <span>${year}</span></h3>
        <div class="calendar-weekdays" aria-hidden="true">
          <span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>
        </div>
        <div class="calendar-grid">${days}</div>
      </section>`;
    })
    .join("");

  const detail = document.querySelector("#calendar-detail");
  detail.classList.remove("is-visible");
  detail.innerHTML = "";

  document.querySelectorAll(".calendar-day[data-date]").forEach((day) => {
    day.addEventListener("click", () => showCalendarDay(day, eventsByDate[day.dataset.date] || []));
  });
  renderDashboardChart();
}

function renderTimelineCalendar() {
  const container = document.querySelector("#timeline-calendar-months");
  const timelineView = document.querySelector("#timeline-view");
  if (!container || !timelineView?.classList.contains("active")) return;
  const bounds = calendarBounds("timeline");
  const cursorIndex = Math.max(bounds.minIndex, Math.min(bounds.maxIndex, calendarMonthIndex(timelineCalendarCursor)));
  timelineCalendarCursor = new Date(Math.floor(cursorIndex / 12), cursorIndex % 12, 1);
  const availableWidth = Math.max(320, container.getBoundingClientRect().width || timelineView.getBoundingClientRect().width);
  const totalMonths = Math.max(1, bounds.maxIndex - bounds.minIndex + 1);
  const monthCount = Math.min(totalMonths, Math.max(3, Math.floor(availableWidth / 175)));
  const leftCount = Math.floor((monthCount - 1) / 2);
  const maxStartIndex = Math.max(bounds.minIndex, bounds.maxIndex - monthCount + 1);
  const startIndex = Math.max(bounds.minIndex, Math.min(cursorIndex - leftCount, maxStartIndex));
  const visibleIndexes = Array.from({ length: monthCount }, (_, index) => startIndex + index).filter(
    (index) => index >= bounds.minIndex && index <= bounds.maxIndex,
  );
  const eventsByDate = reportEvents("timeline").reduce((groups, event) => {
    const date = safeDate(event.data);
    if (!date) return groups;
    const key = calendarDateKey(date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
    return groups;
  }, {});
  const todayKey = calendarDateKey(new Date());
  const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short" });

  document.querySelector("#timeline-calendar-title").textContent = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(timelineCalendarCursor);
  document.querySelector("#timeline-calendar-today-date").textContent = calendarSliderLabel(new Date());
  document.querySelector("#timeline-calendar-min").textContent = calendarSliderLabel(bounds.min);
  document.querySelector("#timeline-calendar-max").textContent = calendarSliderLabel(bounds.max);

  const range = document.querySelector("#timeline-calendar-range");
  range.max = Math.max(0, bounds.maxIndex - bounds.minIndex);
  range.value = cursorIndex - bounds.minIndex;
  const todayIndex = Math.max(bounds.minIndex, Math.min(bounds.maxIndex, calendarMonthIndex(new Date())));
  const supervisionIndex = Math.max(bounds.minIndex, Math.min(bounds.maxIndex, calendarMonthIndex(bounds.supervision)));
  const realStart = Number(range.max) ? ((supervisionIndex - bounds.minIndex) / Number(range.max)) * 100 : 0;
  const realProgress = Number(range.max) ? ((todayIndex - bounds.minIndex) / Number(range.max)) * 100 : 0;
  range.style.setProperty("--real-start", `${realStart}%`);
  range.style.setProperty("--real-progress", `${Math.max(realStart, realProgress)}%`);

  document.querySelector("#timeline-calendar-prev").disabled = cursorIndex <= bounds.minIndex;
  document.querySelector("#timeline-calendar-next").disabled = cursorIndex >= bounds.maxIndex;
  container.style.setProperty("--timeline-month-count", visibleIndexes.length);
  container.innerHTML = visibleIndexes
    .map((index) => {
      const cursor = new Date(Math.floor(index / 12), index % 12, 1);
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const gridStart = new Date(year, month, 1 - cursor.getDay());
      const days = Array.from({ length: 42 }, (_, dayIndex) => {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + dayIndex);
        const key = calendarDateKey(date);
        const events = eventsByDate[key] || [];
        const outside = date.getMonth() !== month;
        const categories = [...new Set(events.map((event) => calendarEventCategory(event, key, todayKey)))];
        const background = categories.length ? `style="--event-background: ${calendarEventBackground(categories)}"` : "";
        const textTone = categories.length === 1 && categories[0] === "futureMaintenance" ? "dark-text" : "light-text";
        return `<button class="calendar-day ${outside ? "outside" : ""} ${key === todayKey ? "today" : ""} ${events.length ? `has-events ${textTone}` : ""}" data-date="${key}" type="button" ${background}>
          <span class="calendar-day-number">${date.getDate()}</span>
        </button>`;
      }).join("");
      return `<section class="calendar-month ${index === cursorIndex ? "current" : "adjacent"}">
        <h3>${monthFormatter.format(cursor)} <span>${year}</span></h3>
        <div class="calendar-weekdays" aria-hidden="true">
          <span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>
        </div>
        <div class="calendar-grid">${days}</div>
      </section>`;
    })
    .join("");

  container.querySelectorAll(".calendar-day[data-date]").forEach((day) => {
    day.addEventListener("click", () => {
      const date = safeDate(day.dataset.date);
      timelineCalendarCursor = new Date(date.getFullYear(), date.getMonth(), 1);
      document.querySelector("#year-filter").value = String(date.getFullYear());
      renderTimeline();
      renderTimelineCalendar();
    });
  });
}

function showCalendarDay(day, events) {
  const detail = document.querySelector("#calendar-detail");
  if (day.classList.contains("is-selected") || !events.length) {
    document.querySelectorAll(".calendar-day.is-selected").forEach((item) => item.classList.remove("is-selected"));
    detail.classList.remove("is-visible");
    detail.innerHTML = "";
    return;
  }
  document.querySelectorAll(".calendar-day.is-selected").forEach((item) => item.classList.remove("is-selected"));
  day.classList.add("is-selected");
  const total = events.reduce((sum, event) => sum + Number(event.custo || 0), 0);
  const groups = [
    { key: "maintenance", label: "Manuten\u00e7\u00f5es", events: events.filter((event) => !String(event.tipo || "").startsWith("Substit")) },
    { key: "replacement", label: "Trocas", events: events.filter((event) => String(event.tipo || "").startsWith("Substit")) },
  ].filter((group) => group.events.length);
  detail.classList.add("is-visible");
  detail.innerHTML = `<div class="calendar-detail-summary"><strong>${formatDate(day.dataset.date)}</strong><span>Total previsto: ${money.format(total)}</span></div>
    <div class="calendar-action-groups">${groups
      .map((group) => {
        const subtotal = group.events.reduce((sum, event) => sum + Number(event.custo || 0), 0);
        const items = group.events
          .sort((a, b) => Number(b.custo || 0) - Number(a.custo || 0))
          .map((event) => {
            const eventDate = safeDate(event.data);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const past = eventDate && eventDate < today;
            const completed = isEventCompleted(event);
            const pastStatus = past
              ? `<span class="calendar-event-status ${completed ? "completed" : "missed"}">${completed ? "Realizada" : "N\u00e3o realizada"}</span>`
              : "";
            return `<li><button class="detail-link calendar-asset-link" data-asset-id="${event.assetId || ""}" type="button">
              <strong>${event.ativo || event.sistema}</strong>
              <span class="meta">${event.sistema} \u00b7 ${event.ambiente}</span>
              ${pastStatus}
              <span class="detail-total">${money.format(event.custo || 0)}</span>
            </button></li>`;
          })
          .join("");
        return `<section class="calendar-action-group ${group.key}">
          <header><strong>${group.label}</strong><span>${group.events.length} ${group.events.length > 1 ? "a\u00e7\u00f5es" : "a\u00e7\u00e3o"} \u00b7 ${money.format(subtotal)}</span></header>
          <ul>${items}</ul>
        </section>`;
      })
      .join("")}</div>`;
  document.querySelectorAll(".calendar-asset-link").forEach((button) => {
    button.addEventListener("click", () => goToAsset(button.dataset.assetId));
  });
}

function renderKpis() {
  const dashboardAssets = reportAssets("dashboard");
  const dashboardEvents = reportEvents("dashboard");
  const vencidos = dashboardAssets.filter((asset) => statusFor(asset.proximaManutencao) === "Vencido").length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in90Days = new Date(today);
  in90Days.setDate(in90Days.getDate() + 90);
  const next90 = dashboardEvents.filter((event) => {
    const date = safeDate(event.data);
    return date && date >= today && date <= in90Days;
  }).length;
  const selectedProvision = selectedMonthlyProvision();
  const selectedMonthLabel = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" })
    .format(calendarCursor)
    .replace(".", "");
  const provisionValidity = selectedProvision.changeDate
    ? `Valor vigente até: ${formatDate(selectedProvision.changeDate)} · Próximo valor: ${money.format(selectedProvision.nextValue)}`
    : "Sem alteração posterior no período";
  const kpis = [
    ["Custo previsto no horizonte", money.format(plannedExecutionCost()), reportHorizonDescription("dashboard")],
    [`Provisionamento mensal · ${selectedMonthLabel}`, money.format(selectedProvision.value), provisionValidity],
    ["Ativos cadastrados", dashboardAssets.length],
    ["Próximos 90 dias", next90],
    ["Itens vencidos", vencidos],
  ];

  document.querySelector("#kpi-grid").innerHTML = kpis
    .map(([label, value, note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</article>`)
    .join("");
}

function renderSystemBars() {
  const windowEvents = planningWindowEvents("dashboard");
  const grouped = groupSum(windowEvents, "sistema", "custo");
  const rows = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map((row) => row[1]), 1);
  document.querySelector("#system-bars").innerHTML = rows.length ? rows
    .map(([label, value]) => {
      const width = Math.max(3, (value / max) * 100);
      return `<div class="bar-row system-bar-row" data-system="${encodeURIComponent(label)}" role="button" tabindex="0" aria-label="Ver ativos do sistema ${label}"><strong>${label}</strong><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><span>${money.format(value)}</span></div>`;
    })
    .join("") : `<div class="empty-state">Nenhum sistema com custos programados.</div>`;
  wireSystemDetails(windowEvents);
}

function wireSystemDetails(windowEvents) {
  document.querySelectorAll(".system-bar-row").forEach((row) => {
    const system = decodeURIComponent(row.dataset.system || "");
    const show = () => showSystemDetail(row, system, windowEvents.filter((event) => (event.sistema || "Não informado") === system));
    row.addEventListener("mouseenter", show);
    row.addEventListener("click", show);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show();
      }
    });
  });
}

function showSystemDetail(row, system, events) {
  document.querySelectorAll(".system-detail.inline").forEach((detail) => detail.remove());
  document.querySelectorAll(".system-bar-row.is-active").forEach((active) => active.classList.remove("is-active"));
  row.classList.add("is-active");

  const eventsByAsset = events.reduce((groups, event) => {
    const key = event.assetId || `${event.ativo}-${event.ambiente}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
    return groups;
  }, {});

  const items = Object.entries(eventsByAsset)
    .map(([assetId, assetEvents]) => {
      const asset = state.assets.find((item) => item.id === assetId);
      const summary = asset ? assetCostSummary(asset) : { lifeYears: 0, totalCycles: 1 };
      const maintenance = assetEvents
        .filter((event) => (event.tipo || "Manutenção") === "Manutenção")
        .reduce((sum, event) => sum + Number(event.custo || 0), 0);
      const replacement = assetEvents
        .filter((event) => event.tipo === "Substituição")
        .reduce((sum, event) => sum + Number(event.custo || 0), 0);
      return {
        assetId,
        name: asset?.ativo || assetEvents[0]?.ativo || "Ativo",
        environment: asset?.ambiente || assetEvents[0]?.ambiente || "Ambiente não informado",
        lifeYears: summary.lifeYears,
        cycles: summary.totalCycles,
        maintenance,
        replacement,
        total: maintenance + replacement,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));

  const total = items.reduce((sum, item) => sum + item.total, 0);
  const banner = document.createElement("aside");
  banner.className = "execution-detail system-detail inline";
  banner.innerHTML = `<h3>${system}</h3>
    <div class="detail-total">Total no horizonte selecionado: ${money.format(total)}</div>
    <ul>${items
      .map(
        (item) => `<li>
          <button class="detail-link" data-asset-id="${item.assetId}" type="button">
            <strong>${item.name}</strong>
            <span class="meta">${item.environment} · Vida útil: ${item.lifeYears ? `${item.lifeYears} anos` : "não informada"} · ${item.cycles} ciclo(s)</span>
            <span class="system-cost-detail">Manutenção: ${money.format(item.maintenance)} · Reposição: ${money.format(item.replacement)} · Total: ${money.format(item.total)}</span>
          </button>
        </li>`,
      )
      .join("")}</ul>`;
  row.insertAdjacentElement("afterend", banner);
  banner.querySelectorAll(".detail-link").forEach((button) => {
    button.addEventListener("click", () => goToAsset(button.dataset.assetId));
  });
  banner.addEventListener("mouseleave", () => {
    banner.remove();
    row.classList.remove("is-active");
  });
}

function renderNextEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events = reportEvents("dashboard")
    .filter((event) => {
      const date = safeDate(event.data);
      return date && date >= today;
    })
    .map((event) => ({ ...event, status: statusFor(event.data) }))
    .sort(byDate)
    .slice(0, 6);

  document.querySelector("#next-events").innerHTML = events.length ? events
    .map(
      (event) => `<article class="event">
        <strong>${event.ativo || event.sistema}</strong>
        <div class="meta">${formatDate(event.data)} · ${event.tipo || "Manutenção"} · ${event.ambiente} · ${money.format(event.custo || 0)}</div>
        <span class="badge ${event.status.toLowerCase().includes("vencido") ? "vencido" : "programado"}">${event.status}</span>
      </article>`,
    )
    .join("") : `<div class="empty-state">Nenhuma atividade programada.</div>`;
}

function renderFilters() {
  const horizonInput = document.querySelector("#planning-horizon");
  const selectedBuildings = selectedReportBuildingIds("timeline");
  const horizons = [...new Set(selectedBuildings.map(buildingHorizonYears))];
  horizonInput.value = horizons.length === 1 ? horizons[0] : "";
  horizonInput.disabled = !selectedBuildings.length;
  document.querySelector("#planning-horizon-note").textContent =
    selectedBuildings.length > 1
      ? "A alteração será aplicada a todas as edificações marcadas."
      : reportHorizonDescription("timeline");
  const systems = ["", ...new Set(state.assets.map((asset) => asset.sistema).filter(Boolean).sort())];
  const systemSelect = document.querySelector("#system-filter");
  const currentSystem = systemSelect.value;
  systemSelect.innerHTML = systems.map((s) => `<option value="${s}">${s || "Todos"}</option>`).join("");
  systemSelect.value = currentSystem;

  const years = ["", ...Object.keys(eventsByYear("timeline")).sort()];
  const yearSelect = document.querySelector("#year-filter");
  const currentYear = yearSelect.value;
  yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y || "Todos"}</option>`).join("");
  yearSelect.value = currentYear;
}

function uniqueValues(...lists) {
  return [...new Set(lists.flat().filter(Boolean).map((item) => String(item).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

function choiceOptions(field) {
  const fromAssets = (key) => state.assets.map((asset) => asset[key]);
  const fromRotinas = (key) => state.rotinas.map((rotina) => rotina[key]);
  const options = {
    ambiente: uniqueValues(state.ambientes.map((item) => item.ambiente), fromAssets("ambiente")),
    sistema: uniqueValues(state.sistemas.map((item) => item.sistema), state.rotinas.map((item) => item.sistema), fromAssets("sistema")),
    ativo: uniqueValues(fromRotinas("ativo"), fromAssets("ativo")),
    componente: uniqueValues(fromRotinas("componente"), fromAssets("componente")),
    acao: uniqueValues(fromRotinas("acao"), fromAssets("acao")),
    prioridade: uniqueValues(["Baixa", "Média", "Alta", "Crítica"], fromAssets("prioridade")),
    responsavel: uniqueValues(fromRotinas("responsavel"), fromAssets("responsavel")),
  };
  return options[field] || [];
}

function setupChoice(id, value = "") {
  const select = document.querySelector(`#asset-${id}`);
  const customInput = document.querySelector(`#asset-${id}-new`);
  const options = choiceOptions(id);
  const hasValue = value && options.includes(value);
  select.innerHTML = [
    `<option value="">Selecionar</option>`,
    ...options.map((option) => `<option value="${option}">${option}</option>`),
    `<option value="${newChoiceValue}">Incluir novo</option>`,
  ].join("");
  select.value = hasValue ? value : value ? newChoiceValue : "";
  customInput.value = hasValue ? "" : value || "";
  updateChoiceMode(id);
}

function setupAssetScopeChoices(buildingId, selectedLocationId = "", selectedSystemId = "") {
  const locationSelect = document.querySelector("#asset-ambiente");
  const systemSelect = document.querySelector("#asset-sistema");
  const locationInput = document.querySelector("#asset-ambiente-new");
  const systemInput = document.querySelector("#asset-sistema-new");
  const locations = buildingData.locations
    .filter((location) => location.building_id === buildingId)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.name.localeCompare(b.name, "pt-BR"));
  const systems = buildingData.systems
    .filter((system) => system.building_id === buildingId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  locationSelect.innerHTML = [
    `<option value="">Selecionar ambiente</option>`,
    ...locations.map((location) =>
      `<option value="${location.id}">${escapeHtml(location.name)} · ${escapeHtml(locationTypeLabel(location.location_type))}</option>`),
  ].join("");
  systemSelect.innerHTML = [
    `<option value="">Selecionar sistema</option>`,
    ...systems.map((system) => `<option value="${system.id}">${escapeHtml(system.name)}</option>`),
  ].join("");
  locationSelect.disabled = !buildingId;
  systemSelect.disabled = !buildingId;
  locationSelect.value = locations.some((location) => location.id === selectedLocationId) ? selectedLocationId : "";
  systemSelect.value = systems.some((system) => system.id === selectedSystemId) ? selectedSystemId : "";
  locationInput.value = "";
  systemInput.value = "";
  locationSelect.closest(".choice-field").classList.remove("is-new");
  systemSelect.closest(".choice-field").classList.remove("is-new");
}

function updateChoiceMode(id) {
  const select = document.querySelector(`#asset-${id}`);
  const field = select.closest(".choice-field");
  field.classList.toggle("is-new", select.value === newChoiceValue);
}

function getChoiceValue(id) {
  const select = document.querySelector(`#asset-${id}`);
  if (select.value !== newChoiceValue) return select.value;
  return document.querySelector(`#asset-${id}-new`).value.trim();
}

function assetCostSummary(asset) {
  const lifeYears = Number(asset.expectativaVidaAnos || 0);
  const periodicityMonths = Number(asset.periodicidadeMeses || 0);
  const maintenanceCost = Number(asset.custoTotal || 0);
  const assetValue = Number(asset.valorAtivo || 0);
  const totalCycles = clampCycles(asset.totalCiclos, lifeYears, asset.buildingId);
  const renew = (asset.fimVida || "renovar") === "renovar";
  const maintenanceCountPerCycle = lifeYears && periodicityMonths ? Math.floor((lifeYears * 12) / periodicityMonths) : 0;
  const maintenancePerCycle = maintenanceCountPerCycle * maintenanceCost;
  const assetMaintenanceEvents = state.recurrenceEvents.filter((event) =>
    event.assetId === asset.id &&
    event.tipoManutencao === "preventiva" &&
    !String(event.tipo || "").startsWith("Substit")
  );
  const ruleGroups = new Map();
  assetMaintenanceEvents.forEach((event) => {
    const key = event.recurrenceGroup || `${event.acao}|${event.periodicidadeMeses || periodicityMonths}`;
    if (!ruleGroups.has(key)) ruleGroups.set(key, event);
  });
  const monthlyMaintenance = ruleGroups.size
    ? [...ruleGroups.values()].reduce((total, rule) => {
        const months = Number(rule.periodicidadeMeses || periodicityMonths || 0);
        return total + (months ? Number(rule.custo || 0) / months : 0);
      }, 0)
    : periodicityMonths ? maintenanceCost / periodicityMonths : 0;
  const replacementCount = lifeYears && assetValue ? (renew ? totalCycles : Math.max(0, totalCycles - 1)) : 0;
  const replacementPerCycle = assetValue;
  const monthlyReplacement = lifeYears && assetValue && replacementCount ? assetValue / (lifeYears * 12) : 0;
  const monthlyFullCycle = monthlyMaintenance + monthlyReplacement;
  const maintenancePeriodTotal = assetMaintenanceEvents.length
    ? assetMaintenanceEvents.reduce((total, event) => total + Number(event.custo || 0), 0)
    : maintenancePerCycle * totalCycles;
  const totalPeriod = maintenancePeriodTotal + replacementPerCycle * replacementCount;
  const installationDate = safeDate(asset.dataInstalacao);
  const initialYear = installationDate ? installationDate.getFullYear() : null;
  const finalYear = installationDate && lifeYears ? addYears(installationDate, lifeYears * totalCycles).getFullYear() : null;

  return {
    lifeYears,
    totalCycles,
    initialYear,
    finalYear,
    monthlyMaintenance,
    monthlyReplacement,
    monthlyFullCycle,
    maintenancePerCycle,
    replacementPerCycle,
    replacementCount,
    endsWithoutRenewal: !renew,
    totalPeriod,
  };
}

function renderAssets() {
  const query = document.querySelector("#asset-search").value.trim().toLowerCase();
  const system = document.querySelector("#system-filter").value;
  const sortMode = document.querySelector("#asset-sort").value;
  const assets = state.assets
    .filter((asset) => {
      const haystack = `${asset.ambiente} ${asset.sistema} ${asset.ativo} ${asset.componente} ${asset.acao}`.toLowerCase();
      return (!query || haystack.includes(query)) &&
        (!system || asset.sistema === system) &&
        reportIncludesAsset(asset, "assets");
    })
    .sort((a, b) => compareAssets(a, b, sortMode));

  document.querySelector("#asset-list").innerHTML = assets.length ? assets
    .map((asset) => {
      const status = statusFor(asset.proximaManutencao);
      const image = asset.foto ? `<img src="${asset.foto}" alt="Foto de ${asset.ativo}" />` : "Foto";
      const costs = assetCostSummary(asset);
      const assetBuilding = asset.buildingAssignmentPending
        ? `<span class="badge vencido">Edificação pendente</span>`
        : `<span class="badge programado">${escapeHtml(buildingName(asset.buildingId))}</span>`;
      return `<article class="asset-card ${focusedAssetId === asset.id ? "is-focused" : ""}" data-id="${asset.id}">
        <div class="thumb">${image}</div>
        <div class="asset-card-content">
          <strong>${asset.ativo || "Ativo sem nome"}</strong>
          <div class="meta">${asset.sistema} · ${asset.ambiente} · ${asset.acao || "Sem ação definida"}</div>
          ${assetBuilding}
          <span class="badge ${status.toLowerCase().includes("vencido") ? "vencido" : "programado"}">${status}</span>
          <div class="asset-metrics">
            <div><span>Ano inicial</span><strong>${costs.initialYear || "Não informado"}</strong></div>
            <div><span>Ano final</span><strong>${costs.finalYear || "Não calculado"}</strong></div>
            <div><span>Última manutenção</span><strong>${asset.ultimaManutencao ? formatDate(asset.ultimaManutencao) : "Não informada"}</strong></div>
            <div><span>Próxima manutenção</span><strong>${asset.proximaManutencao ? formatDate(asset.proximaManutencao) : "Não calculada"}</strong></div>
            <div><span>Expectativa de vida</span><strong>${costs.lifeYears ? `${costs.lifeYears} anos` : "Não informada"}</strong></div>
            <div><span>Total de ciclos</span><strong>${costs.totalCycles}</strong></div>
            <div><span>Provisionamento mensal ciclo cheio</span><strong>${costs.lifeYears ? money.format(costs.monthlyFullCycle) : "Não calculado"}</strong><small>Manutenção ${money.format(costs.monthlyMaintenance)} + substituição ${money.format(costs.monthlyReplacement)}${costs.endsWithoutRenewal ? " · último ciclo sem substituição" : ""}</small></div>
            <div><span>Custo total no período</span><strong>${costs.lifeYears ? money.format(costs.totalPeriod) : "Não calculado"}</strong></div>
          </div>
        </div>
        <div class="card-actions">
          <button class="ghost-button edit-asset" data-id="${asset.id}" type="button">Editar</button>
          <button class="danger-button delete-asset-card" data-id="${asset.id}" type="button">Excluir</button>
        </div>
      </article>`;
    })
    .join("") : `<div class="empty-state empty-state-large">
      <strong>Nenhum ativo cadastrado</strong>
      <span>Comece configurando a edificação, seus espaços e sistemas. Depois, adicione os ativos.</span>
    </div>`;
}

function compareAssets(a, b, sortMode) {
  const nameA = a.ativo || a.sistema || a.id || "";
  const nameB = b.ativo || b.sistema || b.id || "";
  const fallback = () => nameA.localeCompare(nameB, "pt-BR");
  const summaryA = assetCostSummary(a);
  const summaryB = assetCostSummary(b);
  const compareOptional = (valueA, valueB, direction = "asc") => {
    const missingA = valueA === null || valueA === undefined || Number.isNaN(valueA);
    const missingB = valueB === null || valueB === undefined || Number.isNaN(valueB);
    if (missingA && missingB) return fallback();
    if (missingA) return 1;
    if (missingB) return -1;
    const result = direction === "desc" ? valueB - valueA : valueA - valueB;
    return result || fallback();
  };

  if (sortMode === "start-date") {
    const dateA = safeDate(a.dataInstalacao)?.getTime();
    const dateB = safeDate(b.dataInstalacao)?.getTime();
    return compareOptional(dateA, dateB);
  }
  if (sortMode === "end-date") {
    const dateA = a.dataInstalacao && a.expectativaVidaAnos
      ? addYears(safeDate(a.dataInstalacao), Number(a.expectativaVidaAnos) * summaryA.totalCycles).getTime()
      : null;
    const dateB = b.dataInstalacao && b.expectativaVidaAnos
      ? addYears(safeDate(b.dataInstalacao), Number(b.expectativaVidaAnos) * summaryB.totalCycles).getTime()
      : null;
    return compareOptional(dateA, dateB);
  }
  if (sortMode === "last-maintenance") {
    const dateA = safeDate(a.ultimaManutencao)?.getTime();
    const dateB = safeDate(b.ultimaManutencao)?.getTime();
    return compareOptional(dateA, dateB, "desc");
  }
  if (sortMode === "next-maintenance") {
    const dateA = safeDate(a.proximaManutencao)?.getTime();
    const dateB = safeDate(b.proximaManutencao)?.getTime();
    return compareOptional(dateA, dateB);
  }
  if (sortMode === "cycles-asc") return compareOptional(summaryA.totalCycles, summaryB.totalCycles);
  if (sortMode === "cycles-desc") return compareOptional(summaryA.totalCycles, summaryB.totalCycles, "desc");
  const lifeA = summaryA.lifeYears || null;
  const lifeB = summaryB.lifeYears || null;
  if (sortMode === "life-asc") return compareOptional(lifeA, lifeB);
  if (sortMode === "life-desc") return compareOptional(lifeA, lifeB, "desc");
  const provisionA = summaryA.lifeYears ? summaryA.monthlyFullCycle : null;
  const provisionB = summaryB.lifeYears ? summaryB.monthlyFullCycle : null;
  if (sortMode === "provision-asc") return compareOptional(provisionA, provisionB);
  if (sortMode === "provision-desc") return compareOptional(provisionA, provisionB, "desc");
  const valueA = summaryA.lifeYears ? summaryA.totalPeriod : null;
  const valueB = summaryB.lifeYears ? summaryB.totalPeriod : null;
  if (sortMode === "value-desc") return compareOptional(valueA, valueB, "desc");
  if (sortMode === "value-asc") return compareOptional(valueA, valueB);
  return fallback();
}

function renderTimeline() {
  const year = document.querySelector("#year-filter").value;
  const status = document.querySelector("#status-filter").value;
  const events = reportEvents("timeline")
    .filter((event) => (!year || event.data.startsWith(year)) && (!status || statusFor(event.data) === status))
    .sort(byDate)
    .slice(0, 80);

  document.querySelector("#timeline-list").innerHTML = events.length ? events
    .map(
      (event) => `<article class="timeline-item">
        <div class="timeline-date">${formatDate(event.data)}</div>
        <div>
          <strong>${event.ativo || event.sistema}</strong>
          <div class="meta">${event.tipo || "Manutenção"} · ${event.ambiente} · ${event.sistema} · ${event.acao || "Manutenção"}</div>
          <span class="badge ${statusFor(event.data).toLowerCase().includes("vencido") ? "vencido" : "programado"}">${statusFor(event.data)}</span>
        </div>
        <strong>${money.format(event.custo || 0)}</strong>
      </article>`,
    )
    .join("") : `<div class="empty-state empty-state-large">
      <strong>Nenhuma manutenção programada</strong>
      <span>O cronograma será preenchido a partir dos ativos e seus planos de manutenção.</span>
    </div>`;
}

function renderFinance() {
  document.querySelector("#finance-horizon-summary").textContent =
    `Horizonte de planejamento: ${reportHorizonDescription("finance")}`;
  const { execution, provision, executionEvents } = financeSeries("finance");
  const years = yearsFromSeries(execution, provision);
  const maxExecution = Math.max(...Object.values(execution), 1);
  const maxProvision = Math.max(...Object.values(provision), 1);
  document.querySelector("#year-bars").innerHTML = years
    .map((year) => {
      const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
      const executionRows = months
        .filter((key) => execution[key])
        .map((key) => monthBar(key, execution[key], maxExecution, "execution", true))
        .join("");
      const provisionRows = months
        .filter((key) => provision[key])
        .map((key) => monthBar(key, provision[key], maxProvision, "provision"))
        .join("");
      return `<section class="finance-year">
        <h3>${year}</h3>
        <div class="finance-split">
          <div class="finance-column">
            <h4>Execução no mês</h4>
            ${executionRows || `<div class="month-row is-empty">Sem execução prevista</div>`}
          </div>
          <div class="finance-column">
            <h4>Valor mensal acumulado</h4>
            ${provisionRows || `<div class="month-row is-empty">Sem provisionamento futuro</div>`}
          </div>
        </div>
      </section>`;
    })
    .join("");

  const owners = Number(document.querySelector("#owners-input").value || 1);
  let reserve = Number(document.querySelector("#reserve-input").value || 0);
  const monthRows = [...new Set([...Object.keys(execution), ...Object.keys(provision)])].sort();
  const tableRows = monthRows.slice(0, 48).map((key) => {
    const executionValue = execution[key] || 0;
    const provisionValue = provision[key] || 0;
    reserve += provisionValue - executionValue;
    return `<tr><td>${monthLabel(key)} ${key.slice(0, 4)}</td><td>${money.format(executionValue)}</td><td>${money.format(provisionValue)}</td><td>${money.format(provisionValue / owners)}</td><td>${money.format(reserve)}</td></tr>`;
  });
  document.querySelector("#finance-table").innerHTML = `<table>
    <thead><tr><th>Mês</th><th>Execução</th><th>Valor mensal acumulado</th><th>Por condômino</th><th>Saldo estimado</th></tr></thead>
    <tbody>${tableRows.join("")}</tbody>
  </table>`;
  wireExecutionDetails(executionEvents);
}

function monthBar(key, value, maxValue, type, clickable = false) {
  const width = Math.max(3, (value / maxValue) * 100);
  const interactiveAttrs = clickable
    ? ` data-month="${key}" role="button" tabindex="0" aria-label="Ver serviços de ${monthLabel(key)} ${key.slice(0, 4)}"`
    : "";
  return `<div class="month-row ${clickable ? "is-clickable" : ""}"${interactiveAttrs}><strong>${monthLabel(key)}</strong><div class="bar-track"><div class="bar-fill ${type}" style="width:${width}%"></div></div><span>${money.format(value)}</span></div>`;
}

function wireExecutionDetails(executionEvents) {
  const rows = document.querySelectorAll(".month-row.is-clickable");
  rows.forEach((row) => {
    const show = (persist = false) => showExecutionDetail(row, row.dataset.month, executionEvents[row.dataset.month] || [], persist);
    row.addEventListener("click", show);
    row.addEventListener("mouseenter", () => show(false));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show(true);
      }
    });
  });
}

function showExecutionDetail(row, month, events, persist = false) {
  document.querySelectorAll(".execution-detail.inline").forEach((detail) => detail.remove());
  document.querySelectorAll(".month-row.is-active").forEach((activeRow) => activeRow.classList.remove("is-active"));
  row.classList.add("is-active");
  const total = events.reduce((sum, event) => sum + Number(event.custo || 0), 0);
  const items = events
    .sort((a, b) => Number(b.custo || 0) - Number(a.custo || 0))
    .map(
      (event) => `<li>
        <button class="detail-link" data-asset-id="${event.assetId || ""}" type="button">
          <strong>${event.ativo || event.sistema || "Serviço"}</strong>
          <span class="meta">${event.tipo || "Manutenção"} · ${event.sistema || "Sistema não informado"} · ${event.ambiente || "Ambiente não informado"} · ${event.acao || "Manutenção"}</span>
          <span class="detail-total">${money.format(event.custo || 0)}</span>
        </button>
      </li>`,
    )
    .join("");
  const banner = document.createElement("aside");
  banner.className = "execution-detail inline";
  banner.innerHTML = `<h3>Execuções de ${monthLabel(month)} ${month.slice(0, 4)}</h3>
    <div class="detail-total">Total do mês: ${money.format(total)}</div>
    <ul>${items}</ul>`;
  row.insertAdjacentElement("afterend", banner);
  banner.querySelectorAll(".detail-link").forEach((button) => {
    button.addEventListener("click", () => goToAsset(button.dataset.assetId));
  });
  if (!persist) {
    banner.addEventListener("mouseleave", () => {
      banner.remove();
      row.classList.remove("is-active");
    });
  }
}

function activateView(view) {
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active",
    item.dataset.view === view || (view === "asset-editor" && item.dataset.view === "assets")));
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === `${view}-view`));
  if (view === "buildings") renderBuildings();
  if (view === "systems") renderSystemsView();
  if (view === "timeline") {
    requestAnimationFrame(() => requestAnimationFrame(renderTimelineCalendar));
  }
}

function goToAsset(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  focusedAssetId = asset.id;
  activateView("assets");
  document.querySelector("#asset-search").value = asset.id || asset.ativo || "";
  document.querySelector("#system-filter").value = "";
  renderAssets();
  document.querySelector(`[data-id="${asset.id}"]`)?.closest(".asset-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  openAssetSummary(asset);
}

function closeAssetEditor() {
  activateView("assets");
}

function assetSummaryDialogHtml(asset) {
  const costs = assetCostSummary(asset);
  const building = asset.buildingAssignmentPending ? "Edificação pendente" : buildingName(asset.buildingId);
  const photo = asset.foto ? `<img src="${asset.foto}" alt="Foto de ${asset.ativo || "ativo"}" />` : "<span>Sem imagem</span>";
  const todayKey = calendarDateKey(new Date());
  const actions = state.recurrenceEvents
    .filter((event) => event.assetId === asset.id && !String(event.tipo || "").startsWith("Substit"))
    .sort(byDate);
  const actionsHtml = actions.length
    ? actions
        .map((event) => {
          const eventDate = dateInputValue(event.data);
          const completed = isEventCompleted(event);
          const timeClass = eventDate > todayKey
            ? "is-future"
            : eventDate === todayKey
              ? "is-today"
              : completed
                ? "is-past-completed"
                : "is-past-missed";
          const statusLabel = completed
            ? "Realizada"
            : eventDate > todayKey
              ? "Futura"
              : eventDate === todayKey
                ? "Hoje"
                : "Não realizada";
          const typeLabel = event.tipoManutencao === "corretiva" ? "Corretiva" : "Preventiva";
          const records = [
            event.descricao ? "descrição" : "",
            event.galeria?.length ? `${event.galeria.length} ${event.galeria.length === 1 ? "foto" : "fotos"}` : "",
          ].filter(Boolean).join(" · ");
          return `<div class="asset-popup-action-row ${timeClass}">
            <span class="asset-popup-action-mark" aria-hidden="true">${completed ? "✓" : "•"}</span>
            <div class="asset-popup-action-name">
              <strong>${escapeHtml(event.acao || event.tipo || "Manutenção")}</strong>
              <span>${typeLabel} · ${statusLabel}${records ? ` · ${records}` : ""}</span>
            </div>
            <time datetime="${eventDate}">${event.data ? formatDate(event.data) : "Sem data"}</time>
            <strong class="asset-popup-action-cost">${money.format(Number(event.custo) || 0)}</strong>
          </div>`;
        })
        .join("")
    : `<div class="asset-popup-actions-empty">Nenhuma ação de manutenção programada.</div>`;
  return `<div class="asset-summary-hero">
    <div class="thumb asset-summary-thumb">${photo}</div>
    <div class="asset-summary-main">
      <strong>${escapeHtml(asset.ativo || "Ativo sem nome")}</strong>
      <div class="meta">${escapeHtml(asset.sistema || "Sistema não informado")} · ${escapeHtml(asset.ambiente || "Ambiente não informado")} · ${escapeHtml(asset.acao || "Sem ação definida")}</div>
      <div class="summary-badges">
        <span class="badge programado">${escapeHtml(building)}</span>
        <span class="badge ${statusFor(asset.proximaManutencao).toLowerCase().includes("vencido") ? "vencido" : "programado"}">${escapeHtml(statusFor(asset.proximaManutencao))}</span>
      </div>
    </div>
  </div>
  <div class="summary-grid asset-summary-grid">
    <div class="summary-kpi"><span>Ano inicial</span><strong>${costs.initialYear || "Não informado"}</strong></div>
    <div class="summary-kpi"><span>Ano final</span><strong>${costs.finalYear || "Não calculado"}</strong></div>
    <div class="summary-kpi"><span>Última manutenção</span><strong>${asset.ultimaManutencao ? formatDate(asset.ultimaManutencao) : "Não informada"}</strong></div>
    <div class="summary-kpi"><span>Próxima manutenção</span><strong>${asset.proximaManutencao ? formatDate(asset.proximaManutencao) : "Não calculada"}</strong></div>
    <div class="summary-kpi"><span>Expectativa de vida</span><strong>${costs.lifeYears ? `${costs.lifeYears} anos` : "Não informada"}</strong></div>
    <div class="summary-kpi"><span>Total de ciclos</span><strong>${costs.totalCycles}</strong></div>
    <div class="summary-kpi"><span>Plano de manutenção</span><strong>${escapeHtml(asset.acao || "Não definido")}</strong></div>
    <div class="summary-kpi"><span>Tipo do plano</span><strong>${asset.tipoManutencao === "corretiva" ? "Corretiva" : "Preventiva"}</strong></div>
    <div class="summary-kpi"><span>Periodicidade</span><strong>${asset.periodicidadeMeses ? `${asset.periodicidadeMeses} meses` : "Não informada"}</strong></div>
    <div class="summary-kpi"><span>Provisionamento mensal</span><strong>${costs.lifeYears ? money.format(costs.monthlyFullCycle) : "Não calculado"}</strong></div>
    <div class="summary-kpi"><span>Custo total no período</span><strong>${costs.lifeYears ? money.format(costs.totalPeriod) : "Não calculado"}</strong></div>
    <div class="summary-kpi"><span>Fim da vida</span><strong>${asset.fimVida === "renovar" ? "Renovar" : "Encerrar"}</strong></div>
  </div>
  <section class="asset-popup-actions">
    <div class="asset-popup-actions-heading">
      <strong>Ações de manutenção</strong>
      <span>${actions.length} ${actions.length === 1 ? "ação" : "ações"}</span>
    </div>
    <div class="asset-popup-action-list">${actionsHtml}</div>
  </section>`;
}

function openAssetSummary(asset) {
  if (!asset) return;
  const dialog = document.querySelector("#asset-summary-dialog");
  document.querySelector("#asset-summary-title").textContent = asset.ativo || "Ativo sem nome";
  document.querySelector("#asset-summary-dialog-body").innerHTML = assetSummaryDialogHtml(asset);
  dialog.dataset.assetId = asset.id;
  dialog.showModal();
}

function openDialog(asset) {
  const summaryDialog = document.querySelector("#asset-summary-dialog");
  if (summaryDialog.open) summaryDialog.close();
  const isEditing = Boolean(asset);
  activateView("asset-editor");
  document.querySelector("#dialog-title").textContent = isEditing ? "Editar ativo" : "Novo ativo";
  document.querySelector("#delete-asset").style.display = isEditing ? "inline-block" : "none";
  const data = asset || {};
  const editorAssetId = data.id || `ATIVO-${Date.now()}`;
  editingPhoto = data.foto || "";
  document.querySelector("#asset-id").value = editorAssetId;
  editingMaintenanceActions = state.recurrenceEvents
    .filter((event) => event.assetId === data.id)
    .map((event) => ({
      ...event,
      periodicidadeMeses: event.periodicidadeMeses || (event.tipoManutencao === "preventiva" ? data.periodicidadeMeses : 0),
      responsavel: event.responsavel || data.responsavel || "",
      recurrenceGroup: event.recurrenceGroup || (
        String(event.tipo || "").startsWith("Substit")
          ? `substituicao:${event.ciclo || 1}`
          : event.tipoManutencao === "corretiva"
            ? `corretiva:${event.externalEventKey || event.data}`
            : `preventiva:${event.acao || data.acao || "manutencao"}:${event.periodicidadeMeses || data.periodicidadeMeses || 0}`
      ),
    }));
  const buildingSelect = document.querySelector("#asset-building");
  buildingSelect.innerHTML = [
    `<option value="">Pendente — selecione a edificação</option>`,
    ...buildingData.buildings.map((building) => `<option value="${building.id}">${escapeHtml(building.name)}</option>`),
  ].join("");
  buildingSelect.value = data.buildingAssignmentPending ? "" : data.buildingId || "";
  setupAssetScopeChoices(buildingSelect.value, data.locationId || "", data.systemId || "");
  setupChoice("ativo", data.ativo || "");
  setupChoice("componente", data.componente || "");
  setupChoice("acao", data.acao || "");
  document.querySelector("#asset-maintenance-type").value = data.tipoManutencao || "preventiva";
  document.querySelector("#asset-periodicidade").value = data.periodicidadeMeses || "";
  document.querySelector("#asset-ultima").value = dateInputValue(data.ultimaManutencao || "");
  document.querySelector("#asset-custo").value = data.custoUnitario !== "" && data.custoUnitario !== undefined
    ? formatCurrencyInput(Number(data.custoUnitario || 0))
    : "";
  document.querySelector("#asset-instalacao").value = dateInputValue(data.dataInstalacao || data.ultimaManutencao || "");
  document.querySelector("#asset-vida").value = data.expectativaVidaAnos || "";
  document.querySelector("#asset-valor").value = data.valorAtivo !== "" && data.valorAtivo !== undefined
    ? formatCurrencyInput(Number(data.valorAtivo || 0))
    : "";
  document.querySelector(data.fimVida === "encerrar" ? "#asset-encerrar" : "#asset-renovar").checked = true;
  updateCycleLimit(data.totalCiclos || 1);
  setupChoice("prioridade", data.prioridade || "");
  setupChoice("responsavel", data.responsavel || "");
  resetMaintenanceActionForm();
  renderAssetSummary();
  renderMaintenancePlanList();
  renderMaintenanceActionList();
  renderPhotoPreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function maintenanceActionLimitDate() {
  const installationDate = safeDate(document.querySelector("#asset-instalacao").value);
  const lifeYears = Number(document.querySelector("#asset-vida").value || 0);
  const cycles = Number(document.querySelector("#asset-ciclos").value || 1);
  if (installationDate && lifeYears) return addYears(installationDate, lifeYears * Math.max(1, cycles));
  const buildingId = document.querySelector("#asset-building").value;
  return buildingId ? buildingTimeEnd(buildingId) : addYears(new Date(), 50);
}

function resetMaintenanceActionForm() {
  document.querySelector("#maintenance-action-edit-group").value = "";
  document.querySelector("#maintenance-action-form-title").textContent = "Nova ação";
  document.querySelector("#add-maintenance-action").textContent = "Adicionar ao plano";
  document.querySelector("#maintenance-action-name").value = "";
  document.querySelector("#maintenance-action-type").value = "preventiva";
  document.querySelector("#maintenance-action-date").value = "";
  document.querySelector("#maintenance-action-frequency").value = "";
  document.querySelector("#maintenance-action-cost").value = "";
  document.querySelector("#maintenance-action-responsible").value = "";
  document.querySelector("#maintenance-action-status").value = "realizada";
  document.querySelector("#maintenance-action-alarm-lead").value = "7";
  document.querySelector("#maintenance-alarm-email-channel").checked = true;
  document.querySelector("#maintenance-alarm-sms-channel").checked = false;
  document.querySelector("#maintenance-alarm-whatsapp-channel").checked = false;
  document.querySelector("#maintenance-alarm-email").value = currentUserEmail || "";
  document.querySelector("#maintenance-alarm-phone").value = "";
  document.querySelector("#maintenance-action-description").value = "";
  document.querySelector("#maintenance-action-photos").value = "";
  editingMaintenanceRulePhotos = [];
  renderMaintenanceRuleGallery();
  updateMaintenanceActionFormMode();
}

function renderMaintenanceRuleGallery() {
  const gallery = document.querySelector("#maintenance-action-gallery");
  gallery.innerHTML = editingMaintenanceRulePhotos.length
    ? editingMaintenanceRulePhotos.map((photo, index) => `
      <figure class="maintenance-action-photo">
        <img src="${photo.url}" alt="Foto ${index + 1} da ação" />
        <button class="maintenance-rule-photo-remove" data-photo-index="${index}" type="button" aria-label="Remover foto ${index + 1}">×</button>
      </figure>`).join("")
    : "";
}

function maintenancePlanRules() {
  const groups = new Map();
  editingMaintenanceActions
    .filter((event) => !String(event.tipo || "").startsWith("Substit"))
    .sort(byDate)
    .forEach((event) => {
      const group = event.recurrenceGroup || eventScheduleKey(event);
      if (!groups.has(group)) groups.set(group, { ...event, recurrenceGroup: group });
    });
  return [...groups.values()].sort((a, b) =>
    String(a.acao || "").localeCompare(String(b.acao || ""), "pt-BR") || byDate(a, b)
  );
}

function renderMaintenancePlanList() {
  const container = document.querySelector("#asset-maintenance-plan-list");
  const rules = maintenancePlanRules();
  container.innerHTML = rules.length
    ? rules.map((rule, index) => {
        const corrective = rule.tipoManutencao === "corretiva";
        const periodicity = corrective
          ? "Pontual"
          : `${Number(rule.periodicidadeMeses || 0)} ${Number(rule.periodicidadeMeses || 0) === 1 ? "mês" : "meses"}`;
        const alarmChannels = (rule.alarmeCanais || []).map((channel) => ({
          email: "e-mail",
          sms: "SMS",
          whatsapp: "WhatsApp",
        })[channel] || channel).join(", ");
        const alarmSummary = corrective
          ? ""
          : ` · alarmes ${Number(rule.alarmeAntecedenciaDias || 7)} dias antes e no dia${alarmChannels ? ` por ${alarmChannels}` : ""}`;
        return `<div class="maintenance-plan-row ${corrective ? "corrective" : "preventive"}">
          <span class="maintenance-plan-number">${index + 1}.</span>
          <div class="maintenance-plan-name">
            <strong>${escapeHtml(rule.acao || "Manutenção")}</strong>
            <span>${corrective ? "Corretiva" : `Preventiva recorrente${alarmSummary}`}</span>
          </div>
          <strong class="maintenance-plan-period">${periodicity}</strong>
          <strong class="maintenance-plan-cost">${money.format(rule.custo || 0)}</strong>
          <div class="maintenance-plan-actions">
            <button class="ghost-button edit-maintenance-rule" data-group="${escapeHtml(rule.recurrenceGroup)}" type="button">Editar</button>
            <button class="maintenance-rule-remove" data-group="${escapeHtml(rule.recurrenceGroup)}" type="button">Excluir</button>
          </div>
        </div>`;
      }).join("")
    : `<div class="empty-state compact-empty">Nenhuma ação cadastrada no plano.</div>`;
}

function editMaintenanceRule(group) {
  const rule = maintenancePlanRules().find((item) => item.recurrenceGroup === group);
  if (!rule) return;
  document.querySelector("#maintenance-action-edit-group").value = group;
  document.querySelector("#maintenance-action-form-title").textContent = "Editar ação";
  document.querySelector("#add-maintenance-action").textContent = "Refazer programação";
  document.querySelector("#maintenance-action-name").value = rule.acao || "";
  document.querySelector("#maintenance-action-type").value = rule.tipoManutencao || "preventiva";
  document.querySelector("#maintenance-action-date").value = dateInputValue(rule.data);
  document.querySelector("#maintenance-action-frequency").value = rule.periodicidadeMeses || "";
  document.querySelector("#maintenance-action-cost").value = formatCurrencyInput(Number(rule.custo || 0));
  document.querySelector("#maintenance-action-responsible").value = rule.responsavel || "";
  document.querySelector("#maintenance-action-status").value = rule.realizada === true ? "realizada" : "prevista";
  document.querySelector("#maintenance-action-alarm-lead").value = String(rule.alarmeAntecedenciaDias || 7);
  document.querySelector("#maintenance-alarm-email-channel").checked = (rule.alarmeCanais || ["email"]).includes("email");
  document.querySelector("#maintenance-alarm-sms-channel").checked = (rule.alarmeCanais || []).includes("sms");
  document.querySelector("#maintenance-alarm-whatsapp-channel").checked = (rule.alarmeCanais || []).includes("whatsapp");
  document.querySelector("#maintenance-alarm-email").value = rule.alarmeEmail || currentUserEmail || "";
  document.querySelector("#maintenance-alarm-phone").value = rule.alarmeTelefone || "";
  document.querySelector("#maintenance-action-description").value = rule.descricao || "";
  editingMaintenanceRulePhotos = Array.isArray(rule.galeria)
    ? rule.galeria.map((photo) => ({ ...photo }))
    : [];
  renderMaintenanceRuleGallery();
  updateMaintenanceActionFormMode();
  document.querySelector("#maintenance-action-form").hidden = false;
  document.querySelector("#maintenance-action-name").focus();
}

function updateMaintenanceActionFormMode() {
  const corrective = document.querySelector("#maintenance-action-type").value === "corretiva";
  document.querySelector("#maintenance-action-form").classList.toggle("is-corrective", corrective);
  document.querySelector("#maintenance-action-frequency").required = !corrective;
}

function syncLegacyPlanFromActions() {
  const preventiveActions = editingMaintenanceActions
    .filter((event) => event.tipoManutencao === "preventiva")
    .sort(byDate);
  const preventive = preventiveActions.find((event) => event.periodicidadeMeses) || preventiveActions[0];
  if (!preventive) {
    setupChoice("acao", "");
    document.querySelector("#asset-maintenance-type").value = "preventiva";
    document.querySelector("#asset-periodicidade").value = "";
    document.querySelector("#asset-custo").value = "";
    setupChoice("responsavel", "");
    return;
  }
  setupChoice("acao", preventive.acao || "");
  document.querySelector("#asset-maintenance-type").value = "preventiva";
  document.querySelector("#asset-periodicidade").value = preventive.periodicidadeMeses || "";
  document.querySelector("#asset-custo").value = formatCurrencyInput(Number(preventive.custo || 0));
  setupChoice("responsavel", preventive.responsavel || "");
}

function renderMaintenanceActionList() {
  const container = document.querySelector("#asset-maintenance-actions");
  const todayKey = calendarDateKey(new Date());
  const actions = editingMaintenanceActions
    .filter((event) => !String(event.tipo || "").startsWith("Substit"))
    .sort(byDate);
  container.innerHTML = actions.length
    ? actions.map((event) => {
        const corrective = event.tipoManutencao === "corretiva";
        const typeLabel = corrective ? "Corretiva" : "Preventiva";
        const typeClass = corrective ? "corrective" : "preventive";
        const eventDate = dateInputValue(event.data);
        const completed = isEventCompleted(event);
        const timeClass = eventDate > todayKey
          ? "is-future"
          : eventDate === todayKey
            ? "is-today"
            : completed ? "is-past-completed" : "is-past-missed";
        const checkDisabled = eventDate > todayKey ? "disabled" : "";
        const statusLabel = completed ? "Realizada" : eventDate > todayKey ? "Futura" : eventDate === todayKey ? "Hoje" : "Não realizada";
        const completionControl = corrective
          ? `<span class="maintenance-action-status-mark ${completed ? "is-completed" : ""}" aria-label="${statusLabel}">${completed ? "✓" : "•"}</span>`
          : `<input class="maintenance-action-check" type="checkbox" data-event-key="${escapeHtml(eventScheduleKey(event))}" ${completed ? "checked" : ""} ${checkDisabled} aria-label="Marcar ${escapeHtml(event.acao || "manutenção")} como realizada" />`;
        const detailSummary = [
          event.descricao ? "descrição" : "",
          event.galeria?.length ? `${event.galeria.length} ${event.galeria.length === 1 ? "foto" : "fotos"}` : "",
        ].filter(Boolean).join(" · ");
        return `<div class="maintenance-action-row ${typeClass} ${timeClass}">
          ${completionControl}
          <div class="maintenance-action-name">
            <strong>${escapeHtml(event.acao || "Manutenção")}</strong>
            <span>${typeLabel} · ${statusLabel}${detailSummary ? ` · ${detailSummary}` : ""}</span>
          </div>
          <time>${formatDate(event.data)}</time>
          <strong class="maintenance-action-cost">${money.format(event.custo || 0)}</strong>
          <button class="ghost-button maintenance-action-details" data-event-key="${escapeHtml(eventScheduleKey(event))}" type="button">Detalhes</button>
        </div>`;
      }).join("")
    : `<div class="empty-state compact-empty">Nenhuma ação cadastrada.</div>`;
}

function renderMaintenanceDetailsGallery() {
  const gallery = document.querySelector("#maintenance-details-gallery");
  gallery.innerHTML = editingMaintenanceDetailsPhotos.length
    ? editingMaintenanceDetailsPhotos.map((photo, index) => `
      <figure class="maintenance-details-photo">
        <img src="${photo.url}" alt="Foto ${index + 1} da manutenção" />
        <button class="maintenance-photo-remove" data-photo-index="${index}" type="button" aria-label="Remover foto ${index + 1}">×</button>
      </figure>`).join("")
    : `<div class="maintenance-details-gallery-empty">Nenhuma foto adicionada.</div>`;
}

function openMaintenanceActionDetails(eventKey) {
  const action = editingMaintenanceActions.find((event) => eventScheduleKey(event) === eventKey);
  if (!action) return;
  document.querySelector("#maintenance-details-event-key").value = eventKey;
  document.querySelector("#maintenance-details-title").textContent = action.acao || "Manutenção";
  document.querySelector("#maintenance-details-date").textContent = action.data ? formatDate(action.data) : "Sem data";
  document.querySelector("#maintenance-details-description").value = action.descricao || "";
  document.querySelector("#maintenance-details-photos").value = "";
  editingMaintenanceDetailsPhotos = Array.isArray(action.galeria)
    ? action.galeria.map((photo) => ({ ...photo }))
    : [];
  renderMaintenanceDetailsGallery();
  document.querySelector("#maintenance-action-details-dialog").showModal();
}

function saveMaintenanceActionDetails() {
  const eventKey = document.querySelector("#maintenance-details-event-key").value;
  const action = editingMaintenanceActions.find((event) => eventScheduleKey(event) === eventKey);
  if (!action) return;
  action.descricao = document.querySelector("#maintenance-details-description").value.trim();
  action.galeria = editingMaintenanceDetailsPhotos.map((photo) => ({ ...photo }));
  renderMaintenanceActionList();
  document.querySelector("#maintenance-action-details-dialog").close();
}

async function imageFileToDataUrl(file) {
  const metadata = {
    legenda: "",
    nome: file.name || "",
    data: calendarDateKey(new Date()),
  };
  try {
    const bitmap = await createImageBitmap(file);
    const maximumSide = 1600;
    const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return {
      ...metadata,
      url: canvas.toDataURL("image/jpeg", 0.82),
    };
  } catch {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve({
        url: reader.result,
        ...metadata,
      });
      reader.readAsDataURL(file);
    });
  }
}

async function addMaintenanceDetailPhotos(files) {
  const availableSlots = Math.max(0, 8 - editingMaintenanceDetailsPhotos.length);
  const selectedFiles = [...files].filter((file) => file.type.startsWith("image/")).slice(0, availableSlots);
  if (!selectedFiles.length) {
    if (!availableSlots) window.alert("Esta ação já possui o limite de 8 fotos.");
    return;
  }
  const photos = await Promise.all(selectedFiles.map(imageFileToDataUrl));
  editingMaintenanceDetailsPhotos.push(...photos);
  renderMaintenanceDetailsGallery();
}

async function updateMaintenanceActionCompletion(checkbox) {
  const event = editingMaintenanceActions.find(
    (item) => eventScheduleKey(item) === checkbox.dataset.eventKey,
  );
  if (!event || event.tipoManutencao !== "preventiva") return;
  const previous = {
    realizada: event.realizada,
    status: event.status,
    dataExecucao: event.dataExecucao,
  };
  event.realizada = checkbox.checked;
  event.status = checkbox.checked ? "Realizada" : statusFor(event.data);
  event.dataExecucao = checkbox.checked ? calendarDateKey(new Date()) : "";

  try {
    if (event.dbId) {
      await supabaseRequest(`/rest/v1/maintenance_events?id=eq.${encodeURIComponent(event.dbId)}`, {
        method: "PATCH",
        token: currentSession.access_token,
        body: {
          completed: checkbox.checked,
          status: checkbox.checked ? "cumprido" : "perdido",
          execution_date: checkbox.checked ? event.dataExecucao : null,
        },
      });
    }
    const stateEvent = state.recurrenceEvents.find(
      (item) => eventScheduleKey(item) === checkbox.dataset.eventKey,
    );
    if (stateEvent) Object.assign(stateEvent, event);
    renderMaintenanceActionList();
    render();
  } catch {
    Object.assign(event, previous);
    checkbox.checked = previous.realizada === true;
    window.alert("Não foi possível atualizar esta manutenção no Supabase.");
  }
}

function addMaintenanceAction() {
  const assetId = document.querySelector("#asset-id").value;
  const name = document.querySelector("#maintenance-action-name").value.trim();
  const type = document.querySelector("#maintenance-action-type").value;
  const date = document.querySelector("#maintenance-action-date").value;
  const frequency = Number(document.querySelector("#maintenance-action-frequency").value || 0);
  const cost = parseCurrencyInput(document.querySelector("#maintenance-action-cost").value);
  const responsible = document.querySelector("#maintenance-action-responsible").value.trim();
  const correctiveStatus = document.querySelector("#maintenance-action-status").value;
  const description = document.querySelector("#maintenance-action-description").value.trim();
  const alarmLeadDays = Number(document.querySelector("#maintenance-action-alarm-lead").value || 7);
  const alarmChannels = [
    document.querySelector("#maintenance-alarm-email-channel").checked ? "email" : "",
    document.querySelector("#maintenance-alarm-sms-channel").checked ? "sms" : "",
    document.querySelector("#maintenance-alarm-whatsapp-channel").checked ? "whatsapp" : "",
  ].filter(Boolean);
  const alarmEmail = document.querySelector("#maintenance-alarm-email").value.trim();
  const alarmPhone = document.querySelector("#maintenance-alarm-phone").value.trim();
  if (!name || !date || (type === "preventiva" && !frequency)) {
    window.alert("Informe o nome, a data e, para a preventiva, a frequência.");
    return;
  }
  if (type === "preventiva" && !alarmChannels.length) {
    window.alert("Selecione ao menos um canal para o alarme.");
    return;
  }
  if (type === "preventiva" && alarmChannels.includes("email") && !alarmEmail) {
    window.alert("Informe o e-mail que receberá o alarme.");
    return;
  }
  if (type === "preventiva" && alarmChannels.some((channel) => channel === "sms" || channel === "whatsapp") && !alarmPhone) {
    window.alert("Informe o telefone com DDD para receber SMS ou WhatsApp.");
    return;
  }

  const editingGroup = document.querySelector("#maintenance-action-edit-group").value;
  const group = editingGroup || `acao-${Date.now()}`;
  const previousGroupEvents = editingGroup
    ? editingMaintenanceActions.filter((event) => event.recurrenceGroup === editingGroup)
    : [];
  if (editingGroup) {
    editingMaintenanceActions = editingMaintenanceActions.filter(
      (event) => event.recurrenceGroup !== editingGroup,
    );
  }
  const common = {
    assetId,
    acao: name,
    custo: cost,
    responsavel: responsible,
    tipo: "Manutenção",
    tipoManutencao: type,
    manualEntry: true,
    recurrenceGroup: group,
    ciclo: 1,
    descricao: description,
    galeria: editingMaintenanceRulePhotos.map((photo) => ({ ...photo })),
    alarmeAntecedenciaDias: type === "preventiva" ? alarmLeadDays : 0,
    alarmeNoDia: type === "preventiva",
    alarmeCanais: type === "preventiva" ? alarmChannels : [],
    alarmeEmail: type === "preventiva" ? alarmEmail : "",
    alarmeTelefone: type === "preventiva" ? alarmPhone : "",
  };
  if (type === "corretiva") {
    editingMaintenanceActions.push({
      ...common,
      data: date,
      realizada: correctiveStatus === "realizada",
      status: correctiveStatus === "realizada" ? "Realizada" : statusFor(date),
      dataExecucao: correctiveStatus === "realizada" ? date : "",
      externalEventKey: `${assetId}:${group}:${date}:corretiva`,
    });
  } else {
    const limit = maintenanceActionLimitDate();
    let cursor = safeDate(date);
    let sequence = 1;
    while (cursor && cursor <= limit) {
      const scheduledDate = dateInputValue(cursor);
      editingMaintenanceActions.push({
        ...common,
        data: scheduledDate,
        status: statusFor(scheduledDate),
        periodicidadeMeses: frequency,
        provisionStart: sequence === 1
          ? document.querySelector("#asset-instalacao").value || scheduledDate
          : nextDate(scheduledDate, -frequency),
        externalEventKey: `${assetId}:${group}:${scheduledDate}:preventiva`,
      });
      cursor = safeDate(nextDate(scheduledDate, frequency));
      sequence += 1;
    }
  }

  if (previousGroupEvents.length) {
    const previousByDate = new Map(previousGroupEvents.map((event) => [dateInputValue(event.data), event]));
    editingMaintenanceActions = editingMaintenanceActions.map((event) => {
      if (event.recurrenceGroup !== group) return event;
      const previous = previousByDate.get(dateInputValue(event.data));
      if (!previous) return event;
      const preserved = {
        ...event,
        descricao: previous.descricao || event.descricao || "",
        galeria: Array.isArray(previous.galeria) ? previous.galeria : (event.galeria || []),
      };
      if (previous.realizada === undefined) return preserved;
      return {
        ...preserved,
        realizada: previous.realizada,
        status: previous.status,
        dataExecucao: previous.dataExecucao || "",
        custoReal: previous.custoReal,
      };
    });
  }

  syncLegacyPlanFromActions();
  renderMaintenancePlanList();
  renderMaintenanceActionList();
  renderAssetSummary();
  resetMaintenanceActionForm();
  document.querySelector("#maintenance-action-form").hidden = true;
}

function renderAssetSummary() {
  const installationDate = document.querySelector("#asset-instalacao").value;
  const lastMaintenanceDate = document.querySelector("#asset-ultima").value;
  const lifeYears = Number(document.querySelector("#asset-vida").value || 0);
  const periodicityMonths = Number(document.querySelector("#asset-periodicidade").value || 0);
  const maintenanceCost = parseCurrencyInput(document.querySelector("#asset-custo").value);
  const assetValue = parseCurrencyInput(document.querySelector("#asset-valor").value);
  const endMode = getLifeEndMode();
  const maintenanceType = document.querySelector("#asset-maintenance-type").value || "preventiva";
  const maintenanceAction = getChoiceValue("acao");
  const responsible = getChoiceValue("responsavel");
  const totalCycles = updateCycleLimit(document.querySelector("#asset-ciclos").value || 1);
  const maximumCycles = maxCyclesForLife(lifeYears, document.querySelector("#asset-building").value);
  const effectiveCycles = totalCycles;
  const todayKey = calendarDateKey(new Date());
  const nextProgrammedMaintenance = [...editingMaintenanceActions]
    .filter((event) =>
      event.tipoManutencao === "preventiva" &&
      !String(event.tipo || "").startsWith("Substit") &&
      dateInputValue(event.data) >= todayKey
    )
    .sort(byDate)[0];
  const nextMaintenanceDate = nextProgrammedMaintenance?.data ||
    nextDate(lastMaintenanceDate || installationDate, periodicityMonths);
  const startDate = safeDate(installationDate);
  const dates = startDate
    ? Array.from({ length: effectiveCycles }, (_, index) => {
        const cycleStart = addYears(startDate, lifeYears * index).toISOString().slice(0, 10);
        return maintenanceDatesUntil({ installationDate: cycleStart, lifeYears, periodicityMonths }).map((date) => ({
          date,
          cycle: index + 1,
        }));
      }).flat()
    : [];
  const replacementMonths = lifeYears * 12;
  const preventiveRules = maintenancePlanRules().filter((rule) => rule.tipoManutencao === "preventiva");
  const monthlyMaintenance = preventiveRules.length
    ? preventiveRules.reduce((total, rule) =>
        total + (Number(rule.periodicidadeMeses || 0) ? Number(rule.custo || 0) / Number(rule.periodicidadeMeses) : 0), 0)
    : periodicityMonths ? maintenanceCost / periodicityMonths : 0;
  const replacementCount = endMode === "renovar" ? totalCycles : Math.max(0, totalCycles - 1);
  const hasNextCycle = replacementCount > 0;
  const monthlyReplacement = hasNextCycle && replacementMonths ? assetValue / replacementMonths : 0;
  const totalMonthlyProvision = monthlyMaintenance + monthlyReplacement;
  const programmedMaintenanceEvents = editingMaintenanceActions.filter(
    (event) => !String(event.tipo || "").startsWith("Substit"),
  );
  const maintenanceCount = programmedMaintenanceEvents.length || dates.length;
  const totalMaintenanceCost = programmedMaintenanceEvents.length
    ? programmedMaintenanceEvents.reduce((total, event) => total + Number(event.custo || 0), 0)
    : dates.length * maintenanceCost;
  const endDate = installationDate && lifeYears ? addYears(safeDate(installationDate), lifeYears).toISOString().slice(0, 10) : "";
  const replacementTotal = replacementCount * assetValue;
  const assetId = document.querySelector("#asset-id").value;
  const savedEvents = state.recurrenceEvents.filter((event) => event.assetId === assetId);
  const savedByKey = new Map(savedEvents.map((event) => [eventScheduleKey(event), event]));
  const maintenanceEvents = dates.map((item) => ({
    assetId,
    data: item.date,
    tipoManutencao: maintenanceType,
    tipo: "Manutenção",
    ciclo: item.cycle,
    custo: maintenanceCost,
  }));
  const replacementEvents = startDate
    ? Array.from({ length: replacementCount }, (_, index) => ({
        assetId,
        data: addYears(startDate, lifeYears * (index + 1)).toISOString().slice(0, 10),
        tipo: "Substituição",
        ciclo: index + 1,
        custo: assetValue,
      }))
    : [];
  const scheduleEvents = [...maintenanceEvents, ...replacementEvents]
    .map((event) => ({ ...event, ...(savedByKey.get(eventScheduleKey(event)) || {}) }))
    .sort(byDate);

  const summary = document.querySelector("#asset-summary");
  if (!installationDate || !lifeYears || !periodicityMonths) {
    summary.innerHTML = "Preencha data de instalação, vida útil e periodicidade para ver o resumo financeiro.";
    renderMaintenanceActionList();
    return;
  }

  summary.innerHTML = `<h3>Resumo financeiro e de vida útil</h3>
    <div class="summary-grid">
      <div class="summary-kpi"><span>Próxima manutenção</span><strong>${nextMaintenanceDate ? formatDate(nextMaintenanceDate) : "Não calculada"}</strong></div>
      <div class="summary-kpi"><span>Fim da expectativa</span><strong>${formatDate(endDate)}</strong></div>
      <div class="summary-kpi"><span>Manutenções previstas</span><strong>${maintenanceCount}</strong></div>
      <div class="summary-kpi"><span>Custo total de manutenção</span><strong>${money.format(totalMaintenanceCost)}</strong></div>
      <div class="summary-kpi"><span>Valor do ativo</span><strong>${money.format(assetValue)}</strong></div>
      <div class="summary-kpi"><span>Provisão mensal manutenção</span><strong>${money.format(monthlyMaintenance)}</strong></div>
      <div class="summary-kpi"><span>Provisão mensal substituição</span><strong>${money.format(monthlyReplacement)}</strong></div>
      <div class="summary-kpi"><span>Provisão mensal total</span><strong>${money.format(totalMonthlyProvision)}</strong></div>
      <div class="summary-kpi"><span>Total manutenção + substituição</span><strong>${money.format(totalMaintenanceCost + replacementTotal)}</strong></div>
      <div class="summary-kpi"><span>Ao fim da vida</span><strong>${endMode === "renovar" ? "Renovar" : "Encerrar"}</strong></div>
      <div class="summary-kpi"><span>Ciclos programados</span><strong>${effectiveCycles}${maximumCycles ? ` de ${maximumCycles} máx.` : ""}</strong></div>
    </div>`;

  renderMaintenanceActionList();
}

function bindMaintenanceActionChecks(container) {
  container.querySelectorAll(".asset-event-check input[data-event-key]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const event = state.recurrenceEvents.find((item) => eventScheduleKey(item) === checkbox.dataset.eventKey);
      if (!event) return;
      const previous = event.realizada;
      event.realizada = checkbox.checked;
      event.status = checkbox.checked ? "Realizada" : statusFor(event.data);
      try {
        if (event.dbId) {
          await supabaseRequest(`/rest/v1/maintenance_events?id=eq.${encodeURIComponent(event.dbId)}`, {
            method: "PATCH",
            token: currentSession.access_token,
            body: {
              completed: checkbox.checked,
              status: checkbox.checked ? "cumprido" : "perdido",
              execution_date: checkbox.checked ? calendarDateKey(new Date()) : null,
            },
          });
        }
        render();
        renderAssetSummary();
      } catch {
        event.realizada = previous;
        checkbox.checked = previous === true;
        window.alert("Não foi possível atualizar esta manutenção no Supabase.");
      }
    });
  });
}

function buildAssetEvents(asset) {
  const events = [];
  const installDate = safeDate(asset.dataInstalacao);
  const totalCycles = clampCycles(asset.totalCiclos, asset.expectativaVidaAnos, asset.buildingId);
  const renew = (asset.fimVida || "renovar") === "renovar";
  const effectiveCycles = totalCycles;

  if (installDate && asset.expectativaVidaAnos && asset.periodicidadeMeses) {
    for (let cycle = 1; cycle <= effectiveCycles; cycle += 1) {
      const cycleStart = addYears(installDate, asset.expectativaVidaAnos * (cycle - 1)).toISOString().slice(0, 10);
      const maintenanceDates = maintenanceDatesUntil({
        installationDate: cycleStart,
        lifeYears: asset.expectativaVidaAnos,
        periodicityMonths: asset.periodicidadeMeses,
      });

      maintenanceDates.forEach((date, index) => {
        events.push({
          assetId: asset.id,
          data: date,
          sistema: asset.sistema,
          ambiente: asset.ambiente,
          ativo: asset.ativo,
          acao: asset.acao || "Manutenção preventiva",
          custo: Number(asset.custoTotal || 0),
          status: statusFor(date),
          prioridade: asset.prioridade,
          tipo: "Manutenção",
          tipoManutencao: asset.tipoManutencao || "preventiva",
          ciclo: cycle,
          provisionStart: index === 0 ? cycleStart : maintenanceDates[index - 1],
        });
      });

      const needsReplacement = renew || cycle < effectiveCycles;
      if (needsReplacement && asset.valorAtivo) {
        const replacementDate = addYears(installDate, asset.expectativaVidaAnos * cycle).toISOString().slice(0, 10);
        events.push({
          assetId: asset.id,
          data: replacementDate,
          sistema: asset.sistema,
          ambiente: asset.ambiente,
          ativo: asset.ativo,
          acao: "Substituição do ativo",
          custo: Number(asset.valorAtivo || 0),
          status: statusFor(replacementDate),
          prioridade: asset.prioridade,
          tipo: "Substituição",
          ciclo: cycle,
          provisionStart: cycleStart,
        });
      }
    }
  }

  if (!events.length && asset.proximaManutencao) {
    events.push({
      assetId: asset.id,
      data: dateInputValue(asset.proximaManutencao),
      sistema: asset.sistema,
      ambiente: asset.ambiente,
      ativo: asset.ativo,
      acao: asset.acao || "Manutenção",
      custo: Number(asset.custoTotal || 0),
      status: statusFor(asset.proximaManutencao),
      prioridade: asset.prioridade,
      tipo: "Manutenção",
    });
  }

  return events;
}

function syncAssetSchedule(asset) {
  const previousEvents = state.recurrenceEvents.filter((event) => event.assetId === asset.id);
  const hasManagedPlan = previousEvents.some((event) => event.manualEntry || event.recurrenceGroup);
  const canRebuildSchedule = Boolean(
    asset.dataInstalacao &&
    asset.expectativaVidaAnos &&
    asset.periodicidadeMeses,
  );

  if (hasManagedPlan || (!canRebuildSchedule && previousEvents.length)) {
    previousEvents.forEach((event) => {
      event.sistema = asset.sistema;
      event.ambiente = asset.ambiente;
      event.ativo = asset.ativo;
      event.prioridade = asset.prioridade;
      if (!hasManagedPlan && !String(event.tipo || "").startsWith("Substit")) {
        event.acao = asset.acao || event.acao;
        event.custo = Number(asset.custoTotal || 0);
      }
    });
    return;
  }

  const completionByKey = new Map(
    previousEvents.map((event) => [eventScheduleKey(event), { realizada: event.realizada, status: event.status }]),
  );
  state.recurrenceEvents = state.recurrenceEvents.filter((event) => event.assetId !== asset.id);
  state.recurrenceEvents.push(
    ...buildAssetEvents(asset).map((event) => {
      const previous = completionByKey.get(eventScheduleKey(event));
      if (!previous || previous.realizada === undefined) return event;
      return {
        ...event,
        realizada: previous.realizada,
        status: previous.realizada ? "Realizada" : statusFor(event.data),
      };
    }),
  );
}

function updateCycleLimit(requestedCycles) {
  const input = document.querySelector("#asset-ciclos");
  const lifeYears = Number(document.querySelector("#asset-vida").value || 0);
  const buildingId = document.querySelector("#asset-building").value;
  const maximum = maxCyclesForLife(lifeYears, buildingId);
  const cycles = clampCycles(requestedCycles, lifeYears, buildingId);
  input.max = maximum || "";
  input.value = cycles;
  input.title = maximum
    ? `Máximo de ${maximum} ciclo(s) no horizonte de ${planningHorizonYears(buildingId)} anos`
    : "Informe a expectativa de vida para calcular o limite";
  return cycles;
}

async function applyPlanningHorizon(buildingIds = selectedReportBuildingIds("timeline")) {
  const affectedAssets = state.assets.filter((asset) => buildingIds.includes(asset.buildingId));
  affectedAssets.forEach((asset) => {
    asset.totalCiclos = clampCycles(asset.totalCiclos, asset.expectativaVidaAnos, asset.buildingId);
    syncAssetSchedule(asset);
  });
  render();
  try {
    for (const asset of affectedAssets.filter((item) => item.dbId)) {
      await supabaseRequest(`/rest/v1/assets?id=eq.${encodeURIComponent(asset.dbId)}`, {
        method: "PATCH",
        token: currentSession.access_token,
        body: { total_cycles: asset.totalCiclos },
      });
      await persistAssetSchedule(asset, asset.planDbId);
    }
    await loadOperationalData();
  } catch {
    window.alert("O horizonte foi alterado localmente, mas não foi possível atualizar toda a programação no Supabase.");
  }
}

async function deleteAsset(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const ok = window.confirm(`Excluir "${asset.ativo || asset.sistema || asset.id}" e remover sua programação financeira?`);
  if (!ok) return;
  try {
    if (asset.dbId) {
      await supabaseRequest(`/rest/v1/assets?id=eq.${encodeURIComponent(asset.dbId)}`, {
        method: "DELETE",
        token: currentSession.access_token,
      });
    }
    state.assets = state.assets.filter((item) => item.id !== assetId);
    state.recurrenceEvents = state.recurrenceEvents.filter((event) => event.assetId !== assetId);
    if (focusedAssetId === assetId) focusedAssetId = "";
    const summaryDialog = document.querySelector("#asset-summary-dialog");
    if (summaryDialog.open) summaryDialog.close();
    render();
    activateView("assets");
  } catch {
    window.alert("Não foi possível excluir o ativo no Supabase.");
  }
}

function renderPhotoPreview() {
  const preview = document.querySelector("#photo-preview");
  preview.src = editingPhoto;
  preview.style.display = editingPhoto ? "block" : "none";
}

async function ensureAssetType(name) {
  const types = await supabaseRequest(
    `/rest/v1/asset_types?select=*&owner_id=eq.${encodeURIComponent(currentUserId)}`,
    { token: currentSession.access_token },
  );
  let assetType = types.find(
    (item) => item.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0,
  );
  if (assetType) return assetType;

  const rows = await supabaseRequest("/rest/v1/asset_types", {
    method: "POST",
    token: currentSession.access_token,
    headers: { Prefer: "return=representation" },
    body: { owner_id: currentUserId, name },
  });
  return rows[0];
}

function databaseEventBody(event, asset, planId) {
  const replacement = String(event.tipo || "").startsWith("Substit");
  const eventType = replacement ? "substituicao" : "manutencao";
  const key = event.externalEventKey ||
    `${asset.id}:${dateInputValue(event.data)}:${eventType}:c${Number(event.ciclo || 1)}`;
  return {
    owner_id: currentUserId,
    building_id: asset.buildingId || asset.technicalBuildingId,
    asset_id: asset.dbId,
    plan_id: planId || null,
    external_event_key: key,
    event_type: eventType,
    scheduled_date: dateInputValue(event.data),
    execution_date: dateInputValue(event.dataExecucao) || null,
    status: event.realizada === true
      ? "cumprido"
      : event.realizada === false
        ? "perdido"
        : String(event.status || "programado").toLocaleLowerCase("pt-BR"),
    estimated_cost: Number(event.custo || 0),
    actual_cost: event.custoReal === null || event.custoReal === undefined ? null : Number(event.custoReal),
    completed: event.realizada === undefined ? null : event.realizada,
    cycle_number: Number(event.ciclo || 1),
    provision_start_date: dateInputValue(event.provisionStart) || null,
    notes: event.descricao || null,
    properties: {
      action: event.acao || "",
      environment: event.ambiente || "",
      asset_name: event.ativo || asset.ativo,
      priority: event.prioridade || "",
      system: event.sistema || "",
      maintenance_type: event.tipoManutencao || asset.tipoManutencao || "preventiva",
      responsible: event.responsavel || "",
      manual_entry: event.manualEntry === true,
      recurrence_group: event.recurrenceGroup || "",
      recurrence_months: Number(event.periodicidadeMeses || 0) || null,
      galeria: Array.isArray(event.galeria) ? event.galeria : [],
      alarm_lead_days: Number(event.alarmeAntecedenciaDias || 0) || null,
      alarm_on_due_date: event.alarmeNoDia === true,
      alarm_channels: Array.isArray(event.alarmeCanais) ? event.alarmeCanais : [],
      alarm_email: event.alarmeEmail || null,
      alarm_phone: event.alarmeTelefone || null,
    },
  };
}

async function persistAssetSchedule(asset, planId) {
  await supabaseRequest(`/rest/v1/maintenance_events?asset_id=eq.${encodeURIComponent(asset.dbId)}`, {
    method: "DELETE",
    token: currentSession.access_token,
  });
  const events = state.recurrenceEvents.filter((event) => event.assetId === asset.id);
  if (!events.length) return;
  await supabaseRequest("/rest/v1/maintenance_events", {
    method: "POST",
    token: currentSession.access_token,
    headers: { Prefer: "return=representation" },
    body: events.map((event) => databaseEventBody(event, asset, planId)),
  });
}

async function saveAsset() {
  if (!buildingData.buildings.length) {
    window.alert("Crie uma edificação antes de cadastrar ativos.");
    return;
  }
  const targetBuildingId = document.querySelector("#asset-building").value;
  if (!targetBuildingId) {
    window.alert("Selecione a edificação deste ativo.");
    return;
  }
  const id = document.querySelector("#asset-id").value || `ATIVO-${Date.now()}`;
  const periodicidadeMeses = Number(document.querySelector("#asset-periodicidade").value || 0);
  const tipoManutencao = document.querySelector("#asset-maintenance-type").value || "preventiva";
  const ultimaManutencao = document.querySelector("#asset-ultima").value;
  const dataInstalacao = document.querySelector("#asset-instalacao").value;
  const todayKey = dateInputValue(new Date());
  const firstPreventiveAction = editingMaintenanceActions
    .filter((event) =>
      event.tipoManutencao === "preventiva" &&
      dateInputValue(event.data) >= todayKey
    )
    .sort(byDate)[0];
  const proximaManutencao = firstPreventiveAction?.data ||
    nextDate(ultimaManutencao || dataInstalacao, periodicidadeMeses);
  const custoUnitario = parseCurrencyInput(document.querySelector("#asset-custo").value);
  const locationId = document.querySelector("#asset-ambiente").value;
  const systemId = document.querySelector("#asset-sistema").value;
  const locationRecord = buildingData.locations.find(
    (location) => location.id === locationId && location.building_id === targetBuildingId,
  );
  const systemRecord = buildingData.systems.find(
    (system) => system.id === systemId && system.building_id === targetBuildingId,
  );
  const ambiente = locationRecord?.name || "";
  const sistema = systemRecord?.name || "";
  const ativo = getChoiceValue("ativo");
  const componente = getChoiceValue("componente");
  const acao = getChoiceValue("acao");
  const prioridade = getChoiceValue("prioridade");
  const responsavel = getChoiceValue("responsavel");
  const index = state.assets.findIndex((item) => item.id === id);
  const previous = index >= 0 ? state.assets[index] : null;
  const galeria = editingPhoto
    ? [{ url: editingPhoto, legenda: "" }]
    : (previous?.galeria || []);
  const asset = {
    id,
    ambiente,
    zona: "",
    sistema,
    subsistema: "",
    ativo,
    componente,
    acao,
    quantidade: 1,
    unidade: "un",
    periodicidadeMeses,
    tipoManutencao,
    ultimaManutencao,
    proximaManutencao,
    custoUnitario,
    custoTotal: custoUnitario,
    dataInstalacao,
    expectativaVidaAnos: Number(document.querySelector("#asset-vida").value || 0),
    valorAtivo: parseCurrencyInput(document.querySelector("#asset-valor").value),
    fimVida: getLifeEndMode(),
    totalCiclos: clampCycles(
      document.querySelector("#asset-ciclos").value,
      document.querySelector("#asset-vida").value,
      targetBuildingId,
    ),
    prioridade,
    estado: "",
    status: statusFor(proximaManutencao),
    responsavel,
    observacoes: "",
    foto: editingPhoto,
    galeria,
    buildingId: targetBuildingId,
    technicalBuildingId: targetBuildingId,
    buildingAssignmentPending: false,
    locationId,
    systemId,
  };

  asset.dbId = previous?.dbId || "";
  asset.planDbId = previous?.planDbId || "";
  asset.dbProperties = previous?.dbProperties || {};

  try {
    const assetType = ativo ? await ensureAssetType(ativo) : null;
    const body = {
      ...(asset.dbId ? {} : { owner_id: currentUserId }),
      building_id: targetBuildingId,
      location_id: locationRecord?.id || null,
      system_id: systemRecord?.id || null,
      asset_type_id: assetType?.id || null,
      external_code: id,
      name: ativo || "Ativo pendente",
      subsystem: asset.subsistema || null,
      component: componente || null,
      planned_action: acao || null,
      quantity: 1,
      unit: "un",
      periodicity_months: periodicidadeMeses || null,
      last_maintenance_date: ultimaManutencao || null,
      next_maintenance_date: proximaManutencao || null,
      installation_date: asset.dataInstalacao || null,
      expected_life_years: asset.expectativaVidaAnos || null,
      acquisition_value: asset.valorAtivo || 0,
      estimated_unit_cost: custoUnitario || 0,
      estimated_total_cost: custoUnitario || 0,
      end_of_life_action: asset.fimVida,
      total_cycles: asset.totalCiclos,
      priority: prioridade || null,
      status: asset.status,
      responsible: responsavel || null,
      photo_path: editingPhoto || null,
      properties: {
        ...asset.dbProperties,
        building_assignment_pending: false,
        galeria: asset.galeria,
      },
    };
    const savedRows = await supabaseRequest(asset.dbId
      ? `/rest/v1/assets?id=eq.${encodeURIComponent(asset.dbId)}`
      : "/rest/v1/assets", {
      method: asset.dbId ? "PATCH" : "POST",
      token: currentSession.access_token,
      headers: { Prefer: "return=representation" },
      body,
    });
    asset.dbId = savedRows[0].id;

    if (index >= 0) state.assets[index] = asset;
    else state.assets.unshift(asset);
    if (editingMaintenanceActions.length) {
      state.recurrenceEvents = state.recurrenceEvents.filter((event) => event.assetId !== asset.id);
      state.recurrenceEvents.push(...editingMaintenanceActions.map((event) => ({
        ...event,
        assetId: asset.id,
        sistema: asset.sistema,
        ambiente: asset.ambiente,
        ativo: asset.ativo,
        prioridade: asset.prioridade,
      })));
    } else {
      syncAssetSchedule(asset);
    }

    const hasMaintenancePlan = Boolean(acao || periodicidadeMeses || ultimaManutencao || custoUnitario);
    if (hasMaintenancePlan || asset.planDbId) {
      const planBody = {
        ...(asset.planDbId ? {} : { owner_id: currentUserId }),
        building_id: targetBuildingId,
        asset_id: asset.dbId,
        name: acao || "Manutenção periódica",
        maintenance_type: tipoManutencao,
        periodicity_months: periodicidadeMeses || null,
        estimated_cost: custoUnitario || 0,
        start_date: asset.dataInstalacao || ultimaManutencao || proximaManutencao || null,
        active: hasMaintenancePlan,
      };
      const planRows = await supabaseRequest(asset.planDbId
        ? `/rest/v1/maintenance_plans?id=eq.${encodeURIComponent(asset.planDbId)}`
        : "/rest/v1/maintenance_plans", {
        method: asset.planDbId ? "PATCH" : "POST",
        token: currentSession.access_token,
        headers: { Prefer: "return=representation" },
        body: planBody,
      });
      asset.planDbId = planRows[0].id;
    }
    await persistAssetSchedule(asset, asset.planDbId);
    await loadBuildingData();
    focusedAssetId = asset.id;
    activateView("assets");
  } catch (error) {
    window.alert(error.message || "Não foi possível salvar o ativo no Supabase.");
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateView(tab.dataset.view));
});

["assets", "dashboard", "timeline", "finance"].forEach((report) => {
  document.querySelector(`#${report}-building-filter`).addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const selection = reportBuildingSelections[report];
    if (event.target.checked) selection.add(event.target.value);
    else selection.delete(event.target.value);
    renderReportBuildingFilters();

    if (report === "assets") {
      renderAssets();
    } else if (report === "dashboard") {
      renderKpis();
      renderSystemBars();
      renderNextEvents();
      renderCalendar();
    } else if (report === "timeline") {
      renderFilters();
      renderTimeline();
      renderTimelineCalendar();
    } else {
      renderFinance();
    }
  });
});

document.querySelector("#new-building").addEventListener("click", () => {
  openBuildingDialog();
});
document.querySelector("#save-building").addEventListener("click", saveBuildingRecord);
document.querySelector("#buildings-list").addEventListener("click", (event) => {
  const summary = event.target.closest(".building-summary");
  if (summary) event.preventDefault();

  const toggle = event.target.closest(".building-toggle, .building-title");
  if (toggle) {
    toggleBuilding(toggle.dataset.buildingId);
    return;
  }

  const editBuildingButton = event.target.closest(".edit-building");
  if (editBuildingButton) {
    const building = buildingData.buildings.find((item) => item.id === editBuildingButton.dataset.buildingId);
    if (building) openBuildingDialog(building);
    return;
  }

  const addLocationButton = event.target.closest(".add-location");
  if (addLocationButton) {
    openLocationDialog(addLocationButton.dataset.buildingId);
    return;
  }

  const editLocationButton = event.target.closest(".edit-location");
  if (editLocationButton) {
    const location = buildingData.locations.find((item) => item.id === editLocationButton.dataset.locationId);
    if (location) openLocationDialog(location.building_id, location);
  }
});
document.querySelector("#buildings-list").addEventListener("keydown", (event) => {
  const title = event.target.closest(".building-title");
  if (title && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    toggleBuilding(title.dataset.buildingId);
  }
});
document.querySelector("#save-location").addEventListener("click", saveLocationRecord);
document.querySelector("#systems-building-filter").addEventListener("change", renderSystemsView);
document.querySelector("#standards-catalog").addEventListener("click", (event) => {
  const button = event.target.closest(".add-standard-system");
  if (button && !button.disabled) createNormativeSystem(button.dataset.systemKey);
});
document.querySelector("#new-custom-system").addEventListener("click", () => {
  if (!selectedSystemsBuildingId()) {
    setDataMessage("systems-message", "Crie uma edificação antes de cadastrar sistemas.");
    return;
  }
  document.querySelector("#system-dialog").showModal();
});
document.querySelector("#save-custom-system").addEventListener("click", createCustomSystem);
document.querySelector("#building-systems-list").addEventListener("click", (event) => {
  const button = event.target.closest(".delete-building-system");
  if (button) deleteBuildingSystem(button.dataset.systemId);
});

document.querySelector("#new-asset").addEventListener("click", () => openDialog());
document.querySelector("#save-asset").addEventListener("click", saveAsset);
document.querySelector("#delete-asset").addEventListener("click", () => {
  const assetId = document.querySelector("#asset-id").value;
  if (assetId) deleteAsset(assetId);
});
document.querySelector("#cancel-asset-edit").addEventListener("click", closeAssetEditor);
document.querySelector("#back-to-assets").addEventListener("click", closeAssetEditor);
document.querySelector("#asset-summary-edit").addEventListener("click", () => {
  const assetId = document.querySelector("#asset-summary-dialog").dataset.assetId;
  if (!assetId) return;
  openDialog(state.assets.find((asset) => asset.id === assetId));
});
document.querySelector("#asset-search").addEventListener("input", renderAssets);
document.querySelector("#system-filter").addEventListener("change", renderAssets);
document.querySelector("#asset-sort").addEventListener("change", renderAssets);
document.querySelector("#calendar-prev").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  renderCalendar();
  renderKpis();
});
document.querySelector("#calendar-next").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  renderCalendar();
  renderKpis();
});
document.querySelector("#calendar-slider").addEventListener("input", (event) => {
  const bounds = calendarBounds();
  const selectedIndex = bounds.minIndex + Number(event.target.value || 0);
  calendarCursor = new Date(Math.floor(selectedIndex / 12), selectedIndex % 12, 1);
  renderCalendar();
  renderKpis();
});
document.querySelector("#calendar-today").addEventListener("click", () => {
  const today = new Date();
  calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
  clampCalendarCursor();
  renderCalendar();
  renderKpis();
});
document.querySelector("#timeline-calendar-prev").addEventListener("click", () => {
  timelineCalendarCursor = addMonths(timelineCalendarCursor, -1);
  renderTimelineCalendar();
});
document.querySelector("#timeline-calendar-next").addEventListener("click", () => {
  timelineCalendarCursor = addMonths(timelineCalendarCursor, 1);
  renderTimelineCalendar();
});
document.querySelector("#timeline-calendar-today").addEventListener("click", () => {
  const today = new Date();
  timelineCalendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
  renderTimelineCalendar();
});
document.querySelector("#timeline-calendar-range").addEventListener("input", (event) => {
  const bounds = calendarBounds("timeline");
  const index = bounds.minIndex + Number(event.target.value || 0);
  timelineCalendarCursor = new Date(Math.floor(index / 12), index % 12, 1);
  renderTimelineCalendar();
});
let timelineCalendarResizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(timelineCalendarResizeTimer);
  timelineCalendarResizeTimer = setTimeout(renderTimelineCalendar, 120);
});
document.querySelector("#planning-horizon").addEventListener("change", (event) => {
  const years = Math.max(1, Number(event.target.value || 50));
  const buildingIds = selectedReportBuildingIds("timeline");
  Promise.all(buildingIds.map((buildingId) => {
    const building = buildingData.buildings.find((item) => item.id === buildingId);
    building.properties = {
      ...(building.properties || {}),
      planning_horizon_years: years,
    };
    return supabaseRequest(`/rest/v1/buildings?id=eq.${encodeURIComponent(buildingId)}`, {
      method: "PATCH",
      token: currentSession.access_token,
      body: { properties: building.properties },
    });
  }))
    .then(() => applyPlanningHorizon(buildingIds))
    .catch(() => window.alert("Não foi possível atualizar o horizonte das edificações."));
});
document.querySelector("#year-filter").addEventListener("change", renderTimeline);
document.querySelector("#status-filter").addEventListener("change", renderTimeline);
document.querySelector("#owners-input").addEventListener("input", renderFinance);
document.querySelector("#reserve-input").addEventListener("input", renderFinance);
document.querySelector("#asset-building").addEventListener("change", (event) => {
  setupAssetScopeChoices(event.target.value);
});
["ambiente", "sistema", "ativo", "componente", "acao", "prioridade", "responsavel"].forEach((id) => {
  document.querySelector(`#asset-${id}`).addEventListener("change", () => {
    updateChoiceMode(id);
    if (id === "acao" || id === "responsavel") renderAssetSummary();
  });
});
["asset-instalacao", "asset-vida", "asset-periodicidade", "asset-ultima", "asset-custo", "asset-valor", "asset-ciclos"].forEach((id) => {
  document.querySelector(`#${id}`).addEventListener("input", renderAssetSummary);
});
document.querySelector("#asset-maintenance-type").addEventListener("change", renderAssetSummary);
document.querySelector("#show-maintenance-action-form").addEventListener("click", () => {
  const form = document.querySelector("#maintenance-action-form");
  form.hidden = false;
  if (!document.querySelector("#maintenance-action-date").value) {
    document.querySelector("#maintenance-action-date").value = dateInputValue(new Date());
  }
  document.querySelector("#maintenance-action-name").focus();
});
document.querySelector("#cancel-maintenance-action").addEventListener("click", () => {
  document.querySelector("#maintenance-action-form").hidden = true;
  resetMaintenanceActionForm();
});
document.querySelector("#clear-maintenance-action").addEventListener("click", resetMaintenanceActionForm);
document.querySelector("#maintenance-action-type").addEventListener("change", updateMaintenanceActionFormMode);
document.querySelector("#add-maintenance-action").addEventListener("click", addMaintenanceAction);
document.querySelector("#maintenance-action-photos").addEventListener("change", async (event) => {
  const availableSlots = Math.max(0, 8 - editingMaintenanceRulePhotos.length);
  const files = [...event.target.files]
    .filter((file) => file.type.startsWith("image/"))
    .slice(0, availableSlots);
  try {
    const photos = await Promise.all(files.map(imageFileToDataUrl));
    editingMaintenanceRulePhotos.push(...photos);
    renderMaintenanceRuleGallery();
    if (!availableSlots) window.alert("Esta ação já possui o limite de 8 fotos.");
  } catch {
    window.alert("Não foi possível ler uma das imagens selecionadas.");
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#maintenance-action-gallery").addEventListener("click", (event) => {
  const removeButton = event.target.closest(".maintenance-rule-photo-remove");
  if (!removeButton) return;
  editingMaintenanceRulePhotos.splice(Number(removeButton.dataset.photoIndex), 1);
  renderMaintenanceRuleGallery();
});
document.querySelector("#maintenance-action-cost").addEventListener("blur", (event) => {
  if (event.target.value.trim()) event.target.value = formatCurrencyInput(event.target.value);
});
document.querySelector("#asset-maintenance-plan-list").addEventListener("click", (event) => {
  const editButton = event.target.closest(".edit-maintenance-rule");
  if (editButton) {
    editMaintenanceRule(editButton.dataset.group);
    return;
  }
  const removeButton = event.target.closest(".maintenance-rule-remove");
  if (!removeButton) return;
  editingMaintenanceActions = editingMaintenanceActions.filter(
    (item) => item.recurrenceGroup !== removeButton.dataset.group,
  );
  syncLegacyPlanFromActions();
  renderMaintenancePlanList();
  renderMaintenanceActionList();
  renderAssetSummary();
});
document.querySelector("#asset-maintenance-actions").addEventListener("change", (event) => {
  const checkbox = event.target.closest(".maintenance-action-check");
  if (checkbox) updateMaintenanceActionCompletion(checkbox);
});
document.querySelector("#asset-maintenance-actions").addEventListener("click", (event) => {
  const detailsButton = event.target.closest(".maintenance-action-details");
  if (detailsButton) openMaintenanceActionDetails(detailsButton.dataset.eventKey);
});
document.querySelector("#maintenance-details-photos").addEventListener("change", async (event) => {
  try {
    await addMaintenanceDetailPhotos(event.target.files);
  } catch {
    window.alert("Não foi possível ler uma das imagens selecionadas.");
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#maintenance-details-gallery").addEventListener("click", (event) => {
  const removeButton = event.target.closest(".maintenance-photo-remove");
  if (!removeButton) return;
  editingMaintenanceDetailsPhotos.splice(Number(removeButton.dataset.photoIndex), 1);
  renderMaintenanceDetailsGallery();
});
document.querySelector("#save-maintenance-details").addEventListener("click", saveMaintenanceActionDetails);
["asset-custo", "asset-valor"].forEach((id) => {
  const input = document.querySelector(`#${id}`);
  input.addEventListener("focus", () => {
    const value = parseCurrencyInput(input.value);
    input.value = value ? String(value).replace(".", ",") : "";
  });
  input.addEventListener("blur", () => {
    if (input.value.trim()) input.value = formatCurrencyInput(input.value);
    renderAssetSummary();
  });
});
document.querySelectorAll('input[name="asset-fim-vida"]').forEach((input) => input.addEventListener("change", renderAssetSummary));
document.querySelector("#asset-encerrar").addEventListener("change", (event) => {
  if (!event.target.checked) return;
  document.querySelector("#asset-ciclos").value = 1;
  renderAssetSummary();
});
document.querySelector("#reset-data").addEventListener("click", async () => {
  localStorage.removeItem(storageKey);
  state.settings = { planningHorizonYears: 50 };
  await loadOperationalData();
});
document.querySelector("#asset-list").addEventListener("click", (event) => {
  const button = event.target.closest(".edit-asset");
  const deleteButton = event.target.closest(".delete-asset-card");
  const card = event.target.closest(".asset-card");
  if (deleteButton) {
    deleteAsset(deleteButton.dataset.id);
    return;
  }
  if (button) {
    openDialog(state.assets.find((asset) => asset.id === button.dataset.id));
    return;
  }
  if (card) openAssetSummary(state.assets.find((asset) => asset.id === card.dataset.id));
});
document.querySelector("#asset-foto").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    editingPhoto = reader.result;
    renderPhotoPreview();
  };
  reader.readAsDataURL(file);
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.querySelector("#login-submit");
  const message = document.querySelector("#auth-message");
  submit.disabled = true;
  submit.textContent = authMode === "signup" ? "Criando..." : "Entrando...";
  setAuthMessage();

  try {
    const email = document.querySelector("#login-email").value.trim();
    const password = document.querySelector("#login-password").value;

    if (authMode === "signup") {
      const confirmation = document.querySelector("#signup-password-confirmation").value;
      if (password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
      if (password !== confirmation) throw new Error("As senhas não coincidem.");

      const result = await signUp(
        document.querySelector("#signup-name").value.trim(),
        email,
        password,
      );

      if (result.access_token && result.user) {
        showApplication(result.user, result);
      } else {
        setAuthMode("login");
        document.querySelector("#login-email").value = email;
        setAuthMessage("Conta criada. Confirme o e-mail recebido antes de entrar.", "success");
      }
    } else {
      const session = await signIn(email, password);
      showApplication(session.user, session);
    }
  } catch (error) {
    const knownMessage = String(error.message || "");
    if (knownMessage.includes("already registered")) {
      setAuthMessage("Este e-mail já possui uma conta.");
    } else if (knownMessage.includes("rate limit")) {
      setAuthMessage("Muitas tentativas seguidas. Aguarde um pouco e tente novamente.");
    } else if (knownMessage === "As senhas não coincidem." || knownMessage.includes("pelo menos 8")) {
      setAuthMessage(knownMessage);
    } else {
      setAuthMessage(error.status === 400
        ? (authMode === "signup" ? "Não foi possível criar a conta com esses dados." : "E-mail ou senha incorretos.")
        : "Não foi possível conectar ao Supabase. Tente novamente.");
    }
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === "signup" ? "Criar conta" : "Entrar";
  }
});

document.querySelector("#auth-mode-toggle").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "signup" : "login");
});

document.querySelectorAll("[data-demo-user]").forEach((button) => {
  button.addEventListener("click", () => {
    setAuthMode("login");
    const demoCredentials = button.dataset.demoUser === "owner"
      ? { email: "demo.proprietario@example.com", password: "Troque-Esta-Senha-01!" }
      : { email: "demo.gestor@example.com", password: "Troque-Esta-Senha-02!" };
    document.querySelector("#login-email").value = demoCredentials.email;
    document.querySelector("#login-password").value = demoCredentials.password;
    document.querySelector("#auth-message").textContent = "Entrando com o usuário de demonstração...";
    document.querySelector("#login-form").requestSubmit();
  });
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  const token = currentSession?.access_token;
  if (token) {
    try {
      await supabaseRequest("/auth/v1/logout", { method: "POST", token });
    } catch {
      // A sessão local deve ser encerrada mesmo se a rede estiver indisponível.
    }
  }
  showLogin();
});

initializeAuth();
