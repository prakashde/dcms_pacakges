/**
 * Lightweight shell state used by hosts that only need mode/node navigation.
 * The full parity application uses createWorkbenchStore for Form/Record state.
 */
import { cloneFrozenGraph } from "./immutable.js";

export const WORKBENCH_MODES = ["revision", "form", "record"] as const;
export type WorkbenchShellMode = (typeof WORKBENCH_MODES)[number];

export interface WorkbenchNode {
  id: string;
  title: string;
  form: unknown;
  saved: boolean;
}

export interface WorkbenchShellSnapshot {
  readonly mode: WorkbenchShellMode;
  readonly activeNodeId: string;
  readonly nodes: readonly Readonly<WorkbenchNode>[];
}

function immutableNode(node: WorkbenchNode): Readonly<WorkbenchNode> {
  return Object.freeze({
    ...node,
    form: cloneFrozenGraph(node.form)
  });
}

export function createWorkbenchShell(initialNodes: WorkbenchNode[]) {
  if (!initialNodes.length)
    throw new Error("At least one Form node is required.");
  const nodeIds = new Set<string>();
  for (const node of initialNodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate Workbench shell node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }
  let mode: WorkbenchShellMode = "revision";
  let activeNodeId = initialNodes[0].id;
  let nodes: readonly Readonly<WorkbenchNode>[] = Object.freeze(
    initialNodes.map(immutableNode)
  );
  const listeners = new Set<() => void>();
  let currentSnapshot: WorkbenchShellSnapshot;

  const rebuildSnapshot = () => {
    currentSnapshot = Object.freeze({
      mode,
      activeNodeId,
      nodes
    });
  };
  const emit = () => {
    rebuildSnapshot();
    listeners.forEach((listener) => listener());
  };
  rebuildSnapshot();

  return {
    getSnapshot() {
      return currentSnapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setMode(next: WorkbenchShellMode) {
      if (mode === next) return;
      mode = next;
      emit();
    },
    selectNode(id: string) {
      if (!nodes.some((node) => node.id === id))
        throw new Error(`Unknown Form node: ${id}`);
      if (activeNodeId === id) return;
      activeNodeId = id;
      emit();
    },
    markSaved(id: string, saved: boolean) {
      const current = nodes.find((node) => node.id === id);
      if (!current) throw new Error(`Unknown Form node: ${id}`);
      if (current.saved === saved) return;
      nodes = Object.freeze(
        nodes.map((node) =>
          node.id === id ? immutableNode({ ...node, saved }) : node
        )
      );
      emit();
    }
  };
}

export type WorkbenchShell = ReturnType<typeof createWorkbenchShell>;
