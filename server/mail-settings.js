import { audit } from "./core.js";

export const emailTransport = (value) => value == null || value === "smtp" ? "smtp" : "none";
export const safeMailSettings = (settings) => Object.fromEntries(
  Object.entries(settings).filter(([key]) => !key.startsWith("mail_oauth_")),
);

// Run inside the caller's transaction, both on startup and when restoring old archives.
export async function removeDeprecatedMailSettings(client, req = null) {
  const stored = await client.setting.findUnique({ where: { key: "email_transport" } });
  const removed = await client.setting.deleteMany({ where: { key: { startsWith: "mail_oauth_" } } });
  const changed = stored && stored.value !== emailTransport(stored.value);
  if (changed) await client.setting.update({ where: { key: stored.key }, data: { value: "none" } });
  if (removed.count || changed) await audit(req || { admin: { email: "sistem" } }, "email.oauth_removed", null,
    { removedSettings: removed.count, transportDisabled: !!changed }, null, client);
  return { removedSettings: removed.count, transportDisabled: !!changed };
}
