const createOptionsChainMock = ({ getLastPrice }) => {
  const msPerDay = 24 * 60 * 60 * 1000;

  const getExpirations = () => {
    const now = new Date();
    const expirations = [];
    for (let i = 1; i <= 12; i += 1) {
      const date = new Date(now.getTime() + i * 7 * msPerDay);
      expirations.push(date.toISOString().slice(0, 10));
    }
    return expirations;
  };

  const getStrikeStep = (price) => {
    if (price < 50) {
      return 1;
    }
    if (price < 200) {
      return 2.5;
    }
    if (price < 500) {
      return 5;
    }
    return 10;
  };

  const computePremium = ({ underlying, strike, daysToExpiry, side }) => {
    const distance = Math.abs(underlying - strike);
    const intrinsic = side === "CALL"
      ? Math.max(0, underlying - strike)
      : Math.max(0, strike - underlying);
    const timeValue = Math.max(0.35, (daysToExpiry / 30) * 0.4);
    const volatility = Math.max(0.4, underlying * 0.015);
    const distanceFactor = Math.exp(-distance / Math.max(10, underlying * 0.05));
    const premium = intrinsic * 0.6 + timeValue + distanceFactor * volatility * 0.2;
    return Number(Math.max(0.5, premium).toFixed(2));
  };

  const getChain = (symbol) => {
    const underlying = getLastPrice(symbol);
    const step = getStrikeStep(underlying);
    const base = Math.round(underlying / step) * step;
    const strikes = [];
    for (let i = -12; i <= 12; i += 1) {
      strikes.push(Number((base + i * step).toFixed(2)));
    }

    const expirations = getExpirations().map((expiry) => {
      const daysToExpiry = Math.max(1, Math.ceil((new Date(expiry) - new Date()) / msPerDay));
      const strikeData = strikes.map((strike) => ({
        strike,
        callPremium: computePremium({ underlying, strike, daysToExpiry, side: "CALL" }),
        putPremium: computePremium({ underlying, strike, daysToExpiry, side: "PUT" })
      }));
      return { expiry, strikes: strikeData };
    });

    return { symbol, underlying, expirations };
  };

  const getOptionPremium = ({ symbol, strike, expiry, side }) => {
    const underlying = getLastPrice(symbol);
    const daysToExpiry = Math.max(1, Math.ceil((new Date(expiry) - new Date()) / msPerDay));
    return computePremium({ underlying, strike, daysToExpiry, side });
  };

  return {
    getChain,
    getOptionPremium
  };
};

export { createOptionsChainMock };
