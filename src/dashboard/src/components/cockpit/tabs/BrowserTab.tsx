import React, { useState } from 'react';

export interface PlaywrightArtifact {
  id: string;
  type: 'screenshot' | 'video';
  url: string;
  locatorBreadcrumb: string;
  timestamp: string;
}

export interface BrowserTabProps {
  topology?: 'solo' | 'team' | 'cloud';
  hmrLiveUrl?: string;
  playwrightArtifacts?: PlaywrightArtifact[];
}

const DEFAULT_ARTIFACTS: PlaywrightArtifact[] = [
  {
    id: 'art-1',
    type: 'screenshot',
    url: '/artifacts/login-flow-success.png',
    locatorBreadcrumb: 'page.getByRole("button", { name: "Sign In" })',
    timestamp: '2026-10-25 15:32:10 UTC',
  },
  {
    id: 'art-2',
    type: 'video',
    url: '/artifacts/checkout-e2e.webm',
    locatorBreadcrumb: 'page.locator("#checkout-submit")',
    timestamp: '2026-10-25 15:33:45 UTC',
  },
];

export function BrowserTab({
  topology = 'solo',
  hmrLiveUrl = 'http://localhost:5173',
  playwrightArtifacts = DEFAULT_ARTIFACTS,
}: BrowserTabProps): React.ReactElement {
  const [activeMode, setActiveMode] = useState<'hmr' | 'playwright'>(topology === 'solo' ? 'hmr' : 'playwright');
  const [selectedArtifact, setSelectedArtifact] = useState<PlaywrightArtifact>(playwrightArtifacts[0]);

  return (
    <div data-testid="browser-tab" className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center space-x-2">
          <span className="text-sm">🌐</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Browser & QA Artifacts</h3>
        </div>

        {/* Switcher: Topology A Live HMR vs Playwright artifacts */}
        <div className="flex rounded bg-slate-900 p-0.5 border border-slate-800 text-[11px] font-medium">
          {topology === 'solo' && (
            <button
              type="button"
              data-testid="browser-mode-hmr"
              onClick={() => setActiveMode('hmr')}
              className={`px-2.5 py-1 rounded transition ${
                activeMode === 'hmr' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Live HMR (Topology A)
            </button>
          )}
          <button
            type="button"
            data-testid="browser-mode-playwright"
            onClick={() => setActiveMode('playwright')}
            className={`px-2.5 py-1 rounded transition ${
              activeMode === 'playwright' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Playwright QA Preview
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {activeMode === 'hmr' && topology === 'solo' ? (
          <div data-testid="hmr-iframe-container" className="flex-1 flex flex-col bg-slate-900">
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-slate-950 border-b border-slate-800 text-xs font-mono text-slate-400">
              <span className="text-emerald-400">●</span>
              <span className="truncate">{hmrLiveUrl}</span>
            </div>
            <iframe
              src={hmrLiveUrl}
              title="Topology A Live HMR"
              className="flex-1 w-full border-none bg-white"
            />
          </div>
        ) : (
          <div data-testid="playwright-preview-container" className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
            <div className="flex items-center space-x-3">
              {playwrightArtifacts.map((art) => (
                <button
                  key={art.id}
                  type="button"
                  data-testid={`artifact-btn-${art.id}`}
                  onClick={() => setSelectedArtifact(art)}
                  className={`p-2 rounded-lg border text-left text-xs transition ${
                    selectedArtifact?.id === art.id
                      ? 'bg-purple-950/80 border-purple-700 text-purple-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="font-semibold text-slate-200 flex items-center space-x-1">
                    <span>{art.type === 'video' ? '🎬' : '📸'}</span>
                    <span>{art.type.toUpperCase()}</span>
                  </div>
                  <div className="font-mono text-[10px] text-slate-400 truncate">{art.timestamp}</div>
                </button>
              ))}
            </div>

            {selectedArtifact && (
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-300">Locator Breadcrumb</span>
                  <code dir="ltr" className="font-mono text-purple-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {selectedArtifact.locatorBreadcrumb}
                  </code>
                </div>
                <div className="h-64 rounded bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-500 font-mono text-xs">
                  [Playwright {selectedArtifact.type}: {selectedArtifact.url}]
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BrowserTab;
