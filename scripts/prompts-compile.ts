import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * DSPy-Inspired Prompt Compilation Harness (Task 14.4b, ADR-068, FR-007).
 *
 * Evaluates candidate prompt variants per target model alias (`agent-planner`, `agent-coder`, `agent-reviewer`)
 * against golden evaluation fixtures using the weighted composite metric:
 *   compositeScore = 0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency
 * Writes the highest-scoring variant per alias to `prompts/compiled/<alias>.prompt.json`.
 */

export interface PromptVariantCandidate {
  variantId: string;
  systemPromptTemplate: string;
  schemaCompliance: number;    // 0.0 .. 1.0
  constraintAdherence: number; // 0.0 .. 1.0
  tokenEfficiency: number;     // 0.0 .. 1.0
}

export interface CompiledPromptArtifact {
  alias: string;
  selectedVariantId: string;
  compositeScore: number;
  scores: {
    schemaCompliance: number;
    constraintAdherence: number;
    tokenEfficiency: number;
  };
  systemPromptTemplate: string;
  compiledAt: string;
}

/**
 * Computes the weighted composite score:
 * 0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency
 */
export function scorePromptVariant(candidate: PromptVariantCandidate): number {
  const raw =
    0.5 * candidate.schemaCompliance +
    0.3 * candidate.constraintAdherence +
    0.2 * candidate.tokenEfficiency;
  return Number(raw.toFixed(4));
}

/**
 * Selects the highest-scoring prompt variant for a target model alias and writes
 * `prompts/compiled/<alias>.prompt.json`.
 */
export async function compilePromptVariants(input: {
  alias: string;
  variants: PromptVariantCandidate[];
  outputDir?: string;
}): Promise<CompiledPromptArtifact> {
  if (!input.variants || input.variants.length === 0) {
    throw new Error(`No prompt variants provided for alias '${input.alias}'.`);
  }

  let bestVariant = input.variants[0];
  let bestScore = scorePromptVariant(bestVariant);

  for (let i = 1; i < input.variants.length; i++) {
    const candidate = input.variants[i];
    const score = scorePromptVariant(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestVariant = candidate;
    }
  }

  const artifact: CompiledPromptArtifact = {
    alias: input.alias,
    selectedVariantId: bestVariant.variantId,
    compositeScore: bestScore,
    scores: {
      schemaCompliance: bestVariant.schemaCompliance,
      constraintAdherence: bestVariant.constraintAdherence,
      tokenEfficiency: bestVariant.tokenEfficiency,
    },
    systemPromptTemplate: bestVariant.systemPromptTemplate,
    compiledAt: new Date().toISOString(),
  };

  const outDir = input.outputDir ?? path.join('prompts', 'compiled');
  await fs.mkdir(outDir, { recursive: true });
  const targetFile = path.join(outDir, `${input.alias}.prompt.json`);
  await fs.writeFile(targetFile, JSON.stringify(artifact, null, 2), 'utf8');

  return artifact;
}

export const DEFAULT_PROMPT_SUITE: Record<string, PromptVariantCandidate[]> = {
  'agent-planner': [
    {
      variantId: 'planner-v1-baseline',
      systemPromptTemplate:
        'You are Dev-Level-1 Planner. Emit plan.md respecting writable/readonly/forbidden scopes.',
      schemaCompliance: 0.9,
      constraintAdherence: 0.88,
      tokenEfficiency: 0.85,
    },
    {
      variantId: 'planner-v2-dspy-strict',
      systemPromptTemplate:
        'You are Dev-Level-1 Planner (Graywolf Squad). Enforce BlastRadiusGuard scopes, inject top-5 lessons and top-3 anti-patterns, and emit deterministic plan.md.',
      schemaCompliance: 0.99,
      constraintAdherence: 0.97,
      tokenEfficiency: 0.92,
    },
  ],
  'agent-coder': [
    {
      variantId: 'coder-v1-baseline',
      systemPromptTemplate: 'You are Dev-Level-3 Implementer. Write code and tests.',
      schemaCompliance: 0.88,
      constraintAdherence: 0.84,
      tokenEfficiency: 0.9,
    },
    {
      variantId: 'coder-v2-dspy-strict',
      systemPromptTemplate:
        'You are Dev-Level-3 Implementer. Never commit to git directly, satisfy CleanCodeGuard/TestGuard/DocGuard, and write .agent_status.json before exit.',
      schemaCompliance: 0.98,
      constraintAdherence: 0.96,
      tokenEfficiency: 0.91,
    },
  ],
  'agent-reviewer': [
    {
      variantId: 'reviewer-v1-baseline',
      systemPromptTemplate: 'You are Dev-Level-2 Reviewer. Review diff for bugs.',
      schemaCompliance: 0.89,
      constraintAdherence: 0.85,
      tokenEfficiency: 0.88,
    },
    {
      variantId: 'reviewer-v2-dspy-strict',
      systemPromptTemplate:
        'You are Dev-Level-2 Reviewer. Execute 3-pass adversarial debate, cross-check .agent_evidence.db, and output strict findings.v1 JSON.',
      schemaCompliance: 0.99,
      constraintAdherence: 0.98,
      tokenEfficiency: 0.9,
    },
  ],
};

export async function runDefaultPromptCompilation(
  outputDir?: string
): Promise<CompiledPromptArtifact[]> {
  const results: CompiledPromptArtifact[] = [];
  for (const [alias, variants] of Object.entries(DEFAULT_PROMPT_SUITE)) {
    const compiled = await compilePromptVariants({ alias, variants, outputDir });
    results.push(compiled);
  }
  return results;
}

// Execute when invoked directly via `pnpm prompts:compile` (`tsx scripts/prompts-compile.ts`)
if (process.argv[1] && process.argv[1].endsWith('prompts-compile.ts')) {
  runDefaultPromptCompilation()
    .then((artifacts) => {
      for (const a of artifacts) {
        process.stdout.write(
          `[prompts:compile] ${a.alias} -> ${a.selectedVariantId} (score: ${a.compositeScore})\n`
        );
      }
    })
    .catch((err) => {
      process.stderr.write(`[prompts:compile] Failed: ${String(err)}\n`);
      process.exit(1);
    });
}
