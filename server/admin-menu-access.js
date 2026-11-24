import { z } from "zod";
import { adminRoles, masterReaderRole, workspaceMenus } from "../shared/admin-routing.js";
import { audit, db, fail } from "./core.js";

export const menuSettingPrefix = "admin_menu:";
const accountPrefix = menuSettingPrefix + "account:";
const rolePrefix = menuSettingPrefix + "role:";
const roleKey = (role) => rolePrefix + role;
const accountKey = (id) => accountPrefix + id;
const menuIds = workspaceMenus.map(([id]) => id);
const menuId = z.enum(menuIds);
const roleRules = z.array(menuId).max(menuIds.length);
const accountRules = z.partialRecord(menuId, z.boolean());
const customRoleId = /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const customRole = z.object({ label: z.string().min(2).max(50), menus: roleRules });

function readRole(role, value) {
  if (role === masterReaderRole) return { label: adminRoles[role], menus: ["data"] };
  if (Object.hasOwn(adminRoles, role)) return {
    label: adminRoles[role],
    menus: value === undefined ? menuIds : (roleRules.safeParse(value).data ?? []),
  };
  if (customRoleId.test(role)) return customRole.safeParse(value).data;
}
const readAccount = (value) => {
  const parsed = accountRules.safeParse(value);
  return parsed.success ? parsed.data : {};
};

export async function resolveAdminAccess(admin) {
  if (admin.role === masterReaderRole) return { menus: ["data"], roleLabel: adminRoles[admin.role] };
  const role = roleKey(admin.role), account = accountKey(admin.id);
  const rows = await db.setting.findMany({ where: { key: { in: [role, account] } } });
  const values = new Map(rows.map(({ key, value }) => [key, value]));
  const definition = readRole(admin.role, values.get(role));
  if (!definition) return { menus: [], roleLabel: "Role tidak tersedia" };
  const overrides = readAccount(values.get(account));
  const menus = menuIds.filter((id) => overrides[id] ?? definition.menus.includes(id));
  if (admin.role === "superadmin") menus.push("settings");
  return { menus, roleLabel: definition.label };
}

export async function validateAdminRole(role) {
  if (Object.hasOwn(adminRoles, role)) return;
  const stored = customRoleId.test(role) && await db.setting.findUnique({ where: { key: roleKey(role) } });
  if (!stored || !readRole(role, stored.value)) throw fail("Role tidak tersedia.", 422);
}

export function clearMenuOverrides(client, id) {
  return client.setting.deleteMany({ where: { key: accountKey(id) } });
}

const apiMenus = new Map([
  ["dashboard", "dashboard"],
  ["notifications", "notifications"],
  ["submissions", "data"],
  ["custom", "custom"],
  ["terms", "terms"],
  ["images", "terms"],
  ["form", "form"],
  ["review", "form"],
  ["template", "template"],
  ["logs", "logs"],
  ["backups", "logs"],
  ["settings", "settings"],
  ["admins", "settings"],
]);

export async function enforceAdminMenu(req, res, next) {
  const [, resource, item] = req.path.toLowerCase().split("/");
  if (resource === "mode") return next();
  const menu = resource === "uploads" ? (item ? "data" : "terms") : apiMenus.get(resource);
  if (!menu) throw fail("Endpoint tidak ditemukan", 404);
  if (menu === "settings" || resource === "backups") {
    if (req.admin.role !== "superadmin") throw fail("Khusus Super Admin", 403);
    if (menu === "settings") return next();
  }
  req.adminMenus = (await resolveAdminAccess(req.admin)).menus;
  if (!req.adminMenus.includes(menu))
    throw fail("Anda tidak memiliki akses ke menu ini.", 403, { menuAccess: menu });
  if (req.admin.role === masterReaderRole &&
    (!["GET", "HEAD"].includes(req.method) || !/^\/submissions(?:\/[^/]+)?\/?$/i.test(req.path)))
    throw fail("Role User hanya dapat melihat daftar dan detail Data Form Master.", 403);
  next();
}

export function registerMenuAccessSettings(app, superadmin) {
  const base = "/api/admin/settings/menu-access";
  app.get(base, superadmin, async (req, res) => {
    const rows = await db.setting.findMany({ where: { key: { startsWith: menuSettingPrefix } } });
    const values = new Map(rows.map(({ key, value }) => [key, value]));
    const definitions = new Map(Object.keys(adminRoles).map((role) => [role, readRole(role, values.get(roleKey(role)))]));
    for (const { key, value } of rows) {
      if (!key.startsWith(rolePrefix)) continue;
      const role = key.slice(rolePrefix.length);
      const definition = customRoleId.test(role) && readRole(role, value);
      if (definition) definitions.set(role, definition);
    }
    res.json({
      roles: Object.fromEntries([...definitions].map(([role, definition]) => [role, definition.menus])),
      roleLabels: Object.fromEntries([...definitions].map(([role, definition]) => [role, definition.label])),
      accounts: Object.fromEntries(rows.filter(({ key }) => key.startsWith(accountPrefix))
        .map(({ key, value }) => [key.slice(accountPrefix.length), readAccount(value)])),
    });
  });

  async function save(req, key, target, rules) {
    await db.$transaction(async (tx) => {
      const previous = await tx.setting.findUnique({ where: { key } });
      await tx.setting.upsert({ where: { key }, create: { key, value: rules }, update: { value: rules } });
      await audit(req, "admin.menu_access.update",
        { ...target, rules: previous?.value ?? null }, { ...target, rules }, null, tx);
    });
  }

  app.post(base + "/roles", superadmin, async (req, res) => {
    const { label } = z.strictObject({ label: z.string().trim().min(2).max(50) }).parse(req.body);
    const slug = (name) => name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const suffix = slug(label);
    if (!suffix || [...Object.values(adminRoles), ...Object.keys(adminRoles)].some((name) => slug(name) === suffix))
      throw fail("Pilih nama role selain Admin, Super Admin, dan User.", 422);
    const id = "custom-" + suffix;
    const value = { label, menus: [] };
    await db.$transaction(async (tx) => {
      await tx.setting.create({ data: { key: roleKey(id), value } });
      await audit(req, "admin.role.create", null, { role: id, ...value }, null, tx);
    });
    res.status(201).json({ id, ...value });
  });

  app.put(base + "/roles/:role", superadmin, async (req, res) => {
    const role = req.params.role;
    if (role === masterReaderRole) throw fail("Izin role User tetap pada Data Form Master.", 422);
    await validateAdminRole(role);
    const { menus } = z.strictObject({ menus: roleRules }).parse(req.body);
    const rules = menuIds.filter((id) => menus.includes(id));
    if (customRoleId.test(role)) {
      const key = roleKey(role);
      const previous = await db.setting.findUniqueOrThrow({ where: { key } });
      await save(req, key, { role }, { ...previous.value, menus: rules });
    } else await save(req, roleKey(role), { role }, rules);
    res.json({ rules });
  });

  app.put(base + "/accounts/:id", superadmin, async (req, res) => {
    const { overrides } = z.strictObject({ overrides: accountRules }).parse(req.body);
    const id = req.params.id;
    const account = await db.admin.findUnique({ where: { id }, select: { role: true } });
    if (!account) throw fail("Akun admin tidak ditemukan", 404);
    if (account.role === masterReaderRole) throw fail("Izin akun User tetap pada Data Form Master.", 422);
    await save(req, accountKey(id), { adminId: id }, overrides);
    res.json({ rules: overrides });
  });
}
