import React, { useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';

export interface FileDiffItem {
  filePath: string;
  additions: number;
  deletions: number;
  oldContent: string;
  newContent: string;
}

export interface CommitsTabProps {
  semanticSummary?: string[];
  files?: FileDiffItem[];
  diffMode?: 'old' | 'diff' | 'new';
}

const DEFAULT_DIFFS: FileDiffItem[] = [
  {
    filePath: 'src/orchestrator/routes/chat.ts',
    additions: 42,
    deletions: 4,
    oldContent: '// Prior implementation\nexport async function chatRoutes() {}\n',
    newContent: '// Vercel AI SDK Data Stream protocol\nexport async function chatRoutes(fastify, options) {\n  // Streaming 0:, 9:, a:, 2:, d:\n}\n',
  },
  {
    filePath: 'src/orchestrator/auth/rbac.ts',
    additions: 12,
    deletions: 0,
    oldContent: 'export const RBAC_ACTIONS = [ ... ];\n',
    newContent: 'export const RBAC_ACTIONS = [\n  "chat_turn",\n  "change_access_mode_pill",\n  ...\n];\n',
  },
];

export function CommitsTab({
  semanticSummary = [
    '🛠️ Refactored: Fastify Vercel AI SDK route streamText() protocol',
    '🔒 Hardened: Casbin RBAC chat_turn and change_access_mode_pill permissions',
  ],
  files = DEFAULT_DIFFS,
  diffMode: initialDiffMode = 'diff',
}: CommitsTabProps): React.ReactElement {
  const [selectedFile, setSelectedFile] = useState<FileDiffItem>(files[0] || DEFAULT_DIFFS[0]);
  const [diffMode, setDiffMode] = useState<'old' | 'diff' | 'new'>(initialDiffMode);

  return (
    <div data-testid="commits-tab" className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-y-auto p-4 space-y-4">
      {/* AST Semantic Diff Header */}
      <div data-testid="ast-semantic-diff-header" className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
        <div className="flex items-center space-x-2">
          <span className="text-sm">🌳</span>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-300">
            Deterministic AST Semantic Diff Summary
          </h4>
        </div>
        <ul className="space-y-1 text-xs text-slate-300 font-mono">
          {semanticSummary.map((item, idx) => (
            <li key={idx} className="flex items-center space-x-1.5">
              <span>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* File Accordion Bar & Diff Mode Toggle */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center space-x-2 overflow-x-auto">
          {files.map((file) => {
            const isSelected = file.filePath === selectedFile.filePath;
            return (
              <button
                key={file.filePath}
                type="button"
                data-testid={`file-tab-${file.filePath.replace(/\//g, '-')}`}
                onClick={() => setSelectedFile(file)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-mono transition ${
                  isSelected
                    ? 'bg-sky-950 text-sky-300 border border-sky-800'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                <span>{file.filePath.split('/').pop()}</span>
                <span className="text-emerald-400 text-[10px]">+{file.additions}</span>
                <span className="text-rose-400 text-[10px]">-{file.deletions}</span>
              </button>
            );
          })}
        </div>

        {/* Diff Mode Switcher: old | diff | new */}
        <div className="flex rounded bg-slate-900 p-0.5 border border-slate-800 text-[11px] font-medium">
          <button
            type="button"
            data-testid="diff-mode-old"
            onClick={() => setDiffMode('old')}
            className={`px-2 py-0.5 rounded transition ${diffMode === 'old' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
          >
            Old
          </button>
          <button
            type="button"
            data-testid="diff-mode-diff"
            onClick={() => setDiffMode('diff')}
            className={`px-2 py-0.5 rounded transition ${diffMode === 'diff' ? 'bg-sky-600 text-white' : 'text-slate-400'}`}
          >
            Diff
          </button>
          <button
            type="button"
            data-testid="diff-mode-new"
            onClick={() => setDiffMode('new')}
            className={`px-2 py-0.5 rounded transition ${diffMode === 'new' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
          >
            New
          </button>
        </div>
      </div>

      {/* Monaco DiffEditor Container: dir="ltr", max-height 600px */}
      <div
        dir="ltr"
        data-testid="monaco-diff-container"
        className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950"
        style={{ maxHeight: '600px', height: '420px' }}
      >
        {diffMode === 'diff' ? (
          <DiffEditor
            original={selectedFile.oldContent}
            modified={selectedFile.newContent}
            language="typescript"
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
            }}
          />
        ) : (
          <pre className="p-4 font-mono text-xs text-slate-300 overflow-auto h-full">
            {diffMode === 'old' ? selectedFile.oldContent : selectedFile.newContent}
          </pre>
        )}
      </div>
    </div>
  );
}

export default CommitsTab;
