import { test } from "node:test";
import assert from "node:assert/strict";
import { initialFields } from "../prisma/initial.js";
import {dateBounds,validateDateLimits} from '../shared/date-limits.js';
import {
  pathFor,
  validateAnswers,
  validateDefinition,
  condition,
  amountTotal,
  applyAnswer,
} from "../shared/engine.js";
export const valid = {
  paham_ketentuan: "Ya",
  email_anda: "vendor@example.com",
  received_from: "PT Vendor",
  invoice_number: "INV-001",
  invoice_date: "2026-10-01",
  currency: "IDR",
  amount_nett: "100.10",
  ada_ppn: "Tidak",
  invoice_jasa: "Tidak",
  ada_subvendor_1: "Tidak",
  legalitas_terkirim: "Belum",
  permintaan_via: "Email",
  po_number: "PO-001",
};
test("seed valid, opsi Belum mengakhiri form", () => {
  assert.equal(
    validateDefinition(initialFields, [
      { id: "utama", label: "Utama", firstField: "paham_ketentuan" },
    ]),
    true,
  );
  assert.ok(pathFor(initialFields, { paham_ketentuan: "Belum" }).end);
});
test("jawaban tersembunyi dibersihkan dan tidak divalidasi", () => {
  const r = validateAnswers(initialFields, {
    ...valid,
    vat: "999",
    nsfp: "rahasia",
    nitku: "hapus",
    vendor_2_nama: "hapus",
    legalitas_tanggal: "2026-01-01",
  });
  assert.equal(r.valid, true);
  for (const code of [
    "vat",
    "nsfp",
    "nitku",
    "vendor_2_nama",
    "legalitas_tanggal",
  ])
    assert.equal(code in r.values, false);
});
test("seluruh jalur subvendor 0–4, PPN dan jasa", () => {
  for (let n = 0; n <= 4; n++) {
    const values = {
      ...valid,
      ada_ppn: "Ya",
      vat: "10.01",
      nsfp: "123",
      invoice_jasa: "Ya",
      nitku: "123",
      email_bukpot: "pajak@example.com",
      legalitas_terkirim: "Sudah",
      legalitas_tanggal: "2026-10-01",
    };
    for (let i = 1; i <= 4; i++) {
      values[`ada_subvendor_${i}`] = i <= n ? "Ya" : "Tidak";
      values[`vendor_${i}_nama`] = "Vendor " + i;
      values[`vendor_${i}_kontak`] = "08123";
    }
    const r = validateAnswers(initialFields, values);
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(
      r.visible.filter((f) => /^vendor_\d_nama$/.test(f.code)).length,
      n,
    );
  }
});
test("validasi email, tanggal, angka, required hanya jika tampil", () => {
  const r = validateAnswers(initialFields, {
    ...valid,
    email_anda: "salah",
    invoice_date: "2026-02-30",
    amount_nett: "1.001",
    ada_ppn: "Ya",
  });
  for (const code of [
    "email_anda",
    "invoice_date",
    "amount_nett",
    "vat",
    "nsfp",
  ])
    assert.ok(r.errors[code]);
});
test("operator AND / OR, contains, empty, filled, neq", () => {
  assert.equal(
    condition(
      {
        join: "AND",
        conditions: [
          { field: "a", operator: "contains", value: "X" },
          { field: "b", operator: "empty" },
        ],
      },
      { a: ["X"] },
    ),
    true,
  );
  assert.equal(
    condition(
      {
        join: "OR",
        conditions: [
          { field: "a", operator: "neq", value: "X" },
          { field: "a", operator: "filled" },
        ],
      },
      { a: "X" },
    ),
    true,
  );
});
test("lompatan section dan loop ditolak", () => {
  const f = [
    {
      code: "a",
      label: "A",
      type: "select",
      required: true,
      active: true,
      options: [{ value: "Lompat", action: { type: "jump", target: "akhir" } }],
    },
    { code: "b", label: "B", type: "short", required: true, active: true },
    { code: "c", label: "C", type: "short", required: true, active: true },
  ];
  const sections = [{ id: "akhir", label: "Akhir", firstField: "c" }];
  assert.equal(validateDefinition(f, sections), true);
  assert.deepEqual(
    pathFor(f, { a: "Lompat", b: "hilang", c: "ada" }, sections).visible.map(
      (f) => f.code,
    ),
    ["a", "c"],
  );
  f[0].options[0].action.target = "a";
  assert.throws(() => validateDefinition(f, sections), /loop/);
});
test("total dihitung dalam sen untuk menghindari 0.1+0.2", () => {
  assert.equal(amountTotal("0.1", "0.2"), 0.3);
  assert.equal(amountTotal(1250000.25, 137500.75), 1387501);
  assert.equal(amountTotal(100, undefined), 100);
});
test("default diterapkan saat pertanyaan baru tampil, tanpa mengisi ulang jawaban yang sengaja dikosongkan", () => {
  const fields = [
    { code: "a", active: true },
    {
      code: "b",
      active: true,
      defaultValue: "Awal",
      showIf: {
        join: "AND",
        conditions: [{ field: "a", operator: "eq", value: "Ya" }],
      },
    },
  ];
  const answers = applyAnswer(fields, { a: "Tidak" }, "a", "Ya");
  assert.equal(answers.b, "Awal");
  assert.equal(applyAnswer(fields, answers, "b", "").b, undefined);
  assert.equal(applyAnswer(fields, answers, "a", "Tidak").b, undefined);
});
test("kombinasi AND dan OR bertingkat menggunakan mesin yang sama", () => {
  const rule = {
    join: "AND",
    conditions: [
      { field: "a", operator: "eq", value: "Ya" },
      {
        join: "OR",
        conditions: [
          { field: "b", operator: "eq", value: "BCU" },
          { field: "c", operator: "filled" },
        ],
      },
    ],
  };
  assert.equal(condition(rule, { a: "Ya", b: "Lain", c: "ada" }), true);
  assert.equal(condition(rule, { a: "Tidak", b: "BCU" }), false);
  const fields = ["a", "b", "c", "d"].map((code) => ({
    code,
    label: code,
    type: "short",
    required: false,
    active: true,
  }));
  fields[3].showIf = rule;
  assert.equal(validateDefinition(fields), true);
  fields[3].showIf.conditions[1].conditions[0].field = "d";
  assert.throws(() => validateDefinition(fields), /sebelumnya/);
});
test("akhir jalur biasa dapat direview/submit, akhir ke ketentuan memblokir submit", () => {
  const fields = [
    {
      code: "a",
      type: "select",
      required: true,
      active: true,
      options: [
        { value: "Selesai", action: { type: "end", message: "Terima kasih" } },
      ],
    },
    { code: "b", type: "short", required: true, active: true },
  ];
  const done = validateAnswers(fields, { a: "Selesai", b: "hapus" });
  assert.equal(done.valid, true);
  assert.equal(done.values.b, undefined);
  fields[0].options[0].action.returnToTerms = true;
  assert.equal(validateAnswers(fields, { a: "Selesai" }).valid, false);
});

