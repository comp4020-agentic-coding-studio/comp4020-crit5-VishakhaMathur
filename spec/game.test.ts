import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Contract tests for crits/05-game (see the course website for the full
// spec). Lines only a person can judge at the crit — whether a stranger
// reaches an ending inside five minutes, whether the opening screen's
// affordance is actually obvious — aren't testable here and aren't attempted.

const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const shipped = files();
const htmlFiles = shipped.filter((path) => path.endsWith(".html"));

describe("game: teaches itself, no instructions anywhere", () => {
  it("has no how-to-play language on any shipped page", () => {
    const instructionLanguage =
      /how to play|instructions|tutorial|read the rules|click here to begin/i;
    for (const path of htmlFiles) {
      const doc = new JSDOM(readFileSync(path, "utf8")).window.document;
      expect(
        doc.body.textContent ?? "",
        `${path} contains instruction-like text — the brief asks the opening screen to teach by playing, not by explaining`,
      ).not.toMatch(instructionLanguage);
    }
  });

  it("ships no dedicated instructions/help page", () => {
    const instructionPageName = /instructions|tutorial|help|how-?to-?play/i;
    for (const path of htmlFiles) {
      expect(
        path,
        `${path} looks like a dedicated instructions page — the brief asks for none`,
      ).not.toMatch(instructionPageName);
    }
  });
});

describe("game: it can be lost", () => {
  // The brief: "a wrong move is possible, and play ends somewhere — a win, a
  // loss or a finish." This is the one focused rule the spec asks for. Fill
  // it in once the mechanic exists: trigger the losing (or winning/finishing)
  // input or state directly and assert the DOM/game state reflects an ending.
  it.todo("a losing (or winning/finishing) move ends the round");
});
