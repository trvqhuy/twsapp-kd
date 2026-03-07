const selectOptionByPremium = ({ chain, side, targetPremium, minDaysOut = 25 }) => {
  if (!chain) {
    return null;
  }
  const now = new Date();
  for (const expiry of chain.expirations) {
    const daysOut = Math.ceil((new Date(expiry.expiry) - now) / (24 * 60 * 60 * 1000));
    if (daysOut < minDaysOut) {
      continue;
    }

    let best = null;
    expiry.strikes.forEach((strikeEntry) => {
      const premium = side === "CALL" ? strikeEntry.callPremium : strikeEntry.putPremium;
      if (premium >= targetPremium) {
        if (!best || premium < best.premium) {
          best = { premium, strike: strikeEntry.strike };
        }
      }
    });

    if (best) {
      return {
        symbol: chain.symbol,
        expiry: expiry.expiry,
        strike: best.strike,
        premium: best.premium
      };
    }
  }

  return null;
};

export { selectOptionByPremium };
