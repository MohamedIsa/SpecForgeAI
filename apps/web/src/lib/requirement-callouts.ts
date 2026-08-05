export interface DocumentSegment {
  id: string;
  text: string;
  /** Requirement lines get the amber callout treatment in the BRD viewer. */
  isRequirement: boolean;
}

/**
 * Requirement phrasing per RFC 2119-style specification language. A line
 * containing one of these is treated as a requirement worth calling out.
 */
const REQUIREMENT_PATTERN =
  /\b(must|shall|should|required|requirement|needs? to|has to)\b/i;

/**
 * Splits raw document text into displayable segments, flagging the lines that
 * read as requirements so the viewer can highlight them.
 */
export function segmentDocumentText(pageText: string): DocumentSegment[] {
  return pageText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => ({
      id: `segment-${index}`,
      text: line,
      isRequirement: REQUIREMENT_PATTERN.test(line),
    }));
}

export function countRequirements(segments: DocumentSegment[]): number {
  return segments.filter((segment) => segment.isRequirement).length;
}