test('batas tanggal: 6 bulan, akhir bulan, tahun kabisat dan zona waktu',()=>{
  assert.deepEqual(dateBounds({monthsBack:6,noFuture:true},{now:new Date('2026-11-04T03:00:00Z')}),{min:'2026-05-04',max:'2026-11-04'});
  assert.equal(dateBounds({monthsBack:6},{now:new Date('2024-08-31T03:00:00Z')}).min,'2024-02-29');
  assert.equal(dateBounds({monthsBack:6},{now:new Date('2025-08-31T03:00:00Z')}).min,'2025-02-28');
  assert.equal(dateBounds({noFuture:true},{now:new Date('2026-11-03T18:00:00Z'),timeZone:'Asia/Jakarta'}).max,'2026-11-04');
});
test('batas tanggal inklusif, tersembunyi dilewati, konfigurasi salah ditolak',()=>{
  const field={code:'tanggal',label:'Tanggal',type:'date',active:true,required:true,validation:{monthsBack:6,noFuture:true}};
  const ctx={now:new Date('2026-11-04T03:00:00Z')};
  for(const date of ['2026-05-04','2026-11-04'])assert.equal(validateAnswers([field],{tanggal:date},[],ctx).valid,true);
  for(const date of ['2026-05-03','2026-11-05','2026-02-30'])assert.equal(validateAnswers([field],{tanggal:date},[],ctx).valid,false);
  assert.equal(validateAnswers([{...field,active:false}],{tanggal:'2020-01-01'},[],ctx).valid,true);
  assert.throws(()=>validateDateLimits({monthsBack:-1}));assert.throws(()=>validateDateLimits({monthsBack:1.5}));
  assert.throws(()=>validateDateLimits({dateMin:'2026-02-30'}));
  assert.throws(()=>validateDateLimits({dateMin:'2026-11-06',dateMax:'2026-11-05'}));
  assert.deepEqual(dateBounds({dateMin:'2026-06-01',monthsBack:6,noFuture:true},ctx),{min:'2026-06-01',max:'2026-11-04'});
});

test("kode placeholder buku dicadangkan agar tidak menjadi pertanyaan vendor", () => {
  for (const code of ["nomor_buku", "tahun_buku"]) {
    const fields = structuredClone(initialFields);
    fields[0].code = code;
    assert.throws(() => validateDefinition(fields), /dicadangkan/);
  }
});
