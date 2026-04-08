/** Create a managed SSE connection with typed event handling and auto-reconnect. */
export interface SSEConnection {
  connect: () => void;
  disconnect: () => void;
  readonly connected: boolean;
}

export function createSSE<T>(
  url: string,
  onEvent: (data: T) => void,
  reconnectMs = 3000
): SSEConnection {
  let es: EventSource | null = null;
  let isConnected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    disconnect();
    es = new EventSource(url);
    es.onopen = () => { isConnected = true; };
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as T;
        onEvent(data);
      } catch {
        // skip malformed events
      }
    };
    es.onerror = () => {
      isConnected = false;
      es?.close();
      es = null;
      reconnectTimer = setTimeout(connect, reconnectMs);
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (es) {
      es.close();
      es = null;
    }
    isConnected = false;
  }

  return {
    connect,
    disconnect,
    get connected() { return isConnected; },
  };
}
