import { describe, expect, it } from "vitest";
import { useDocumentStore } from "./document-store";
import { followProjectNav, inProject, useNav } from "./nav-store";

describe("getting around", () => {
  it("leaves the project open while elsewhere, and comes back to it", () => {
    const stop = followProjectNav();
    useDocumentStore.setState({ projectRoot: "/p/Thesis" } as never);
    expect(inProject()).toBe(true);
    useNav.getState().goHome("planner");
    expect(useNav.getState()).toMatchObject({ away: true, section: "planner" });
    expect(inProject()).toBe(false);
    // Still open behind the start page.
    expect(useDocumentStore.getState().projectRoot).toBe("/p/Thesis");
    useNav.getState().backToProject();
    expect(inProject()).toBe(true);
    // Another project opened from the start page: in it.
    useNav.getState().goHome();
    useDocumentStore.setState({ projectRoot: "/p/Paper" } as never);
    expect(useNav.getState().away).toBe(false);
    stop();
  });
});
