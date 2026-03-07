const createPortfolioLive = ({ client }) => {
  const getAccountSummary = async () => {
    return client.call("portfolio.get_account_summary");
  };

  const getPositions = async () => {
    return client.call("portfolio.get_positions");
  };

  const getOrders = async () => {
    return client.call("portfolio.get_orders");
  };

  return {
    getAccountSummary,
    getPositions,
    getOrders
  };
};

export { createPortfolioLive };
