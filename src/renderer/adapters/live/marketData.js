const createMarketDataLive = ({ client }) => {
  const listeners = new Set();
  const prices = new Map();

  client.on("price_update", (payload) => {
    if (!payload || !payload.symbol) {
      return;
    }
    const symbol = payload.symbol.toUpperCase();
    prices.set(symbol, payload.price);
    listeners.forEach((listener) => listener({ symbol, price: payload.price, ts: payload.ts }));
  });

  const subscribe = async (symbols = [], callback) => {
    if (callback) {
      listeners.add(callback);
    }
    if (symbols.length) {
      await client.call("market.subscribe", { symbols });
    }
  };

  const unsubscribe = async (symbols = [], callback) => {
    if (callback) {
      listeners.delete(callback);
    }
    if (symbols.length) {
      await client.call("market.unsubscribe", { symbols });
    }
  };

  const getLastPrice = (symbol) => {
    if (!symbol) {
      return null;
    }
    return prices.get(symbol.toUpperCase()) ?? null;
  };

  return {
    getLastPrice,
    subscribe,
    unsubscribe
  };
};

export { createMarketDataLive };
