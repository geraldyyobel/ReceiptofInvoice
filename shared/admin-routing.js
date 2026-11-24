export const adminModes = ["internal", "eksternal"];
export const adminRoles = { admin: "Admin", superadmin: "Super Admin", user: "User" };
export const masterReaderRole = "user";
export const workspaceMenus = [
  ["dashboard", "⌂", "Ringkasan"],
  ["notifications", "🔔", "Notifikasi"],
  ["data", "▤", "Data Form"],
  ["custom", "▦", "Tabel Kustom"],
  ["terms", "≡", "Editor Ketentuan"],
  ["form", "⑂", "Form Builder"],
  ["template", "▧", "Template Dokumen"],
  ["logs", "◷", "Logs & Backup"],
];
export const adminMenus = [...workspaceMenus, ["settings", "⚙", "Settings"]];
export const globalAdminApi = (path) => /^\/(?:settings|admins|backups)(?:\/|$)/.test(path);
export const modeFromPath = (path) => /^\/admin\/(internal|eksternal)(?:\/|$)/.exec(path)?.[1] || null;
