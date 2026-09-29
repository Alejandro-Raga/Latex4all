/**
 * Fills an Obsidian template the way its core Templates plugin does:
 * {{title}}, {{date}}, {{time}}, and {{date:FORMAT}} / {{time:FORMAT}} with
 * the common Moment.js tokens (YYYY, YY, MM, M, DD, D, HH, H, mm, ss).
 */
export function fillTemplate(
  template: string,
  title: string,
  now = new Date(),
) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, string> = {
    YYYY: String(now.getFullYear()),
    YY: String(now.getFullYear()).slice(-2),
    MM: pad(now.getMonth() + 1),
    M: String(now.getMonth() + 1),
    DD: pad(now.getDate()),
    D: String(now.getDate()),
    HH: pad(now.getHours()),
    H: String(now.getHours()),
    mm: pad(now.getMinutes()),
    ss: pad(now.getSeconds()),
  };
  const format = (pattern: string) =>
    pattern.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g, (t) => tokens[t]);
  return template.replace(
    /\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/gi,
    (_, key: string, pattern: string | undefined) => {
      const k = key.toLowerCase();
      if (k === "title") return title;
      return format(pattern?.trim() || (k === "date" ? "YYYY-MM-DD" : "HH:mm"));
    },
  );
}
