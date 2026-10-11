import { describe, expect, it } from "vitest";
import golden from "./__fixtures__/pyyaml.json";
import { dumpYaml, loadYaml, YamlDate, type YamlValue } from "./pyyaml";

const revive = (v: unknown): YamlValue => {
  if (v && typeof v === "object" && "__date__" in v)
    return new YamlDate((v as { __date__: string }).__date__);
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, revive(x)]),
    );
  return v as YamlValue;
};

describe("YAML as PyYAML's safe_dump writes it", () => {
  it.each(
    golden.map((g, i) => [i, g.input, g.yaml]),
  )("case %i", (_, input, yaml) => {
    expect(dumpYaml(revive(input) as { [key: string]: YamlValue })).toBe(yaml);
  });

  it("reads dates back as dates, so they're written back the same", () => {
    expect(dumpYaml(loadYaml("created: 2026-10-11\nname: x\n"))).toBe(
      "created: 2026-10-11\nname: x\n",
    );
  });
});

import { fixed } from "./model";
describe("numbers as Python formats them", () => {
  it("rounds an exact half to even, like f'{x:.1f}'", () => {
    expect(fixed(29.25, 1)).toBe("29.2");
    expect(fixed(29.35, 1)).toBe((29.35).toFixed(1));
    expect(fixed(0.125, 2)).toBe("0.12");
    expect(fixed(2.5, 0)).toBe("2");
    expect(fixed(3.5, 0)).toBe("4");
    expect(fixed(-29.25, 1)).toBe("-29.2");
    expect(fixed(1.05, 1)).toBe((1.05).toFixed(1));
  });
});
