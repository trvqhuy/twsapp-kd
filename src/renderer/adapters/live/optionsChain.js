const createOptionsChainLive = ({ client }) => {
  const selectOptionByPremium = async ({ symbol, side, targetPremium, minDaysOut = 25 }) => {
    return client.call("options.select_by_premium", {
      symbol,
      side,
      targetPremium,
      minDaysOut
    });
  };

  const getOptionPremium = async ({ symbol, strike, expiry, side }) => {
    const result = await client.call("options.get_premium", {
      symbol,
      strike,
      expiry,
      side
    });
    return result.premium;
  };

  return {
    selectOptionByPremium,
    getOptionPremium
  };
};

export { createOptionsChainLive };
