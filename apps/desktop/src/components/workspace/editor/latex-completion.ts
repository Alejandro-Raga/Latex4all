import {
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";
import { useDocumentStore } from "@/stores/document-store";

const CITE_RE =
  /\\(?:cite|citep|citet|citeauthor|citeyear|citealt|citealp|citenum|Cite|Citep|Citet|Citeauthor|footcite|textcite|parencite|autocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/;

const REF_RE =
  /\\(?:ref|eqref|autoref|nameref|pageref|vref|cref|Cref)\{([^}]*)$/;

function extractCitekeys(bib: string): Completion[] {
  const out: Completion[] = [];
  const re = /@(\w+)\{([^,\s]+)/g;
  let m;
  while ((m = re.exec(bib)) !== null) {
    out.push({ label: m[2], type: "keyword", detail: m[1] });
  }
  return out;
}

function extractLabels(tex: string): Completion[] {
  const out: Completion[] = [];
  const re = /\\label\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(tex)) !== null) {
    out.push({ label: m[1], type: "variable" });
  }
  return out;
}

export function latexCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const slice = context.state.doc.sliceString(
    Math.max(0, context.pos - 150),
    context.pos,
  );

  const citeMatch = CITE_RE.exec(slice);
  if (citeMatch) {
    const parts = citeMatch[1].split(",");
    const typed = parts[parts.length - 1];
    const { files } = useDocumentStore.getState();
    const options: Completion[] = [];
    for (const f of files) {
      if (f.type === "bib" && f.content) {
        options.push(...extractCitekeys(f.content));
      }
    }
    return {
      from: context.pos - typed.length,
      options,
      validFor: /^[^},]*$/,
    };
  }

  const refMatch = REF_RE.exec(slice);
  if (refMatch) {
    const typed = refMatch[1];
    const { files } = useDocumentStore.getState();
    const options: Completion[] = [];
    for (const f of files) {
      if (f.type === "tex" && f.content) {
        options.push(...extractLabels(f.content));
      }
    }
    return {
      from: context.pos - typed.length,
      options,
      validFor: /^[^}]*$/,
    };
  }

  return null;
}
