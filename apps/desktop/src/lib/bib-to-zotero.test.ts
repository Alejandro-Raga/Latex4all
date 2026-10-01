import { describe, expect, it } from "vitest";
import {
  bibCreators,
  parseBibRecords,
  zoteroItemFromBib,
} from "./bib-to-zotero";

const BIB = String.raw`@article{cohen_absorptive_1990,
  title = {Absorptive {Capacity}: A New Perspective on Learning and Innovation},
  author = {Cohen, Wesley M. and Daniel A. Levinthal},
  journal = {Administrative Science Quarterly},
  volume = {35}, number = {1}, pages = {128--152},
  year = 1990, month = mar,
  doi = {10.2307/2393553},
}

@misc{noauthor_horizon_2025,
  title = "Horizon {Europe} work programme",
  author = {{European Commission}},
  url = {https://research-and-innovation.ec.europa.eu/x_y},
  urldate = {2025-02-01},
  year = {2025}
}

@incollection{nelson_rate_1962,
  title = {The {Rate} and {Direction} of {R\&D}},
  author = {Nelson, Richard R.},
  editor = {Arrow, Kenneth},
  booktitle = {The Rate and Direction of Inventive Activity},
  publisher = {Princeton University Press}, address = {Princeton},
  pages = {609--626}, year = {1962}, doi = {10.1515/9781400879762-024},
}`;

describe("a .bib entry as a Zotero item", () => {
  const [article, web, chapter] = parseBibRecords(BIB);

  it("reads every field, braces, months and all", () => {
    expect(article.key).toBe("cohen_absorptive_1990");
    expect(article.fields).toMatchObject({
      title:
        "Absorptive Capacity: A New Perspective on Learning and Innovation",
      volume: "35",
      pages: "128–152",
      month: "3",
    });
    expect(web.fields.url).toBe(
      "https://research-and-innovation.ec.europa.eu/x_y",
    );
    expect(chapter.fields.title).toBe("The Rate and Direction of R&D");
  });

  it("splits names, keeping an organisation whole", () => {
    expect(
      bibCreators(
        "Cohen, Wesley M. and Daniel A. Levinthal and Ludwig van Beethoven",
        "author",
      ),
    ).toEqual([
      { creatorType: "author", lastName: "Cohen", firstName: "Wesley M." },
      { creatorType: "author", firstName: "Daniel A.", lastName: "Levinthal" },
      { creatorType: "author", firstName: "Ludwig", lastName: "van Beethoven" },
    ]);
    expect(bibCreators("{European Commission}", "author")).toEqual([
      { creatorType: "author", name: "European Commission" },
    ]);
  });

  it("maps a journal article", () => {
    expect(zoteroItemFromBib(article)).toEqual({
      itemType: "journalArticle",
      title:
        "Absorptive Capacity: A New Perspective on Learning and Innovation",
      creators: [
        { creatorType: "author", lastName: "Cohen", firstName: "Wesley M." },
        {
          creatorType: "author",
          firstName: "Daniel A.",
          lastName: "Levinthal",
        },
      ],
      date: "1990-03",
      publicationTitle: "Administrative Science Quarterly",
      volume: "35",
      issue: "1",
      pages: "128–152",
      DOI: "10.2307/2393553",
      extra: "Citation Key: cohen_absorptive_1990",
    });
  });

  it("keeps fields a type lacks in Extra", () => {
    const item = zoteroItemFromBib(chapter);
    expect(item).toMatchObject({
      itemType: "bookSection",
      bookTitle: "The Rate and Direction of Inventive Activity",
      publisher: "Princeton University Press",
      place: "Princeton",
    });
    expect(item.DOI).toBeUndefined();
    expect(item.extra).toBe(
      "Citation Key: nelson_rate_1962\nDOI: 10.1515/9781400879762-024",
    );
  });

  it("makes a linked misc entry a web page", () => {
    expect(zoteroItemFromBib(web)).toMatchObject({
      itemType: "webpage",
      creators: [{ creatorType: "author", name: "European Commission" }],
      url: "https://research-and-innovation.ec.europa.eu/x_y",
      accessDate: "2025-02-01",
    });
  });
});
