import { getState, setState, updateState, subscribe, createPlayTemplate, createStepTemplate, createConditionBlock, createActionBlock } from "./state/store.js";
import { createMarketDataLive } from "./adapters/live/marketData.js";
import { createPortfolioLive } from "./adapters/live/portfolio.js";
import { createExecutionLive } from "./adapters/live/execution.js";
import { createOptionsChainLive } from "./adapters/live/optionsChain.js";
import { createBackendClient } from "./adapters/live/backendClient.js";
import { evaluateCondition } from "./engine/evaluator.js";
import { validateConfig, validatePlay } from "./utils/validation.js";
import { parseTimeToMinutes } from "./utils/time.js";
import { formatCurrency, formatNumber, formatDelta, formatTimestamp } from "./utils/format.js";
import { createId } from "./utils/id.js";

const dom = {
  modePill: document.getElementById("mode-pill"),
  modeBanner: document.getElementById("mode-banner"),
  appVersion: document.getElementById("app-version"),
  accountSummary: document.getElementById("account-summary"),
  marketSnapshot: document.getElementById("market-snapshot"),
  activeStrategies: document.getElementById("active-strategies"),
  executionMonitor: document.getElementById("execution-monitor"),
  positionsTable: document.getElementById("positions-table"),
  ordersTable: document.getElementById("orders-table"),
  dashboardPositions: document.getElementById("dashboard-positions"),
  dashboardOrders: document.getElementById("dashboard-orders"),
  portfolioSummary: document.getElementById("portfolio-summary"),
  logList: document.getElementById("log-list"),
  refreshDashboard: document.getElementById("refresh-dashboard"),
  exportLogs: document.getElementById("export-logs"),
  newPlay: document.getElementById("new-play"),
  playList: document.getElementById("play-list"),
  playEditor: document.getElementById("play-editor"),
  importStrategies: document.getElementById("import-strategies"),
  exportStrategies: document.getElementById("export-strategies"),
  backendStatus: document.getElementById("backend-status"),
  backendConfig: document.getElementById("backend-config"),
  backendLogs: document.getElementById("backend-logs"),
  checkUpdates: document.getElementById("check-updates"),
  downloadUpdate: document.getElementById("download-update"),
  restartUpdate: document.getElementById("restart-update"),
  updateStatus: document.getElementById("update-status"),
  updateMessage: document.getElementById("update-message"),
  updateProgress: document.getElementById("update-progress"),
  updateProgressBar: document.getElementById("update-progress-bar"),
  updateProgressLabel: document.getElementById("update-progress-label"),
  updateMeta: document.getElementById("update-meta"),
  updateCurrentVersion: document.getElementById("update-current-version"),
  updateAvailableVersion: document.getElementById("update-available-version"),
  updateReleaseDate: document.getElementById("update-release-date"),
  updateNotes: document.getElementById("update-notes")
};

const navButtons = Array.from(document.querySelectorAll(".nav-item"));
const views = Array.from(document.querySelectorAll(".view"));
let currentView = "dashboard";
let subscribedSymbols = new Set();
let backendClient = null;
let marketData = null;
let optionsChain = null;
let portfolio = null;
let execution = null;
let servicesReady = false;
let evaluationInProgress = false;
let accountsLoaded = false;
let backendHandlersBound = false;
let backendRetryTimer = null;
let lastStatusSnapshot = null;
let statusWatchdog = null;
let backendConnecting = false;
let twsConnecting = false;
let lastTwsAttempt = 0;
let statusPoll = null;

const MARKET_TIMEZONE = "America/New_York";
const MARKET_OPEN = "09:30";
const MARKET_CLOSE = "16:00";
const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_LABELS = [
  { key: "MON", label: "Mon" },
  { key: "TUE", label: "Tue" },
  { key: "WED", label: "Wed" },
  { key: "THU", label: "Thu" },
  { key: "FRI", label: "Fri" },
  { key: "SAT", label: "Sat" },
  { key: "SUN", label: "Sun" }
];

const isBackendReady = (state) => {
  const status = state.backend.status || {};
  const connection = state.backend.connection || {};
  return Boolean(connection.connected && status.connected && status.state === "CONNECTED");
};

const appendLog = (message, level = "info") => {
  updateState((state) => {
    const entry = {
      id: createId(),
      ts: Date.now(),
      message,
      level
    };
    const logs = [entry, ...state.logs].slice(0, 200);
    return { ...state, logs };
  }, "log");
};

const appendBackendLog = (message, level = "info") => {
  updateState((state) => {
    const entry = {
      id: createId(),
      ts: Date.now(),
      message,
      level
    };
    const logs = [entry, ...(state.backend.logs || [])].slice(0, 200);
    return {
      ...state,
      backend: {
        ...state.backend,
        logs
      }
    };
  }, "backend-log");
};

const updateStatusLabels = {
  idle: "Idle",
  checking: "Checking",
  available: "Update Available",
  none: "Up to Date",
  downloading: "Downloading",
  downloaded: "Ready",
  error: "Error"
};

const updateStatusClasses = {
  idle: "",
  checking: "warn",
  available: "warn",
  none: "success",
  downloading: "warn",
  downloaded: "success",
  error: "error"
};

const setUpdateState = (patch, action = "update-status") => {
  updateState((state) => ({
    ...state,
    updates: {
      ...state.updates,
      ...patch
    }
  }), action);
};

const formatUpdateDate = (value) => {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "2-digit" });
};

const normalizeReleaseNotes = (notes) => {
  if (!notes) {
    return null;
  }
  if (Array.isArray(notes)) {
    const joined = notes
      .map((entry) => {
        if (!entry) {
          return "";
        }
        if (typeof entry === "string") {
          return entry;
        }
        return entry.note || "";
      })
      .filter(Boolean)
      .join("\n");
    return joined.trim() || null;
  }
  if (typeof notes === "string") {
    return notes.trim() || null;
  }
  return null;
};

const renderUpdatePanel = (state) => {
  if (!dom.updateStatus || !dom.updateMessage || !dom.updateMeta) {
    return;
  }
  const updates = state.updates || {};
  const status = updates.status || "idle";
  const label = updateStatusLabels[status] || "Idle";
  const statusClass = updateStatusClasses[status] || "";
  dom.updateStatus.textContent = label;
  dom.updateStatus.className = `status-pill ${statusClass}`.trim();
  dom.updateMessage.textContent = updates.message || "";

  const metaParts = [];
  if (updates.releaseName) {
    metaParts.push(updates.releaseName);
  }
  if (updates.version) {
    metaParts.push(`Version v${updates.version}`);
  }
  if (updates.releaseDate) {
    metaParts.push(`Released ${formatUpdateDate(updates.releaseDate)}`);
  }
  if (updates.lastCheckedAt) {
    metaParts.push(`Checked ${formatTimestamp(updates.lastCheckedAt)}`);
  }
  dom.updateMeta.textContent = metaParts.join(" · ");

  if (dom.updateCurrentVersion) {
    dom.updateCurrentVersion.textContent = updates.currentVersion ? `v${updates.currentVersion}` : "--";
  }
  if (dom.updateAvailableVersion) {
    dom.updateAvailableVersion.textContent = updates.version ? `v${updates.version}` : "--";
  }
  if (dom.updateReleaseDate) {
    dom.updateReleaseDate.textContent = updates.releaseDate ? formatUpdateDate(updates.releaseDate) : "--";
  }

  const percent = typeof updates.progress === "number"
    ? Math.min(100, Math.max(0, updates.progress))
    : null;
  if (dom.updateProgress && dom.updateProgressBar) {
    const showProgress = status === "downloading" && percent !== null;
    dom.updateProgress.hidden = !showProgress;
    dom.updateProgressBar.style.width = showProgress ? `${Math.round(percent)}%` : "0%";
    if (dom.updateProgressLabel) {
      dom.updateProgressLabel.textContent = showProgress ? `${Math.round(percent)}% downloaded` : "";
    }
  }

  if (dom.updateNotes) {
    if (updates.releaseNotes) {
      dom.updateNotes.textContent = updates.releaseNotes;
      dom.updateNotes.hidden = false;
    } else {
      dom.updateNotes.textContent = "";
      dom.updateNotes.hidden = true;
    }
  }

  if (dom.downloadUpdate) {
    dom.downloadUpdate.hidden = status !== "available";
  }
  if (dom.restartUpdate) {
    dom.restartUpdate.hidden = status !== "downloaded";
  }
  if (dom.checkUpdates) {
    dom.checkUpdates.disabled = status === "checking" || status === "downloading";
  }
};

const getDefaultPort = (mode) => {
  return mode === "live" ? 7496 : 7497;
};

const getMarketDateKey = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const getMarketNow = () => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = map.weekday || "Sun";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const hours = Number(map.hour || 0);
  const minutes = Number(map.minute || 0);
  const dateKey = `${map.year}-${map.month}-${map.day}`;
  return {
    dayKey: DAY_KEYS[dayIndex] || "SUN",
    minutes: hours * 60 + minutes,
    dateKey
  };
};

const getNextMarketSessionDateKey = (marketNow) => {
  const openMinutes = parseTimeToMinutes(MARKET_OPEN) ?? 0;
  const weekdayIndex = DAY_KEYS.indexOf(marketNow.dayKey);
  const current = new Date();
  const currentKey = marketNow.dateKey;
  const base = current;
  if (weekdayIndex >= 1 && weekdayIndex <= 5 && marketNow.minutes < openMinutes) {
    return currentKey;
  }
  for (let i = 1; i <= 7; i += 1) {
    const candidate = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const candidateKey = getMarketDateKey(candidate);
    const candidateWeekday = new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TIMEZONE, weekday: "short" })
      .format(candidate);
    const candidateIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(candidateWeekday);
    if (candidateIndex >= 1 && candidateIndex <= 5) {
      return candidateKey;
    }
  }
  return currentKey;
};

const isWithinSchedule = (schedule, marketNow) => {
  if (!schedule) {
    return false;
  }
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (!days.includes(marketNow.dayKey)) {
    return false;
  }
  const start = parseTimeToMinutes(schedule.startTime);
  const end = parseTimeToMinutes(schedule.endTime);
  if (start === null || end === null || start >= end) {
    return false;
  }
  return marketNow.minutes >= start && marketNow.minutes <= end;
};

const isWithinMarketHours = (marketNow) => {
  const openMinutes = parseTimeToMinutes(MARKET_OPEN);
  const closeMinutes = parseTimeToMinutes(MARKET_CLOSE);
  if (openMinutes === null || closeMinutes === null) {
    return false;
  }
  return marketNow.minutes >= openMinutes && marketNow.minutes <= closeMinutes;
};

const getScheduleValidity = (schedule) => {
  if (!schedule) {
    return false;
  }
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (days.length === 0) {
    return false;
  }
  const start = parseTimeToMinutes(schedule.startTime);
  const end = parseTimeToMinutes(schedule.endTime);
  if (start === null || end === null) {
    return false;
  }
  return start < end;
};

const getDraftStatus = (play) => {
  if (!play.active) {
    return { status: "Draft", stage: "Draft strategy" };
  }
  if (!getScheduleValidity(play.schedule)) {
    return { status: "Error", stage: "Fix schedule" };
  }
  const marketNow = getMarketNow();
  if (!isWithinSchedule(play.schedule, marketNow)) {
    return { status: "Outside Window", stage: "Waiting for schedule" };
  }
  if (!isMarketOpen(marketNow)) {
    return { status: "Market Closed", stage: "Waiting for market" };
  }
  return { status: "Active", stage: "Waiting for conditions" };
};

