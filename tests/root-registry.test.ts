import { describe, expect, test, vi } from "vitest";
import { RootRegistry } from "../src/services/root-registry.js";
import { createRepoFixture } from "./fixtures/repo-fixture.js";

describe("RootRegistry", () => {
  test("skips missing roots without hiding valid repositories", async () => {
    const fixture = await createRepoFixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const registry = await RootRegistry.fromConfig({
      repos: [
        { repo_id: "missing", display_name: "Missing", root: `${fixture.root}/gone` },
        { repo_id: "fixture", display_name: "Fixture", root: fixture.root }
      ]
    });

    expect(registry.list()).toEqual([
      { repo_id: "fixture", display_name: "Fixture", root: fixture.root }
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipping missing repository root for missing"));
    warn.mockRestore();
  });
});
