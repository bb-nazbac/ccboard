import app from "./app.js";
import { PORT } from "./lib/constants.js";

app.listen(PORT, () => {
  console.log(`ccboard server listening on http://localhost:${PORT}`);
});
