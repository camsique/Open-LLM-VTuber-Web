/**
 * Tracks backend tool calls by id so the vessel can show `working` while
 * any tool runs and a short `error` when one fails. Framework-free external
 * store (useSyncExternalStore-compatible), fed by the WebSocket handler.
 */
import type { ToolCategory } from '@/components/avatar/wintermute/vessel-types';

export type ToolStatus = 'running' | 'completed' | 'error';

export interface ToolActivity {
  id: string;
  name: string;
  category: ToolCategory;
  status: ToolStatus;
  updatedMs: number;
}

export interface ToolStatusEvent {
  tool_id: string;
  tool_name: string;
  status: ToolStatus | string;
  timestamp?: string;
}

/** How long a failed tool keeps the vessel in `error`. */
export const TOOL_ERROR_HOLD_MS = 2400;

export function classifyTool(name: string): ToolCategory {
  const lower = (name || '').toLowerCase();
  if (lower.includes('web') || lower.includes('search') || lower.includes('browser')) return 'web';
  if (lower.includes('home') || lower.includes('light') || lower.includes('sensor')) return 'home';
  if (lower.includes('code') || lower.includes('shell') || lower.includes('git')) return 'code';
  if (lower.includes('file') || lower.includes('document')) return 'files';
  return 'other';
}

function isToolStatus(value: unknown): value is ToolStatus {
  return value === 'running' || value === 'completed' || value === 'error';
}

export class ToolActivityStore {
  private tools = new Map<string, ToolActivity>();

  private snapshot: ToolActivity[] = [];

  private listeners = new Set<() => void>();

  private approvalPending = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Immutable array; a new one only when something changed. */
  getSnapshot = (): ToolActivity[] => this.snapshot;

  isApprovalPending(): boolean {
    return this.approvalPending;
  }

  setApprovalPending(pending: boolean): void {
    if (this.approvalPending === pending) return;
    this.approvalPending = pending;
    this.notify();
  }

  apply(event: ToolStatusEvent, nowMs: number = Date.now()): void {
    if (!event.tool_id || !isToolStatus(event.status)) return;
    const ts = event.timestamp ? Date.parse(event.timestamp) : NaN;
    const updatedMs = Number.isFinite(ts) ? ts : nowMs;
    if (event.status === 'completed') {
      if (!this.tools.delete(event.tool_id)) return;
    } else {
      this.tools.set(event.tool_id, {
        id: event.tool_id,
        name: event.tool_name || event.tool_id,
        category: classifyTool(event.tool_name),
        status: event.status,
        updatedMs,
      });
    }
    this.prune(nowMs);
    this.publish();
  }

  /** Drop expired error entries; returns true when something was removed. */
  prune(nowMs: number = Date.now()): boolean {
    let removed = false;
    this.tools.forEach((tool, id) => {
      if (tool.status === 'error' && nowMs - tool.updatedMs >= TOOL_ERROR_HOLD_MS) {
        this.tools.delete(id);
        removed = true;
      }
    });
    if (removed) this.publish();
    return removed;
  }

  clear(): void {
    if (this.tools.size === 0 && !this.approvalPending) return;
    this.tools.clear();
    this.approvalPending = false;
    this.publish();
  }

  private publish(): void {
    this.snapshot = Array.from(this.tools.values());
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const toolActivityStore = new ToolActivityStore();
