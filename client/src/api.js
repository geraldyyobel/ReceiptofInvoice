let csrf;
export async function api(url, options = {}) {
  if (!csrf) {
    const r = await fetch("/api/csrf", { credentials: "include" });
    csrf = (await r.json()).token;
  }
  const body = options.body,
    form = body instanceof FormData;
  const r = await fetch("/api" + url, {
    credentials: "include",
    ...options,
    headers: {
      ...(!form ? { "Content-Type": "application/json" } : {}),
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (!r.ok) {
    const data = await r
      .json()
      .catch(() => ({ error: "Server tidak dapat dihubungi" }));
    const e = new Error(data.error);
    e.details = data.details;
    e.status = r.status;
    throw e;
  }
  return options.raw ? r : r.json();
}
export async function download(url, name, options = {}) {
  const r = await api(url, { ...options, raw: true }),
    blob = await r.blob(),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
export const money = (v) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v) || 0);
let timeZone = "Asia/Jakarta";
export const setTimeZone = (v) => {
  timeZone = v || "Asia/Jakarta";
};
export const date = (v) =>
  v
    ? new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      }).format(new Date(v))
    : "—";
