import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Autonomous Weekly Skill Curator Lifecycle & Jaccard Consolidation (Task 14.2, ADR-063, FR-003).
 *
 * Rules:
 * 1. Operates exclusively on `origin === 'agent-created'` and `pinned === false` skills.
 * 2. `user-created` skills are never auto-patched; `pinned: true` skills are never archived.
 * 3. Lifecycle transitions:
 *    - active -> stale (>= 14 days unused)
 *    - stale (or active) -> archived (>= 30 days unused, moved to .agents/skills/.archive/<name>/SKILL.md)
 *    - archived -> pending_deletion (>= 90 days archived)
 *    - pending_deletion -> deleted (requires explicit operatorApprovedDeletionIds approval)
 * 4. When consolidate === true, pre-filters overlapping agent-created skills using Jaccard token
 *    similarity >= 0.50 across `description` and `When to Use` sections and writes a unified
 *    markdown consolidation diff proposal to `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md`.
 */

export interface SkillCuratorRunOptions {
  skillsRootDir: string;
  now?: Date;
  consolidate?: boolean;
  operatorApprovedDeletionIds?: string[];
}

export interface ParsedSkillFile {
  name: string;
  description: string;
  version: string;
  origin: 'agent-created' | 'user-created';
  pinned: boolean;
  status: 'active' | 'stale' | 'archived' | 'pending_deletion' | 'deleted';
  lastUsedAt: string;
  archivedAt: string | null;
  whenToUseText: string;
  filePath: string;
  rawContent: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Computes word-token Jaccard similarity between two skill texts (`description` + `When to Use`).
 */
export function computeSkillJaccardSimilarity(textA: string, textB: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s-]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    );

  const setA = tokenize(textA);
  const setB = tokenize(textB);

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : Number((intersection / union).toFixed(4));
}

function parseSkillMarkdown(rawContent: string, filePath: string): ParsedSkillFile {
  const extractField = (key: string, fallback: string): string => {
    const match = new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm').exec(rawContent);
    return match ? match[1].trim() : fallback;
  };

  const name = extractField('name', path.basename(path.dirname(filePath)));
  const description = extractField('description', '');
  const version = extractField('version', '0.1.0');
  const originRaw = extractField('origin', 'agent-created');
  const origin = originRaw === 'user-created' ? 'user-created' : 'agent-created';
  const pinnedRaw = extractField('pinned', 'false');
  const pinned = pinnedRaw.toLowerCase() === 'true';
  const statusRaw = extractField('status', 'active') as ParsedSkillFile['status'];
  const lastUsedAt = extractField('lastUsedAt', new Date().toISOString());
  const archivedAtRaw = extractField('archivedAt', '');
  const archivedAt = archivedAtRaw ? archivedAtRaw : null;

  const whenMatch = /^##\s+When to Use\s*\n([\s\S]*?)(?=^##\s+|$(?![\s\S]))/m.exec(rawContent);
  const whenToUseText = whenMatch ? whenMatch[1].trim() : '';

  return {
    name,
    description,
    version,
    origin,
    pinned,
    status: statusRaw,
    lastUsedAt,
    archivedAt,
    whenToUseText,
    filePath,
    rawContent,
  };
}

function updateFrontmatterField(rawContent: string, key: string, value: string): string {
  const regex = new RegExp(`^(${key}:\\s*).*$`, 'm');
  if (regex.test(rawContent)) {
    return rawContent.replace(regex, `$1"${value}"`);
  }
  return rawContent.replace(/^---\s*\n/, `---\n${key}: "${value}"\n`);
}

async function collectSkillFiles(dir: string): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      const candidate = path.join(dir, entry.name, 'SKILL.md');
      try {
        await fs.access(candidate);
        paths.push(candidate);
      } catch {
        // Not a skill directory
      }
    }
  }
  return paths;
}

/**
 * Executes the autonomous weekly skill curator pass (Task 14.2, ADR-063, FR-003).
 */
