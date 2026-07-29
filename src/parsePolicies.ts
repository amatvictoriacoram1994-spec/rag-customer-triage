export interface PolicyMetadata {
  documentId: string;
  documentTitle: string;
  documentVersion: string;
  effectiveDate: string | null;
  documentType: string | null;
}

export interface PolicySection {
  sectionNumber: number;
  sectionTitle: string;
  content: string;
}

export interface ParsedPolicy {
  metadata: PolicyMetadata;
  sections: PolicySection[];
}

const SECTION_HEADING = /^\s*#{0,6}\s*(\d+)\.\s+(.+?)\s*#*\s*$/;
const METADATA_LINE = /^\s*([A-Za-z ]+):\s*(.+?)\s*$/;

function toIsoDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) throw new Error(`Unsupported Effective Date format: ${value}`);
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const month = months[match[2]!.toLowerCase()];
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) throw new Error(`Invalid Effective Date: ${value}`);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parsePolicy(markdown: string, sourceName = "policy"): ParsedPolicy {
  const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const firstSectionIndex = lines.findIndex((line) => SECTION_HEADING.test(line));
  if (firstSectionIndex < 0) throw new Error(`${sourceName}: no numbered sections found`);
  const headerLines = lines.slice(0, firstSectionIndex);
  const fields = new Map<string, string>();
  for (const line of headerLines) {
    const match = line.match(METADATA_LINE);
    if (match) fields.set(match[1]!.trim().toLowerCase(), match[2]!.trim());
  }
  const required = (name: string): string => {
    const value = fields.get(name.toLowerCase());
    if (!value) throw new Error(`${sourceName}: missing ${name}`);
    return value;
  };
  const title = headerLines.map((line) => line.trim().replace(/^#+\s*/, ""))
    .filter((line) => line && !METADATA_LINE.test(line) && line.toUpperCase() !== "NIVARA GOODS").at(-1);
  if (!title) throw new Error(`${sourceName}: missing document title`);

  const sections: PolicySection[] = [];
  let current: PolicySection | undefined;
  for (const line of lines.slice(firstSectionIndex)) {
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      if (current) sections.push({ ...current, content: current.content.trim() });
      current = { sectionNumber: Number(heading[1]), sectionTitle: heading[2]!.trim(), content: "" };
    } else if (current) current.content += `${line}\n`;
  }
  if (current) sections.push({ ...current, content: current.content.trim() });
  if (sections.some((section) => !section.content)) throw new Error(`${sourceName}: one or more numbered sections are empty`);
  const effectiveDate = fields.get("effective date");
  return {
    metadata: {
      documentId: required("Document ID"), documentTitle: title, documentVersion: required("Version"),
      effectiveDate: effectiveDate ? toIsoDate(effectiveDate) : null,
      documentType: fields.get("document type") ?? null,
    },
    sections,
  };
}
