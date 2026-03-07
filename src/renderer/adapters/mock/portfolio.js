const createPortfolioMock = ({ getLastPrice, getOptionPremium }) => {
  const positions = [];
  const orders = [];
  const account = {
    equity: 250000,
    cash: 140000,
    unrealizedPnL: 0,
    realizedPnL: 0
  };

  const recomputeAccount = () => {
    let marketValue = 0;
    let unrealized = 0;

    positions.forEach((position) => {
      const last = position.option
        ? getOptionPremium({
            symbol: position.symbol,
            strike: position.option.strike,
            expiry: position.option.expiry,
            side: position.option.side
          })
        : getLastPrice(position.symbol);
      marketValue += last * position.qty * 100;
      unrealized += (last - position.avgPrice) * position.qty * 100;
    });

    account.unrealizedPnL = Number(unrealized.toFixed(2));
    account.equity = Number((account.cash + marketValue).toFixed(2));
  };

  const getAccountSummary = () => {
    recomputeAccount();
    return { ...account };
  };

  const getPositions = () => {
    return positions.map((position) => {
      const lastPrice = position.option
        ? getOptionPremium({
            symbol: position.symbol,
            strike: position.option.strike,
            expiry: position.option.expiry,
            side: position.option.side
          })
        : getLastPrice(position.symbol);
      const unrealized = (lastPrice - position.avgPrice) * position.qty * 100;
      return {
        ...position,
        lastPrice: Number(lastPrice.toFixed(2)),
        unrealizedPnL: Number(unrealized.toFixed(2))
      };
    });
  };

  const getOrders = () => orders.slice().reverse();

  const findPosition = (order) => {
    if (order.option) {
      return positions.find(
        (pos) => pos.symbol === order.symbol
          && pos.option
          && pos.option.side === order.option.side
          && pos.option.strike === order.option.strike
          && pos.option.expiry === order.option.expiry
      );
    }
    return positions.find((pos) => pos.symbol === order.symbol && !pos.option);
  };

  const applyFill = (order) => {
    const fillPrice = order.avgFillPrice ?? getLastPrice(order.symbol);
    const qty = order.filledQty ?? order.quantity;
    const existing = findPosition(order);

    if (order.side === "BUY") {
      if (existing) {
        const totalQty = existing.qty + qty;
        const newAvg = (existing.avgPrice * existing.qty + fillPrice * qty) / totalQty;
        existing.qty = totalQty;
        existing.avgPrice = Number(newAvg.toFixed(2));
      } else {
        positions.push({
          symbol: order.symbol,
          qty,
          avgPrice: Number(fillPrice.toFixed(2)),
          option: order.option ? { ...order.option } : null
        });
      }
      account.cash -= fillPrice * qty * 100;
    } else if (order.side === "SELL" && existing) {
      const realized = (fillPrice - existing.avgPrice) * qty * 100;
      existing.qty -= qty;
      account.cash += fillPrice * qty * 100;
      account.realizedPnL = Number((account.realizedPnL + realized).toFixed(2));
      if (existing.qty <= 0) {
        const index = positions.indexOf(existing);
        if (index >= 0) {
          positions.splice(index, 1);
        }
      }
    }

    recomputeAccount();
  };

  const registerOrder = (order) => {
    orders.push({
      id: order.id,
      playId: order.playId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      status: order.status,
      filledQty: order.filledQty ?? 0,
      avgFillPrice: order.avgFillPrice ?? null,
      option: order.option ? { ...order.option } : null
    });
  };

  const updateOrder = (orderId, update) => {
    const order = orders.find((item) => item.id === orderId);
    if (order) {
      Object.assign(order, update);
    }
  };

  return {
    getAccountSummary,
    getPositions,
    getOrders,
    applyFill,
    registerOrder,
    updateOrder
  };
};

export { createPortfolioMock };
