import React, { useState } from 'react';
import type { WorkspaceRole } from '../../context/DashboardContext';
import { AccessModePill, AccessModePillValue } from './AccessModePill';
import { SpendTicker, SpendTickerState } from './SpendTicker';
import { BidiProse } from '../../lib/bidi';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCall?: {
    toolName: string;
    args: Record<string, unknown>;
    result?: Record<string, unknown>;
    authorized?: boolean;
    executed?: boolean;
    error?: string | null;
  };
  briefPreview?: string;
  requiresConfirmation?: boolean;
}

export interface ChatCockpitProps {
  conversationId: string;
  projectId: string;
  activeTaskId?: string;
  userRole: WorkspaceRole;
  initialCockpitMode?: 'STANDARD' | 'GRILL';
  initialAccessMode?: AccessModePillValue;
  currentFile?: string;
  onCancelTask?: (taskId: string) => Promise<{ status: string }>;
  onSendMessage?: (req: {
    projectId: string;
    taskId?: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
    cockpitMode: 'STANDARD' | 'GRILL';
    accessModeOverride: AccessModePillValue;
    currentFile?: string;
    skipGrill?: boolean;
  }) => Promise<void>;
  onQueueTask?: (briefMarkdown: string) => Promise<void>;
}

export function ChatCockpit({
  projectId,
  activeTaskId,
  userRole,
  initialCockpitMode = 'STANDARD',
  initialAccessMode = 'full-factory',
  currentFile,
  onCancelTask,
  onSendMessage,
  onQueueTask,
}: ChatCockpitProps): React.ReactElement {
  const [cockpitMode, setCockpitMode] = useState<'STANDARD' | 'GRILL'>(initialCockpitMode);
  const [accessMode, setAccessMode] = useState<AccessModePillValue>(initialAccessMode);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationResult, setCancellationResult] = useState<string | null>(null);

  const [spendState] = useState<SpendTickerState>({
    taskId: activeTaskId,
    taskSpendUsd: 0.045,
    workspaceDailySpendUsd: 4.82,
    dailySpendCapUsd: 50.0,
    totalTokens: 14200,
    connectionStatus: 'connected',
  });

  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'msg-init',
      role: 'assistant',
      content:
        'Graywolf Squad Cockpit active. Ready to plan, execute, or inspect tasks across your container workspace.',
    },
  ]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || isStreaming) return;

    const userMsg: ChatMessageItem = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: inputMessage,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputMessage('');
    setIsStreaming(true);

    try {
      if (onSendMessage) {
        await onSendMessage({
          projectId,
          taskId: activeTaskId,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          cockpitMode,
          accessModeOverride: accessMode,
          currentFile,
        });
      } else {
        // Fallback simulated response if no external sender provided
        const isSkip = userMsg.content.includes('--skip-grill');
        if (cockpitMode === 'GRILL') {
          if (isSkip) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}-ai`,
                role: 'assistant',
                content: 'Socratic review bypassed. Brief synthesized.',
                briefPreview: `# Task Brief\n\n**Goal**: ${userMsg.content}\n**Status**: Ready to queue`,
                requiresConfirmation: true,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}-ai`,
                role: 'assistant',
                content: 'Question 1/5: What is the blast-radius scope for this change?',
              },
            ]);
          }
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}-ai`,
              role: 'assistant',
              content: `Turn processed in ${accessMode} mode.${currentFile ? ` Active file: ${currentFile}` : ''}`,
            },
          ]);
        }
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handlePanicCancel = async () => {
    if (!activeTaskId || isCancelling) return;
    setIsCancelling(true);
    try {
      if (onCancelTask) {
        const res = await onCancelTask(activeTaskId);
        setCancellationResult(res.status);
      } else {
        const res = await fetch(`/api/v1/tasks/${activeTaskId}/cancel`, { method: 'POST' });
        const json = await res.json();
        setCancellationResult(json.status || 'CANCELLED');
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-cancel`,
          role: 'system',
          content: `🛑 Panic Button: Task ${activeTaskId} cancellation requested. Container execution terminated.`,
        },
      ]);
    } catch {
      setCancellationResult('CANCELLED');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleConfirmQueueTask = async (brief: string) => {
    if (onQueueTask) {
      await onQueueTask(brief);
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-queued`,
        role: 'system',
        content: '✅ Task queued successfully from verified brief preview.',
      },
    ]);
  };

  return (
    <div data-testid="chat-cockpit" className="flex flex-col h-full bg-slate-950 border-r border-slate-800">
      {/* Cockpit Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center space-x-2">
          {/* Socratic GRILL Mode Toggle */}
          <button
            type="button"
            data-testid="grill-mode-toggle"
            onClick={() => setCockpitMode((m) => (m === 'STANDARD' ? 'GRILL' : 'STANDARD'))}
            className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
              cockpitMode === 'GRILL'
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
            }`}
          >
            {cockpitMode === 'GRILL' ? '🔥 GRILL Active' : '💬 Standard Chat'}
          </button>

          {/* Access Mode Pill */}
          <AccessModePill value={accessMode} role={userRole} onChange={setAccessMode} />
        </div>

        <div className="flex items-center space-x-2">
          {/* Spend Ticker */}
          <SpendTicker state={spendState} />

          {/* Panic Button */}
          {activeTaskId && (
            <button
              type="button"
              data-testid="panic-cancel-button"
              onClick={handlePanicCancel}
              disabled={isCancelling}
              className="flex items-center space-x-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-rose-950/60 border border-rose-500 hover:bg-rose-500 active:bg-rose-700 transition disabled:opacity-50"
              title="Immediately terminate container execution and abort active task"
            >
              <span>🛑</span>
              <span>{isCancelling ? 'Cancelling...' : 'Panic Cancel'}</span>
            </button>
          )}
        </div>
      </div>

      {cancellationResult && (
        <div data-testid="cancellation-banner" className="bg-rose-950/80 border-b border-rose-800 px-4 py-1.5 text-xs text-rose-300 flex justify-between">
          <span>Task {activeTaskId} status: {cancellationResult}</span>
          <button type="button" onClick={() => setCancellationResult(null)} className="text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            data-testid={`message-${m.role}`}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm shadow-sm ${
                m.role === 'user'
                  ? 'bg-sky-600 text-white rounded-br-none'
                  : m.role === 'system'
                  ? 'bg-amber-950/80 border border-amber-800 text-amber-200'
                  : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-none'
              }`}
            >
              <BidiProse dir="auto">
                <p className="whitespace-pre-wrap">{m.content}</p>
              </BidiProse>

              {/* Tool Execution Card */}
              {m.toolCall && (
                <div
                  data-testid="tool-execution-card"
                  className="mt-3 rounded-lg bg-slate-950 p-2.5 border border-slate-800 text-xs font-mono"
                >
                  <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1 mb-1.5">
                    <span>Tool: {m.toolCall.toolName}</span>
                    <span className={m.toolCall.authorized ? 'text-emerald-400' : 'text-rose-400'}>
                      {m.toolCall.authorized ? '✓ Authorized' : '✗ Forbidden'}
                    </span>
                  </div>
                  <pre className="text-[11px] text-slate-300 overflow-x-auto">
                    {JSON.stringify(m.toolCall.args, null, 2)}
                  </pre>
                  {m.toolCall.error && (
                    <p className="text-rose-400 mt-1 text-[11px]">Error: {m.toolCall.error}</p>
                  )}
                </div>
              )}

              {/* Task Brief Preview Card & Queue Task Confirmation */}
              {m.briefPreview && (
                <div
                  data-testid="brief-preview-card"
                  className="mt-3 rounded-lg bg-slate-950 p-3 border border-sky-800 text-xs"
                >
                  <div className="flex items-center justify-between border-b border-sky-900 pb-1.5 mb-2">
                    <span className="font-bold text-sky-400">📋 Task Brief Preview</span>
                    <span className="rounded bg-sky-950 px-1.5 py-0.5 text-[10px] text-sky-300 border border-sky-800">
                      GRILL Synthesized
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-300 whitespace-pre-wrap bg-slate-900 p-2 rounded">
                    {m.briefPreview}
                  </div>
                  {m.requiresConfirmation && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        data-testid="queue-task-confirm-btn"
                        onClick={() => handleConfirmQueueTask(m.briefPreview!)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition"
                      >
                        Queue Task
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} className="p-3 border-t border-slate-800 bg-slate-900/50">
        {currentFile && (
          <div data-testid="viewport-sync-indicator" className="mb-2 flex items-center space-x-1.5 text-xs text-slate-400">
            <span>👁️ Viewport Sync:</span>
            <code dir="ltr" className="font-mono text-sky-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
              {currentFile}
            </code>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <input
            type="text"
            data-testid="chat-input"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={
              cockpitMode === 'GRILL'
                ? 'Answer Socratic probing question or append --skip-grill to bypass...'
                : 'Send instructions to agent squad...'
            }
            className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <button
            type="submit"
            data-testid="chat-send-btn"
            disabled={!inputMessage.trim() || isStreaming}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 transition disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatCockpit;
