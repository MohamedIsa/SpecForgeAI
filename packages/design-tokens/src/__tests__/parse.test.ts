import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { readFileSync } from "fs";
import { join } from "path";

const DESIGN_PATH = join(import.meta.dirname, "..", "..", "..", "..", "design", "DESIGN.md");
const TOKENS_TS_PATH = join(import.meta.dirname, "..", "tokens.ts");

interface TypographyStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing?: string;
}

interface TokenData {
  colors: Record<string, string>;
  typography: Record<string, TypographyStyle>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
}

function parseDesignTokens(raw: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);

  if (match == null || match[1] === undefined) {
    throw new Error("DESIGN.md must contain YAML frontmatter.");
  }

  return parseYaml(match[1]) as Record<string, unknown>;
}

describe("token parsing", () => {
  const raw = readFileSync(DESIGN_PATH, "utf-8");
  const tokens = parseDesignTokens(raw);

  it("parses colors section", () => {
    const colors = tokens["colors"] as Record<string, string>;
    expect(colors).toBeDefined();
    expect(colors["primary"]).toBe("#d4bbff");
    expect(colors["surface"]).toBe("#15121b");
    expect(colors["background"]).toBe("#15121b");
  });

  it("parses typography section", () => {
    const typography = tokens["typography"] as Record<string, Record<string, string>>;
    expect(typography).toBeDefined();
    expect(typography["display"]).toBeDefined();
    expect(typography["display"]?.["fontFamily"]).toBe("Outfit");
    expect(typography["label-md"]?.["fontFamily"]).toBe("JetBrains Mono");
  });

  it("parses rounded section", () => {
    const rounded = tokens["rounded"] as Record<string, string>;
    expect(rounded).toBeDefined();
    expect(rounded["sm"]).toBe("0.25rem");
    expect(rounded["full"]).toBe("9999px");
  });

  it("parses spacing section", () => {
    const spacing = tokens["spacing"] as Record<string, string>;
    expect(spacing).toBeDefined();
    expect(spacing["unit"]).toBe("4px");
    expect(spacing["sidebar-width"]).toBe("260px");
  });

  it("has required color tokens for dark theme", () => {
    const colors = tokens["colors"] as Record<string, string>;
    expect(colors["primary"]).toBeTruthy();
    expect(colors["on-primary"]).toBeTruthy();
    expect(colors["surface"]).toBeTruthy();
    expect(colors["background"]).toBeTruthy();
    expect(colors["error"]).toBeTruthy();
  });

  it("has font definitions for both Outfit and JetBrains Mono", () => {
    const typography = tokens["typography"] as Record<string, Record<string, string>>;
    const families = new Set(
      Object.values(typography).map((s) => s["fontFamily"]),
    );

    expect(families.has("Outfit")).toBe(true);
    expect(families.has("JetBrains Mono")).toBe(true);
  });
});

describe("generated tokens", () => {
  it("normalizes negative letterSpacing to 0 in generated output", async () => {
    const mod = (await import(TOKENS_TS_PATH)) as {
      typography: Record<string, TypographyStyle>;
    };

    for (const [, style] of Object.entries(mod.typography)) {
      if (style.letterSpacing !== undefined) {
        const value = parseFloat(style.letterSpacing);

        if (!Number.isNaN(value)) {
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("exports all four token categories", async () => {
    const mod = (await import(TOKENS_TS_PATH)) as TokenData;
    expect(Object.keys(mod.colors).length).toBeGreaterThan(0);
    expect(Object.keys(mod.typography).length).toBeGreaterThan(0);
    expect(Object.keys(mod.rounded).length).toBeGreaterThan(0);
    expect(Object.keys(mod.spacing).length).toBeGreaterThan(0);
  });
});
