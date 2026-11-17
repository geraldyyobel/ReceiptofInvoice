import { spawnSync, spawn } from "node:child_process";
for (const args of [
  ["scripts/database.js", "prepare"],
  ["scripts/database.js", "migrate"],
  ["prisma/seed.js"],
]) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status) process.exit(r.status);
}
const child = spawn(process.execPath, ["server/index.js"], {
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
