const createExecutionMock = ({ getLastPrice, portfolio }) => {
  const listeners = new Set();

  const emit = (event) => {
    listeners.forEach((listener) => listener(event));
  };

  const submitOrder = (orderRequest) => {
    const id = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const order = {
      id,
      playId: orderRequest.playId,
      symbol: orderRequest.symbol,
      side: orderRequest.side,
      quantity: Number(orderRequest.quantity),
      orderType: "MARKET",
      tif: "DAY",
      status: "SUBMITTED",
      filledQty: 0,
      avgFillPrice: null,
      option: orderRequest.option ? { ...orderRequest.option } : null
    };

    portfolio.registerOrder(order);
    emit({ type: "submitted", order });

    const delay = 400 + Math.random() * 900;
    setTimeout(() => {
      const fillPrice = orderRequest.fillPrice ?? getLastPrice(order.symbol);
      const filled = {
        status: "FILLED",
        filledQty: order.quantity,
        avgFillPrice: Number(fillPrice.toFixed(2))
      };
      portfolio.updateOrder(id, filled);
      portfolio.applyFill({ ...order, ...filled });
      emit({ type: "filled", order: { ...order, ...filled } });
    }, delay);

    return id;
  };

  const cancelOrder = (orderId) => {
    portfolio.updateOrder(orderId, { status: "CANCELED" });
    emit({ type: "canceled", orderId });
  };

  const onEvent = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };

  return {
    submitOrder,
    cancelOrder,
    onEvent
  };
};

export { createExecutionMock };
