import { createId } from "../utils/id.js";

const botVersions = [
  { id: "bot-100", label: "$100", targetPremium: 1.0 },
  { id: "bot-250", label: "$250", targetPremium: 2.5 },
  { id: "bot-500", label: "$500", targetPremium: 5.0 },
  { id: "bot-1000", label: "$1000", targetPremium: 10.0 }
];

const defaultSymbols = ["SPY", "QQQ"];

const defaultConfig = {
  versionTargets: botVersions
};

const createConditionBlock = (type, value = 0) => ({
  id: createId(),
  type,
  value
});

const createActionBlock = (type, quantity = null) => ({
  id: createId(),
  type,
  quantity
});

const createBranchTemplate = () => ({
  id: createId(),
  condition: createConditionBlock("IF_DROPS", 410),
  action: createActionBlock("ACTION_BUY")
});

const createStepTemplate = () => ({
  id: createId(),
  branches: [createBranchTemplate()]
});

const createPlayTemplate = (symbol = "SPY", index = 1) => ({
  playId: createId(),
  name: `Strategy ${index}`,
  symbol,
  active: true,
  autoDeactivateOthers: false,
  schedule: {
    days: ["MON", "TUE", "WED", "THU", "FRI"],
    startTime: "09:30",
    endTime: "16:00"
  },
  side: "CALL",
  versionTarget: botVersions[0].id,
  quantity: 0,
  steps: [
    createStepTemplate(),
    {
      id: createId(),
      branches: [
        {
          id: createId(),
          condition: createConditionBlock("IF_RISES", 420),
          action: createActionBlock("ACTION_SELL")
        }
      ]
    }
  ],
  stepCursor: 0,
  stepTriggeredBranchId: null,
  pendingAction: null,
  state: {
    status: "Active",
    stage: "Waiting for schedule",
    autoDisabledUntilSession: null,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    lastOrderId: null,
    message: "",
    realizedPnL: 0,
    openPosition: null
  }
});

const createDefaultPlays = () => {
  const plays = [];
  defaultSymbols.forEach((symbol, index) => {
    plays.push(createPlayTemplate(symbol, index + 1));
  });
  return plays;
};

const defaultState = {
  mode: "live",
  config: structuredClone(defaultConfig),
  plays: createDefaultPlays(),
  executionPlays: [],
  activePlayId: null,
  prices: {},
  backend: {
    status: {
      state: "OFFLINE",
      connected: false,
      message: "",
      lastError: "",
      accountId: "",
      dataType: "",
      serverTime: null
    },
    connection: {
      connected: false,
      message: "Backend offline"
    },
    lastStatusAt: null,
    url: null,
    config: null,
    draft: null,
    validationErrors: [],
    logs: [],
    accounts: []
  },
  updates: {
    status: "idle",
    message: "Check for updates to see if a new version is available.",
    currentVersion: null,
    version: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    progress: null,
    lastCheckedAt: null
  },
  account: {
    equity: 250000,
    cash: 140000,
    unrealizedPnL: 0,
    realizedPnL: 0,
    raw: {}
  },
  positions: [],
  orders: [],
  logs: [],
  lastRefresh: null,
  strategyDirtyIds: [],
  strategySave: {
    status: "",
    message: "",
    ts: null
  }
};

defaultState.activePlayId = defaultState.plays[0]?.playId || null;

const subscribers = new Set();
let state = structuredClone(defaultState);

const getState = () => state;

const setState = (partial, action = "update") => {
  state = { ...state, ...partial };
  subscribers.forEach((listener) => listener(state, action));
};

const updateState = (updater, action = "update") => {
  state = updater(state);
  subscribers.forEach((listener) => listener(state, action));
};

const subscribe = (listener) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};

const resetState = () => {
  state = structuredClone(defaultState);
  subscribers.forEach((listener) => listener(state, "reset"));
};

export {
  getState,
  setState,
  updateState,
  subscribe,
  resetState,
  createPlayTemplate,
  createConditionBlock,
  createActionBlock,
  createStepTemplate
};
