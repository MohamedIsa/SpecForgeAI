import { describe, it, expect } from "vitest";
import { deflateRawSync } from "zlib";

import { extractText } from "../parser";

function buildPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, "");
  const streamContent = `BT /F1 24 Tf 100 700 Td (${safe}) Tj ET`;

  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj`,
    `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
  ];

  const bodyParts = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  let pos = bodyParts[0]!.length;

  for (const obj of objects) {
    offsets.push(pos);
    const block = obj + "\n";

    bodyParts.push(block);
    pos += block.length;
  }

  const body = bodyParts.join("");
  const totalObjects = objects.length;

  let xrefTable = "xref\n0 " + (totalObjects + 1) + "\n0000000000 65535 f \n";

  for (const offset of offsets) {
    xrefTable += String(offset).padStart(10, "0") + " 00000 n \n";
  }

  const trailer =
    "trailer\n<< /Size " +
    (totalObjects + 1) +
    " /Root 1 0 R >>\nstartxref\n" +
    body.length +
    "\n%%EOF";

  return Buffer.from(body + xrefTable + trailer, "ascii");
}

function buildDocx(text: string): Buffer {
  const contentTypes = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    "utf-8",
  );

  const rels = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    "utf-8",
  );

  const docXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${text}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`,
    "utf-8",
  );

  const files: Array<{ name: string; content: Buffer }> = [
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rels },
    { name: "word/document.xml", content: docXml },
  ];

  const chunks: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "ascii");
    const compressed = deflateRawSync(file.content);
    const crc = crc32(file.content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBuf, compressed);

    const cdEntry = Buffer.alloc(46);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(20, 4);
    cdEntry.writeUInt16LE(20, 6);
    cdEntry.writeUInt16LE(0x0800, 8);
    cdEntry.writeUInt16LE(8, 10);
    cdEntry.writeUInt32LE(0, 12);
    cdEntry.writeUInt32LE(crc, 16);
    cdEntry.writeUInt32LE(compressed.length, 20);
    cdEntry.writeUInt32LE(file.content.length, 24);
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30);
    cdEntry.writeUInt16LE(0, 32);
    cdEntry.writeUInt32LE(0, 34);
    cdEntry.writeUInt32LE(offset, 42);

    centralDir.push(cdEntry, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }

  const cdOffset = Buffer.concat(chunks).length;
  const cdData = Buffer.concat(centralDir);
  const cdSize = cdData.length;
  const entryCount = files.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdData, eocd]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]! & 0xff;

    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

describe("extractText", () => {
  describe("plain text (.txt)", () => {
    it("returns UTF-8 content trimmed", async () => {
      const text = await extractText(
        Buffer.from("  Hello World  \n", "utf-8"),
        "document.txt",
      );

      expect(text).toBe("Hello World");
    });

    it("returns empty string for empty file", async () => {
      const text = await extractText(
        Buffer.from("", "utf-8"),
        "empty.txt",
      );

      expect(text).toBe("");
    });
  });

  describe("markdown (.md)", () => {
    it("returns raw markdown text", async () => {
      const content = "# Title\n\nSome **bold** text\n";
      const text = await extractText(
        Buffer.from(content, "utf-8"),
        "readme.md",
      );

      expect(text).toBe("# Title\n\nSome **bold** text");
    });
  });

  describe("PDF (.pdf)", () => {
    it("extracts text from a minimal PDF", async () => {
      const pdf = buildPdf("Extracted PDF Text");
      const text = await extractText(pdf, "sample.pdf");

      expect(text).toContain("Extracted PDF Text");
    });
  });

  describe("DOCX (.docx)", () => {
    it("extracts text from a minimal DOCX", async () => {
      const docx = buildDocx("Extracted DOCX Text");
      const text = await extractText(docx, "sample.docx");

      expect(text).toContain("Extracted DOCX Text");
    });
  });

  describe("error handling", () => {
    it("throws for unsupported file formats", async () => {
      await expect(
        extractText(Buffer.from("data", "utf-8"), "image.png"),
      ).rejects.toThrow('Unsupported file format: "image.png"');
    });

    it("throws for files with no extension", async () => {
      await expect(
        extractText(Buffer.from("data", "utf-8"), "noextension"),
      ).rejects.toThrow(/Unsupported file format/);
    });

    it("handles corrupted PDF gracefully", async () => {
      await expect(
        extractText(Buffer.from("not a pdf", "utf-8"), "broken.pdf"),
      ).rejects.toThrow();
    });

    it("handles corrupted DOCX gracefully", async () => {
      await expect(
        extractText(Buffer.from("not a docx", "utf-8"), "broken.docx"),
      ).rejects.toThrow();
    });
  });
});
