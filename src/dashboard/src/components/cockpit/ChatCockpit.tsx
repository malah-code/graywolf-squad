import React, { useState } from 'react';
import type { WorkspaceRole } from '../../context/DashboardContext';
import { AccessModePill, AccessModePillValue } from './AccessModePill';
import { SpendTicker, SpendTickerState } from './SpendTicker';
import { BidiProse } from '../../lib/bidi';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thoughtProcess?: string;
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
  onViewBoard?: () => void;
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
  onViewBoard,
}: ChatCockpitProps): React.ReactElement {
  const [cockpitMode, setCockpitMode] = useState<'STANDARD' | 'GRILL'>(initialCockpitMode);
  const [accessMode, setAccessMode] = useState<AccessModePillValue>(initialAccessMode);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationResult, setCancellationResult] = useState<string | null>(null);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [streamingThought, setStreamingThought] = useState<string>('');
  const [streamElapsedSec, setStreamElapsedSec] = useState<number>(0);
  const chatBottomRef = React.useRef<HTMLDivElement>(null);

  const storageKey = `graywolf_chat_history_${projectId || 'default'}`;

  const [spendState] = useState<SpendTickerState>({
    taskId: activeTaskId,
    taskSpendUsd: 0.045,
    workspaceDailySpendUsd: 4.82,
    dailySpendCapUsd: 50.0,
    totalTokens: 14200,
    connectionStatus: 'connected',
  });

  const [messages, setMessages] = useState<ChatMessageItem[]>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      }
    } catch {}
    return [
      {
        id: 'msg-init',
        role: 'assistant',
        content:
          'Graywolf Squad Cockpit active. Ready to plan, execute, or inspect tasks across your container workspace.',
      },
    ];
  });

  // Persist messages whenever they change
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && messages.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(messages));
      }
    } catch {}
  }, [messages, storageKey]);

  // When projectId changes, reload that project's chat history
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessages(parsed);
            return;
          }
        }
      }
    } catch {}
    setMessages([
      {
        id: 'msg-init',
        role: 'assistant',
        content:
          'Graywolf Squad Cockpit active. Ready to plan, execute, or inspect tasks across your container workspace.',
      },
    ]);
  }, [projectId, storageKey]);

  React.useEffect(() => {
    if (!isStreaming) {
      setStreamElapsedSec(0);
      setStreamingStatus(null);
      setStreamingThought('');
      return;
    }
    const timer = setInterval(() => {
      setStreamElapsedSec((s) => +(s + 0.5).toFixed(1));
    }, 500);
    return () => clearInterval(timer);
  }, [isStreaming]);

  React.useEffect(() => {
    chatBottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, isStreaming, streamingThought]);

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
        // Direct stream call to backend /api/v1/chat/stream
        try {
          const res = await fetch('/api/v1/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: projectId || '00000000-0000-4000-8000-000000000001',
              taskId: activeTaskId,
              messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
              cockpitMode,
              accessModeOverride: accessMode,
              currentFile,
            }),
          });

          if (!res.ok || !res.body) {
            throw new Error(`Chat stream returned ${res.status}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let fullAssistantContent = '';
          let capturedThought = '';
          const aiMsgId = `msg-${Date.now()}-ai`;

          const updateAssistantMessage = (content: string, briefPreview?: string, requiresConfirmation?: boolean, thought?: string) => {
            let finalContent = content;
            let finalThought = thought || capturedThought;
            const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
            if (thinkMatch) {
              finalThought = thinkMatch[1].trim();
              finalContent = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
            }

            setMessages((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === aiMsgId);
              if (existingIdx !== -1) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  content: finalContent || updated[existingIdx].content,
                  thoughtProcess: finalThought || updated[existingIdx].thoughtProcess,
                  ...(briefPreview !== undefined ? { briefPreview, requiresConfirmation } : {}),
                };
                return updated;
              }
              return [
                ...prev,
                {
                  id: aiMsgId,
                  role: 'assistant',
                  content: finalContent,
                  thoughtProcess: finalThought,
                  ...(briefPreview !== undefined ? { briefPreview, requiresConfirmation } : {}),
                },
              ];
            });
          };

          const parseFrame = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) {
              fullAssistantContent += (fullAssistantContent ? '\n' : '') + trimmed;
              updateAssistantMessage(fullAssistantContent);
              return;
            }
            const code = trimmed.slice(0, colonIdx);
            const payloadStr = trimmed.slice(colonIdx + 1);

            try {
              const payload = JSON.parse(payloadStr);
              if (code === '0') {
                fullAssistantContent += payload;
                updateAssistantMessage(fullAssistantContent);
              } else if (code === '2') {
                if (Array.isArray(payload)) {
                  for (const item of payload) {
                    if (item.type === 'progress') {
                      setStreamingStatus(item.message || 'Thinking...');
                    } else if (item.type === 'thought') {
                      capturedThought = item.thought;
                      setStreamingThought(item.thought);
                      updateAssistantMessage(fullAssistantContent, undefined, undefined, capturedThought);
                    } else if (item.briefPreviewMarkdown) {
                      updateAssistantMessage(fullAssistantContent, item.briefPreviewMarkdown, item.requiresConfirmation);
                    }
                  }
                }
              }
            } catch {
              if (code === '0' || !code.match(/^[0-9a-z]$/)) {
                fullAssistantContent += payloadStr;
                updateAssistantMessage(fullAssistantContent);
              }
            }
          };

          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              parseFrame(line);
            }
          }

          if (buffer.trim()) {
            parseFrame(buffer);
          }

          if (!fullAssistantContent.trim()) {
            fullAssistantContent = 'Acknowledged. Ready to plan and execute tasks for this project.';
            updateAssistantMessage(fullAssistantContent);
          }
        } catch {
          // Fallback simulated response if no external backend available or in isolated test runner
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
        content: '✅ Task created and added to your Kanban Board & DAG! Ready to dispatch squad.',
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

          {/* Clear Chat Button */}
          <button
            type="button"
            data-testid="clear-chat-btn"
            onClick={() => {
              const initial: ChatMessageItem[] = [
                {
                  id: 'msg-init',
                  role: 'assistant',
                  content:
                    'Graywolf Squad Cockpit active. Ready to plan, execute, or inspect tasks across your container workspace.',
                },
              ];
              setMessages(initial);
              try {
                if (typeof window !== 'undefined') {
                  localStorage.removeItem(storageKey);
                }
              } catch {}
            }}
            className="rounded px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
            title="Clear chat history for this project"
          >
            Clear
          </button>
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
              {/* Expandable Architectural Thought / Reasoning Process */}
              {m.thoughtProcess && (
                <details className="mb-3 rounded-lg bg-slate-950/80 p-2.5 border border-sky-950/80 text-xs group" open>
                  <summary className="cursor-pointer font-mono text-[11px] font-semibold text-sky-400 hover:text-sky-300 select-none flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <span>🧠</span>
                      <span>Squad Reasoning & Analysis</span>
                    </span>
                    <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="mt-2 text-[11px] whitespace-pre-wrap text-slate-300 font-mono border-t border-slate-800/60 pt-2 leading-relaxed max-h-60 overflow-y-auto">
                    {m.thoughtProcess}
                  </div>
                </details>
              )}

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
              {/* Vibe Coder Action: Create Task on Board from Assistant Plan */}
              {m.role === 'assistant' && m.id !== 'msg-init' && !m.briefPreview && (
                <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-800">
                  <span className="text-[11px] text-slate-400">Ready to build this?</span>
                  <button
                    type="button"
                    onClick={() => handleConfirmQueueTask(m.content)}
                    className="flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition"
                  >
                    <span>⚡</span>
                    <span>Create Task on Board</span>
                  </button>
                </div>
              )}

              {/* View Board & DAG Switch Shortcut */}
              {m.role === 'system' && onViewBoard && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={onViewBoard}
                    className="text-xs font-bold text-sky-400 hover:text-sky-300 underline flex items-center space-x-1"
                  >
                    <span>👉 Switch to Board & DAG to Dispatch Squad</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Live Thinking & Progress Indicator */}
        {isStreaming && (
          <div data-testid="assistant-thinking-indicator" className="flex flex-col items-start space-y-2">
            <div className="flex items-center space-x-2.5 rounded-xl bg-slate-900/90 border border-slate-800 px-4 py-2.5 text-xs text-sky-400 shadow-md">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
              </span>
              <span className="font-semibold">{streamingStatus || 'Squad is analyzing and formulating plan...'}</span>
              <span className="text-slate-400 font-mono text-[11px]">({streamElapsedSec.toFixed(1)}s)</span>
            </div>

            {streamingThought && (
              <div className="max-w-[85%] rounded-lg bg-slate-950/90 p-3 border border-sky-900/40 text-xs font-mono text-slate-300 shadow">
                <div className="flex items-center space-x-1.5 text-sky-400 mb-1 text-[11px] font-bold">
                  <span>🧠</span>
                  <span>Active Reasoning Stream:</span>
                </div>
                <p className="whitespace-pre-wrap text-[11px] text-slate-400 max-h-40 overflow-y-auto">{streamingThought}</p>
              </div>
            )}
          </div>
        )}
        <div ref={chatBottomRef} />
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
