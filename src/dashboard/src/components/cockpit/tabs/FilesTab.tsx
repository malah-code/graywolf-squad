import React, { useState } from 'react';

export interface WorkspaceFileItem {
  path: string;
  sizeBytes: number;
  contentPreview?: string;
  scope: 'writable' | 'readonly' | 'forbidden';
}

export interface FilesTabProps {
  files?: WorkspaceFileItem[];
  selectedPath?: string;
  onSelectFile?: (path: string) => void;
}

const DEFAULT_FILES: WorkspaceFileItem[] = [
  {
    path: 'src/orchestrator/routes/chat.ts',
    sizeBytes: 8192,
    contentPreview: 'export async function chatRoutes(...)',
    scope: 'writable',
  },
  {
    path: 'src/orchestrator/auth/rbac.ts',
    sizeBytes: 5214,
    contentPreview: 'export async function checkPermission(...)',
    scope: 'readonly',
  },
  {
    path: 'config/seccomp.json',
    sizeBytes: 2048,
    contentPreview: '{ "defaultAction": "SCMP_ACT_ERRNO" }',
    scope: 'forbidden',
  },
  {
    path: 'docs/PRD.md',
    sizeBytes: 16400,
    contentPreview: '# Master Product Requirements Document',
    scope: 'writable',
  },
];

export function FilesTab({
  files = DEFAULT_FILES,
  selectedPath,
  onSelectFile,
}: FilesTabProps): React.ReactElement {
  const [activePath, setActivePath] = useState<string>(selectedPath || files[0]?.path || '');

  const handleSelect = (path: string) => {
    setActivePath(path);
    if (onSelectFile) {
      onSelectFile(path);
    }
  };

  const activeFile = files.find((f) => f.path === activePath) || files[0];

  return (
    <div data-testid="files-tab" className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="p-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Workspace Files</h3>
        <span className="text-[10px] text-slate-500 font-mono">{files.length} tracked</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* File tree */}
        <div className="w-1/2 border-r border-slate-800 overflow-y-auto p-2 space-y-1">
          {files.map((file) => {
            const isSelected = file.path === activePath;
            return (
              <div
                key={file.path}
                data-testid={`file-item-${file.path.replace(/\//g, '-')}`}
                onClick={() => handleSelect(file.path)}
                className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer transition ${
                  isSelected ? 'bg-sky-950/80 border border-sky-800 text-sky-200' : 'hover:bg-slate-900 text-slate-300'
                }`}
              >
                <div className="flex items-center space-x-1.5 overflow-hidden">
                  <span className="text-slate-400">📄</span>
                  <code dir="ltr" className="font-mono truncate">{file.path}</code>
                </div>
                <span
                  data-testid={`scope-badge-${file.scope}`}
                  className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${
                    file.scope === 'writable'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : file.scope === 'readonly'
                      ? 'bg-sky-950 text-sky-400 border border-sky-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}
                >
                  {file.scope}
                </span>
              </div>
            );
          })}
        </div>

        {/* File Preview */}
        <div className="w-1/2 p-3 flex flex-col bg-slate-900/30 overflow-y-auto">
          {activeFile ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                <code dir="ltr" className="text-xs font-mono font-bold text-sky-400">{activeFile.path}</code>
                <span className="text-[10px] text-slate-400">{(activeFile.sizeBytes / 1024).toFixed(1)} kB</span>
              </div>
              <pre
                dir="ltr"
                data-testid="file-preview-content"
                className="flex-1 p-2 bg-slate-950 rounded border border-slate-800 font-mono text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto"
              >
                {activeFile.contentPreview || '// Content unavailable'}
              </pre>
            </>
          ) : (
            <p className="text-xs text-slate-500 italic">Select a file to inspect</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default FilesTab;
