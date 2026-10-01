/**
 * A .bib entry as a Zotero item, so a paper someone else cited can go into
 * your library with its details. Zotero refuses an item with a field its
 * type doesn't have, so each type gets only its own fields; the rest go in
 * Extra, which Zotero reads ("DOI: …") and keeps either way.
 */

export interface BibRecord {
  type: string;
  key: string;
  /** Lower-cased field names, values with LaTeX taken out (but for names
   *  and links, kept as written). */
  fields: Record<string, string>;
}

/** Text from LaTeX: accents, commands and braces out, escapes resolved. */
export function latexToText(value: string): string {
  return value
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/--/g, "–")
    .replace(/\\[^A-Za-z\s]\s*\{?([A-Za-z])\}?/g, "$1")
    .replace(/\\[A-Za-z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** Every entry in a .bib file, fields and all. */
export function parseBibRecords(content: string): BibRecord[] {
  const records: BibRecord[] = [];
  const head = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
  for (let m = head.exec(content); m; m = head.exec(content)) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble")
      continue;
    const fields: Record<string, string> = {};
    let i = head.lastIndex;
    while (i < content.length) {
      const name = /^\s*,?\s*([A-Za-z][\w-]*)\s*=\s*/.exec(content.slice(i));
      if (!name) break;
      i += name[0].length;
      let value = "";
      // A value is one or more parts joined with #.
      for (;;) {
        const c = content[i];
        if (c === "{") {
          let depth = 0;
          const start = i;
          for (; i < content.length; i++) {
            if (content[i] === "\\") {
              i++;
              continue;
            }
            if (content[i] === "{") depth++;
            else if (content[i] === "}" && --depth === 0) break;
          }
          value += content.slice(start + 1, i);
          i++;
        } else if (c === '"') {
          let depth = 0;
          const start = ++i;
          for (; i < content.length; i++) {
            if (content[i] === "\\") {
              i++;
              continue;
            }
            if (content[i] === "{") depth++;
            else if (content[i] === "}") depth--;
            else if (content[i] === '"' && depth === 0) break;
          }
          value += content.slice(start, i);
          i++;
        } else {
          const bare = /^[\w.:/-]+/.exec(content.slice(i));
          if (!bare) break;
          const word = bare[0].toLowerCase();
          const month = MONTHS.indexOf(word.slice(0, 3));
          value += month >= 0 && word.length <= 9 ? String(month + 1) : bare[0];
          i += bare[0].length;
        }
        const join = /^\s*#\s*/.exec(content.slice(i));
        if (!join) break;
        i += join[0].length;
      }
      const field = name[1].toLowerCase();
      // Names keep their braces until they're split: "{European
      // Commission}" is one name, not two.
      fields[field] = ["url", "author", "editor"].includes(field)
        ? value.trim()
        : latexToText(value);
      const rest = /^\s*([,}])/.exec(content.slice(i));
      if (!rest || rest[1] === "}") break;
    }
    records.push({ type, key: m[2], fields });
    head.lastIndex = i;
  }
  return records;
}

export interface ZoteroCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

/** Names from "A and B and {Some Organisation}", as Zotero creators. */
export function bibCreators(value: string | undefined, creatorType: string) {
  if (!value) return [];
  return splitNames(value).map((raw): ZoteroCreator => {
    const name = raw.trim();
    // A name in its own braces is one name: an organisation.
    if (/^\{.*\}$/.test(name) && !/\}.*\{/.test(name.slice(1, -1))) {
      return { creatorType, name: latexToText(name) };
    }
    const text = latexToText(name);
    if (text.includes(",")) {
      const [last, ...first] = text.split(",");
      return {
        creatorType,
        lastName: last.trim(),
        firstName: first.join(",").trim(),
      };
    }
    const words = text.split(" ");
    if (words.length === 1) return { creatorType, name: text };
    // "Ludwig van Beethoven": the lower-case particle goes with the surname.
    let cut = words.length - 1;
    while (cut > 1 && /^[a-z]/.test(words[cut - 1])) cut--;
    return {
      creatorType,
      firstName: words.slice(0, cut).join(" "),
      lastName: words.slice(cut).join(" "),
    };
  });
}

/** "A and B" split on the top-level "and"s only. */
function splitNames(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "{") depth++;
    else if (value[i] === "}") depth--;
    else if (depth === 0 && /^\sand\s/i.test(value.slice(i, i + 5))) {
      out.push(value.slice(start, i));
      start = i + 5;
      i += 4;
    }
  }
  out.push(value.slice(start));
  return out.filter((n) => n.trim());
}

/** Zotero type, and which bib field fills which of its fields. */
const TYPES: Record<
  string,
  { itemType: string; fields: Record<string, string> }
