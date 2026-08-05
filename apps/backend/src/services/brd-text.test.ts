import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { extractBrdText, BrdTextExtractionError } from "./brd-text";

let workDir: string;

/** A minimal but genuinely valid single-page PDF containing known text. */
function buildPdf(bodyText: string): Buffer {
  const content = `BT /F1 18 Tf 20 100 Td (${bodyText}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${content.length}>>stream
${content}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`;
  return Buffer.from(pdf, "latin1");
}

/**
 * A minimal valid .docx (a ZIP holding the OOXML parts mammoth needs).
 * Built with stored (uncompressed) entries so no zip library is required.
 */
function buildDocx(paragraphText: string): Buffer {
  const files: Array<{ name: string; content: string }> = [
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ];

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const dataBuf = Buffer.from(file.content, "utf8");
    const checksum = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), "specforge-brd-text-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeFixture(name: string, content: Buffer | string): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, content);
  return filePath;
}

describe("extractBrdText — markdown", () => {
  it("reads markdown as a single page", async () => {
    const filePath = await writeFixture("spec.md", "# Requirements\n\nUsers must log in.");
    const result = await extractBrdText(filePath, "md");

    expect(result.text).toContain("Users must log in.");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.pageNumber).toBe(1);
  });

  it("preserves unicode content", async () => {
    const filePath = await writeFixture("unicode.md", "# 要件定義\n\nログインが必要です。");
    const result = await extractBrdText(filePath, "md");
    expect(result.text).toContain("ログインが必要です。");
  });

  it("handles an empty markdown file without throwing", async () => {
    const filePath = await writeFixture("empty.md", "");
    const result = await extractBrdText(filePath, "md");
    expect(result.text).toBe("");
    expect(result.pages).toHaveLength(1);
  });

  it("throws BrdTextExtractionError when the file is missing", async () => {
    await expect(
      extractBrdText(path.join(workDir, "does-not-exist.md"), "md"),
    ).rejects.toBeInstanceOf(BrdTextExtractionError);
  });
});

describe("extractBrdText — pdf", () => {
  it("extracts text and per-page structure from a real PDF", async () => {
    const filePath = await writeFixture("spec.pdf", buildPdf("Hello BRD"));
    const result = await extractBrdText(filePath, "pdf");

    expect(result.text).toContain("Hello BRD");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.pageNumber).toBe(1);
  });

  it("omits the library's page separator markers from the joined text", async () => {
    const filePath = await writeFixture("clean.pdf", buildPdf("Payload Only"));
    const result = await extractBrdText(filePath, "pdf");
    // pdf-parse's own `text` interleaves "-- 1 of 1 --" separators; ours must not.
    expect(result.text).not.toContain("-- 1 of 1 --");
  });

  it("throws BrdTextExtractionError for a corrupt PDF", async () => {
    const filePath = await writeFixture("corrupt.pdf", "this is definitely not a pdf");
    await expect(extractBrdText(filePath, "pdf")).rejects.toBeInstanceOf(BrdTextExtractionError);
  });

  it("throws BrdTextExtractionError when the PDF is missing", async () => {
    await expect(
      extractBrdText(path.join(workDir, "nope.pdf"), "pdf"),
    ).rejects.toBeInstanceOf(BrdTextExtractionError);
  });
});

describe("extractBrdText — docx", () => {
  it("extracts text from a real docx package", async () => {
    const filePath = await writeFixture("spec.docx", buildDocx("Business requirements here"));
    const result = await extractBrdText(filePath, "docx");

    expect(result.text).toContain("Business requirements here");
    expect(result.pages).toHaveLength(1);
  });

  it("throws BrdTextExtractionError for a corrupt docx", async () => {
    const filePath = await writeFixture("corrupt.docx", "not a zip archive");
    await expect(extractBrdText(filePath, "docx")).rejects.toBeInstanceOf(
      BrdTextExtractionError,
    );
  });

  it("throws BrdTextExtractionError when the docx is missing", async () => {
    await expect(
      extractBrdText(path.join(workDir, "nope.docx"), "docx"),
    ).rejects.toBeInstanceOf(BrdTextExtractionError);
  });
});
