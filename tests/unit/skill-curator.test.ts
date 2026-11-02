import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeSkillJaccardSimilarity,
  runWeeklySkillCurator,
} from '../../src/orchestrator/learning/skill-curator';
import { renderHermesSkillMarkdown } from '../../src/orchestrator/learning/reflection-worker';

describe('Autonomous Weekly Skill Curator (Task 14.2, ADR-063, FR-003)', () => {
  let tempSkillsDir: string;
  const now = new Date('2026-11-01T12:00:00.000Z');

  beforeEach(async () => {
    tempSkillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-curator-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempSkillsDir, { recursive: true, force: true });
  });

  async function writeSkillFixture(opts: {
    name: string;
    description: string;
    whenToUse: string;
    origin?: 'agent-created' | 'user-created';
    pinned?: boolean;
    status?: 'active' | 'stale' | 'archived';
    daysUnused: number;
    inArchive?: boolean;
  }) {
    const base = opts.inArchive
      ? path.join(tempSkillsDir, '.archive', opts.name)
      : path.join(tempSkillsDir, opts.name);
    await fs.mkdir(base, { recursive: true });
    const ts = new Date(now.getTime() - opts.daysUnused * 86_400_000).toISOString();

    const md = renderHermesSkillMarkdown({
      name: opts.name,
      description: opts.description,
      origin: opts.origin ?? 'agent-created',
      pinned: opts.pinned ?? false,
      status: opts.status ?? 'active',
      lastUsedAt: ts,
      archivedAt: opts.inArchive ? ts : null,
      sections: {
        Title: opts.name,
        'When to Use': opts.whenToUse,
        Prerequisites: 'Node.js 20+.',
        'How to Run': 'Run command.',
        'Quick Reference': 'Quick ref.',
        Procedure: 'Step 1.',
        Pitfalls: 'Avoid pitfall.',
        Verification: 'Run vitest.',
      },
    });
    await fs.writeFile(path.join(base, 'SKILL.md'), md, 'utf8');
  }

  it('transitions agent-created skills across 14d (stale), 30d (archived), and 90d (pending_deletion -> deleted)', async () => {
    await writeSkillFixture({
      name: 'fresh-skill',
      description: 'Fresh skill used recently.',
      whenToUse: 'When testing fresh workflows.',
      daysUnused: 3,
    });
    await writeSkillFixture({
      name: 'stale-candidate',
      description: 'Skill unused for fifteen days.',
      whenToUse: 'When testing fifteen day staleness.',
      daysUnused: 15,
    });
    await writeSkillFixture({
      name: 'archive-candidate',
      description: 'Skill unused for thirty-five days.',
      whenToUse: 'When testing thirty day archival.',
      daysUnused: 35,
    });
    await writeSkillFixture({
      name: 'delete-unapproved',
      description: 'Archived skill over ninety days without approval.',
      whenToUse: 'When testing ninety day pending deletion.',
      status: 'archived',
      daysUnused: 95,
      inArchive: true,
    });
    await writeSkillFixture({
      name: 'delete-approved',
      description: 'Archived skill over ninety days with operator approval.',
      whenToUse: 'When testing approved deletion.',
      status: 'archived',
      daysUnused: 95,
      inArchive: true,
    });

    const result = await runWeeklySkillCurator({
      skillsRootDir: tempSkillsDir,
      now,
      operatorApprovedDeletionIds: ['delete-approved'],
    });

    expect(result.transitionedToStale).toEqual(['stale-candidate']);
    expect(result.transitionedToArchived).toEqual(['archive-candidate']);
    expect(result.markedPendingDeletion).toEqual(['delete-unapproved']);
    expect(result.permanentlyDeleted).toEqual(['delete-approved']);

    // Verify archive-candidate was moved to .archive/
    const archivedContent = await fs.readFile(
      path.join(tempSkillsDir, '.archive', 'archive-candidate', 'SKILL.md'),
      'utf8'
    );
    expect(archivedContent).toContain('status: "archived"');
  });

  it('never auto-patches user-created skills or archives pinned skills even after 120 days of inactivity', async () => {
    await writeSkillFixture({
      name: 'user-custom-skill',
      description: 'Human authored skill.',
      whenToUse: 'Always keep untouched.',
      origin: 'user-created',
      daysUnused: 120,
    });
    await writeSkillFixture({
      name: 'pinned-agent-skill',
      description: 'Pinned agent skill.',
      whenToUse: 'Never archive this skill.',
      origin: 'agent-created',
      pinned: true,
      daysUnused: 120,
    });

    const result = await runWeeklySkillCurator({
      skillsRootDir: tempSkillsDir,
      now,
    });

    expect(result.skippedProtected).toEqual(
      expect.arrayContaining(['user-custom-skill', 'pinned-agent-skill'])
    );
    expect(result.transitionedToStale).toHaveLength(0);
    expect(result.transitionedToArchived).toHaveLength(0);
  });

  it('pre-filters overlapping agent-created skills via Jaccard >= 0.50 and writes consolidation diff proposal', async () => {
    await writeSkillFixture({
      name: 'add-postgres-migration-v1',
      description: 'Create PostgreSQL schema migration with RLS policies.',
      whenToUse: 'When adding a new PostgreSQL table migration with tenant RLS policies.',
      daysUnused: 2,
    });
    await writeSkillFixture({
      name: 'add-postgres-migration-v2',
      description: 'Create PostgreSQL schema migration with RLS policies.',
      whenToUse: 'When creating a new PostgreSQL table migration with tenant RLS policies.',
      daysUnused: 5,
    });

    const sim = computeSkillJaccardSimilarity(
      'Create PostgreSQL schema migration with RLS policies. When adding a new PostgreSQL table migration with tenant RLS policies.',
      'Create PostgreSQL schema migration with RLS policies. When creating a new PostgreSQL table migration with tenant RLS policies.'
    );
    expect(sim).toBeGreaterThanOrEqual(0.5);

    const result = await runWeeklySkillCurator({
      skillsRootDir: tempSkillsDir,
      now,
      consolidate: true,
    });

    expect(result.overlappingPairs).toHaveLength(1);
    expect(result.consolidationProposalPath).toBe(
      path.join(tempSkillsDir, '.proposals', 'consolidation-2026-11-01.diff.md')
    );

    const proposalMd = await fs.readFile(result.consolidationProposalPath!, 'utf8');
    expect(proposalMd).toContain('add-postgres-migration-v1');
    expect(proposalMd).toContain('add-postgres-migration-v2');
  });
});

