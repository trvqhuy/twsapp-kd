const createBackendClient = ({ url }) => {
  let socket = null;
  let isOpen = false;
  let requestId = 1;
  const pending = new Map();
  const listeners = new Map();
  let useBridge = false;

  const emitLocal = (event, data) => {
    if (event === "connection_open") {
      isOpen = true;
    }
    if (event === "connection_closed" || event === "connection_error") {
      isOpen = false;
    }
    const handlers = listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  };

  const connectDirect = () => new Promise((resolve, reject) => {
    if (isOpen) {
      resolve();
      return;
    }
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      isOpen = true;
      emitLocal("connection_open", { url });
      resolve();
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.id) {
          const entry = pending.get(payload.id);
          if (entry) {
            pending.delete(payload.id);
            if (payload.error) {
              entry.reject(new Error(payload.error.message || "Backend error"));
            } else {
              entry.resolve(payload.result);
            }
          }
          return;
        }
        if (payload.event) {
          emitLocal(payload.event, payload.data);
        }
      } catch (err) {
        console.error("Backend message parse error", err);
      }
    });
    socket.addEventListener("close", () => {
      isOpen = false;
      pending.forEach((entry) => entry.reject(new Error("Backend connection closed")));
      pending.clear();
      emitLocal("connection_closed", {});
    });
    socket.addEventListener("error", () => {
      isOpen = false;
      emitLocal("connection_error", { message: "Backend connection failed" });
      reject(new Error("Backend connection failed"));
    });
  });

  const connect = () => new Promise((resolve, reject) => {
    if (useBridge) {
      window.appBridge
        .backendConnect()
        .then(() => {
          emitLocal("connection_open", { url });
          resolve();
        })
        .catch(() => {
          useBridge = false;
          connectDirect().then(resolve).catch(reject);
        });
      return;
    }
    connectDirect().then(resolve).catch(reject);
  });

  const close = () => {
    if (socket) {
      socket.close();
      socket = null;
    }
    isOpen = false;
  };

  const call = (method, params = {}) => {
    if (useBridge) {
      return window.appBridge.backendCall(method, params);
    }
    if (!isOpen || !socket) {
      return Promise.reject(new Error("Backend not connected"));
    }
    const id = requestId++;
    const payload = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    socket.send(JSON.stringify(payload));
    return promise;
  };

  const on = (event, handler) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
  };


  const connected = () => isOpen;

  return {
    connect,
    close,
    call,
    on,
    connected
  };
};

export { createBackendClient };
