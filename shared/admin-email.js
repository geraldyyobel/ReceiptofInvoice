export const adminEmailDomain = "bcupt.id";

export function normalizeAdminEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isBcuAdminEmail(value) {
  const email = normalizeAdminEmail(value);
  const [local, domain, extra] = email.split("@");
  return email.length <= 254 && !!local && !/\s/.test(local) &&
    domain === adminEmailDomain && extra === undefined;
}
