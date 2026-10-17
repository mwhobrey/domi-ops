/** Explicit environment only; aggregate receipts contain no household/member/record IDs. */
import { createDb, closeDb } from "../packages/db/dist/index.js";
import { hostedActivationReport } from "../packages/db/src/hosted-activation.js";
if (!process.env.METRICS_DATABASE_URL) throw new Error("METRICS_DATABASE_URL is required");
const db = createDb(process.env.METRICS_DATABASE_URL);
try { console.log(JSON.stringify(await hostedActivationReport(db), null, 2)); } finally { await closeDb(db); }
