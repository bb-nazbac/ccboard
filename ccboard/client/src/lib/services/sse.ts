import { sseLog } from "../utils/logger";

export interface SSEConnection {
  connect: () => void;
  disconnect: () => void;
}

export function createSSE<T>(
  url: string,
  onEvent: (data: T) => void,
  reconnectMs = 3000
): SSEConnection {
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    disconnect();
    sseLog.info("connecting", url);
    es = new EventSource(url);
    es.onopen = () => sseLog.debug("connected", url);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as T;
        onEvent(data);
      } catch {
        sseLog.warn("malformed SSE data", url, evt.data?.slice(0, 100));
      }
    };
    es.onerror = () => {
      sseLog.warn("error, reconnecting in", reconnectMs, "ms", url);
      es?.close();
      es = null;
      reconnectTimer = setTimeout(connect, reconnectMs);
    };
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (es) { sseLog.debug("disconnecting", url); es.close(); es = null; }
  }

  return { connect, disconnect };
}
