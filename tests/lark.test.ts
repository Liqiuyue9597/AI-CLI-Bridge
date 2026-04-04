import { describe, it, expect } from "vitest";
import { buildCard } from "../src/lark.js";

describe("buildCard", () => {
  it("streaming card has blue template and '思考中...' title", () => {
    const card = JSON.parse(buildCard("hello", true));
    expect(card.header.template).toBe("blue");
    expect(card.header.title.content).toBe("Claude 思考中...");
  });

  it("final card has green template and 'Claude' title", () => {
    const card = JSON.parse(buildCard("hello", false));
    expect(card.header.template).toBe("green");
    expect(card.header.title.content).toBe("Claude");
  });

  it("text appears in markdown element", () => {
    const card = JSON.parse(buildCard("test content", false));
    expect(card.elements[0].tag).toBe("markdown");
    expect(card.elements[0].content).toBe("test content");
  });

  it("empty text produces space in content", () => {
    const card = JSON.parse(buildCard("", true));
    expect(card.elements[0].content).toBe(" ");
  });

  it("output is valid JSON", () => {
    expect(() => JSON.parse(buildCard("hello", true))).not.toThrow();
    expect(() => JSON.parse(buildCard("", false))).not.toThrow();
  });
});
