import { describe, expect, it } from "vitest";
import {
  readVaultSettingsFile,
  vaultSettingsFile,
} from "./vault-settings-file";

describe("the vault's settings file", () => {
  it("reads back what it wrote", () => {
    const s = {
      paperTag: "vault",
      papersFolder: "Literature",
      kindFolders: { topic: "Subjects" },
    };
    expect(readVaultSettingsFile(vaultSettingsFile(s))).toEqual(s);
  });

  it("ignores what it can't read", () => {
    expect(readVaultSettingsFile("no settings here")).toBeNull();
    expect(
      readVaultSettingsFile(
        '```json\n{"paperTag": 3, "kindFolders": {"idea": 1}}\n```',
      ),
    ).toEqual({ paperTag: "", papersFolder: "", kindFolders: {} });
  });
});
