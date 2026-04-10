import { createServer } from "http";
import app from "./app.js";
import { PORT } from "./lib/constants.js";
import { initRealtime } from "./services/realtime.js";

const httpServer = createServer(app);
initRealtime(httpServer);

httpServer.listen(PORT, () => {
  console.log(`ccboard server listening on http://localhost:${PORT}`);
});
