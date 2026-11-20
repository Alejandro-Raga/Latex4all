import { describe, expect, it } from "vitest";
import { cloudPlace } from "./cloud-place";

describe("a project's place in a cloud folder", () => {
  it("is the same on a Mac and on Windows", () => {
    const mac = cloudPlace("/Users/me/Seafile/Doctorado/Thesis/Paper");
    const pc = cloudPlace("D:\\Seafile\\Doctorado\\Thesis\\Paper");
    expect(mac).toBe("seafile:Doctorado/Thesis/Paper");
    expect(pc).toBe(mac);
  });
  it("names accents one way", () => {
    expect(cloudPlace("/Users/me/Dropbox/Presentacio\u0301n")).toBe(
      cloudPlace("C:\\Users\\me\\Dropbox\\Presentaci\u00f3n"),
    );
  });
  it("knows other cloud apps by their folder", () => {
    expect(cloudPlace("C:\\Users\\me\\OneDrive - Uni\\Papers\\X")).toBe(
      "onedrive:Papers/X",
    );
  });
  it("is nothing outside a cloud folder, or for the cloud folder itself", () => {
    expect(cloudPlace("/Users/me/Documents/Latex4All/Paper")).toBeNull();
    expect(cloudPlace("/Users/me/Seafile")).toBeNull();
  });
});
