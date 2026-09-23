import type { PolicyMatch } from "./retrievePolicies.js";

export interface PolicyVersionConflict {
  document_id: string;
  section_number: number;
  versions: string[];
  matches: PolicyMatch[];
}

export function findPolicyVersionConflicts(
  matches: PolicyMatch[],
): PolicyVersionConflict[] {
  const groups = new Map<string, PolicyMatch[]>();

  for (const match of matches) {
    const key = `${match.document_id}:${match.section_number}`;
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }

  const conflicts: PolicyVersionConflict[] = [];

  for (const group of groups.values()) {
    const versions = [...new Set(group.map((match) => match.document_version))];

    if (versions.length <= 1) continue;

    conflicts.push({
      document_id: group[0]!.document_id,
      section_number: group[0]!.section_number,
      versions,
      matches: group,
    });
  }

  return conflicts;
}
