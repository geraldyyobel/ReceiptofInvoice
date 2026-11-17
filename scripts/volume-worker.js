import path from "node:path";
const dir = path.resolve(process.env.DATA_DIR || "");
if (
  process.env.ROI_VOLUME_TEST !== "1" ||
  !dir.startsWith(path.resolve("data", "volume-test-"))
)
  throw Error("Worker hanya boleh berjalan pada database uji volume terpisah");
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
const { closeBrowser } = await import("../server/documents.js");
const server = app.listen(Number(process.env.PORT), "127.0.0.1", () =>
  process.send?.({ type: "ready", port: server.address().port }),
);
const timer = setInterval(
  () => process.send?.({ type: "memory", ...process.memoryUsage() }),
  250,
);
timer.unref();
process.on("message", async (message) => {
  if (message?.type !== "stop") return;
  clearInterval(timer);
  server.close();
  await closeBrowser();
  await db.$disconnect();
  process.exit(0);
});
