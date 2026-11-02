import React from 'react';
import type { VNode } from './jsx-runtime';

export type SupportedLocale = 'ar' | 'en' | 'fr' | 'tr';

export interface BidiProseProps {
  children: React.ReactNode;
  locale?: SupportedLocale;
  className?: string;
  dir?: 'auto' | 'ltr' | 'rtl';
}

export interface CodeIsolateProps {
  children: React.ReactNode;
  as?: 'code' | 'pre' | 'span' | 'kbd';
  className?: string;
}

export const LTR_ISOLATE_START = '\u2066';
export const LTR_ISOLATE_END = '\u2069';

export function BidiProse({
  children,
  locale,
  className = '',
  dir = 'auto',
}: BidiProseProps): VNode {
  const isRtl = locale === 'ar';
  const resolvedDir = locale ? (isRtl ? 'rtl' : 'ltr') : dir;

  return (
    <div
      dir={resolvedDir}
      data-testid="bidi-prose"
      data-locale={locale}
      className={`bidi-prose ${isRtl ? 'text-right' : 'text-left'} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function CodeIsolate({
  children,
  as: Component = 'code',
  className = '',
}: CodeIsolateProps): VNode {
  return (
    <Component
      dir="ltr"
      data-testid="code-isolate"
      className={`[unicode-bidi:isolate] font-mono text-left inline-block ${className}`.trim()}
      style={{ unicodeBidi: 'isolate', direction: 'ltr' }}
    >
      {children}
    </Component>
  );
}

export function postProcessBidiDocument(markdown: string, _locale?: SupportedLocale): string {
  if (!markdown) return '';

  // 1. Preserve fenced code blocks
  const codeBlocks: string[] = [];
  let processed = markdown.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__FENCED_CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 2. Wrap inline backticked code spans with LTR isolate markers and <code dir="ltr"> wrapper
  processed = processed.replace(/`([^`]+)`/g, (_match, codeContent) => {
    return `<code dir="ltr" class="bidi-isolate" style="unicode-bidi: isolate">${LTR_ISOLATE_START}${codeContent}${LTR_ISOLATE_END}</code>`;
  });

  // 3. File paths: e.g. src/auth/login.ts or ./config/seccomp.json
  processed = processed.replace(/(?<!["`>\w])(\.?\.?\/(?:[\w.-]+\/)+[\w.-]+)/g, (_match, path) => {
    return `<span dir="ltr" class="bidi-isolate" style="unicode-bidi: isolate">${LTR_ISOLATE_START}${path}${LTR_ISOLATE_END}</span>`;
  });

  // 4. CLI flags: e.g. --skip-grill, --help
  processed = processed.replace(/(?<!["`>\w])(--[a-zA-Z0-9_-]+)/g, (_match, flag) => {
    return `<span dir="ltr" class="bidi-isolate" style="unicode-bidi: isolate">${LTR_ISOLATE_START}${flag}${LTR_ISOLATE_END}</span>`;
  });

  // 5. Restore fenced code blocks with outer LTR container
  processed = processed.replace(/__FENCED_CODE_BLOCK_(\d+)__/g, (_match, index) => {
    const original = codeBlocks[Number(index)];
    return `\n<div dir="ltr" class="bidi-isolate" style="unicode-bidi: isolate">\n\n${original}\n\n</div>\n`;
  });

  return processed;
}

export function verifyBidiCompliance(renderedHtml: string): {
  compliant: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Check 1: <code> tags must have dir="ltr" or style with unicode-bidi: isolate
  const codeTagsWithoutDir = renderedHtml.match(/<code(?![^>]*dir=["']ltr["'])(?![^>]*unicode-bidi:\s*isolate)[^>]*>/gi);
  if (codeTagsWithoutDir) {
    violations.push(`Found ${codeTagsWithoutDir.length} <code> tag(s) without dir="ltr" or unicode-bidi: isolate`);
  }

  // Check 2: <pre> tags must have dir="ltr"
  const preTagsWithoutDir = renderedHtml.match(/<pre(?![^>]*dir=["']ltr["'])[^>]*>/gi);
  if (preTagsWithoutDir) {
    violations.push(`Found ${preTagsWithoutDir.length} <pre> tag(s) without dir="ltr"`);
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}
