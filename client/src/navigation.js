import { useSyncExternalStore } from "react";
import { modeFromPath } from "../../shared/admin-routing";
export { modeFromPath };

export const adminPaths = {
  dashboard: "/admin/ringkasan",
  notifications: "/admin/notifikasi",
  data: "/admin/data-form",
  custom: "/admin/tabel-kustom",
  terms: "/admin/ketentuan",
  form: "/admin/form-builder",
  template: "/admin/template",
  logs: "/admin/logs-backup",
  settings: "/admin/settings",
};
export const settingsTabs = {
  umum: "Umum", dokumen: "Dokumen", email: "Email / SMTP", keamanan: "Keamanan",
  backup: "Backup", unggahan: "Unggahan", tema: "Tema warna", akun: "Akun admin", "akses-menu": "Akses Menu",
};
const changeEvent = "roi-location-changed";
const subscribe = (listener) => {
  window.addEventListener("popstate", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(changeEvent, listener);
  };
};
export function useLocation() {
  const href = useSyncExternalStore(subscribe, () => window.location.href);
  return new URL(href);
}
export function navigateUrl(href, { replace = false } = {}) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) throw Error("Alamat navigasi tidak valid.");
  if (url.href === window.location.href) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(changeEvent));
}
export function rememberedMode() {
  try {
    const mode = sessionStorage.getItem("roi-admin-mode");
    return ["internal", "eksternal"].includes(mode) ? mode : null;
  } catch { return null; }
}
export function rememberMode(mode) {
  if (!["internal", "eksternal"].includes(mode)) return;
  try { sessionStorage.setItem("roi-admin-mode", mode); } catch { /* URL remains authoritative. */ }
}
export function adminHref(page, params = {}, mode = modeFromPath(location.pathname) || rememberedMode() || "internal") {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "" && value != null));
  const path = page === "settings" ? adminPaths.settings : adminPaths[page]?.replace("/admin/", `/admin/${mode}/`);
  return path + (search.size ? "?" + search : "");
}
export function goAdmin(page, params, mode) { navigateUrl(adminHref(page, params, mode)); }
export function queryUpdate(values, options) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  navigateUrl(url.href, options);
}
export function followLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigateUrl(event.currentTarget.href);
}
