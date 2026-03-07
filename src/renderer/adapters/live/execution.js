const createExecutionLive = ({ client }) => {
  const listeners = new Set();

  client.on("execution_event", (payload) => {
    listeners.forEach((listener) => listener(payload));
  });

  const submitOrder = async (orderRequest) => {
    const result = await client.call("execution.submit", orderRequest);
    return result.orderId;
  };

  const cancelOrder = async (orderId) => {
    await client.call("execution.cancel", { orderId });
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

export { createExecutionLive };