> = {
  article: {
    itemType: "journalArticle",
    fields: {
      journal: "publicationTitle",
      journaltitle: "publicationTitle",
      volume: "volume",
      number: "issue",
      issue: "issue",
      pages: "pages",
      doi: "DOI",
      issn: "ISSN",
      series: "series",
      shortjournal: "journalAbbreviation",
    },
  },
  book: {
    itemType: "book",
    fields: {
      publisher: "publisher",
      address: "place",
      location: "place",
      edition: "edition",
      series: "series",
      volume: "volume",
      isbn: "ISBN",
      pagetotal: "numPages",
    },
  },
  incollection: {
    itemType: "bookSection",
    fields: {
      booktitle: "bookTitle",
      publisher: "publisher",
      address: "place",
      location: "place",
      edition: "edition",
      series: "series",
      volume: "volume",
      pages: "pages",
      isbn: "ISBN",
    },
  },
  inproceedings: {
    itemType: "conferencePaper",
    fields: {
      booktitle: "proceedingsTitle",
      eventtitle: "conferenceName",
      publisher: "publisher",
      address: "place",
      location: "place",
      volume: "volume",
      series: "series",
      pages: "pages",
      doi: "DOI",
      isbn: "ISBN",
    },
  },
  phdthesis: {
    itemType: "thesis",
    fields: {
      school: "university",
      institution: "university",
      address: "place",
      location: "place",
      type: "thesisType",
    },
  },
  techreport: {
    itemType: "report",
    fields: {
      institution: "institution",
      number: "reportNumber",
      type: "reportType",
      address: "place",
      location: "place",
      pages: "pages",
    },
  },
  online: {
    itemType: "webpage",
    fields: {
      organization: "websiteTitle",
      howpublished: "websiteTitle",
      type: "websiteType",
    },
  },
  misc: {
    itemType: "document",
    fields: {
      publisher: "publisher",
      organization: "publisher",
      howpublished: "publisher",
    },
  },
  unpublished: {
    itemType: "manuscript",
    fields: { type: "manuscriptType", address: "place" },
  },
};
TYPES.inbook = TYPES.incollection;
TYPES.conference = TYPES.inproceedings;
TYPES.proceedings = TYPES.book;
TYPES.mastersthesis = TYPES.phdthesis;
TYPES.thesis = TYPES.phdthesis;
TYPES.report = TYPES.techreport;
TYPES.www = TYPES.online;
TYPES.electronic = TYPES.online;
TYPES.manual = TYPES.book;
TYPES.booklet = TYPES.book;

/** Shared by every type; "accessDate" and "url" only where the type has them. */
const COMMON = [
  "title",
  "abstractNote",
  "date",
  "language",
  "url",
  "accessDate",
  "extra",
];

/** The Zotero item for a .bib entry, its citation key kept in Extra. */
export function zoteroItemFromBib(record: BibRecord): Record<string, unknown> {
  const f = record.fields;
  let spec = TYPES[record.type] ?? TYPES.misc;
  // What Zotero itself exports as @misc with a link and no publisher is a
  // web page; a web page without a link is just a document.
  if (record.type === "misc" && f.url && !f.publisher && !f.howpublished) {
    spec = TYPES.online;
  }
  if (spec.itemType === "webpage" && !f.url) spec = TYPES.misc;
  const item: Record<string, unknown> = { itemType: spec.itemType };
  const extra: string[] = [`Citation Key: ${record.key}`];

  item.title = f.title ?? "";
  item.creators = [
    ...bibCreators(f.author, "author"),
    ...bibCreators(f.editor, "editor"),
  ];
  if (f.abstract) item.abstractNote = f.abstract;
  const date =
    f.date ??
    (f.year
      ? f.month
        ? `${f.year}-${f.month.padStart(2, "0")}`
        : f.year
      : undefined);
  if (date) item.date = date;
  if (f.language) item.language = f.language;
  if (f.url) item.url = f.url;
  if (f.urldate) item.accessDate = f.urldate;

  if (spec.itemType === "thesis" && !f.type) {
    item.thesisType =
      record.type === "mastersthesis" ? "Master's thesis" : "PhD thesis";
  }
  for (const [bib, value] of Object.entries(f)) {
    const field = spec.fields[bib];
    if (field) {
      if (!item[field]) item[field] = value;
    } else if (bib === "doi") {
      extra.push(`DOI: ${value}`);
    } else if (bib === "isbn" || bib === "issn") {
      extra.push(`${bib.toUpperCase()}: ${value}`);
    }
  }
  if (f.note) extra.push(f.note);
  item.extra = extra.join("\n");
  for (const key of Object.keys(item)) {
    if (item[key] === "" && !COMMON.includes(key)) delete item[key];
  }
  return item;
}
