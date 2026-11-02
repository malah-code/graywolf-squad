import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { computeSha256 } from '../recon/ast-indexer';
import { GraywolfAppError } from '../errors/taxonomy';

/**
 * Layer 4 — Surgical File Slicing (FR-003): `view_file_range` and
 * `replace_file_content` tools for bounded, targeted context access.
 */

function resolveWithinRepoRoot(repoRoot: string, filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new GraywolfAppError('ACI_VALIDATION_FAILED', 'Invalid or missing file path');
  }
  const normalized = filePath.split(path.sep).join('/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..')) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Path traversal outside workspace root: ${filePath}`
    );
  }
  return path.join(repoRoot, normalized);
}

export interface FileRangeView {
  filePath: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}

export async function viewFileRange(
  repoRoot: string,
  filePath: string,
  startLine: number,
  endLine: number
): Promise<FileRangeView> {
  const absolute = resolveWithinRepoRoot(repoRoot, filePath);
  let content: string;
  try {
    content = await fs.readFile(absolute, 'utf8');
  } catch {
    throw new GraywolfAppError('ACI_VALIDATION_FAILED', `File not found: ${filePath}`);
  }
  const lines = content.split('\n');
  const totalLines = lines.length;
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine > totalLines
  ) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Invalid line range ${startLine}-${endLine} for ${filePath} (${totalLines} lines)`
    );
  }
  return {
    filePath,
    startLine,
    endLine,
    totalLines,
    content: lines.slice(startLine - 1, endLine).join('\n'),
  };
}

export interface FileContentReplacement {
  updated: boolean;
  newHash: string;
}

export async function replaceFileContent(
  repoRoot: string,
  filePath: string,
  targetContent: string,
  replacementContent: string
): Promise<FileContentReplacement> {
  const absolute = resolveWithinRepoRoot(repoRoot, filePath);
  let content: string;
  try {
    content = await fs.readFile(absolute, 'utf8');
  } catch {
    throw new GraywolfAppError('ACI_VALIDATION_FAILED', `File not found: ${filePath}`);
  }
  const targetIndex = content.indexOf(targetContent);
  if (targetIndex < 0) {
    return { updated: false, newHash: computeSha256(content) };
  }
  const updatedContent =
    content.slice(0, targetIndex) + replacementContent + content.slice(targetIndex + targetContent.length);
  await fs.writeFile(absolute, updatedContent, 'utf8');
  return { updated: true, newHash: computeSha256(updatedContent) };
}
