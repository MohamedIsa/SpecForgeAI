import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { BrdExtension } from "../lib/brd-constants";

/**
 * Extracts readable text from a stored BRD so the AI layer has something to
 * analyse. Files are kept on disk as uploaded (EPIC-3-T1), so extraction
 * happens on read rather than at upload time.
 */

/** The document could not be read or parsed into text. */
export class BrdTextExtractionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BrdTextExtractionError";
  }
}

export interface BrdPage {
  pageNumber: number;
  text: string;
}

export interface BrdDocumentText {
  /** Full document text, pages joined in order. */
  text: string;
  /** Per-page text. Non-paginated formats yield a single page. */
  pages: BrdPage[];
}

function toSinglePage(text: string): BrdDocumentText {
  return { text, pages: [{ pageNumber: 1, text }] };
}

async function extractPdf(filePath: string): Promise<BrdDocumentText> {
  // `readFile` is inside the try so a missing/unreadable file surfaces as a
  // BrdTextExtractionError like every other failure here, rather than leaking
  // a raw ENOENT to the caller.
  let parser: PDFParse | null = null;
  try {
    const buffer = await readFile(filePath);
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const pages: BrdPage[] = result.pages.map((page) => ({
      pageNumber: page.num,
      text: page.text,
    }));
    // `result.text` interleaves "-- n of m --" page separators, so the joined
    // per-page text is what actually gets sent to the model.
    return { text: pages.map((page) => page.text).join("\n\n"), pages };
  } catch (error) {
    throw new BrdTextExtractionError("Could not read text from this PDF", { cause: error });
  } finally {
    await parser?.destroy();
  }
}

async function extractDocx(filePath: string): Promise<BrdDocumentText> {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return toSinglePage(result.value);
  } catch (error) {
    throw new BrdTextExtractionError("Could not read text from this DOCX file", {
      cause: error,
    });
  }
}

async function extractMarkdown(filePath: string): Promise<BrdDocumentText> {
  try {
    return toSinglePage(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new BrdTextExtractionError("Could not read this Markdown file", { cause: error });
  }
}

export async function extractBrdText(
  filePath: string,
  extension: BrdExtension,
): Promise<BrdDocumentText> {
  switch (extension) {
    case "pdf":
      return extractPdf(filePath);
    case "docx":
      return extractDocx(filePath);
    case "md":
      return extractMarkdown(filePath);
  }
}
