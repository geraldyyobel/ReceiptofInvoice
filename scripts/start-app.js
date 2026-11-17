import { ensureLocalPostgres } from "./local-postgres.js";
ensureLocalPostgres();
const { ensureBookkeeping } = await import("../server/bookkeeping.js");
await ensureBookkeeping();
await import("../server/index.js");