export async function runWeeklySkillCurator(
  options: SkillCuratorRunOptions
): Promise<{
  transitionedToStale: string[];
  transitionedToArchived: string[];
  markedPendingDeletion: string[];
  permanentlyDeleted: string[];
  skippedProtected: string[];
  consolidationProposalPath: string | null;
  overlappingPairs: Array<{ skillA: string; skillB: string; jaccardSimilarity: number }>;
}> {
  const now = options.now ?? new Date();
  const approvedDeletions = new Set(options.operatorApprovedDeletionIds ?? []);
  const archiveBaseDir = path.join(options.skillsRootDir, '.archive');
  const proposalsBaseDir = path.join(options.skillsRootDir, '.proposals');

  const transitionedToStale: string[] = [];
  const transitionedToArchived: string[] = [];
  const markedPendingDeletion: string[] = [];
  const permanentlyDeleted: string[] = [];
  const skippedProtected: string[] = [];
  const consolidationCandidates: ParsedSkillFile[] = [];

  // 1. Scan active/stale skills in skillsRootDir
  const rootSkillPaths = await collectSkillFiles(options.skillsRootDir);
  for (const filePath of rootSkillPaths) {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseSkillMarkdown(raw, filePath);

    // Sovereignty guard: never auto-patch user-created or archive pinned skills
    if (parsed.origin === 'user-created' || parsed.pinned) {
      skippedProtected.push(parsed.name);
      continue;
    }

    const lastUsedMs = Date.parse(parsed.lastUsedAt);
    const unusedDays = Number.isNaN(lastUsedMs)
      ? 0
      : (now.getTime() - lastUsedMs) / MS_PER_DAY;

    if (unusedDays >= 30) {
      // Transition to archived and relocate to .agents/skills/.archive/<name>/SKILL.md
      const updated = updateFrontmatterField(
        updateFrontmatterField(raw, 'status', 'archived'),
        'archivedAt',
        now.toISOString()
      );
      const targetArchiveDir = path.join(archiveBaseDir, parsed.name);
      await fs.mkdir(targetArchiveDir, { recursive: true });
      const targetArchivePath = path.join(targetArchiveDir, 'SKILL.md');
      await fs.writeFile(targetArchivePath, updated, 'utf8');
      await fs.rm(path.dirname(filePath), { recursive: true, force: true });
      transitionedToArchived.push(parsed.name);
    } else if (unusedDays >= 14 && parsed.status === 'active') {
      const updated = updateFrontmatterField(raw, 'status', 'stale');
      await fs.writeFile(filePath, updated, 'utf8');
      transitionedToStale.push(parsed.name);
      consolidationCandidates.push({ ...parsed, status: 'stale', rawContent: updated });
    } else {
      consolidationCandidates.push(parsed);
    }
  }

  // 2. Scan archived skills in .agents/skills/.archive/ for >= 90 days archival
  const archivedSkillPaths = await collectSkillFiles(archiveBaseDir);
  for (const archivePath of archivedSkillPaths) {
    const raw = await fs.readFile(archivePath, 'utf8');
    const parsed = parseSkillMarkdown(raw, archivePath);

    if (parsed.origin === 'user-created' || parsed.pinned) {
      skippedProtected.push(parsed.name);
      continue;
    }

    const refTimestamp = parsed.archivedAt ?? parsed.lastUsedAt;
    const archivedMs = Date.parse(refTimestamp);
    const archivedDays = Number.isNaN(archivedMs)
      ? 0
      : (now.getTime() - archivedMs) / MS_PER_DAY;

    if (archivedDays >= 90 || parsed.status === 'pending_deletion') {
      if (approvedDeletions.has(parsed.name)) {
        await fs.rm(path.dirname(archivePath), { recursive: true, force: true });
        permanentlyDeleted.push(parsed.name);
      } else {
        const updated = updateFrontmatterField(raw, 'status', 'pending_deletion');
        await fs.writeFile(archivePath, updated, 'utf8');
        markedPendingDeletion.push(parsed.name);
      }
    }
  }

  // 3. Opt-in Consolidation Pass (curator.consolidate = true)
  let consolidationProposalPath: string | null = null;
  const overlappingPairs: Array<{ skillA: string; skillB: string; jaccardSimilarity: number }> = [];

  if (options.consolidate && consolidationCandidates.length >= 2) {
    for (let i = 0; i < consolidationCandidates.length; i++) {
      for (let j = i + 1; j < consolidationCandidates.length; j++) {
        const a = consolidationCandidates[i];
        const b = consolidationCandidates[j];
        const textA = `${a.description} ${a.whenToUseText}`;
        const textB = `${b.description} ${b.whenToUseText}`;
        const similarity = computeSkillJaccardSimilarity(textA, textB);
        if (similarity >= 0.5) {
          overlappingPairs.push({
            skillA: a.name,
            skillB: b.name,
            jaccardSimilarity: similarity,
          });
        }
      }
    }

    if (overlappingPairs.length > 0) {
      await fs.mkdir(proposalsBaseDir, { recursive: true });
      const dateStr = now.toISOString().slice(0, 10);
      consolidationProposalPath = path.join(
        proposalsBaseDir,
        `consolidation-${dateStr}.diff.md`
      );

      const diffLines = [
        `# Skill Consolidation Proposal (${dateStr})`,
        '',
        '> **Human Gate Required (`lead_dev`)**: Review the proposed merges below before applying.',
        '',
        ...overlappingPairs.map(
          (pair) =>
            `## Merge Candidate: \`${pair.skillA}\` + \`${pair.skillB}\` (Jaccard Similarity: ${pair.jaccardSimilarity})\n\n\`\`\`diff\n- .agents/skills/${pair.skillB}/SKILL.md\n+ .agents/skills/${pair.skillA}/SKILL.md (consolidated procedure & pitfalls)\n\`\`\``
        ),
        '',
      ];
      await fs.writeFile(consolidationProposalPath, diffLines.join('\n'), 'utf8');
    }
  }

  return {
    transitionedToStale,
    transitionedToArchived,
    markedPendingDeletion,
    permanentlyDeleted,
    skippedProtected,
    consolidationProposalPath,
    overlappingPairs,
  };
}
