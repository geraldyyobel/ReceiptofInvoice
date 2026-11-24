import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { chromium } from "playwright";
import { db } from "../server/core.js";
import { app } from "../server/app.js";
import { dashboard, followupSelection } from "../server/dashboard.js";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");
test("Ringkasan: agregasi tahunan, tindak lanjut, carousel dan grafik responsif", async (t) => {
  const server = app.listen(3195, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  let browser;
  const ids = [], emailIds = [], notificationIds = [];
  const year = 2091, mode = "eksternal", now = new Date("2091-12-31T17:30:00Z");
  const submission = (suffix, values, date = "2091-02-01T01:00:00Z", extra = {}) => {
    const id = `dashboard-test-${suffix}`; ids.push(id);
    return { id, mode, bookYear: year, bookNumber: Number(suffix) || null, reference: `DASHBOARD-${suffix}`,
      tokenHash: "test", formVersionId: "test", termsVersionId: "test", templateVersionId: "test", documentSettings: {},
      vendor: "Batch", email: "test@example.com", submittedAt: new Date(date), startedAt: new Date(+new Date(date) - 10000),
      values: { invoice_date: "2091-02-01", currency: "IDR", amount_nett: 0, ...values }, ...extra };
  };
  const email = (id, sub, status, date) => { emailIds.push(id); return { id, mode, submissionId: sub, status, recipient: "test@example.com", createdAt: new Date(date) }; };
  try {
    await db.submission.createMany({ data: [
      submission("a", { invoice_date: "2091-12-31", currency: "IDR", amount_nett: "9007199254740993.10", vat: "10.20", ada_ppn: "Ya", invoice_jasa: "Ya", ada_subvendor_1: "Ya", legalitas_terkirim: "Belum", permintaan_via: "Email" }, "2091-12-31T17:15:00Z", { vendor: "PT Alpha", startedAt: new Date("2091-12-31T17:14:00Z") }),
      submission("b", { invoice_date: "2091-12-30", currency: "USD", amount_nett: 5, vat: 999, ada_ppn: "Tidak", invoice_jasa: "Tidak", ada_subvendor_1: "Tidak", legalitas_terkirim: "Sudah", permintaan_via: "WhatsApp" }, "2091-12-30T01:00:00Z", { vendor: " pt alpha ", startedAt: new Date("2091-12-30T00:58:00Z") }),
      submission("c", { invoice_date: "2091-12-29", currency: "IDR", amount_nett: ".10", vat: ".20", ada_ppn: "Ya", invoice_jasa: "Tidak", ada_subvendor_1: "Tidak", legalitas_terkirim: "Belum", permintaan_via: "Email" }, "2091-12-29T01:00:00Z", { vendor: "PT Beta_%", startedAt: new Date("2091-12-29T02:00:00Z") }),
      ...Array.from({ length: 501 }, (_, i) => submission(String(i + 1), {})),
      submission("other-year", { amount_nett: 999999 }, undefined, { bookYear: 2090 }),
      submission("other-mode", { amount_nett: 999999 }, undefined, { mode: "internal" }),
    ] });
    await db.emailLog.createMany({ data: [email("dashboard-email-a1", "dashboard-test-a", "gagal", "2091-12-31T17:16:00Z"), email("dashboard-email-a2", "dashboard-test-a", "terkirim", "2091-12-31T17:17:00Z"), email("dashboard-email-b1", "dashboard-test-b", "gagal", "2091-12-30T01:00:00Z"), { ...email("dashboard-email-cross", "dashboard-test-a", "gagal", "2091-12-31T17:18:00Z"), mode: "internal" }, email("dashboard-email-test", null, "gagal", "2091-12-31T17:19:00Z")] });
    await t.test("batches >500, zona waktu, mata uang tepat, jawaban kosong dan kirim ulang berhasil", async () => {
      const d = await dashboard(mode, String(year), now);
      assert.equal(d.total, 504); assert.equal(d.today, 1); assert.equal(d.last7, 3); assert.equal(d.vendors, 3);
      assert.deepEqual(d.emails, { sent: 1, failed: 2 });
      assert.deepEqual(d.currencies, [{ currency: "IDR", total: "9007199254741003.60" }, { currency: "USD", total: "1004.00" }]);
      assert.equal(d.daily.reduce((n, r) => n + r.count, 0), 3);
      assert.equal(d.monthly[1].count, 501); assert.equal(d.monthly[11].count, 3);
      assert.deepEqual(d.compositions.vat, { yes: 2, no: 1, unknown: 501 });
      assert.equal(d.followups.legality.count, 2); assert.equal(d.followups.email.count, 1);
      assert.equal(d.followups.email.rows[0].id, "dashboard-test-b");
      assert.equal(d.duration.valid, 503); assert.equal(d.duration.excluded, 1);
      assert.ok(Math.abs(d.duration.averageSeconds - 5190 / 503) < .0001);
      assert.equal(d.topVendors[0].name, "Batch");
      assert.equal(d.topByValue.find((c) => c.currency === "IDR").vendors[0].name, "PT Alpha");
      assert.equal(d.topByValue.find((c) => c.currency === "USD").vendors[0].count, 1);
      assert.equal((await dashboard(mode, "2080", now)).duration.averageSeconds, null);
    });
    const agent = request.agent(server), token = (await agent.get("/api/csrf")).body.token;
    await agent.post("/api/auth/login").set("X-CSRF-Token", token).send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
    await agent.post("/api/admin/mode").set("X-CSRF-Token", token).send({ mode }).expect(200);
    await t.test("auth, filter tahunan dan pagination/pencarian/ekspor tindak lanjut", async () => {
      await request(server).get("/api/admin/dashboard").expect(401);
      for (const y of ["all", "abc", "2026; DROP TABLE submissions"]) await agent.get("/api/admin/dashboard?year=" + encodeURIComponent(y)).expect(422);
      const result = (await agent.get(`/api/admin/dashboard?year=${year}`).expect(200)).body;
      assert.equal(result.total, 504); assert.ok(!JSON.stringify(result).includes("tokenHash"));
      const page = (await agent.get(`/api/admin/submissions?year=${year}&followup=legality&page=2&size=1`).expect(200)).body;
      assert.equal(page.total, 2); assert.equal(page.rows.length, 1); assert.equal(page.rows[0].id, "dashboard-test-c");
      const filtered = (await agent.get(`/api/admin/submissions?year=${year}&followup=legality&vendor=Beta_%25&status=diterima`).expect(200)).body;
      assert.equal(filtered.total, 1); assert.equal(filtered.rows[0].id, "dashboard-test-c");
      assert.equal((await followupSelection({ mode, bookYear: year, OR: [{ vendor: { contains: "' OR 1=1 --" } }] }, "legality")).total, 0);
      const csv = await agent.get(`/api/admin/submissions/export/csv?year=${year}&followup=email`).expect(200);
      assert.ok(csv.text.includes("DASHBOARD-b")); assert.ok(!csv.text.includes("DASHBOARD-a"));
      await agent.get(`/api/admin/submissions?year=${year}&followup=invalid`).expect(422);
    });
    await t.test("browser: carousel per halaman, keyboard, swipe, grafik, filter dan tautan", async () => {
      const admin = await db.admin.findUnique({ where: { email: process.env.ADMIN_EMAIL } });
      for (let i = 0; i < 22; i++) {
        const id = `dashboard-notif-${i}`; notificationIds.push(id);
        await db.adminNotification.create({ data: { id, mode, authorId: admin.id, authorName: "Admin Uji", title: `Notif ${i}`, message: "Pesan uji <script>window.bad=1</script>", kind: "info", dueAt: new Date(Date.now() - i * 1000 - 1000), recipients: { create: { adminId: admin.id } } } });
      }
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext(), page = await context.newPage(), errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const origin = "http://127.0.0.1:3195", csrf = (await (await context.request.get(origin + "/api/csrf")).json()).token;
      await context.request.post(origin + "/api/auth/login", { headers: { "X-CSRF-Token": csrf }, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
      await context.request.post(origin + "/api/admin/mode", { headers: { "X-CSRF-Token": csrf }, data: { mode } });
      await page.goto(origin + "/admin");
      const summary = page.locator(".notification-summary");
      await summary.getByRole("heading", { name: "Notif 0", exact: true }).waitFor();
      assert.equal(await summary.locator("article").count(), 1);
      for (let i = 1; i <= 20; i++) {
        await summary.getByRole("button", { name: "Notifikasi berikutnya", exact: true }).click();
        await summary.getByRole("heading", { name: `Notif ${i}`, exact: true }).waitFor();
      }
      await summary.getByRole("button", { name: "Notifikasi sebelumnya", exact: true }).click();
      await summary.getByRole("heading", { name: "Notif 19", exact: true }).waitFor();
      await page.locator(".notification-slider").focus(); await page.keyboard.press("ArrowLeft");
      await summary.getByRole("heading", { name: "Notif 18", exact: true }).waitFor();
      await page.locator(".notification-slider").dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 300, clientY: 100 }] });
      await page.locator(".notification-slider").dispatchEvent("touchend", { changedTouches: [{ identifier: 1, clientX: 150, clientY: 100 }] });
      await summary.getByRole("heading", { name: "Notif 19", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.bad), undefined);
      await page.getByLabel("Tahun buku ringkasan", { exact: true }).selectOption(String(year));
      await page.locator(".dashboard-stats .stat").filter({ hasText: "Total penyerahan" }).getByText("504", { exact: true }).waitFor();
      await page.locator(".currency-list").getByText("9.007.199.254.741.003,60", { exact: true }).waitFor();
      await page.getByLabel("Periode tren").selectOption("monthly");
      assert.equal(await page.locator(".dashboard-chart rect").count(), 12);
      await page.getByLabel("Peringkat vendor").selectOption("value");
      await page.getByLabel("Mata uang peringkat vendor").selectOption("USD");
      await page.getByText("USD 1.004,00", { exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".sidebar").evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      assert.ok((await page.locator(".sidebar").boundingBox()).x < -200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: "test-results/dashboard-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: "test-results/dashboard-desktop.png", fullPage: true });
      await page.locator(".followup-group").filter({ hasText: "Legalitas belum terkirim" }).getByRole("button", { name: "Lihat semua →", exact: true }).click();
      await page.getByLabel("Filter tindak lanjut").waitFor();
      assert.equal(await page.getByLabel("Filter tindak lanjut").inputValue(), "legality");
      assert.equal(await page.getByLabel("Tahun buku data form").inputValue(), String(year));
      await page.locator(".reference-cell").filter({ hasText: "DASHBOARD-a" }).waitFor();
      await page.locator(".sidebar nav").getByRole("link", { name: "Ringkasan", exact: false }).click();
      await page.getByRole("button", { name: "Buka Email Log →", exact: true }).click();
      await page.getByRole("button", { name: "Email Log", exact: true }).waitFor();
      assert.match(await page.getByRole("button", { name: "Email Log", exact: true }).getAttribute("class"), /active/);
      assert.deepEqual(errors, []);
    });
  } finally {
    if (browser) await browser.close();
    await db.adminNotification.deleteMany({ where: { id: { in: notificationIds } } });
    await db.emailLog.deleteMany({ where: { id: { in: emailIds } } });
    await db.submission.deleteMany({ where: { id: { in: ids } } });
    await new Promise((r) => server.close(r)); await db.$disconnect();
  }
});
