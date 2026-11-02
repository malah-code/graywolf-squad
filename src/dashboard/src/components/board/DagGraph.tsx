import React, { useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  Connection,
} from 'reactflow';
import type { TaskStatus } from './KanbanBoard';

export interface DagTaskNode {
  id: string;
  title?: string;
  status: TaskStatus;
  blockedBy: string[];
  writableScope: string[];
  position?: { x: number; y: number };
}

export function detectCycleInNodes(nodes: DagTaskNode[]): string[] | null {
  const nodeMap = new Map<string, DagTaskNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(currId: string): string[] | null {
    visited.add(currId);
    recursionStack.add(currId);
    path.push(currId);

    const node = nodeMap.get(currId);
    if (node) {
      for (const blockerId of node.blockedBy) {
        if (!visited.has(blockerId)) {
          const res = dfs(blockerId);
          if (res) return res;
        } else if (recursionStack.has(blockerId)) {
          return [...path, blockerId];
        }
      }
    }

    path.pop();
    recursionStack.delete(currId);
    return null;
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) {
      const cycle = dfs(n.id);
      if (cycle) return cycle;
    }
  }

  return null;
}

export function connectDagDependencyEdge(
  nodes: DagTaskNode[],
  sourceTaskId: string,
  targetTaskId: string
):
  | { cycle: false; updatedNodes: DagTaskNode[]; targetBlockedBy: string[] }
  | { cycle: true; cyclePath: string[] } {
  // Candidate: targetTaskId depends on sourceTaskId (blockedBy includes sourceTaskId)
  const candidateNodes = nodes.map((node) => {
    if (node.id === targetTaskId) {
      const nextBlockedBy = Array.from(new Set([...node.blockedBy, sourceTaskId]));
      return { ...node, blockedBy: nextBlockedBy };
    }
    return node;
  });

  const cycle = detectCycleInNodes(candidateNodes);
  if (cycle) {
    return { cycle: true, cyclePath: cycle };
  }

  const updatedTarget = candidateNodes.find((n) => n.id === targetTaskId)!;
  return {
    cycle: false,
    updatedNodes: candidateNodes,
    targetBlockedBy: updatedTarget.blockedBy,
  };
}

const DEFAULT_DAG_NODES: DagTaskNode[] = [
  {
    id: 'TASK-101',
    title: 'Fastify Streaming Route',
    status: 'IN_PROGRESS',
    blockedBy: [],
    writableScope: ['src/orchestrator/routes/chat.ts'],
    position: { x: 50, y: 50 },
  },
  {
    id: 'TASK-102',
    title: 'Socratic Grilling Prompt',
    status: 'INTERNAL_REVIEW',
    blockedBy: ['TASK-101'],
    writableScope: ['src/orchestrator/routes/chat.ts'],
    position: { x: 300, y: 50 },
  },
  {
    id: 'TASK-103',
    title: 'ChatCockpit UI Component',
    status: 'BACKLOG',
    blockedBy: ['TASK-102'],
    writableScope: ['src/dashboard/src/components/cockpit/ChatCockpit.tsx'],
    position: { x: 550, y: 50 },
  },
];

export interface DagGraphProps {
  initialNodes?: DagTaskNode[];
  onConnectEdge?: (source: string, target: string) => void;
  className?: string;
}

export function DagGraph({
  initialNodes = DEFAULT_DAG_NODES,
  onConnectEdge,
  className = '',
}: DagGraphProps): React.ReactElement {
  const [dagNodes, setDagNodes] = useState<DagTaskNode[]>(initialNodes);
  const [cycleError, setCycleError] = useState<string | null>(null);

  // Convert DagTaskNode to React Flow Node
  const flowNodes: Node[] = dagNodes.map((n, i) => ({
    id: n.id,
    position: n.position || { x: (i % 3) * 220 + 40, y: Math.floor(i / 3) * 120 + 40 },
    data: {
      label: (
        <div className="p-2 rounded bg-slate-900 border border-slate-700 text-xs">
          <div className="font-mono text-sky-400 font-bold">{n.id}</div>
          <div className="text-slate-200 text-[11px] font-medium">{n.title || n.id}</div>
          <div className="text-[10px] text-slate-400 font-mono mt-1">Status: {n.status}</div>
        </div>
      ),
    },
    style: { background: 'transparent', border: 'none', padding: 0 },
  }));

  // Convert blockedBy relationships into directed edges
  const flowEdges: Edge[] = [];
  dagNodes.forEach((node) => {
    node.blockedBy.forEach((blockerId) => {
      flowEdges.push({
        id: `e-${blockerId}-${node.id}`,
        source: blockerId,
        target: node.id,
        animated: true,
        style: { stroke: '#38bdf8', strokeWidth: 2 },
      });
    });
  });

  const [nodes, setNodes] = useState<Node[]>(flowNodes);
  const [edges, setEdges] = useState<Edge[]>(flowEdges);

  const onNodesChange = (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds));
  const onEdgesChange = (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds));

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const sourceId = connection.source;
    const targetId = connection.target;

    const res = connectDagDependencyEdge(dagNodes, sourceId, targetId);
    if (res.cycle) {
      setCycleError(`Dependency cycle detected: ${res.cyclePath.join(' → ')}`);
      return;
    }

    setCycleError(null);
    setDagNodes(res.updatedNodes);
    setEdges((eds) => [
      ...eds,
      {
        id: `e-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        animated: true,
        style: { stroke: '#38bdf8', strokeWidth: 2 },
      },
    ]);

    if (onConnectEdge) {
      onConnectEdge(sourceId, targetId);
    }
  };

  return (
    <div data-testid="dag-graph" className={`flex flex-col h-full bg-slate-950 text-slate-200 ${className}`.trim()}>
      <div className="p-2.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm">🕸️</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            React Flow DAG Visualizer (Branch Stacking & BlockedBy)
          </h3>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">Drag connectors between task nodes</span>
      </div>

      {cycleError && (
        <div data-testid="dag-cycle-error" className="bg-rose-950 border-b border-rose-800 px-3 py-1.5 text-xs text-rose-300 flex justify-between">
          <span>⚠️ {cycleError}</span>
          <button type="button" onClick={() => setCycleError(null)} className="text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      <div className="flex-1 w-full h-full min-h-[220px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          fitView
        >
          <Background color="#1e293b" gap={16} />
          <Controls className="bg-slate-900 border border-slate-800 text-white fill-white" />
        </ReactFlow>
      </div>
    </div>
  );
}

export default DagGraph;
