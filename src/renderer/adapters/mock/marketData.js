const createMarketDataMock = ({ symbols = [] } = {}) => {
  const listeners = new Set();
  const tracked = new Set();
  const prices = new Map();
  let timer = null;

  const seedPrice = (symbol) => {
    const base = 100 + Math.random() * 400;
    prices.set(symbol, Number(base.toFixed(2)));
  };

  const updatePrice = (symbol) => {
    const current = prices.get(symbol) ?? 100;
    const drift = (Math.random() - 0.48) * 1.2;
    const next = Math.max(1, current + drift);
    prices.set(symbol, Number(next.toFixed(2)));
  };

  const tick = () => {
    tracked.forEach((symbol) => {
      updatePrice(symbol);
      const price = prices.get(symbol);
      listeners.forEach((listener) => listener({ symbol, price, ts: Date.now() }));
    });
  };

  const start = () => {
    if (!timer) {
      timer = setInterval(tick, 1000);
    }
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const subscribe = (symbolsToAdd = [], callback) => {
    if (callback) {
      listeners.add(callback);
    }
    symbolsToAdd.forEach((symbol) => {
      if (!prices.has(symbol)) {
        seedPrice(symbol);
      }
      tracked.add(symbol);
    });
    if (tracked.size > 0) {
      start();
    }
  };

  const unsubscribe = (symbolsToRemove = [], callback) => {
    symbolsToRemove.forEach((symbol) => tracked.delete(symbol));
    if (callback) {
      listeners.delete(callback);
    }
    if (tracked.size === 0) {
      stop();
    }
  };

  const getLastPrice = (symbol) => {
    if (!prices.has(symbol)) {
      seedPrice(symbol);
    }
    return prices.get(symbol);
  };

  symbols.forEach((symbol) => {
    seedPrice(symbol);
    tracked.add(symbol);
  });
  if (tracked.size > 0) {
    start();
  }

  return {
    getLastPrice,
    subscribe,
    unsubscribe
  };
};

export { createMarketDataMock };
