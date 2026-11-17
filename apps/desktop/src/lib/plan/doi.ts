/**
 * What a DOI says about its paper, from Crossref (the DOI registry, open to
 * anyone): its title, authors, journal and year, to name a paper added by
 * its DOI and to put it in Zotero.
 */
export interface DoiPaper {
  title: string;
  authors: { firstName: string; lastName: string }[];
  journal?: string;
  year?: string;
}

export async function lookupDoi(
  doi: string,
  timeoutMs = 6000,
): Promise<DoiPaper | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const { message } = (await response.json()) as {
      message?: {
        title?: string[];
        author?: { given?: string; family?: string; name?: string }[];
        "container-title"?: string[];
        issued?: { "date-parts"?: number[][] };
      };
    };
    const title = message?.title?.[0]?.trim();
    if (!title) return null;
    return {
      title,
      authors: (message?.author ?? []).map((a) => ({
        firstName: a.given ?? "",
        lastName: a.family ?? a.name ?? "",
      })),
      journal: message?.["container-title"]?.[0],
      year: message?.issued?.["date-parts"]?.[0]?.[0]?.toString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
