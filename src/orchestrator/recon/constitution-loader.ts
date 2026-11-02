import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Phase 5a — Convention Cascade Loader (ADR-038).
 * Deterministic merge of project instruction files in strict precedence
 * order: AGENTS.md > CLAUDE.md > .cursorrules > .windsurfrules.
 */

export interface LoadedConventions {
  /** Ordered by ADR-038 precedence. */
  sourcesFound: string[];
  mergedRulesMarkdown: string;
}

const CONVENTION_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules'] as const;

export async function loadProjectConventions(repoRoot: string): Promise<LoadedConventions> {
  const sourcesFound: string[] = [];
  const sections: string[] = [];

  for (const fileName of CONVENTION_FILES) {
    const absolutePath = path.join(repoRoot, fileName);
    let content: string | null = null;
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      content = null;
    }
    if (content === null || content.trim() === '') continue;
    sourcesFound.push(fileName);
    sections.push(`## ${fileName}\n\n${content.trim()}`);
  }

  const mergedRulesMarkdown =
    sections.length > 0
      ? sections.join('\n\n---\n\n')
      : '# Project Conventions\n\nNo convention instruction files (AGENTS.md, CLAUDE.md, .cursorrules, .windsurfrules) were found in the repository root.';

  return { sourcesFound, mergedRulesMarkdown };
}
