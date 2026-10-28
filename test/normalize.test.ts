import { describe, expect, it } from "vitest";
import { directorNamedIn, normalizeTitle } from "@/lib/normalize";
import { pickMatch } from "@/lib/match";
import type { QlooEntity } from "@/lib/qloo";

describe("normalizeTitle", () => {
  it("drops one leading article", () => {
    expect(normalizeTitle("The Witch")).toBe("witch");
    expect(normalizeTitle("A Quiet Place")).toBe("quiet place");
    expect(normalizeTitle("The The Movie")).toBe("the movie");
  });
  it("removes apostrophes, maps & and other punctuation", () => {
    expect(normalizeTitle("You\u2019ve Got Mail")).toBe("youve got mail");
    expect(normalizeTitle("Hello & Paris")).toBe("hello and paris");
    expect(normalizeTitle("When Harry Met Sally...")).toBe("when harry met sally");
    expect(normalizeTitle("I, Robot")).toBe("i robot");
    expect(normalizeTitle("Mad Max: Fury Road")).toBe("mad max fury road");
  });
  it("folds accents to ASCII and collapses spaces", () => {
    expect(normalizeTitle("  Am\u00e9lie   ")).toBe("amelie");
    expect(normalizeTitle("Pok\u00e9mon\u00a0 Detective")).toBe("pokemon detective");
  });
});

describe("directorNamedIn", () => {
  it("matches full name or surname", () => {
    expect(directorNamedIn("directed by Mara Quill and Theo Quill", "Quill")).toBe(true);
    expect(directorNamedIn("is Ned Farrow\u2019s debut", "Ned Farrow")).toBe(true);
    expect(directorNamedIn("directed by Sid Moreau", "Remy Stone")).toBe(false);
  });
});

describe("pickMatch", () => {
  const rec = (name: string, year: number, desc = "", extra: Partial<QlooEntity> = {}): QlooEntity => ({ name, entity_id: `${name}-${year}`, properties: { release_year: String(year), description: desc }, popularity: 0.5, tags: [{ tag_id: "t" }], ...extra });
  it("prefers exact year, falls back to within 1", () => {
    expect(pickMatch({ title: "The Witch", year: 2015 }, [rec("The Witch", 2016), rec("The Witch", 2015)]).entityId).toBe("The Witch-2015");
    expect(pickMatch({ title: "The Witch", year: 2015 }, [rec("The Witch", 2016)]).yearRule).toBe("within1");
    expect(pickMatch({ title: "The Witch", year: 2015 }, [rec("The Witch", 2018)]).badge).toBe("Unmatched");
  });
  it("requires the director to be named when given", () => {
    const rs = [rec("Little Women", 2019, "directed by someone else"), { ...rec("Little Women", 2019, "by Greta Gerwig"), entity_id: "lw-gerwig" }];
    expect(pickMatch({ title: "Little Women", year: 2019, director: "Greta Gerwig" }, rs).entityId).toBe("lw-gerwig");
    expect(pickMatch({ title: "Little Women", year: 2019, director: "Nobody Here" }, rs).badge).toBe("Unmatched");
  });
  it("warns on records with no popularity and no tags", () => {
    const m = pickMatch({ title: "Tiny Film" }, [rec("Tiny Film", 2020, "", { popularity: undefined, tags: [] })]);
    expect(m.badge).toBe("Matched");
    expect(m.warning).toMatch(/Thin record/);
  });
});

import { directorCredit } from "@/lib/match";
describe("director credit (invented records)", () => {
  const rec = (description: string) => ({ name: "Gamma", entity_id: "g", properties: { release_year: "2018", description }, popularity: 0.5, tags: [{ tag_id: "t", name: "T" }] });
  it("shows the record's full credit exactly as written", () => {
    expect(directorCredit(rec("Gamma (2018), directed by Ann Roe and Bo Roe and starring X, is a film."))).toBe("Ann Roe and Bo Roe");
    expect(pickMatch({ title: "Gamma", year: 2018, director: "Roe" }, [rec("Gamma (2018), directed by Ann Roe and Bo Roe and starring X.")])).toMatchObject({ directorInRecord: "Ann Roe and Bo Roe" });
  });
  it("without a full credit, keeps what the record names and shows the deck's director beside it", () => {
    expect(pickMatch({ title: "Gamma", year: 2018, director: "Ann Roe" }, [rec("A Roe picture.")])).toMatchObject({ directorInRecord: "Roe", directorFromDeck: "Ann Roe" });
    expect(pickMatch({ title: "Gamma", year: 2018 }, [rec("A Roe picture.")]).directorFromDeck).toBeUndefined();
  });
});

describe("director credit: names end where Qloo's text moves on", () => {
  const r = (d: string) => directorCredit({ entity_id: "x", name: "x", properties: { description: d } } as never);
  it("cuts credits at the end of the names (synthetic descriptions in the shapes Qloo's text takes)", () => {
    expect(r("Paper Lanterns (2002), directed by Rowan Vale and based on a short story by Ida Penn, is a thriller")).toBe("Rowan Vale");
    expect(r("Hollow Pines (2018), directed by Mara Quill and Theo Quill and starring Lena Dorn, Pia Sol")).toBe("Mara Quill and Theo Quill");
    expect(r("Glass Orchard (1982), directed by Ned Farrow and starring Oli Brant, Cass Wynn and Jo Hale, is")).toBe("Ned Farrow");
    expect(r("Static Bloom (2015) is a drama\u2013science fiction thriller written and directed by Ivo Marsh and starring Tess Lark")).toBe("Ivo Marsh");
    expect(r("Low Tide (2013), directed by Bram Okafor and starring Uma Reyes, Dex Ward")).toBe("Bram Okafor");
    expect(r("Copper Hill (2017), directed by Ava Lynn Torres and starring Rex Pole")).toBe("Ava Lynn Torres");
    expect(r("Kettle (2019), directed by Sid Moreau and starring Fay Noon with Gil Hart")).toBe("Sid Moreau");
    expect(r("North Yard (2017), written and directed by Remy Stone and starring Kit Vance")).toBe("Remy Stone");
  });
  it("other ends: comma, semicolon, period, written, lowercase verb", () => {
    expect(r("Z (1966), directed by Dario Benn, is an Italian Gothic horror")).toBe("Dario Benn");
    expect(r("Z, directed by Ann Roe; a drama")).toBe("Ann Roe");
    expect(r("Z was directed by Ann Roe.")).toBe("Ann Roe");
    expect(r("Z, directed by Min Jae Park and written in part by Lou Garr, is")).toBe("Min Jae Park");
    expect(r("Z, directed by Ann Roe is a film")).toBe("Ann Roe");
    expect(r("Z, directed by K.T. Moss and starring X")).toBe("K.T. Moss");
    expect(r("Z, directed by Ana del Rio and starring X")).toBe("Ana del Rio");
  });
  it("unsure gives no director rather than a guess", () => {
    expect(r("Z, directed by the Quill brothers, is")).toBeUndefined(); // no capitalized name right after
    expect(r("Z (2001) is a drama starring Ann Roe")).toBeUndefined();
    expect(r("Z, directed by Ann Roe Bo Lee Cy Doe Di Ek Fo Gu and starring")).toBeUndefined(); // too many words for a name
    expect(r("Z, directed by Ann Roe Starring Bo Lee")).toBeUndefined(); // no clear end
  });
});
