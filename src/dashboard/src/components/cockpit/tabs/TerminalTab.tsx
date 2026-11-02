import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export interface TerminalTabProps {
  wsUrl?: string;
  initialLines?: string[];
}

export function TerminalTab({
  wsUrl: _wsUrl = '/api/v1/telemetry/ws-ticket',
  initialLines = [
    '⚡ Connected to Sandbox Container (Docker Runner v1)',
    'WORKDIR: /workspace/GraywolfSquad',
    'pnpm test:unit --reporter=spec',
    '✓ 372 tests passed across 39 suites (clean baseline)',
  ],
}: TerminalTabProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [ticketStatus] = useState<'requesting' | 'connected' | 'disconnected'>('connected');

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'monospace',
      theme: {
        background: '#020617', // slate-950
        foreground: '#cbd5e1', // slate-300
        cursor: '#38bdf8', // sky-400
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    try {
      fitAddon.fit();
    } catch {
      // fit requires visible element
    }

    initialLines.forEach((line) => term.writeln(line));
    terminalRef.current = term;

    return () => {
      term.dispose();
      terminalRef.current = null;
    };
  }, [initialLines]);

  return (
    <div data-testid="terminal-tab" className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center space-x-2">
          <span className="text-sm">💻</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Sandbox Terminal Stream</h3>
        </div>
        <div className="flex items-center space-x-2 text-[11px] font-mono">
          <span className="text-slate-400">WS-TGT Ticket:</span>
          <span data-testid="terminal-ticket-status" className="text-emerald-400 font-semibold">{ticketStatus}</span>
        </div>
      </div>

      {/* Terminal Viewport: strictly dir="ltr" */}
      <div
        dir="ltr"
        ref={containerRef}
        data-testid="xterm-container"
        className="flex-1 p-2 bg-slate-950 overflow-hidden font-mono"
        style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
      />
    </div>
  );
}

export default TerminalTab;
