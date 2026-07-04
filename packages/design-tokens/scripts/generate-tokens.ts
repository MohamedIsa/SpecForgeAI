import { parse as parseYaml } from "yaml";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const DESIGN_PATH = join(PROJECT_ROOT, "design", "DESIGN.md");
const SRC_DIR = join(import.meta.dirname, "..", "src");
const GENERATED_DIR = join(import.meta.dirname, "..", "generated");

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

function parseFrontmatter(content: string): TokenData {
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (match == null || match[1] === undefined) {
    throw new Error("DESIGN.md must contain YAML frontmatter between --- delimiters.");
  }

  const parsed = parseYaml(match[1]) as Record<string, unknown>;

  if (parsed == null || typeof parsed !== "object") {
    throw new Error("DESIGN.md frontmatter must contain a valid YAML object.");
  }

  const colors = parsed["colors"] as Record<string, string> | undefined;
  const typography = parsed["typography"] as Record<string, TypographyStyle> | undefined;
  const rounded = parsed["rounded"] as Record<string, string> | undefined;
  const spacing = parsed["spacing"] as Record<string, string> | undefined;

  return {
    colors: normalizeColorMap(colors),
    typography: normalizeTypographyMap(typography),
    rounded: normalizeStringMap(rounded),
    spacing: normalizeStringMap(spacing),
  };
}

function normalizeColorMap(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  if (raw == null) return {};

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    result[key] = String(value);
  }

  return result;
}

function normalizeTypographyMap(
  raw: Record<string, TypographyStyle> | undefined,
): Record<string, TypographyStyle> {
  if (raw == null) return {};

  const result: Record<string, TypographyStyle> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value == null || typeof value !== "object") continue;

    const letterSpacing = normalizeLetterSpacing(
      value["letterSpacing"],
    );

    result[key] = {
      fontFamily: String(value["fontFamily"] ?? ""),
      fontSize: String(value["fontSize"] ?? ""),
      fontWeight: String(value["fontWeight"] ?? "400"),
      lineHeight: String(value["lineHeight"] ?? "1.5"),
      ...(letterSpacing !== undefined ? { letterSpacing } : {}),
    };
  }

  return result;
}

function normalizeLetterSpacing(raw: unknown): string | undefined {
  if (raw == null) return undefined;

  const str = String(raw);
  const value = parseFloat(str);

  if (Number.isNaN(value)) return undefined;
  if (value < 0) return "0";

  return str;
}

function normalizeStringMap(
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  if (raw == null) return {};

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    result[key] = String(value);
  }

  return result;
}

function toKebab(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/([a-zA-Z])(\d)/g, "$1-$2");
}

function generateCSS(tokens: TokenData): string {
  const vars: string[] = [];

  for (const [key, value] of Object.entries(tokens.colors)) {
    vars.push(`  --color-${toKebab(key)}: ${value};`);
  }

  for (const [styleName, style] of Object.entries(tokens.typography)) {
    const prefix = `--font-${toKebab(styleName)}`;
    vars.push(`  ${prefix}-family: ${style.fontFamily};`);
    vars.push(`  ${prefix}-size: ${style.fontSize};`);
    vars.push(`  ${prefix}-weight: ${style.fontWeight};`);
    vars.push(`  ${prefix}-line-height: ${style.lineHeight};`);

    if (style.letterSpacing !== undefined) {
      vars.push(`  ${prefix}-letter-spacing: ${style.letterSpacing};`);
    }
  }

  for (const [key, value] of Object.entries(tokens.rounded)) {
    vars.push(`  --radius-${key === "DEFAULT" ? "default" : toKebab(key)}: ${value};`);
  }

  for (const [key, value] of Object.entries(tokens.spacing)) {
    vars.push(`  --spacing-${toKebab(key)}: ${value};`);
  }

  return `:root {\n${vars.join("\n")}\n}\n`;
}

function generateTS(tokens: TokenData): string {
  const colorEntries = Object.entries(tokens.colors)
    .map(([k, v]) => `  "${k}": "${v}"`)
    .join(",\n");

  const typographySections = Object.entries(tokens.typography).map(([name, style]) => {
    const entries = [
      `    fontFamily: "${style.fontFamily}"`,
      `    fontSize: "${style.fontSize}"`,
      `    fontWeight: "${style.fontWeight}"`,
      `    lineHeight: "${style.lineHeight}"`,
    ];

    if (style.letterSpacing !== undefined) {
      entries.push(`    letterSpacing: "${style.letterSpacing}"`);
    }

    return `  "${name}": {\n${entries.join(",\n")}\n  }`;
  }).join(",\n");

  const roundedEntries = Object.entries(tokens.rounded)
    .map(([k, v]) => `  "${k}": "${v}"`)
    .join(",\n");

  const spacingEntries = Object.entries(tokens.spacing)
    .map(([k, v]) => `  "${k}": "${v}"`)
    .join(",\n");

  return `// Auto-generated from design/DESIGN.md — do not edit manually.

export const colors = {
${colorEntries}
} as const;

export const typography = {
${typographySections}
} as const;

export const rounded = {
${roundedEntries}
} as const;

export const spacing = {
${spacingEntries}
} as const;

export type ColorKey = keyof typeof colors;
export type TypographyKey = keyof typeof typography;
export type RoundedKey = keyof typeof rounded;
export type SpacingKey = keyof typeof spacing;
`;
}

function generateJSON(tokens: TokenData): string {
  return JSON.stringify(tokens, null, 2) + "\n";
}

function main() {
  const content = readFileSync(DESIGN_PATH, "utf-8");
  const tokens = parseFrontmatter(content);

  mkdirSync(SRC_DIR, { recursive: true });
  mkdirSync(GENERATED_DIR, { recursive: true });

  writeFileSync(join(SRC_DIR, "tokens.css"), generateCSS(tokens));
  writeFileSync(join(SRC_DIR, "tokens.ts"), generateTS(tokens));
  writeFileSync(join(GENERATED_DIR, "tokens.json"), generateJSON(tokens));

  console.log("Design tokens generated: src/tokens.css, src/tokens.ts, generated/tokens.json");
}

void main();
