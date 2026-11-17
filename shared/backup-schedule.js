export function latestBackupSlot(localDateTime, times) {
  const slots = [...new Set(times)].sort();
  if (!slots.length || slots.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))
    throw Error("Jadwal backup tidak valid");
  const day = localDateTime.slice(0, 10),
    time = localDateTime.slice(11, 16),
    due = slots.filter((s) => s <= time);
  if (due.length) return day + " " + due.at(-1);
  const previous = new Date(Date.parse(day + "T00:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  return previous + " " + slots.at(-1);
}
