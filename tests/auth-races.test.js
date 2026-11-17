import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../server/app.js";
import { db } from "../server/core.js";
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");
test("login/logout serentak tidak menghasilkan error server", async (t) => {
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const credentials = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
  try {
    const agent = request.agent(server), csrfResponse = await agent.get("/api/csrf"), token = csrfResponse.body.token;
    const csrfCookie = csrfResponse.headers["set-cookie"].find((c) => c.startsWith("roi_csrf=")).split(";")[0];
    const login = () => agent.post("/api/auth/login").set("X-CSRF-Token", token).send(credentials);
    const cookieFor = (r) => csrfCookie + "; " + r.headers["set-cookie"].find((c) => c.startsWith("roi_session=")).split(";")[0];
    const first = await login().expect(200);
    await t.test("logout session yang sama bersifat idempoten saat klik berulang", async () => {
      const cookie = cookieFor(first);
      const before = await db.activityLog.count({ where: { action: "auth.logout" } });
      const results = await Promise.all(Array.from({ length: 12 }, () => request(server).post("/api/auth/logout").set("Cookie", cookie).set("X-CSRF-Token", token).send({})));
      assert.deepEqual(results.map((r) => r.status), Array(12).fill(200));
      assert.equal((await request(server).get("/api/auth/me").set("Cookie", cookie)).body.admin, null);
      assert.equal(await db.activityLog.count({ where: { action: "auth.logout" } }), before + 1);
    });
    await t.test("dua login memakai session lama yang sama tetap berhasil", async () => {
      const cookie = cookieFor(await login().expect(200));
      const results = await Promise.all(Array.from({ length: 2 }, () => request(server).post("/api/auth/login").set("Cookie", cookie).set("X-CSRF-Token", token).send(credentials)));
      assert.deepEqual(results.map((r) => r.status), [200, 200]);
      for (const r of results) {
        assert.match(r.headers["set-cookie"].join(";"), /HttpOnly/);
        assert.equal((await request(server).get("/api/auth/me").set("Cookie", cookieFor(r))).body.admin.email, credentials.email);
      }
    });
  } finally { await new Promise((r) => server.close(r)); await db.$disconnect(); }
});
