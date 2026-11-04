/**
 * When a project was last worked on, as the projects page says it: "Edited
 * just now", "Edited 5 min ago", "Edited 2 h ago", "Edited yesterday",
 * "Edited 3 days ago", then the date ("Edited 12 Mar", with the year once
 * it isn't this one).
 */
export function editedLabel(at: number | null, now = Date.now()): string {
  if (at === null || !Number.isFinite(at) || at <= 0) return "";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} h ago`;
  const then = new Date(at);
  const today = new Date(now);
  const midnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const days = Math.ceil((midnight - at) / 86_400_000);
  if (days <= 1) return "Edited yesterday";
  if (days < 7) return `Edited ${days} days ago`;
  const sameYear = then.getFullYear() === today.getFullYear();
  return `Edited ${then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })}`;
}
