import React, { useState } from 'react';
import type { ProjectMode } from '../../context/DashboardContext';

export interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; mode: ProjectMode; gitRemoteUrl?: string }) => Promise<void>;
}

export function NewProjectModal({ isOpen, onClose, onCreate }: NewProjectModalProps): React.ReactElement | null {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ProjectMode>('greenfield');
  const [gitRemoteUrl, setGitRemoteUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a project name.');
      return;
    }
    if (mode === 'brownfield' && !gitRemoteUrl.trim()) {
      setError('Please provide a Git repository clone URL.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        mode,
        gitRemoteUrl: gitRemoteUrl.trim() || undefined,
      });
      setName('');
      setGitRemoteUrl('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create project');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🐺</span>
            <div>
              <h2 className="text-lg font-bold text-white">Create New Project</h2>
              <p className="text-xs text-slate-400">Launch an autonomous software squad workspace</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-950/80 border border-red-800 p-3 text-xs text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-2">Project Mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('greenfield')}
                className={`p-3 rounded-xl border text-left transition ${
                  mode === 'greenfield'
                    ? 'border-sky-500 bg-sky-950/40 text-white shadow'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="text-xl mb-1">🚀</div>
                <div className="text-xs font-bold">Greenfield</div>
                <div className="text-[11px] text-slate-400">Build a brand-new application from scratch</div>
              </button>

              <button
                type="button"
                onClick={() => setMode('brownfield')}
                className={`p-3 rounded-xl border text-left transition ${
                  mode === 'brownfield'
                    ? 'border-sky-500 bg-sky-950/40 text-white shadow'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="text-xl mb-1">🔗</div>
                <div className="text-xs font-bold">Brownfield</div>
                <div className="text-[11px] text-slate-400">Connect & recon an existing Git repo</div>
              </button>
            </div>
          </div>

          {/* Project Name */}
          <div>
            <label htmlFor="project-name" className="text-xs font-semibold text-slate-300 block mb-1">
              Project Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Next.js SaaS Platform, Payment API"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              autoFocus
            />
          </div>

          {/* Git URL (Brownfield) */}
          {mode === 'brownfield' && (
            <div>
              <label htmlFor="git-url" className="text-xs font-semibold text-slate-300 block mb-1">
                Git Repository URL
              </label>
              <input
                id="git-url"
                type="text"
                value={gitRemoteUrl}
                onChange={(e) => setGitRemoteUrl(e.target.value)}
                placeholder="https://github.com/organization/repository.git"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-500 transition shadow-lg shadow-sky-600/30 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create & Launch Squad'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