const updatePlay = (playId, updater, action = "play-update") => {
  updateState((state) => {
    const plays = state.plays.map((play) => {
      if (play.playId !== playId) {
        return play;
      }
      const draft = structuredClone(play);
      return updater(draft) || draft;
    });
    return { ...state, plays };
  }, action);
};

const setStrategyDirty = (playId, dirty = true, action = "strategy-dirty") => {
  updateState((state) => {
    const next = new Set(state.strategyDirtyIds || []);
    if (dirty) {
      next.add(playId);
    } else {
      next.delete(playId);
    }
    const strategySave = dirty
      ? { status: "", message: "", ts: null }
      : state.strategySave;
    return { ...state, strategyDirtyIds: Array.from(next), strategySave };
  }, action);
  if (dirty && action === "strategy-dirty-input") {
    const saveStatus = dom.playEditor?.querySelector(".save-status");
    if (saveStatus) {
      saveStatus.textContent = "";
      saveStatus.classList.remove("danger", "warning", "muted");
    }
  }
};

const setStrategySaveState = (status, message) => {
  updateState((state) => ({
    ...state,
    strategySave: {
      status,
      message,
      ts: Date.now()
    }
  }), "strategy-save");
};

const isStrategyDirty = (state, playId) => {
  return (state.strategyDirtyIds || []).includes(playId);
};

const DEFAULT_SCHEDULE = {
  days: ["MON", "TUE", "WED", "THU", "FRI"],
  startTime: MARKET_OPEN,
  endTime: MARKET_CLOSE
};

const normalizeStrategy = (play, fallbackIndex = 1) => {
  const base = play && typeof play === "object" ? play : {};
  return {
    playId: base.playId || createId(),
    name: base.name || `Strategy ${fallbackIndex}`,
    symbol: (base.symbol || "SPY").toUpperCase(),
    active: typeof base.active === "boolean" ? base.active : true,
    autoDeactivateOthers: typeof base.autoDeactivateOthers === "boolean" ? base.autoDeactivateOthers : false,
    schedule: {
      days: Array.isArray(base.schedule?.days) ? base.schedule.days : DEFAULT_SCHEDULE.days,
      startTime: base.schedule?.startTime || DEFAULT_SCHEDULE.startTime,
      endTime: base.schedule?.endTime || DEFAULT_SCHEDULE.endTime
    },
    side: base.side || "CALL",
    versionTarget: base.versionTarget || getState().config.versionTargets[0]?.id,
    quantity: Number.isFinite(Number(base.quantity)) ? Number(base.quantity) : 1,
    steps: Array.isArray(base.steps) && base.steps.length ? base.steps : [createStepTemplate()],
    stepCursor: 0,
    stepTriggeredBranchId: null,
    pendingAction: null,
    state: {
      status: base.active === false ? "Draft" : "Active",
      stage: base.active === false ? "Draft strategy" : "Waiting for schedule",
      autoDisabledUntilSession: null,
      lastEvaluatedAt: null,
      lastTriggeredAt: null,
      lastOrderId: null,
      message: "",
      realizedPnL: 0,
      openPosition: null
    }
  };
};

const serializeStrategy = (play) => ({
  playId: play.playId,
  name: play.name,
  symbol: play.symbol,
  active: play.active,
  schedule: play.schedule,
  side: play.side,
  versionTarget: play.versionTarget,
  quantity: play.quantity,
  steps: play.steps
});

const applyStrategies = (strategies) => {
  const normalized = (strategies || []).map((play, index) => normalizeStrategy(play, index + 1));
  const fallback = normalized.length ? normalized : [normalizeStrategy({}, 1)];
  updateState((state) => ({
    ...state,
    plays: fallback,
    executionPlays: fallback,
    activePlayId: fallback[0]?.playId || null,
    strategyDirtyIds: [],
    strategySave: {
      status: "",
      message: "",
      ts: null
    }
  }), "strategies-load");
};

const mergeStrategiesById = (existing, incoming) => {
  const map = new Map(existing.map((play) => [play.playId, play]));
  incoming.forEach((play) => {
    map.set(play.playId, play);
  });
  return Array.from(map.values());
};

const resetRuntimeState = (play) => ({
  ...play,
  stepCursor: 0,
  stepTriggeredBranchId: null,
  pendingAction: null,
  state: {
    ...play.state,
    status: play.active ? "Active" : "Draft",
    stage: play.active ? "Waiting for schedule" : "Draft strategy",
    autoDisabledUntilSession: null,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    lastOrderId: null,
    message: "",
    realizedPnL: 0,
    openPosition: null
  }
});

const buildExecutionPlays = (draftPlays, existingExecution) => {
  const existingMap = new Map((existingExecution || []).map((play) => [play.playId, play]));
  return (draftPlays || []).map((play) => {
    const previous = existingMap.get(play.playId);
    if (!previous) {
      return resetRuntimeState({ ...play });
    }
    const signature = JSON.stringify(serializeStrategy(play));
    const previousSignature = JSON.stringify(serializeStrategy(previous));
    if (signature !== previousSignature) {
      return resetRuntimeState({ ...play });
    }
    return {
      ...play,
      stepCursor: previous.stepCursor,
      stepTriggeredBranchId: previous.stepTriggeredBranchId,
      pendingAction: previous.pendingAction,
      state: { ...previous.state }
    };
  });
};

const syncRuntimeToDraft = (draftPlays, executionPlays) => {
  const execMap = new Map((executionPlays || []).map((play) => [play.playId, play]));
  return (draftPlays || []).map((play) => {
    const exec = execMap.get(play.playId);
    if (!exec) {
      return play;
    }
    return {
      ...play,
      stepCursor: exec.stepCursor,
      stepTriggeredBranchId: exec.stepTriggeredBranchId,
      pendingAction: exec.pendingAction,
      state: { ...exec.state }
    };
  });
};

const setActivePlay = (playId) => {
  setState({ activePlayId: playId }, "active-play");
};

const getVersionTarget = (config, versionId) => {
  return config.versionTargets.find((version) => version.id === versionId) || config.versionTargets[0];
};

