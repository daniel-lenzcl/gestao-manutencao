const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const seed = window.MANUTENCAO_SEED;
const storageKey = "manutencao-prototipo-state-v1";

let state = loadState();
let editingPhoto = "";
let focusedAssetId = "";
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let timelineCalendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const newChoiceValue = "__new__";

function loadState() {
  const saved = localStorage.getItem(storageKey);
  const data = saved ? JSON.parse(saved) : {
    assets: seed.assets,
    recurrenceEvents: seed.recurrenceEvents,
    ambientes: seed.ambientes,
    sistemas: seed.sistemas,
    rotinas: seed.rotinas,
  };
  const savedHorizon = Number(data.settings?.planningHorizonYears || 0);
  data.settings = {
    ...(data.settings || {}),
    planningHorizonYears: !savedHorizon || savedHorizon === 20 ? 50 : savedHorizon,
  };
  return data;
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
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

function nextDate(lastDate, months) {
  if (!lastDate || !months) return "";
  const date = new Date(`${lastDate}T00:00:00`);
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

function planningHorizonYears() {
  return Math.max(1, Number(state.settings?.planningHorizonYears || 50));
}

function maxCyclesForLife(lifeYears) {
  const life = Number(lifeYears || 0);
  return life > 0 ? Math.max(1, Math.floor(planningHorizonYears() / life)) : null;
}

function clampCycles(totalCycles, lifeYears) {
  const requested = Math.max(1, Number(totalCycles || 1));
  const maximum = maxCyclesForLife(lifeYears);
  return maximum ? Math.min(requested, maximum) : requested;
}

function groupSum(items, key, valueKey) {
  return items.reduce((acc, item) => {
    const label = item[key] || "Não informado";
    acc[label] = (acc[label] || 0) + Number(item[valueKey] || 0);
    return acc;
  }, {});
}

function planningWindowEvents() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = addYears(start, planningHorizonYears());
  return state.recurrenceEvents.filter((event) => {
    const date = safeDate(event.data);
    return date && date >= start && date <= end;
  });
}

function plannedExecutionCost() {
  return planningWindowEvents().reduce((sum, event) => sum + Number(event.custo || 0), 0);
}

function selectedMonthlyProvision() {
  const selectedMonth = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const { provision } = financeSeries();
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

function eventsByYear() {
  return state.recurrenceEvents.reduce((acc, event) => {
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

function financeSeries() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const execution = {};
  const provision = {};
  const executionEvents = {};

  state.recurrenceEvents.forEach((event) => {
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
  const { execution, provision } = financeSeries();
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

function calendarBounds() {
  const dates = state.recurrenceEvents.map((event) => safeDate(event.data)).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) {
    const current = new Date();
    const month = new Date(current.getFullYear(), current.getMonth(), 1);
    return { min: month, max: month, minIndex: calendarMonthIndex(month), maxIndex: calendarMonthIndex(month) };
  }
  const min = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
  const last = dates[dates.length - 1];
  const max = new Date(last.getFullYear(), last.getMonth(), 1);
  return { min, max, minIndex: calendarMonthIndex(min), maxIndex: calendarMonthIndex(max) };
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
  const realProgress = Number(slider.max) ? ((todayIndex - bounds.minIndex) / Number(slider.max)) * 100 : 0;
  slider.style.setProperty("--real-progress", `${realProgress}%`);
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

  return state.recurrenceEvents
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
  const events = state.recurrenceEvents.filter((event) => dateInputValue(event.data) === dateKey);
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

  state.recurrenceEvents.forEach((event) => {
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
  const eventsByDate = state.recurrenceEvents.reduce((groups, event) => {
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
  const bounds = calendarBounds();
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
  const eventsByDate = state.recurrenceEvents.reduce((groups, event) => {
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
  const realProgress = Number(range.max) ? ((todayIndex - bounds.minIndex) / Number(range.max)) * 100 : 0;
  range.style.setProperty("--real-progress", `${realProgress}%`);

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
  const vencidos = state.assets.filter((asset) => statusFor(asset.proximaManutencao) === "Vencido").length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in90Days = new Date(today);
  in90Days.setDate(in90Days.getDate() + 90);
  const next90 = state.recurrenceEvents.filter((event) => {
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
    [`Custo previsto em ${planningHorizonYears()} anos`, money.format(plannedExecutionCost())],
    [`Provisionamento mensal · ${selectedMonthLabel}`, money.format(selectedProvision.value), provisionValidity],
    ["Ativos cadastrados", state.assets.length],
    ["Próximos 90 dias", next90],
    ["Itens vencidos", vencidos],
  ];

  document.querySelector("#kpi-grid").innerHTML = kpis
    .map(([label, value, note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</article>`)
    .join("");
}

function renderSystemBars() {
  const windowEvents = planningWindowEvents();
  const grouped = groupSum(windowEvents, "sistema", "custo");
  const rows = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map((row) => row[1]), 1);
  document.querySelector("#system-bars").innerHTML = rows
    .map(([label, value]) => {
      const width = Math.max(3, (value / max) * 100);
      return `<div class="bar-row system-bar-row" data-system="${encodeURIComponent(label)}" role="button" tabindex="0" aria-label="Ver ativos do sistema ${label}"><strong>${label}</strong><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><span>${money.format(value)}</span></div>`;
    })
    .join("");
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
    <div class="detail-total">Total no horizonte de ${planningHorizonYears()} anos: ${money.format(total)}</div>
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
  const events = state.recurrenceEvents
    .filter((event) => {
      const date = safeDate(event.data);
      return date && date >= today;
    })
    .map((event) => ({ ...event, status: statusFor(event.data) }))
    .sort(byDate)
    .slice(0, 6);

  document.querySelector("#next-events").innerHTML = events
    .map(
      (event) => `<article class="event">
        <strong>${event.ativo || event.sistema}</strong>
        <div class="meta">${formatDate(event.data)} · ${event.tipo || "Manutenção"} · ${event.ambiente} · ${money.format(event.custo || 0)}</div>
        <span class="badge ${event.status.toLowerCase().includes("vencido") ? "vencido" : "programado"}">${event.status}</span>
      </article>`,
    )
    .join("");
}

function renderFilters() {
  document.querySelector("#planning-horizon").value = planningHorizonYears();
  const systems = ["", ...new Set(state.assets.map((asset) => asset.sistema).filter(Boolean).sort())];
  const systemSelect = document.querySelector("#system-filter");
  const currentSystem = systemSelect.value;
  systemSelect.innerHTML = systems.map((s) => `<option value="${s}">${s || "Todos"}</option>`).join("");
  systemSelect.value = currentSystem;

  const years = ["", ...Object.keys(eventsByYear()).sort()];
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
  const totalCycles = clampCycles(asset.totalCiclos, lifeYears);
  const renew = (asset.fimVida || "renovar") === "renovar";
  const maintenanceCountPerCycle = lifeYears && periodicityMonths ? Math.floor((lifeYears * 12) / periodicityMonths) : 0;
  const maintenancePerCycle = maintenanceCountPerCycle * maintenanceCost;
  const monthlyMaintenance = periodicityMonths ? maintenanceCost / periodicityMonths : 0;
  const replacementCount = lifeYears && assetValue ? (renew ? totalCycles : Math.max(0, totalCycles - 1)) : 0;
  const replacementPerCycle = assetValue;
  const monthlyReplacement = lifeYears && assetValue && replacementCount ? assetValue / (lifeYears * 12) : 0;
  const monthlyFullCycle = monthlyMaintenance + monthlyReplacement;
  const totalPeriod = maintenancePerCycle * totalCycles + replacementPerCycle * replacementCount;
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
      return (!query || haystack.includes(query)) && (!system || asset.sistema === system);
    })
    .sort((a, b) => compareAssets(a, b, sortMode));

  document.querySelector("#asset-list").innerHTML = assets
    .map((asset) => {
      const status = statusFor(asset.proximaManutencao);
      const image = asset.foto ? `<img src="${asset.foto}" alt="Foto de ${asset.ativo}" />` : "Foto";
      const costs = assetCostSummary(asset);
      return `<article class="asset-card ${focusedAssetId === asset.id ? "is-focused" : ""}">
        <div class="thumb">${image}</div>
        <div class="asset-card-content">
          <strong>${asset.ativo || "Ativo sem nome"}</strong>
          <div class="meta">${asset.sistema} · ${asset.ambiente} · ${asset.acao || "Sem ação definida"}</div>
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
    .join("");
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
  const events = state.recurrenceEvents
    .filter((event) => (!year || event.data.startsWith(year)) && (!status || statusFor(event.data) === status))
    .sort(byDate)
    .slice(0, 80);

  document.querySelector("#timeline-list").innerHTML = events
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
    .join("");
}

function renderFinance() {
  const { execution, provision, executionEvents } = financeSeries();
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
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === `${view}-view`));
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
  openDialog(asset);
}

function openDialog(asset) {
  const isEditing = Boolean(asset);
  document.querySelector("#dialog-title").textContent = isEditing ? "Editar ativo" : "Novo ativo";
  document.querySelector("#delete-asset").style.display = isEditing ? "inline-block" : "none";
  const data = asset || {};
  editingPhoto = data.foto || "";
  document.querySelector("#asset-id").value = data.id || "";
  setupChoice("ambiente", data.ambiente || "");
  setupChoice("sistema", data.sistema || "");
  setupChoice("ativo", data.ativo || "");
  setupChoice("componente", data.componente || "");
  setupChoice("acao", data.acao || "");
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
  renderAssetSummary();
  renderPhotoPreview();
  document.querySelector("#asset-dialog").showModal();
}

function renderAssetSummary() {
  const installationDate = document.querySelector("#asset-instalacao").value;
  const lifeYears = Number(document.querySelector("#asset-vida").value || 0);
  const periodicityMonths = Number(document.querySelector("#asset-periodicidade").value || 0);
  const maintenanceCost = parseCurrencyInput(document.querySelector("#asset-custo").value);
  const assetValue = parseCurrencyInput(document.querySelector("#asset-valor").value);
  const endMode = getLifeEndMode();
  const totalCycles = updateCycleLimit(document.querySelector("#asset-ciclos").value || 1);
  const maximumCycles = maxCyclesForLife(lifeYears);
  const effectiveCycles = totalCycles;
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
  const monthlyMaintenance = periodicityMonths ? maintenanceCost / periodicityMonths : 0;
  const replacementCount = endMode === "renovar" ? totalCycles : Math.max(0, totalCycles - 1);
  const hasNextCycle = replacementCount > 0;
  const monthlyReplacement = hasNextCycle && replacementMonths ? assetValue / replacementMonths : 0;
  const totalMonthlyProvision = monthlyMaintenance + monthlyReplacement;
  const totalMaintenanceCost = dates.length * maintenanceCost;
  const endDate = installationDate && lifeYears ? addYears(safeDate(installationDate), lifeYears).toISOString().slice(0, 10) : "";
  const replacementTotal = replacementCount * assetValue;
  const assetId = document.querySelector("#asset-id").value;
  const savedEvents = state.recurrenceEvents.filter((event) => event.assetId === assetId);
  const savedByKey = new Map(savedEvents.map((event) => [eventScheduleKey(event), event]));
  const maintenanceEvents = dates.map((item) => ({
    assetId,
    data: item.date,
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
    summary.innerHTML = "Preencha data de instalação, vida útil e periodicidade para ver as manutenções previstas.";
    return;
  }

  summary.innerHTML = `<h3>Resumo de vida útil</h3>
    <div class="summary-grid">
      <div class="summary-kpi"><span>Fim da expectativa</span><strong>${formatDate(endDate)}</strong></div>
      <div class="summary-kpi"><span>Manutenções previstas</span><strong>${dates.length}</strong></div>
      <div class="summary-kpi"><span>Custo total de manutenção</span><strong>${money.format(totalMaintenanceCost)}</strong></div>
      <div class="summary-kpi"><span>Valor do ativo</span><strong>${money.format(assetValue)}</strong></div>
      <div class="summary-kpi"><span>Provisão mensal manutenção</span><strong>${money.format(monthlyMaintenance)}</strong></div>
      <div class="summary-kpi"><span>Provisão mensal substituição</span><strong>${money.format(monthlyReplacement)}</strong></div>
      <div class="summary-kpi"><span>Provisão mensal total</span><strong>${money.format(totalMonthlyProvision)}</strong></div>
      <div class="summary-kpi"><span>Total manutenção + substituição</span><strong>${money.format(totalMaintenanceCost + replacementTotal)}</strong></div>
      <div class="summary-kpi"><span>Ao fim da vida</span><strong>${endMode === "renovar" ? "Renovar" : "Encerrar"}</strong></div>
      <div class="summary-kpi"><span>Ciclos programados</span><strong>${effectiveCycles}${maximumCycles ? ` de ${maximumCycles} máx.` : ""}</strong></div>
    </div>
    <div class="schedule-heading">
      <div>
        <strong>Manuten\u00e7\u00f5es e trocas previstas</strong>
        <span>Marque o check quando o servi\u00e7o for realizado.</span>
      </div>
      ${assetId ? "" : "<small>Salve o ativo para habilitar os checks.</small>"}
    </div>
    <div class="asset-event-checklist">
      ${scheduleEvents
        .map((event) => {
          const completed = isEventCompleted(event);
          const eventDate = safeDate(event.data);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const past = eventDate && eventDate < today;
          const future = eventDate && eventDate > today;
          const statusLabel = completed ? "Realizada" : past ? "N\u00e3o realizada" : "Pendente";
          const typeClass = String(event.tipo).startsWith("Substit") ? "replacement" : "maintenance";
          return `<label class="asset-event-check ${completed ? "is-completed" : past ? "is-missed" : ""} ${future ? "is-future" : ""}">
            <input type="checkbox" data-event-key="${eventScheduleKey(event)}" ${completed ? "checked" : ""} ${assetId && !future ? "" : "disabled"} />
            <span class="event-type ${typeClass}">${event.tipo}</span>
            <span class="event-date">${formatDate(event.data)}</span>
            <span class="event-cycle">Ciclo ${event.ciclo || 1}</span>
            <strong>${money.format(event.custo || 0)}</strong>
            <em>${statusLabel}</em>
          </label>`;
        })
        .join("") || "<div class=\"meta\">Nenhum evento previsto.</div>"}
    </div>`;

  summary.querySelectorAll(".asset-event-check input[data-event-key]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const event = state.recurrenceEvents.find((item) => eventScheduleKey(item) === checkbox.dataset.eventKey);
      if (!event) return;
      event.realizada = checkbox.checked;
      event.status = checkbox.checked ? "Realizada" : statusFor(event.data);
      saveState();
      render();
      renderAssetSummary();
    });
  });
}

function buildAssetEvents(asset) {
  const events = [];
  const installDate = safeDate(asset.dataInstalacao);
  const totalCycles = clampCycles(asset.totalCiclos, asset.expectativaVidaAnos);
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
  const maximum = maxCyclesForLife(lifeYears);
  const cycles = clampCycles(requestedCycles, lifeYears);
  input.max = maximum || "";
  input.value = cycles;
  input.title = maximum
    ? `Máximo de ${maximum} ciclo(s) no horizonte de ${planningHorizonYears()} anos`
    : "Informe a expectativa de vida para calcular o limite";
  return cycles;
}

function applyPlanningHorizon() {
  state.assets.forEach((asset) => {
    asset.totalCiclos = clampCycles(asset.totalCiclos, asset.expectativaVidaAnos);
    syncAssetSchedule(asset);
  });
  saveState();
  render();
}

function deleteAsset(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const ok = window.confirm(`Excluir "${asset.ativo || asset.sistema || asset.id}" e remover sua programação financeira?`);
  if (!ok) return;
  state.assets = state.assets.filter((item) => item.id !== assetId);
  state.recurrenceEvents = state.recurrenceEvents.filter((event) => event.assetId !== assetId);
  if (focusedAssetId === assetId) focusedAssetId = "";
  saveState();
  document.querySelector("#asset-dialog").close();
  render();
}

function renderPhotoPreview() {
  const preview = document.querySelector("#photo-preview");
  preview.src = editingPhoto;
  preview.style.display = editingPhoto ? "block" : "none";
}

function saveAsset() {
  const id = document.querySelector("#asset-id").value || `ATIVO-${Date.now()}`;
  const periodicidadeMeses = Number(document.querySelector("#asset-periodicidade").value || 0);
  const ultimaManutencao = document.querySelector("#asset-ultima").value;
  const proximaManutencao = nextDate(ultimaManutencao, periodicidadeMeses);
  const custoUnitario = parseCurrencyInput(document.querySelector("#asset-custo").value);
  const ambiente = getChoiceValue("ambiente");
  const sistema = getChoiceValue("sistema");
  const ativo = getChoiceValue("ativo");
  const componente = getChoiceValue("componente");
  const acao = getChoiceValue("acao");
  const prioridade = getChoiceValue("prioridade");
  const responsavel = getChoiceValue("responsavel");
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
    ultimaManutencao,
    proximaManutencao,
    custoUnitario,
    custoTotal: custoUnitario,
    dataInstalacao: document.querySelector("#asset-instalacao").value,
    expectativaVidaAnos: Number(document.querySelector("#asset-vida").value || 0),
    valorAtivo: parseCurrencyInput(document.querySelector("#asset-valor").value),
    fimVida: getLifeEndMode(),
    totalCiclos: clampCycles(document.querySelector("#asset-ciclos").value, document.querySelector("#asset-vida").value),
    prioridade,
    estado: "",
    status: statusFor(proximaManutencao),
    responsavel,
    observacoes: "",
    foto: editingPhoto,
  };

  const index = state.assets.findIndex((item) => item.id === id);
  if (index >= 0) state.assets[index] = asset;
  else state.assets.unshift(asset);
  syncAssetSchedule(asset);

  saveState();
  document.querySelector("#asset-dialog").close();
  render();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateView(tab.dataset.view));
});

document.querySelector("#new-asset").addEventListener("click", () => openDialog());
document.querySelector("#save-asset").addEventListener("click", saveAsset);
document.querySelector("#delete-asset").addEventListener("click", () => {
  const assetId = document.querySelector("#asset-id").value;
  if (assetId) deleteAsset(assetId);
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
  const bounds = calendarBounds();
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
  state.settings.planningHorizonYears = Math.max(1, Number(event.target.value || 50));
  applyPlanningHorizon();
});
document.querySelector("#year-filter").addEventListener("change", renderTimeline);
document.querySelector("#status-filter").addEventListener("change", renderTimeline);
document.querySelector("#owners-input").addEventListener("input", renderFinance);
document.querySelector("#reserve-input").addEventListener("input", renderFinance);
["ambiente", "sistema", "ativo", "componente", "acao", "prioridade", "responsavel"].forEach((id) => {
  document.querySelector(`#asset-${id}`).addEventListener("change", () => updateChoiceMode(id));
});
["asset-instalacao", "asset-vida", "asset-periodicidade", "asset-custo", "asset-valor", "asset-ciclos"].forEach((id) => {
  document.querySelector(`#${id}`).addEventListener("input", renderAssetSummary);
});
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
document.querySelector("#reset-data").addEventListener("click", () => {
  localStorage.removeItem(storageKey);
  state = loadState();
  render();
});
document.querySelector("#asset-list").addEventListener("click", (event) => {
  const button = event.target.closest(".edit-asset");
  const deleteButton = event.target.closest(".delete-asset-card");
  if (deleteButton) {
    deleteAsset(deleteButton.dataset.id);
    return;
  }
  if (button) openDialog(state.assets.find((asset) => asset.id === button.dataset.id));
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

render();
