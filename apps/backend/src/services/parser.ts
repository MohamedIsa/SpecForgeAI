import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

function detectFormat(fileName: string): string {
  const lower = fileName.toLowerCase();

  for (const [ext, format] of Object.entries(EXTENSION_TO_MIME)) {
    if (lower.endsWith(ext)) {
      return format;
    }
  }

  return "unknown";
}

async function extractPdfContent(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();

  return result.text.trim();
}

async function extractDocxContent(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });

  return result.value.trim();
}

function extractPlainText(buffer: Buffer): string {
  return buffer.toString("utf-8").trim();
}

/**
 * Extracts readable text content from a document buffer.
 *
 * Supported formats: PDF (.pdf), DOCX (.docx), Markdown (.md), Plain Text (.txt).
 *
 * @param buffer - The raw file buffer.
 * @param fileName - The original file name used to detect the format.
 * @returns The extracted text content.
 */
export async function extractText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const format = detectFormat(fileName);

  switch (format) {
    case "application/pdf":
      return extractPdfContent(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
      return extractDocxContent(buffer);
    case "text/markdown":
    case "text/plain":
      return extractPlainText(buffer);
    default:
      throw new Error(
        `Unsupported file format: "${fileName}". Supported: .pdf, .docx, .md, .txt`,
      );
  }
}