const renderSelect = ({
  value,
  options,
  attrName,
  attrValue,
  variant = "field",
  disabled = false,
  extraClass = ""
}) => {
  const selected = options.find((option) => option.value === value) || options[0];
  const label = selected ? selected.label : value;
  const classes = ["select", `select--${variant}`, extraClass, disabled ? "disabled" : ""]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="${classes}" ${attrName}="${attrValue}" data-value="${value}" ${disabled ? "aria-disabled='true'" : ""}>
      <button class="select-trigger" type="button">${label}</button>
      <div class="select-menu">
        ${options
          .map((option) => `
            <button class="select-option" type="button" data-value="${option.value}">${option.label}</button>
          `)
          .join("")}
      </div>
    </div>
  `;
};

const closeAllSelects = () => {
  document.querySelectorAll(".select.open").forEach((select) => {
    select.classList.remove("open");
  });
};

const buildPreviewLines = (play) => {
  if (!Array.isArray(play.steps) || play.steps.length === 0) {
    return ["No steps configured yet."];
  }

  return play.steps.map((step, index) => {
    const branchLines = (step.branches || []).map((branch, branchIndex) => {
      const isRise = branch.condition?.type === "IF_RISES";
      const conditionValue = Number(branch.condition?.value ?? 0);
      const conditionLabel = isRise
        ? `Price Rises to ${formatCurrency(conditionValue)}`
        : `Price Drops to ${formatCurrency(conditionValue)}`;
      const actionLabel = branch.action?.type === "ACTION_SELL" ? "Sell" : "Buy";
      const qtyValue = branch.action?.quantity || play.quantity;
      const qtyLabel = qtyValue ? `${qtyValue} contract${qtyValue > 1 ? "s" : ""}` : "contracts";
      const prefix = branchIndex === 0 ? "IF" : "OR IF";
      return `${prefix} ${conditionLabel} THEN ${actionLabel} ${qtyLabel}`;
    });
    return `Step ${index + 1}: ${branchLines.join(" ")}`;
  });
};

const isMarketOpen = (marketNow) => {
  return isWithinMarketHours(marketNow);
};

const getTrackedSymbols = (plays) => {
  const symbols = new Set();
  (plays || []).forEach((play) => {
    if (play.symbol) {
      symbols.add(play.symbol.toUpperCase());
    }
  });
  return Array.from(symbols);
};

const renderAccountSummary = (state) => {
  const summary = state.account;
  const connected = (state.backend.status || {}).connected;
  const metrics = connected
    ? [
      { label: "Equity", value: formatCurrency(summary.equity), sub: "Net liquidation" },
      { label: "Cash", value: formatCurrency(summary.cash), sub: "Available" },
      { label: "Unrealized P/L", value: formatCurrency(summary.unrealizedPnL), sub: "Open positions" },
      { label: "Realized P/L", value: formatCurrency(summary.realizedPnL), sub: "Closed positions" }
    ]
    : [
      { label: "Equity", value: "--", sub: "Awaiting IBKR" },
      { label: "Cash", value: "--", sub: "Awaiting IBKR" },
      { label: "Unrealized P/L", value: "--", sub: "Awaiting IBKR" },
      { label: "Realized P/L", value: "--", sub: "Awaiting IBKR" }
    ];
  dom.accountSummary.innerHTML = metrics
    .map(
      (item) => `
        <div class="metric-card">
          <div class="metric-title">${item.label}</div>
          <div class="metric-value">${item.value}</div>
          <div class="metric-sub">${item.sub}</div>
        </div>
      `
    )
    .join("");
};

const renderMarketSnapshot = (state) => {
  const symbols = getTrackedSymbols(state.executionPlays && state.executionPlays.length ? state.executionPlays : state.plays);
  if (symbols.length === 0) {
    dom.marketSnapshot.innerHTML = `<div class="muted">No symbols configured yet.</div>`;
    return;
  }

  const rows = symbols.map((symbol) => {
    const priceInfo = state.prices[symbol];
    const price = priceInfo?.price ?? null;
    const change = priceInfo ? price - priceInfo.prev : null;
    const changeClass = change === null ? "muted" : change > 0 ? "success" : change < 0 ? "danger" : "muted";
    return `
      <div class="table-row cols-4">
        <div>
          <div class="label">Symbol</div>
          <div class="value">${symbol}</div>
        </div>
        <div>
          <div class="label">Last</div>
          <div class="value">${price === null ? "--" : formatCurrency(price)}</div>
        </div>
        <div>
          <div class="label">Change</div>
          <div class="value ${changeClass}">${change === null ? "--" : formatDelta(change)}</div>
        </div>
        <div>
          <div class="label">Feed</div>
          <div class="value">${priceInfo ? "Live" : "Pending"}</div>
        </div>
      </div>
    `;
  });

  dom.marketSnapshot.innerHTML = rows.join("");
};

const getNextStepLabel = (play, lastPrice) => {
  if (play.pendingAction) {
    return "Order pending";
  }
  if (play.stepCursor >= play.steps.length) {
    return "Completed";
  }
  const step = play.steps[play.stepCursor];
  if (!step) {
    return "--";
  }
  const stepLabel = `Step ${play.stepCursor + 1}`;
  const branches = step.branches || [];
  if (!branches.length) {
    return `${stepLabel}: No branches`;
  }
  const triggeredBranch = play.stepTriggeredBranchId
    ? branches.find((branch) => branch.id === play.stepTriggeredBranchId)
    : branches.find((branch) => evaluateCondition(branch.condition, lastPrice));
  if (!triggeredBranch) {
    const branchHints = branches
      .map((branch) => {
        const isRise = branch.condition?.type === "IF_RISES";
        const conditionValue = Number(branch.condition?.value ?? 0);
        return isRise
          ? `rises to ${formatCurrency(conditionValue)}`
          : `drops to ${formatCurrency(conditionValue)}`;
      })
      .join(" or ");
    return `${stepLabel}: Waiting for price ${branchHints}`;
  }
  const actionLabel = triggeredBranch.action?.type === "ACTION_SELL" ? "Sell" : "Buy";
  const qtyValue = triggeredBranch.action?.quantity || play.quantity;
  const qtyLabel = qtyValue ? `${qtyValue} contract${qtyValue > 1 ? "s" : ""}` : "contracts";
  return `${stepLabel}: Then ${actionLabel} ${qtyLabel}`;
};

const renderActivePlays = (state) => {
  const rows = state.plays.map((play) => {
    const price = state.prices[play.symbol]?.price ?? 0;
    const nextStep = getNextStepLabel(play, price);
    const statusClass =
      play.state.status === "Completed" ? "success" :
      play.state.status === "Error" ? "error" :
      play.state.status === "Market Closed" || play.state.status === "Outside Window" || play.state.status === "Auto Paused" ? "warn" : "";
    const statusText = play.state.status || "Draft";
    const stageText = play.state.stage || nextStep;

    return `
      <div class="table-row cols-6 active-strategies-row">
        <div>
          <div class="label">Strategy</div>
          <div class="value">${play.name}</div>
        </div>
        <div>
          <div class="label">Symbol</div>
          <div class="value">${play.symbol} · ${play.side}</div>
        </div>
        <div>
          <div class="label">Last</div>
          <div class="value">${price === null ? "--" : formatCurrency(price)}</div>
        </div>
        <div>
          <div class="label">Status</div>
          <div class="value"><span class="status-pill ${statusClass}">${statusText}</span></div>
        </div>
        <div>
          <div class="label">Current</div>
          <div class="value">${stageText}</div>
        </div>
        <div>
          <div class="label">Next Action</div>
          <div class="value">${nextStep}</div>
        </div>
      </div>
    `;
  });

  dom.activeStrategies.innerHTML = rows.join("");
};

const renderExecutionMonitor = (state) => {
  if (!state.orders.length) {
    dom.executionMonitor.innerHTML = `<div class="muted">No orders yet. Live fills will appear here.</div>`;
    return;
  }
  const rows = state.orders.slice(0, 5).map((order) => {
    return `
      <div class="table-row cols-5">
        <div>
          <div class="label">Order</div>
          <div class="value">${order.id}</div>
        </div>
        <div>
          <div class="label">Symbol</div>
          <div class="value">${order.symbol}</div>
        </div>
        <div>
          <div class="label">Side</div>
          <div class="value">${order.side}</div>
        </div>
        <div>
          <div class="label">Status</div>
          <div class="value">${order.status}</div>
        </div>
        <div>
          <div class="label">Filled</div>
          <div class="value">${order.filledQty ?? 0}</div>
        </div>
      </div>
    `;
  });

  dom.executionMonitor.innerHTML = rows.join("");
};

const renderPlayList = (state) => {
  dom.playList.innerHTML = state.plays
    .map((play) => {
      const isActive = play.playId === state.activePlayId;
      const status = play.state?.status || "Draft";
      const stage = play.state?.stage || "";
      const statusClass = status === "Active"
        ? "active"
        : status === "Completed"
          ? "active"
          : status === "Error"
            ? "error"
            : status === "Draft"
              ? "draft"
              : status === "Market Closed" || status === "Outside Window" || status === "Auto Paused"
                ? "warn"
                : "";
      return `
        <div class="strategy-item ${isActive ? "active" : ""}" data-play-id="${play.playId}">
          <h4>${play.name}</h4>
          <div class="muted">${play.symbol} · ${play.side} · ${getVersionTarget(state.config, play.versionTarget).label}</div>
          <div class="strategy-meta">
            <span class="status-chip ${statusClass}">${status}</span>
            ${stage ? `<span class="muted">${stage}</span>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  dom.playList.querySelectorAll("[data-play-id]").forEach((item) => {
    item.addEventListener("click", () => setActivePlay(item.dataset.playId));
  });
};

const renderPlayEditor = (state) => {
  const previousEditor = dom.playEditor.querySelector(".editor");
  const previousScroll = previousEditor ? previousEditor.scrollTop : 0;
  const play = state.plays.find((item) => item.playId === state.activePlayId);
  if (!play) {
    dom.playEditor.innerHTML = `<div class="muted">Select a play to begin.</div>`;
    return;
  }

  const errors = validatePlay(play, state.config);
  const schedule = play.schedule || {};
  const isDirty = isStrategyDirty(state, play.playId);
  const saveState = state.strategySave || {};
  const saveLabel = saveState.message || (saveState.ts ? `Saved ${formatTimestamp(saveState.ts)}` : "");
  const saveClass = saveState.status === "error" ? "danger" : saveState.status === "saving" ? "warning" : "muted";
  const statusValue = play.state?.status || "Draft";
  const statusClass = statusValue === "Active"
    ? "active"
    : statusValue === "Completed"
      ? "active"
      : statusValue === "Error"
        ? "error"
        : statusValue === "Draft"
          ? "draft"
          : statusValue === "Market Closed" || statusValue === "Outside Window" || statusValue === "Auto Paused"
            ? "warn"
            : "";

  dom.playEditor.innerHTML = `
    <div class="editor scrollbar">
      <div class="editor-section">
        <h3>Strategy Details</h3>
        <div class="form-grid cols-3">
          <label class="field">
            Strategy Name
            <input type="text" data-field="name" value="${play.name}" />
          </label>
          <label class="field">
            Symbol
            <input type="text" data-field="symbol" value="${play.symbol}" />
          </label>
          <label class="field">
            Call / Put
            ${renderSelect({
              value: play.side,
              options: [
                { value: "CALL", label: "CALL" },
                { value: "PUT", label: "PUT" }
              ],
              attrName: "data-field",
              attrValue: "side",
              variant: "field"
            })}
          </label>
          <label class="field">
            Bot Version (Entry Cost)
            ${renderSelect({
              value: play.versionTarget,
              options: state.config.versionTargets.map((version) => ({
                value: version.id,
                label: version.label
              })),
              attrName: "data-field",
              attrValue: "versionTarget",
              variant: "field"
            })}
          </label>
          <label class="field">
            Status
            ${renderSelect({
              value: play.active ? "true" : "false",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Draft" }
              ],
              attrName: "data-field",
              attrValue: "active",
              variant: "field"
            })}
          </label>
          <label class="field">
            Quantity
            <input type="number" step="1" data-field="quantity" value="${play.quantity}" />
          </label>
          <label class="field">
            Auto Pause Others
            ${renderSelect({
              value: play.autoDeactivateOthers ? "true" : "false",
              options: [
                { value: "true", label: "Enabled" },
                { value: "false", label: "Off" }
              ],
              attrName: "data-field",
              attrValue: "autoDeactivateOthers",
              variant: "field"
            })}
          </label>
        </div>
      </div>

      <div class="editor-row">
        <div class="editor-section">
          <h3>Schedule</h3>
          <div class="schedule-grid">
            <div class="day-toggle" data-schedule="days">
              ${DAY_LABELS.map((day) => {
                const isSelected = Array.isArray(schedule.days) && schedule.days.includes(day.key);
                return `<button type="button" class="day-button ${isSelected ? "active" : ""}" data-day="${day.key}">${day.label}</button>`;
              }).join("")}
            </div>
            <div class="form-grid">
              <label class="field">
                Start Time
                <input type="time" data-schedule="startTime" value="${schedule.startTime || ""}" />
              </label>
              <label class="field">
                End Time
                <input type="time" data-schedule="endTime" value="${schedule.endTime || ""}" />
              </label>
            </div>
            <div class="muted">Times use market timezone (${MARKET_TIMEZONE}). Market hours enforced ${MARKET_OPEN}–${MARKET_CLOSE}.</div>
          </div>
        </div>

        <div class="editor-section">
          <h3>Status</h3>
          <div class="status-box">
            <div class="strategy-meta">
              <span class="status-chip ${statusClass}">${statusValue}</span>
              <span class="muted">${play.state?.stage || "--"}</span>
            </div>
            ${play.state?.message ? `<div class="warning">${play.state.message}</div>` : ""}
          </div>
        </div>
      </div>

      <div class="editor-section">
        <h3>Strategy Flow</h3>
        <div class="step-list">
          ${play.steps
            .map((step, index) => `
              <div class="step-card" data-step-id="${step.id}">
                <div class="step-header">
                  <div>
                    <div class="step-title">Step ${index + 1}</div>
                    <div class="muted">IF/OR branches → THEN action</div>
                  </div>
                  <div class="sequence-controls">
                    <button data-action="step-up" ${index === 0 ? "disabled" : ""}>Up</button>
                    <button data-action="step-down" ${index === play.steps.length - 1 ? "disabled" : ""}>Down</button>
                    <button data-action="remove-step">Remove</button>
                  </div>
                </div>

                <div class="branch-list">
                  ${step.branches
                    .map((branch, branchIndex) => `
                      <div class="branch-row" data-step-id="${step.id}" data-branch-id="${branch.id}">
                        <div class="step-badge">${branchIndex === 0 ? "IF" : "OR"}</div>
                        ${renderSelect({
                          value: branch.condition.type,
                          options: [
                            { value: "IF_RISES", label: "Price Rises" },
                            { value: "IF_DROPS", label: "Price Drops" }
                          ],
                          attrName: "data-condition-field",
                          attrValue: "type",
                          variant: "compact"
                        })}
                        <input type="number" step="0.01" data-condition-field="value" value="${branch.condition.value ?? ""}" />
                        <div class="step-badge">THEN</div>
                        ${renderSelect({
                          value: branch.action.type,
                          options: [
                            { value: "ACTION_BUY", label: "Buy" },
                            { value: "ACTION_SELL", label: "Sell" }
                          ],
                          attrName: "data-action-field",
                          attrValue: "type",
                          variant: "compact"
                        })}
                        <input type="number" step="1" min="1" data-action-field="quantity" placeholder="${play.quantity} default" value="${branch.action.quantity ?? ""}" />
                        <button data-action="remove-branch">Remove</button>
                      </div>
                    `)
                    .join("")}
                </div>

                <div class="step-footer">
                  <button data-action="add-branch">Add OR Branch</button>
                </div>

              </div>
            `)
            .join("")}
        </div>
        <div class="condition-actions" style="justify-content:flex-start; margin-top:12px;">
          <button data-action="add-step">Add Step</button>
        </div>
      </div>

      <div class="editor-section">
        <h3>Logic Sentence Preview</h3>
        <div class="sequence-preview">
          ${buildPreviewLines(play).map((line) => `<div class="preview-line">${line}</div>`).join("")}
        </div>
      </div>

      ${
        errors.length
          ? `
            <div class="editor-section">
              <h3>Validation</h3>
              <div class="muted">${errors.join(" ")}</div>
            </div>
          `
          : ""
      }

      <div class="condition-actions condition-actions--split">
        <div class="save-group">
          <button class="primary" data-action="save-play" ${isDirty ? "" : "disabled"}>Save Strategy</button>
          <div class="save-status ${saveClass}">${saveLabel}</div>
        </div>
        <button class="ghost" data-action="delete-play">Delete Strategy</button>
      </div>
    </div>
  `;

  const nextEditor = dom.playEditor.querySelector(".editor");
  if (nextEditor) {
    nextEditor.scrollTop = previousScroll;
  }

  const bindFieldUpdate = (input) => {
    const handler = () => {
      const field = input.dataset.field;
      if (!field) {
        return;
      }
      updatePlay(play.playId, (draft) => {
        if (field === "name") {
          draft.name = input.value;
        } else if (field === "symbol") {
          draft.symbol = input.value.toUpperCase();
        } else if (field === "side") {
          draft.side = input.value;
        } else if (field === "versionTarget") {
          draft.versionTarget = input.value;
        } else if (field === "active") {
          draft.active = input.value === "true";
          const nextStatus = getDraftStatus(draft);
          draft.state.status = nextStatus.status;
          draft.state.stage = nextStatus.stage;
        } else if (field === "quantity") {
          draft.quantity = Number(input.value);
        } else if (field === "autoDeactivateOthers") {
          draft.autoDeactivateOthers = input.value === "true";
        }
      }, "play-input");
      setStrategyDirty(play.playId, true, "strategy-dirty-input");
    };

    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  };

  dom.playEditor.querySelectorAll("input[data-field]").forEach((input) => {
    if (input.closest(".branch-row")) {
      return;
    }
    bindFieldUpdate(input);
  });

  dom.playEditor.querySelectorAll("[data-schedule='days'] .day-button").forEach((button) => {
    button.addEventListener("click", () => {
      const dayKey = button.dataset.day;
      if (!dayKey) {
        return;
      }
      updatePlay(play.playId, (draft) => {
        if (!draft.schedule) {
          draft.schedule = { days: [], startTime: MARKET_OPEN, endTime: MARKET_CLOSE };
        }
        const days = new Set(draft.schedule.days || []);
        if (days.has(dayKey)) {
          days.delete(dayKey);
        } else {
          days.add(dayKey);
        }
        draft.schedule.days = Array.from(days);
        const nextStatus = getDraftStatus(draft);
        draft.state.status = nextStatus.status;
        draft.state.stage = nextStatus.stage;
      });
      setStrategyDirty(play.playId, true, "strategy-dirty-input");
      renderPlayEditor(getState());
    });
  });

  dom.playEditor.querySelectorAll("[data-schedule='startTime'], [data-schedule='endTime']").forEach((input) => {
    const handler = () => {
      const key = input.dataset.schedule;
      updatePlay(play.playId, (draft) => {
        if (!draft.schedule) {
          draft.schedule = { days: [], startTime: MARKET_OPEN, endTime: MARKET_CLOSE };
        }
        draft.schedule[key] = input.value;
        const nextStatus = getDraftStatus(draft);
        draft.state.status = nextStatus.status;
        draft.state.stage = nextStatus.stage;
      }, "play-input");
      setStrategyDirty(play.playId, true, "strategy-dirty-input");
    };
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  });

  dom.playEditor.querySelectorAll(".step-card").forEach((card) => {
    const stepId = card.dataset.stepId;

    card.querySelectorAll(".branch-row").forEach((row) => {
      const branchId = row.dataset.branchId;
      row.querySelectorAll("input[data-condition-field='value']").forEach((input) => {
        const handler = () => {
          updatePlay(play.playId, (draft) => {
            const step = draft.steps.find((item) => item.id === stepId);
            if (!step) {
              return;
            }
            const branch = step.branches.find((item) => item.id === branchId);
            if (!branch) {
              return;
            }
            branch.condition.value = input.value ? Number(input.value) : null;
          }, "play-input");
          setStrategyDirty(play.playId, true, "strategy-dirty-input");
        };
        input.addEventListener("change", handler);
        input.addEventListener("input", handler);
      });
      row.querySelectorAll("input[data-action-field='quantity']").forEach((input) => {
        const handler = () => {
          updatePlay(play.playId, (draft) => {
            const step = draft.steps.find((item) => item.id === stepId);
            if (!step) {
              return;
            }
            const branch = step.branches.find((item) => item.id === branchId);
            if (!branch) {
              return;
            }
            branch.action.quantity = input.value ? Number(input.value) : null;
          }, "play-input");
          setStrategyDirty(play.playId, true, "strategy-dirty-input");
        };
        input.addEventListener("change", handler);
        input.addEventListener("input", handler);
      });

      row.querySelectorAll("[data-action='remove-branch']").forEach((button) => {
        button.addEventListener("click", () => {
          updatePlay(play.playId, (draft) => {
            const step = draft.steps.find((item) => item.id === stepId);
            if (!step) {
              return;
            }
            const index = step.branches.findIndex((item) => item.id === branchId);
            if (index < 0) {
              return;
            }
            step.branches.splice(index, 1);
          });
          setStrategyDirty(play.playId, true);
        });
      });
    });

    card.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (!action || !["remove-step", "step-up", "step-down", "add-branch"].includes(action)) {
          return;
        }
        updatePlay(play.playId, (draft) => {
          const index = draft.steps.findIndex((item) => item.id === stepId);
          if (index < 0) {
            return;
          }
          const step = draft.steps[index];

          if (action === "remove-step") {
            draft.steps.splice(index, 1);
            return;
          }
          if (action === "step-up" || action === "step-down") {
            const target = action === "step-up" ? index - 1 : index + 1;
            if (target < 0 || target >= draft.steps.length) {
              return;
            }
            const [moved] = draft.steps.splice(index, 1);
            draft.steps.splice(target, 0, moved);
            return;
          }
          if (action === "add-branch") {
            step.branches.push({
              id: createId(),
              condition: createConditionBlock("IF_DROPS", 0),
              action: createActionBlock("ACTION_BUY")
            });
          }
        });
        setStrategyDirty(play.playId, true);
      });
    });
  });

  dom.playEditor.querySelectorAll(".select").forEach((select) => {
    const trigger = select.querySelector(".select-trigger");
    const options = select.querySelectorAll(".select-option");
    const field = select.dataset.field;
    const conditionField = select.dataset.conditionField;
    const actionField = select.dataset.actionField;

    if (trigger) {
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        if (select.classList.contains("disabled")) {
          return;
        }
        const isOpen = select.classList.contains("open");
        closeAllSelects();
        if (!isOpen) {
          select.classList.add("open");
        }
      });
    }

    options.forEach((option) => {
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        if (select.classList.contains("disabled")) {
          return;
        }
        const value = option.dataset.value;
        const label = option.textContent;
        select.dataset.value = value;
        if (trigger) {
          trigger.textContent = label;
        }
        closeAllSelects();

        if (field) {
          updatePlay(play.playId, (draft) => {
            if (field === "side") {
              draft.side = value;
            } else if (field === "versionTarget") {
              draft.versionTarget = value;
            } else if (field === "active") {
              draft.active = value === "true";
              const nextStatus = getDraftStatus(draft);
              draft.state.status = nextStatus.status;
              draft.state.stage = nextStatus.stage;
            } else if (field === "autoDeactivateOthers") {
              draft.autoDeactivateOthers = value === "true";
            }
          });
          setStrategyDirty(play.playId, true, "strategy-dirty-input");
          return;
        }

        const branchRow = select.closest(".branch-row");
        const stepId = branchRow?.dataset.stepId;
        const branchId = branchRow?.dataset.branchId;
        if (!stepId) {
          return;
        }

        updatePlay(play.playId, (draft) => {
          const step = draft.steps.find((item) => item.id === stepId);
          if (!step) {
            return;
          }
          const branch = step.branches.find((item) => item.id === branchId);
          if (!branch) {
            return;
          }
          if (conditionField === "type") {
            branch.condition.type = value;
          }
          if (actionField === "type") {
            branch.action.type = value;
          }
        });
        setStrategyDirty(play.playId, true);
      });
    });
  });

  dom.playEditor.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (!action || !["add-step", "delete-play", "save-play"].includes(action)) {
        return;
      }
      if (action === "add-step") {
        updatePlay(play.playId, (draft) => {
          draft.steps.push(createStepTemplate());
        });
        setStrategyDirty(play.playId, true);
      }
      if (action === "delete-play") {
        updateState((current) => {
          const plays = current.plays.filter((item) => item.playId !== play.playId);
          const nextPlay = plays[0] || null;
          return {
            ...current,
            plays,
            activePlayId: nextPlay ? nextPlay.playId : null
          };
        }, "play-delete");
      }
      if (action === "save-play") {
        void saveStrategy(play.playId);
      }
    });
  });
};

const renderPositions = (state, target = dom.positionsTable) => {
  if (!target) {
    return;
  }
  if (!state.positions.length) {
    target.innerHTML = `<div class="muted">No positions available.</div>`;
    return;
  }
  const rows = state.positions.map((position) => `
    <div class="table-row cols-5">
      <div>
        <div class="label">Symbol</div>
        <div class="value">${position.symbol}</div>
      </div>
      <div>
        <div class="label">Qty</div>
        <div class="value">${position.qty}</div>
      </div>
      <div>
          <div class="label">Avg</div>
          <div class="value">${formatCurrency(position.avgPrice)}</div>
      </div>
      <div>
          <div class="label">Last</div>
          <div class="value">${formatCurrency(position.lastPrice)}</div>
      </div>
      <div>
        <div class="label">Unrealized</div>
        <div class="value ${position.unrealizedPnL >= 0 ? "success" : "danger"}">${formatCurrency(position.unrealizedPnL)}</div>
      </div>
    </div>
  `);
  target.innerHTML = rows.join("");
};

const renderOrders = (state, target = dom.ordersTable) => {
  if (!target) {
    return;
  }
  if (!state.orders.length) {
    target.innerHTML = `<div class="muted">No orders available.</div>`;
    return;
  }
  const rows = state.orders.map((order) => `
    <div class="table-row cols-5">
      <div>
        <div class="label">Order</div>
        <div class="value">${order.id}</div>
      </div>
      <div>
        <div class="label">Side</div>
        <div class="value">${order.side}</div>
      </div>
      <div>
        <div class="label">Qty</div>
        <div class="value">${order.quantity}</div>
      </div>
      <div>
        <div class="label">Status</div>
        <div class="value">${order.status}</div>
      </div>
      <div>
          <div class="label">Avg Fill</div>
          <div class="value">${order.avgFillPrice ? formatCurrency(order.avgFillPrice) : "--"}</div>
      </div>
    </div>
  `);
  target.innerHTML = rows.join("");
};

const renderLogs = (state) => {
  dom.logList.innerHTML = state.logs
    .map(
      (log) => `
        <div class="log-item">
          <div class="log-message ${log.level === "error" ? "danger" : log.level === "warn" ? "warning" : ""}">${log.message}</div>
          <div class="log-time">${formatTimestamp(log.ts)}</div>
        </div>
      `
    )
    .join("");
};

const renderBackendStatus = (state, target) => {
  const status = state.backend.status || {};
  const connection = state.backend.connection || {};
  const destination = target || dom.backendStatus;
  if (!destination) {
    return;
  }
  const backendClass = connection.connected ? "success" : "warn";
  const twsClass = status.connected
    ? "success"
    : status.state === "ERROR"
      ? "error"
      : "warn";
  const statusMessage = status.message
    || connection.message
    || (status.connected ? "Connected" : "Awaiting IBKR status...");
  destination.innerHTML = `
    <div class="card-title">Connection Status</div>
    <div class="table">
      <div class="table-row cols-3">
        <div>
          <div class="label">Backend</div>
          <div class="value"><span class="status-pill ${backendClass}">${connection.connected ? "Connected" : "Offline"}</span></div>
        </div>
        <div>
          <div class="label">TWS / Gateway</div>
          <div class="value"><span class="status-pill ${twsClass}">${status.state || "OFFLINE"}</span></div>
        </div>
        <div>
          <div class="label">Account</div>
          <div class="value">${status.accountId || "--"}</div>
        </div>
      </div>
      <div class="table-row cols-3">
        <div>
          <div class="label">Message</div>
          <div class="value">${statusMessage}</div>
        </div>
        <div>
          <div class="label">Data Type</div>
          <div class="value">${status.dataType || "--"}</div>
        </div>
        <div>
          <div class="label">Server Time</div>
          <div class="value">${status.serverTime ? formatTimestamp(status.serverTime) : "--"}</div>
        </div>
      </div>
    </div>
  `;
};

const renderBackendConfig = (state, target) => {
  const fallback = {
    ib: {
      tradingMode: "paper",
      dataType: "delayed",
      port: getDefaultPort("paper"),
      accountId: ""
    }
  };
  const draft = state.backend.draft || state.backend.config || fallback;
  const ib = { ...fallback.ib, ...(draft.ib || {}) };
  const errors = state.backend.validationErrors || [];
  const accounts = state.backend.accounts || [];
  const twsConnected = (state.backend.status || {}).connected;
  const destination = target || dom.backendConfig;
  if (!destination) {
    return;
  }
  destination.innerHTML = `
    <div class="card-title">Backend Configuration</div>
    <div class="form-grid">
      <label class="field">
        Trading Mode
        ${renderSelect({
          value: ib.tradingMode,
          options: [
            { value: "paper", label: "Paper" },
            { value: "live", label: "Live" }
          ],
          attrName: "data-path",
          attrValue: "ib.tradingMode",
          variant: "field"
        })}
      </label>
      <label class="field">
        Data Type
        ${renderSelect({
          value: ib.dataType,
          options: [
            { value: "live", label: "Live" },
            { value: "frozen", label: "Frozen" },
            { value: "delayed", label: "Delayed" },
            { value: "delayed_frozen", label: "Delayed Frozen" }
          ],
          attrName: "data-path",
          attrValue: "ib.dataType",
          variant: "field"
        })}
      </label>
      <label class="field">
        IB Port (auto)
        <input type="number" data-path="ib.port" value="${ib.port ?? ""}" readonly />
      </label>
      <label class="field">
        Account ID
        ${
          accounts.length
            ? `
              ${renderSelect({
                value: ib.accountId || accounts[0],
                options: accounts.map((account) => ({ value: account, label: account })),
                attrName: "data-path",
                attrValue: "ib.accountId",
                variant: "field",
                disabled: !twsConnected
              })}
            `
            : `
              <input type="text" data-path="ib.accountId" value="${ib.accountId ?? ""}" disabled />
            `
        }
        ${twsConnected ? "" : `<div class=\"muted\">Connect to TWS to load accounts.</div>`}
      </label>
    </div>
    ${errors.length ? `<div class="muted" style="margin-top:10px;">${errors.join(" ")}</div>` : ""}
    <div class="condition-actions" style="justify-content:flex-start; margin-top:12px;">
      <button data-backend-action="validate">Validate</button>
      <button data-backend-action="save">Save & Restart</button>
    </div>
  `;
  bindBackendConfig(destination);
};

const renderBackendLogs = (state, target) => {
  const logs = state.backend.logs || [];
  const destination = target || dom.backendLogs;
  destination.innerHTML = logs
    .map(
      (log) => `
        <div class="log-item">
          <div class="log-message ${log.level === "error" ? "danger" : log.level === "warn" ? "warning" : ""}">${log.message}</div>
          <div class="log-time">${formatTimestamp(log.ts)}</div>
        </div>
      `
    )
    .join("") || `<div class="muted">No backend logs yet.</div>`;
};

const bindBackendConfig = (container) => {
  if (!container) {
    return;
  }
  container.querySelectorAll("input[data-path]").forEach((input) => {
    const path = input.dataset.path;
    if (!path) {
      return;
    }
    const handler = () => {
      if (input.type === "checkbox") {
        setDraftValue(path, input.checked);
        return;
      }
      if (input.type === "number") {
        setDraftValue(path, input.value ? Number(input.value) : "");
        return;
      }
      setDraftValue(path, input.value);

      if (path === "ib.tradingMode") {
        const nextPort = getDefaultPort(input.value);
        setDraftValue("ib.port", nextPort);
        renderBackendConfig(getState(), container);
      }
    };
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  });

  container.querySelectorAll(".select[data-path]").forEach((select) => {
    const trigger = select.querySelector(".select-trigger");
    const options = select.querySelectorAll(".select-option");
    const path = select.dataset.path;
    if (!path) {
      return;
    }

    if (trigger) {
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        if (select.classList.contains("disabled")) {
          return;
        }
        const isOpen = select.classList.contains("open");
        closeAllSelects();
        if (!isOpen) {
          select.classList.add("open");
        }
      });
    }

    options.forEach((option) => {
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        if (select.classList.contains("disabled")) {
          return;
        }
        const value = option.dataset.value;
        const label = option.textContent;
        select.dataset.value = value;
        if (trigger) {
          trigger.textContent = label;
        }
        closeAllSelects();
        setDraftValue(path, value);
        if (path === "ib.tradingMode") {
          const nextPort = getDefaultPort(value);
          setDraftValue("ib.port", nextPort);
          renderBackendConfig(getState(), container);
        }
      });
    });
  });

  container.querySelectorAll("[data-backend-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.backendAction;
      if (!backendClient || !backendClient.connected()) {
        appendBackendLog("Backend connection unavailable.", "warn");
        return;
      }
      try {
        const latest = getState();
        const draftConfig = latest.backend.draft || latest.backend.config;
        if (action === "validate") {
          const result = await backendClient.call("control.validate_config", {
            config: draftConfig
          });
          updateState((current) => ({
            ...current,
            backend: {
              ...current.backend,
              validationErrors: result.errors || []
            }
          }), "backend-validation");
        }
        if (action === "save") {
          const nextConfig = structuredClone(draftConfig || {});
          if (!nextConfig.ib) {
            nextConfig.ib = {};
          }
          nextConfig.ib.autoConnect = true;
          nextConfig.ib.autoReconnect = true;
          const result = await backendClient.call("control.set_config", {
            config: nextConfig,
            apply: true
          });
          updateState((current) => ({
            ...current,
            backend: {
              ...current.backend,
              validationErrors: result.errors || []
            }
          }), "backend-validation");
          if (!result.errors || result.errors.length === 0) {
            appendBackendLog("Config saved. Reconnecting...", "info");
          }
        }
      } catch (error) {
        appendBackendLog(error.message || "Backend action failed", "error");
      }
    });
  });
};

const handleUpdateEvent = (payload) => {
  if (!payload || !payload.type) {
    return;
  }
  const info = payload.info || {};
  const releaseNotes = normalizeReleaseNotes(info.releaseNotes);
  if (payload.type === "checking-for-update") {
    setUpdateState({
      status: "checking",
      message: "Checking for updates...",
      lastCheckedAt: Date.now(),
      progress: null
    });
    return;
  }
  if (payload.type === "update-available") {
    const versionLabel = info.version ? `v${info.version}` : "a new version";
    setUpdateState({
      status: "available",
      message: `Update ${versionLabel} available.`,
      version: info.version || null,
      releaseName: info.releaseName || null,
      releaseNotes,
      releaseDate: info.releaseDate || null,
      progress: null
    });
    return;
  }
  if (payload.type === "update-not-available") {
    setUpdateState({
      status: "none",
      message: "You're up to date.",
      lastCheckedAt: Date.now(),
      progress: null
    });
    return;
  }
  if (payload.type === "download-progress") {
    const percent = payload.progress?.percent;
    setUpdateState({
      status: "downloading",
      message: `Downloading update${typeof percent === "number" ? ` (${Math.round(percent)}%)` : "..."}`,
      progress: typeof percent === "number" ? percent : null
    });
    return;
  }
  if (payload.type === "update-downloaded") {
    setUpdateState({
      status: "downloaded",
      message: "Update ready. Restart to install.",
      progress: 100
    });
    return;
  }
  if (payload.type === "error") {
    setUpdateState({
      status: "error",
      message: payload.message || "Update error",
      progress: null
    });
  }
};

const bindUpdateControls = () => {
  if (dom.checkUpdates) {
    dom.checkUpdates.addEventListener("click", async () => {
      if (!window.appBridge?.checkForUpdates) {
        setUpdateState({
          status: "error",
          message: "Updates are not available in this build.",
          lastCheckedAt: Date.now()
        });
        return;
      }
      setUpdateState({
        status: "checking",
        message: "Checking for updates...",
        lastCheckedAt: Date.now(),
        progress: null
      });
      const result = await window.appBridge.checkForUpdates();
      if (!result?.ok) {
        setUpdateState({
          status: "error",
          message: result?.error || "Update check failed",
          progress: null
        });
      }
    });
  }
  if (dom.downloadUpdate) {
    dom.downloadUpdate.addEventListener("click", async () => {
      if (!window.appBridge?.downloadUpdate) {
        setUpdateState({
          status: "error",
          message: "Updates are not available in this build.",
          progress: null
        });
        return;
      }
      setUpdateState({
        status: "downloading",
        message: "Starting download...",
        progress: 0
      });
      const result = await window.appBridge.downloadUpdate();
      if (!result?.ok) {
        setUpdateState({
          status: "error",
          message: result?.error || "Update download failed",
          progress: null
        });
      }
    });
  }
  if (dom.restartUpdate) {
    dom.restartUpdate.addEventListener("click", async () => {
      if (!window.appBridge?.restartUpdate) {
        setUpdateState({
          status: "error",
          message: "Update install unavailable.",
          progress: null
        });
        return;
      }
      await window.appBridge.restartUpdate();
    });
  }
};

const setDraftValue = (path, value) => {
  updateState((current) => {
    const draft = structuredClone(current.backend.draft || current.backend.config || { ib: {} });
    const keys = path.split(".");
    let cursor = draft;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const key = keys[i];
      if (!cursor[key]) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = value;
    return {
      ...current,
      backend: {
        ...current.backend,
        draft
      }
    };
  }, "backend-draft");
};

const renderBackendView = (state) => {
  renderBackendStatus(state, dom.backendStatus);
  renderBackendConfig(state, dom.backendConfig);
  renderUpdatePanel(state);
  renderBackendLogs(state, dom.backendLogs);
};

const renderDashboard = (state) => {
  renderAccountSummary(state);
  renderMarketSnapshot(state);
  renderActivePlays(state);
  renderExecutionMonitor(state);
  renderPositions(state, dom.dashboardPositions);
  renderOrders(state, dom.dashboardOrders);
};

const renderPlayBuilder = (state) => {
  renderPlayList(state);
  renderPlayEditor(state);
};

const renderPortfolioView = (state) => {
  renderPortfolioSummary(state);
};

function renderPortfolioSummary(state) {
  const target = dom.portfolioSummary;
  if (!target) {
    return;
  }
  const account = state.account || {};
  const raw = account.raw || {};
  const keys = Object.keys(raw);
  const formatAccountKey = (key) => {
    const spaced = key
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/PnL/g, "P/L")
      .replace(/RegT/g, "Reg T")
      .replace(/SMA/g, "SMA")
      .replace(/NAV/g, "NAV");
    return spaced.replace(/\b\w/g, (match) => match.toUpperCase());
  };
  const formatAccountValue = (key, value) => {
    if (value === null || value === undefined || value === "") {
      return "--";
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (/Cushion|Percent|Pct/i.test(key)) {
        return `${(numeric * 100).toFixed(2)}%`;
      }
      if (/PnL|Value|Cash|Funds|Liquidity|Margin|BuyingPower|Equity|Balance|Accrued|Commission|Fee|Interest/i.test(key)) {
        return formatCurrency(numeric);
      }
      return formatNumber(numeric, 2);
    }
    return String(value);
  };

  const groups = [
    { title: "Balances", match: /NetLiquidation|TotalCashValue|CashBalance|SettledCash|AccruedCash|EquityWithLoanValue|GrossPositionValue|FullInitMarginReq|FullMaintMarginReq|LookAheadInitMarginReq|LookAheadMaintMarginReq|LookAheadAvailFunds|LookAheadExcessLiquidity/i },
    { title: "Buying Power", match: /BuyingPower|AvailableFunds|ExcessLiquidity|Cushion|DayTradesRemaining/i },
    { title: "P\/L", match: /PnL|Unrealized|Realized|Profit|Loss/i },
    { title: "Margin", match: /Margin|SMA|RegT/i },
    { title: "Account", match: /Account|Currency|Segment|Leverage|LastLiquidation|LookAheadNextChange/i },
    { title: "Fees & Interest", match: /Interest|Commission|Fee|Accrued|Dividend/i }
  ];

  const grouped = new Map(groups.map((group) => [group.title, []]));
  const other = [];
  keys.forEach((key) => {
    const value = raw[key];
    const entry = { key, value };
    const group = groups.find((item) => item.match.test(key));
    if (group) {
      grouped.get(group.title).push(entry);
    } else {
      other.push(entry);
    }
  });

  const renderGroup = (title, entries) => {
    if (!entries.length) {
      return "";
    }
    const rows = entries
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => `
        <div class="table-row cols-2">
          <div>
            <div class="label">${formatAccountKey(entry.key)}</div>
          </div>
          <div>
            <div class="value">${formatAccountValue(entry.key, entry.value)}</div>
          </div>
        </div>
      `)
      .join("");
    return `
      <div class="summary-group">
        <div class="summary-title">${title}</div>
        <div class="table summary-table scrollbar">${rows}</div>
      </div>
    `;
  };

  const groupSections = [
    ...groups.map((group) => renderGroup(group.title, grouped.get(group.title) || [])),
    renderGroup("Other", other)
  ].filter(Boolean);

  target.innerHTML = `
    <div class="card-title">Account Summary</div>
    ${groupSections.length ? `<div class="summary-grid">${groupSections.join("")}</div>` : `<div class="muted">No account summary available.</div>`}
  `;
}

const renderBackendPanel = (state) => {
  renderBackendView(state);
};

const renderView = (view, state) => {
  if (view === "dashboard") {
    renderDashboard(state);
  } else if (view === "strategies") {
    renderPlayBuilder(state);
  } else if (view === "portfolio") {
    renderPortfolioView(state);
  } else if (view === "backend") {
    renderBackendPanel(state);
  }
};

let updateSubscriptions = async () => {};
let refreshPortfolio = async () => {};
let saveStrategy = async () => {};

const updateNavigationAvailability = (state) => {
  navButtons.forEach((button) => {
    button.disabled = false;
  });
};

const renderAll = (state) => {
  renderDashboard(state);
  renderPlayBuilder(state);
  renderPortfolioView(state);
  renderBackendPanel(state);
  renderBackendPanel(state);
};

const handleStateChange = (state, action) => {
  switch (action) {
    case "price-update":
      if (currentView === "dashboard") {
        renderMarketSnapshot(state);
        renderActivePlays(state);
      }
      break;
    case "portfolio-refresh":
      if (currentView === "dashboard") {
        renderAccountSummary(state);
        renderExecutionMonitor(state);
      }
      if (currentView === "portfolio") {
        renderPortfolioView(state);
      }
      break;
    case "play-update":
    case "play-add":
    case "play-delete":
    case "active-play":
    case "config-update":
    case "strategy-dirty":
    case "strategies-load":
    case "strategy-save":
      if (currentView === "dashboard") {
        renderActivePlays(state);
      }
      if (currentView === "strategies") {
        renderPlayBuilder(state);
      }
      break;
    case "strategy-dirty-input":
      if (currentView === "dashboard") {
        renderActivePlays(state);
      }
      if (currentView === "strategies") {
        renderPlayList(state);
      }
      break;
    case "play-input":
      if (currentView === "strategies") {
        renderPlayList(state);
      }
      if (currentView === "dashboard") {
        renderActivePlays(state);
      }
      break;
    case "evaluate":
      if (currentView === "dashboard") {
        renderActivePlays(state);
      }
      break;
    case "order-filled":
    case "order-update":
      if (currentView === "dashboard") {
        renderExecutionMonitor(state);
      }
      if (currentView === "portfolio") {
        renderPortfolioView(state);
      }
      break;
    case "log":
      break;
    case "backend-status":
    case "backend-config":
    case "backend-log":
    case "backend-validation":
    case "backend-draft":
    case "update-status":
      if (currentView === "backend") {
        renderBackendPanel(state);
      }
      updateNavigationAvailability(state);
      break;
    default:
      renderView(currentView, state);
      updateNavigationAvailability(state);
      break;
  }
};

const bindNavigation = () => {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      const ready = isBackendReady(getState());
      if (!ready && view !== "backend") {
        appendBackendLog("Backend not ready yet. Showing live data may be incomplete.", "warn");
      }
      navButtons.forEach((btn) => btn.classList.toggle("active", btn === button));
      views.forEach((section) => {
        section.hidden = section.dataset.view !== view;
      });
      currentView = view;
      renderView(view, getState());
    });
  });
};

const init = async () => {
  window.addEventListener("error", (event) => {
    appendBackendLog(event.message || "Renderer error", "error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message = event?.reason?.message || "Unhandled promise rejection";
    appendBackendLog(message, "error");
  });
  const params = new URLSearchParams(window.location.search);
  let runtime = {
    mode: "live",
    backendUrl: params.get("backendUrl") || null,
    configPath: params.get("configPath") || null,
    appVersion: params.get("appVersion") || "dev",
    banner: params.get("banner") || null
  };
  try {
    if (window.appBridge?.getRuntimeConfig) {
      const bridgeRuntime = await window.appBridge.getRuntimeConfig();
      runtime = { ...runtime, ...bridgeRuntime };
      if (window.appBridge.onBackendLog) {
        window.appBridge.onBackendLog((payload) => {
          if (!payload?.message) {
            return;
          }
          appendBackendLog(payload.message, payload.level || "info");
        });
      }
      if (window.appBridge.onUpdateEvent) {
        window.appBridge.onUpdateEvent(handleUpdateEvent);
      }
    }
  } catch (error) {
    appendBackendLog(error.message || "Runtime bridge failed", "warn");
  }
  const mode = "live";
  const bannerMessages = [];
  const defaultBackendUrl = "ws://127.0.0.1:8765";
  const resolvedBackendUrl = runtime.backendUrl || defaultBackendUrl;
  setState({
    mode,
    backend: {
      ...getState().backend,
      url: resolvedBackendUrl
    }
  }, "runtime");
  appendBackendLog(`Backend URL: ${resolvedBackendUrl}`, "info");
  dom.modePill.textContent = "Mode: Live";
  dom.appVersion.textContent = `v${runtime.appVersion}`;
  setUpdateState({ currentVersion: runtime.appVersion }, "update-status");
  if (runtime.banner) {
    bannerMessages.push(runtime.banner);
    appendLog(runtime.banner, "warn");
  }
  if (bannerMessages.length) {
    dom.modeBanner.textContent = bannerMessages.join(" ");
    dom.modeBanner.hidden = false;
  }

  const fetchAccounts = async () => {
    if (!backendClient || !backendClient.connected()) {
      return;
    }
    if (!(getState().backend.status || {}).connected) {
      return;
    }
    if (accountsLoaded === true) {
      return;
    }
    try {
      const result = await backendClient.call("control.get_accounts");
      const accounts = result.accounts || [];
      accountsLoaded = accounts.length > 0;
      updateState((state) => {
        const nextDraft = structuredClone(state.backend.draft || state.backend.config || { ib: {} });
        if (accounts.length > 0 && !nextDraft.ib.accountId) {
          nextDraft.ib.accountId = accounts[0];
        }
        return {
          ...state,
          backend: {
            ...state.backend,
            accounts,
            draft: nextDraft
          }
        };
      }, "backend-accounts");
    } catch (error) {
      appendBackendLog(error.message || "Failed to load accounts", "warn");
    }
  };

  const persistStrategies = async (strategies) => {
    if (!backendClient || !backendClient.connected()) {
      throw new Error("Backend connection unavailable.");
    }
    await backendClient.call("control.set_strategies", { strategies });
  };

  saveStrategy = async (playId) => {
    const state = getState();
    const play = state.plays.find((item) => item.playId === playId);
    if (!play) {
      return;
    }
    const errors = validatePlay(play, state.config);
    if (errors.length) {
      appendBackendLog(errors[0], "warn");
      setStrategySaveState("error", errors[0]);
      return;
    }
    try {
      setStrategySaveState("saving", "Saving...");
      const strategies = state.plays.map(serializeStrategy);
      await persistStrategies(strategies);
      const executionPlays = buildExecutionPlays(state.plays, state.executionPlays);
      updateState((current) => ({
        ...current,
        executionPlays,
        plays: syncRuntimeToDraft(current.plays, executionPlays),
        strategyDirtyIds: []
      }), "strategy-dirty");
      appendBackendLog("Strategy saved.", "info");
      setStrategySaveState("saved", "Saved");
    } catch (error) {
      appendBackendLog(error.message || "Failed to save strategy", "error");
      setStrategySaveState("error", error.message || "Save failed");
    }
  };

  const connectTws = async () => {
    if (!backendClient || !backendClient.connected()) {
      return;
    }
    const status = getState().backend.status || {};
    if (status.connected) {
      return;
    }
    const now = Date.now();
    if (twsConnecting || now - lastTwsAttempt < 4000) {
      return;
    }
    twsConnecting = true;
    lastTwsAttempt = now;
    try {
      appendBackendLog("Connecting to TWS/Gateway...", "info");
      await backendClient.call("control.connect");
    } catch (error) {
      appendBackendLog(error.message || "TWS connect failed", "warn");
    } finally {
      twsConnecting = false;
    }
  };

  const setBackendOffline = (message) => {
    updateState((state) => ({
      ...state,
      backend: {
        ...state.backend,
        connection: {
          connected: false,
          message: message || "Backend offline"
        },
        lastStatusAt: null,
        status: {
          ...state.backend.status,
          accountId: "",
          dataType: "",
          serverTime: null,
          state: "OFFLINE",
          connected: false,
          message: message || "Backend offline"
        }
      }
    }), "backend-status");
  };

  const scheduleBackendReconnect = (delayMs = 1200) => {
    if (backendRetryTimer) {
      return;
    }
    backendRetryTimer = setTimeout(async () => {
      backendRetryTimer = null;
      if (!backendClient) {
        return;
      }
      if (backendClient.connected()) {
        return;
      }
      await connectBackend();
    }, delayMs);
  };

  const bindBackendHandlers = () => {
    if (!backendClient || backendHandlersBound) {
      return;
    }
    backendHandlersBound = true;
    backendClient.on("connection_open", () => {
      updateState((state) => ({
        ...state,
        backend: {
          ...state.backend,
          connection: {
            connected: true,
            message: "Backend connected"
          }
        }
      }), "backend-connection");
      appendBackendLog("Backend connected.", "info");
      setTimeout(() => {
        connectTws();
      }, 1000);
    });
    backendClient.on("connection_closed", () => {
      servicesReady = false;
      accountsLoaded = false;
      updateState((state) => ({
        ...state,
        backend: {
          ...state.backend,
          connection: {
            connected: false,
            message: "Backend disconnected"
          },
          accounts: []
        }
      }), "backend-accounts");
      setBackendOffline("Backend disconnected. Retrying...");
      scheduleBackendReconnect(1800);
    });
    backendClient.on("connection_error", (payload) => {
      updateState((state) => ({
        ...state,
        backend: {
          ...state.backend,
          connection: {
            connected: false,
            message: payload?.message || "Backend connection error"
          }
        }
      }), "backend-connection");
      setBackendOffline(payload?.message || "Backend connection error.");
      scheduleBackendReconnect(2000);
    });
    backendClient.on("status_update", (status) => {
      updateState((state) => ({
        ...state,
        backend: {
          ...state.backend,
          connection: {
            connected: true,
            message: "Backend connected"
          },
          lastStatusAt: Date.now(),
          status
        }
      }), "backend-status");
      const snapshot = `${status.state}|${status.connected}|${status.message}|${status.lastError}`;
      if (snapshot !== lastStatusSnapshot) {
        lastStatusSnapshot = snapshot;
        if (status.message) {
          appendBackendLog(status.message, status.state === "ERROR" ? "error" : "info");
        }
        if (status.lastError) {
          appendBackendLog(status.lastError, "error");
        }
      }
      if (status.connected) {
        fetchAccounts();
      } else {
        accountsLoaded = false;
        updateState((state) => ({
          ...state,
          backend: {
            ...state.backend,
            accounts: []
          }
        }), "backend-accounts");
        connectTws();
      }
      if (isBackendReady(getState())) {
        initLiveServices();
      } else {
        servicesReady = false;
      }
    });
    backendClient.on("backend_log", (entry) => {
      appendBackendLog(entry.message, entry.level || "info");
    });
    backendClient.on("config_update", (config) => {
      updateState((state) => ({
        ...state,
        backend: {
          ...state.backend,
          config,
          draft: config,
          validationErrors: []
        }
      }), "backend-config");
    });
  };

  const connectBackend = async () => {
    if (!backendClient) {
      setBackendOffline("Backend URL missing. Check startup configuration.");
      return;
    }
    if (backendConnecting) {
      return;
    }
    bindBackendHandlers();
    if (backendClient.connected()) {
      return;
    }
    backendConnecting = true;
    try {
      appendBackendLog("Connecting to backend...", "info");
      updateState((state) => ({
        ...state,
        backend: {
          ...state.backend,
          connection: {
            connected: false,
            message: "Connecting to backend"
          }
        }
      }), "backend-connection");
      await backendClient.connect();
      const status = await backendClient.call("control.get_status");
      const config = await backendClient.call("control.get_config");
      const strategiesResult = await backendClient.call("control.get_strategies");
      applyStrategies(strategiesResult.strategies || []);
      const normalizedConfig = structuredClone(config);
      if (!normalizedConfig.ib) {
        normalizedConfig.ib = {};
      }
      if (!normalizedConfig.ib.port) {
        normalizedConfig.ib.port = getDefaultPort(normalizedConfig.ib.tradingMode || "paper");
      }
      updateState((state) => ({
        ...state,
        backend: {
          ...state.backend,
          connection: {
            connected: true,
            message: "Backend connected"
          },
          lastStatusAt: Date.now(),
          status,
          config: normalizedConfig,
          draft: normalizedConfig,
          validationErrors: []
        }
      }), "backend-status");
      if (!status.connected) {
        setTimeout(() => {
          connectTws();
        }, 1000);
      } else {
        fetchAccounts();
      }
      if (backendClient.connected()) {
        updateState((state) => ({
          ...state,
          backend: {
            ...state.backend,
            connection: {
              connected: true,
              message: "Backend connected"
            }
          }
        }), "backend-connection");
      }
      if (isBackendReady(getState())) {
        initLiveServices();
      }
    } catch (error) {
      appendBackendLog(error.message || "Backend connection failed", "warn");
      setBackendOffline("Backend connection failed. Retrying...");
      scheduleBackendReconnect(2000);
    } finally {
      backendConnecting = false;
    }
  };

  const startStatusWatchdog = () => {
    if (statusWatchdog) {
      return;
    }
    statusWatchdog = setInterval(() => {
      const state = getState();
      const last = state.backend.lastStatusAt;
      if (!last) {
        if (!state.backend.connection.connected) {
          scheduleBackendReconnect(2000);
        }
        return;
      }
      const stale = Date.now() - last > 6000;
      if (stale) {
        setBackendOffline("Backend heartbeat lost. Retrying...");
        scheduleBackendReconnect(2000);
      }
    }, 2000);
  };

  const startStatusPoll = () => {
    if (statusPoll) {
      return;
    }
    statusPoll = setInterval(async () => {
      if (!backendClient || !backendClient.connected()) {
        return;
      }
      try {
        const status = await backendClient.call("control.get_status");
        updateState((state) => ({
          ...state,
          backend: {
            ...state.backend,
            connection: {
              connected: true,
              message: "Backend connected"
            },
            lastStatusAt: Date.now(),
            status
          }
        }), "backend-status");
        if (!status.connected) {
          connectTws();
        }
      } catch (error) {
        appendBackendLog(error.message || "Status poll failed", "warn");
      }
    }, 2000);
  };

  const startReconnectLoop = () => {
    setInterval(() => {
      const state = getState();
      if (!state.backend.connection.connected) {
        connectBackend();
        return;
      }
      if (!state.backend.status?.connected) {
        connectTws();
      }
    }, 3000);
  };

  const startPortfolioLoop = () => {
    setInterval(() => {
      if (!servicesReady) {
        return;
      }
      void refreshPortfolio();
    }, 4000);
  };

  try {
    backendClient = createBackendClient({ url: resolvedBackendUrl });
    startStatusWatchdog();
    startReconnectLoop();
    startPortfolioLoop();
    setTimeout(() => {
      connectBackend();
    }, 800);
  } catch (error) {
    appendBackendLog(error.message || "Backend init failed", "error");
    setBackendOffline("Backend init failed. Retrying...");
    scheduleBackendReconnect(2000);
    startReconnectLoop();
  }

  function initLiveServices() {
    if (servicesReady || !backendClient) {
      return;
    }
    marketData = createMarketDataLive({ client: backendClient });
    optionsChain = createOptionsChainLive({ client: backendClient });
    portfolio = createPortfolioLive({ client: backendClient });
    execution = createExecutionLive({ client: backendClient });
    execution.onEvent(handleOrderEvent);
    servicesReady = true;
    void updateSubscriptions();
    void refreshPortfolio();
  }

  refreshPortfolio = async function refreshPortfolio() {
    if (!servicesReady || !portfolio) {
      return;
    }
    try {
      const account = await Promise.resolve(portfolio.getAccountSummary());
      const positions = await Promise.resolve(portfolio.getPositions());
      const orders = await Promise.resolve(portfolio.getOrders());
      setState({ account, positions, orders }, "portfolio-refresh");
    } catch (error) {
      appendBackendLog(error.message || "Portfolio refresh failed", "warn");
    }
  }

  function handleOrderEvent(event) {
    if (event.type === "filled") {
      const play = getState().plays.find((item) => item.playId === event.order.playId);
      const sentence = play ? buildPreviewLines(play).join(" | ") : "";
      if (event.order.side === "SELL" && play?.state.openPosition) {
        const qty = event.order.quantity;
        const pnl = (event.order.avgFillPrice - play.state.openPosition.premium)
          * qty
          * 100;
        appendLog(`${sentence} | P/L: ${formatCurrency(pnl)}`, "info");
      }

      updateState((state) => {
        const plays = (state.executionPlays && state.executionPlays.length ? state.executionPlays : state.plays).map((item) => {
          if (item.playId !== event.order.playId) {
            return item;
          }
          const next = structuredClone(item);
          if (next.pendingAction?.orderId === event.order.id) {
            next.stepCursor = next.pendingAction.nextStepIndex;
            next.stepTriggeredBranchId = null;
            next.pendingAction = null;
          }

          if (event.order.side === "BUY") {
            if (next.state.openPosition) {
              const totalQty = next.state.openPosition.quantity + event.order.quantity;
              const avgPremium = (next.state.openPosition.premium * next.state.openPosition.quantity
                + event.order.avgFillPrice * event.order.quantity) / totalQty;
              next.state.openPosition = {
                premium: Number(avgPremium.toFixed(2)),
                quantity: totalQty,
                option: event.order.option ? { ...event.order.option } : next.state.openPosition.option
              };
            } else {
              next.state.openPosition = {
                premium: event.order.avgFillPrice,
                quantity: event.order.quantity,
                option: event.order.option ? { ...event.order.option } : null
              };
            }
          }
          if (event.order.side === "SELL" && next.state.openPosition) {
            const qty = event.order.quantity;
            const pnl = (event.order.avgFillPrice - next.state.openPosition.premium)
              * qty
              * 100;
            next.state.realizedPnL = Number((next.state.realizedPnL + pnl).toFixed(2));
            const remaining = next.state.openPosition.quantity - qty;
            next.state.openPosition = remaining > 0
              ? { ...next.state.openPosition, quantity: remaining }
              : null;
          }

          next.state.status = next.stepCursor >= next.steps.length ? "Completed" : "Active";
          next.state.stage = next.stepCursor >= next.steps.length
            ? "All steps complete"
            : `Step ${next.stepCursor + 1}: Waiting for IF`;
          return next;
        });
        return { ...state, executionPlays: plays, plays: syncRuntimeToDraft(state.plays, plays) };
      }, "order-filled");
    }
    void refreshPortfolio();
  }

  const evaluatePlays = async () => {
    if (!servicesReady || !marketData || !optionsChain || !execution) {
      return;
    }
    if (!isBackendReady(getState())) {
      return;
    }
    if (evaluationInProgress) {
      return;
    }
    evaluationInProgress = true;
    try {
      const state = getState();
      const now = new Date();
      const marketNow = getMarketNow();
      const ordersToSubmit = [];
      const configErrors = validateConfig(state.config);
      if (configErrors.length) {
        const plays = state.plays.map((play) => ({
          ...play,
          state: { ...play.state, status: "Error", stage: "Config error", message: configErrors[0] }
        }));
        setState({ ...state, plays }, "evaluate");
        return;
      }

      const plays = [];
      const sourcePlays = state.executionPlays && state.executionPlays.length ? state.executionPlays : state.plays;
      let autoPause = null;
      for (const play of sourcePlays) {
        const next = structuredClone(play);
        next.state.message = "";
        if (next.state.autoDisabledUntilSession) {
          const openMinutes = parseTimeToMinutes(MARKET_OPEN) ?? 0;
          if (
            marketNow.dateKey > next.state.autoDisabledUntilSession ||
            (marketNow.dateKey === next.state.autoDisabledUntilSession && marketNow.minutes >= openMinutes)
          ) {
            next.state.autoDisabledUntilSession = null;
          }
        }

        if (!next.active) {
          next.state.status = "Draft";
          next.state.stage = "Draft strategy";
          plays.push(next);
          continue;
        }

        if (next.state.autoDisabledUntilSession) {
          next.state.status = "Auto Paused";
          next.state.stage = `Resumes ${next.state.autoDisabledUntilSession}`;
          plays.push(next);
          continue;
        }

        const errors = validatePlay(next, state.config);
        if (errors.length) {
          next.state.status = "Error";
          next.state.stage = "Fix validation";
          next.state.message = errors[0];
          plays.push(next);
          continue;
        }

        if (!isWithinSchedule(next.schedule, marketNow)) {
          next.state.status = "Outside Window";
          next.state.stage = "Waiting for schedule";
          plays.push(next);
          continue;
        }

        if (!isMarketOpen(marketNow)) {
          next.state.status = "Market Closed";
          next.state.stage = "Waiting for market";
          plays.push(next);
          continue;
        }

        if (next.pendingAction) {
          next.state.status = "Active";
          next.state.stage = "Order pending";
          plays.push(next);
          continue;
        }

        if (next.stepCursor >= next.steps.length) {
          next.state.status = "Completed";
          next.state.stage = "All steps complete";
          plays.push(next);
          continue;
        }

        const lastPrice = state.prices[next.symbol]?.price ?? marketData.getLastPrice(next.symbol);
        if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
          next.state.status = "Active";
          next.state.stage = `Step ${next.stepCursor + 1}: Waiting for price`;
          next.state.message = "Waiting for price feed.";
          plays.push(next);
          continue;
        }
        next.state.lastEvaluatedAt = now.toISOString();

        const step = next.steps[next.stepCursor];
        if (!step) {
          next.state.status = "Completed";
          next.state.stage = "All steps complete";
          plays.push(next);
          continue;
        }

        const branches = step.branches || [];
        if (!branches.length) {
          next.state.status = "Error";
          next.state.stage = "Missing branches";
          next.state.message = "Step has no branches.";
          plays.push(next);
          continue;
        }

        let branch = null;
        if (next.stepTriggeredBranchId) {
          branch = branches.find((item) => item.id === next.stepTriggeredBranchId) || null;
        } else {
          branch = branches.find((item) => evaluateCondition(item.condition, lastPrice)) || null;
        }

        if (!branch) {
          next.state.status = "Active";
          next.state.stage = `Step ${next.stepCursor + 1}: Waiting for IF`;
          plays.push(next);
          continue;
        }

        if (next.autoDeactivateOthers && next.stepCursor === 0) {
          autoPause = {
            playId: next.playId,
            untilDateKey: getNextMarketSessionDateKey(marketNow)
          };
        }

        if (branch.action.type === "ACTION_SELL" && !next.state.openPosition) {
          next.state.status = "Error";
          next.state.stage = "Sell requires position";
          next.state.message = "Sell action requires an open position.";
          plays.push(next);
          continue;
        }

        let optionSelection = null;
        let fillPrice = null;
        if (branch.action.type === "ACTION_BUY") {
          const versionTarget = getVersionTarget(state.config, next.versionTarget);
          try {
            const selection = await optionsChain.selectOptionByPremium({
              symbol: next.symbol,
              side: next.side,
              targetPremium: versionTarget.targetPremium,
              minDaysOut: 25
            });
            optionSelection = {
              side: next.side,
              strike: selection.strike,
              expiry: selection.expiry
            };
            fillPrice = selection.premium;
          } catch (error) {
            next.state.status = "Error";
            next.state.stage = "Option selection failed";
            next.state.message = error.message || "No option meets premium target.";
            plays.push(next);
            continue;
          }
        } else {
          optionSelection = next.state.openPosition?.option;
          if (!optionSelection) {
            next.state.status = "Error";
            next.state.stage = "Missing option";
            next.state.message = "Missing option details for sell action.";
            plays.push(next);
            continue;
          }
          try {
            fillPrice = await Promise.resolve(optionsChain.getOptionPremium({
              symbol: next.symbol,
              strike: optionSelection.strike,
              expiry: optionSelection.expiry,
              side: optionSelection.side
            }));
          } catch (error) {
            next.state.status = "Error";
            next.state.stage = "Option pricing failed";
            next.state.message = error.message || "Missing option premium.";
            plays.push(next);
            continue;
          }
        }

        next.state.status = "Active";
        next.state.stage = `Step ${next.stepCursor + 1}: Order submitted`;
        next.state.lastTriggeredAt = now.toISOString();
        next.stepTriggeredBranchId = branch.id;
        next.pendingAction = {
          orderId: null,
          nextStepIndex: next.stepCursor + 1,
          actionType: branch.action.type,
          triggeredBranchId: branch.id,
          option: { ...optionSelection },
          premium: fillPrice
        };
        ordersToSubmit.push({
          playId: next.playId,
          symbol: next.symbol,
          side: branch.action.type === "ACTION_BUY" ? "BUY" : "SELL",
          quantity: branch.action.quantity || next.quantity,
          option: { ...optionSelection },
          fillPrice
        });

        plays.push(next);
      }

      let adjustedPlays = plays;
      if (autoPause) {
        adjustedPlays = plays.map((item) => {
          if (item.playId === autoPause.playId || !item.active) {
            return item;
          }
          return {
            ...item,
            state: {
              ...item.state,
              autoDisabledUntilSession: autoPause.untilDateKey,
              status: "Auto Paused",
              stage: `Resumes ${autoPause.untilDateKey}`
            }
          };
        });
      }
      const syncedDraft = syncRuntimeToDraft(state.plays, adjustedPlays);
      setState({ ...state, executionPlays: adjustedPlays, plays: syncedDraft }, "evaluate");

      for (const orderRequest of ordersToSubmit) {
        try {
          const orderId = await Promise.resolve(execution.submitOrder(orderRequest));
          updatePlay(orderRequest.playId, (draft) => {
            draft.state.lastOrderId = orderId;
            if (draft.pendingAction) {
              draft.pendingAction.orderId = orderId;
            }
          }, "order-update");
        } catch (error) {
          appendBackendLog(error.message || "Order submission failed", "error");
        }
      }
    } finally {
      evaluationInProgress = false;
    }
  };

  updateSubscriptions = async () => {
    if (!servicesReady || !marketData) {
      return;
    }
      const state = getState();
      const symbols = getTrackedSymbols(state.executionPlays && state.executionPlays.length ? state.executionPlays : state.plays);
    const nextSet = new Set(symbols);
    const toRemove = Array.from(subscribedSymbols).filter((symbol) => !nextSet.has(symbol));
    const toAdd = symbols.filter((symbol) => !subscribedSymbols.has(symbol));

    try {
      if (toRemove.length > 0) {
        await marketData.unsubscribe(toRemove, handlePriceUpdate);
      }
      if (toAdd.length > 0) {
        await marketData.subscribe(toAdd, handlePriceUpdate);
      }
    } catch (error) {
      appendBackendLog(error.message || "Market data subscription failed", "warn");
    }

    subscribedSymbols = nextSet;
  };

  const handlePriceUpdate = ({ symbol, price }) => {
    if (!servicesReady) {
      return;
    }
    updateState((state) => {
      const previous = state.prices[symbol]?.price ?? price;
      const prices = {
        ...state.prices,
        [symbol]: {
          price,
          prev: previous
        }
      };
      return { ...state, prices, lastRefresh: Date.now() };
    }, "price-update");

    void refreshPortfolio();
    void evaluatePlays();
  };

  void updateSubscriptions();
  void refreshPortfolio();

  subscribe((state, action) => {
    handleStateChange(state, action);
    void updateSubscriptions();
  });

  document.addEventListener("click", closeAllSelects);

  renderAll(getState());
  bindNavigation();
  bindUpdateControls();
  updateNavigationAvailability(getState());

  dom.newPlay.addEventListener("click", () => {
    updateState((state) => {
      const lastSymbol = state.plays[0]?.symbol || "SPY";
      const play = createPlayTemplate(lastSymbol, state.plays.length + 1);
      play.active = false;
      play.state.status = "Draft";
      play.state.stage = "Draft strategy";
      const plays = [play, ...state.plays];
      return { ...state, plays, activePlayId: play.playId };
    }, "play-add");
    setStrategyDirty(getState().activePlayId, true);
  });

  dom.refreshDashboard.addEventListener("click", () => {
    void refreshPortfolio();
  });

  if (dom.exportLogs) {
    dom.exportLogs.addEventListener("click", async () => {
      const state = getState();
      const content = state.logs
        .map((log) => `${new Date(log.ts).toISOString()} | ${log.message}`)
        .join("\n");
      const result = await window.appBridge.exportLogs({
        content,
        suggestedName: `hybrid-bot-logs-${new Date().toISOString().slice(0, 10)}.txt`
      });
      void result;
    });
  }

  if (dom.exportStrategies) {
    dom.exportStrategies.addEventListener("click", async () => {
    if (!window.appBridge?.exportStrategies) {
      appendBackendLog("Export unavailable in this build.", "warn");
      return;
    }
    const state = getState();
    const strategies = state.plays.map(serializeStrategy);
    const result = await window.appBridge.exportStrategies({
      strategies,
      suggestedName: `hybrid-bot-strategies-${new Date().toISOString().slice(0, 10)}.json`
    });
    void result;
    });
  }

  if (dom.importStrategies) {
    dom.importStrategies.addEventListener("click", async () => {
    if (!window.appBridge?.importStrategies) {
      appendBackendLog("Import unavailable in this build.", "warn");
      return;
    }
    try {
      const result = await window.appBridge.importStrategies();
      if (result?.canceled) {
        return;
      }
      const parsed = JSON.parse(result.content || "[]");
      if (!Array.isArray(parsed)) {
        appendBackendLog("Invalid strategies file.", "warn");
        return;
      }
      const normalizedIncoming = parsed.map((play, index) => normalizeStrategy(play, index + 1));
      const merged = mergeStrategiesById(getState().plays, normalizedIncoming);
      applyStrategies(merged);
      await persistStrategies(merged.map(serializeStrategy));
      appendBackendLog("Strategies imported.", "info");
    } catch (error) {
      appendBackendLog(error.message || "Failed to import strategies", "error");
    }
    });
  }
};

init();
