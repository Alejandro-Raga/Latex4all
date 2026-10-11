import { describe, expect, it } from "vitest";
import { applyCleanup, findBibProblems } from "./bib-cleanup";

const refs = String.raw`@article{arora_decline_2018,
  author = {Arora, Ashish and Belenzon, Sharon},
  title = {The decline of science in corporate {R\&D}},
  year = {2018},
  doi = {10.1002/smj.2693},
}

@article{arora2018decline,
  author = {Ashish Arora},
  title = {The Decline of Science in Corporate R\&D},
  year = {2018},
}

@article{stephan_economics_1996,
  author = {Stephan, Paula},
  title = {The Economics of Science},
  year = {1996},
}

@incollection{stephan_economics_2010,
  author = {Stephan, Paula},
  title = {The Economics of Science},
  year = {2010},
}

@article{irwin_citizen_2002,
  author = {Irwin, Alan},
  title = {Citizen science: a study of people, expertise and sustainable development},
  year = {2002},
}

@article{marx_reliance_2020,
  author = {Marx, Matt},
  title = {Reliance on science},
  year = {2020},
}
`;
const more = String.raw`@article{marx_reliance_2020,
  author = {Marx, Matt},
  title = {Reliance on science},
  year = {2020},
}
`;
const tex = String.raw`\cite{arora_decline_2018} \citep{arora2018decline, arora_decline_2018}
\cite{irwinCitizenScienceStudy2002} \cite{stephan_economics_1996,stephan_economics_2010} \cite{marx_reliance_2020}
% \cite{arora2018decline}`;

const bib = [
  { path: "references.bib", content: refs },
  { path: "patents.bib", content: more },
];

describe("tidying a bibliography", () => {
  const found = findBibProblems([{ content: tex }], bib);

  it("finds one paper under two keys (by DOI or title and year), keeping the one cited most", () => {
    expect(found.duplicates).toHaveLength(1);
    expect(found.duplicates[0].keep).toBe("arora_decline_2018");
    expect(found.duplicates[0].uses).toEqual({
      arora_decline_2018: 2,
      arora2018decline: 1,
    });
  });

  it("doesn't join different works that share a title", () => {
    expect(found.duplicates.flatMap((d) => d.keys)).not.toContain(
      "stephan_economics_2010",
    );
  });

  it("finds a key written twice, and whether the copies agree", () => {
    expect(found.sameKey).toEqual([
      expect.objectContaining({ key: "marx_reliance_2020", identical: true }),
    ]);
  });

  it("matches a cited key that's in no .bib to the entry it means", () => {
    expect(found.strays).toEqual([
      { key: "irwinCitizenScienceStudy2002", to: "irwin_citizen_2002" },
    ]);
  });

  it("rewrites the citations and removes the extra entries", () => {
    const result = applyCleanup([{ path: "main.tex", content: tex }], bib, {
      merges: [{ from: ["arora2018decline"], to: "arora_decline_2018" }],
      keepCopy: [{ key: "marx_reliance_2020", index: 0 }],
      strays: found.strays,
    });
    const main = result.tex.get("main.tex") as string;
    expect(main).toContain(String.raw`\citep{arora_decline_2018}`);
    expect(main).toContain(String.raw`\cite{irwin_citizen_2002}`);
    const references = result.bib.get("references.bib") as string;
    expect(references).not.toContain("arora2018decline");
    expect(references).toContain("arora_decline_2018");
    expect(references).toContain("marx_reliance_2020");
    expect(result.bib.get("patents.bib")).not.toContain("marx_reliance_2020");
    expect(result.removed).toBe(2);
  });
});
