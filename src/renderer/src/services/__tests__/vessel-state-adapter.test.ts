import { describe, it, expect } from 'vitest';
import {
  COMPLETE_HOLD_MS,
  VESSEL_PRIORITY,
  VesselInputs,
  VesselTracker,
  assertedStates,
  resolveByPriority,
} from '../vessel-state-adapter';
import {
  TOOL_ERROR_HOLD_MS,
  ToolActivity,
  ToolActivityStore,
  classifyTool,
} from '../tool-activity-store';
import { VESSEL_STATES } from '@/components/avatar/wintermute/vessel-types';

const T0 = 1_000_000;

function inputs(over: Partial<VesselInputs> = {}): VesselInputs {
  return {
    aiState: 'idle', isPlaying: false, tools: [], approvalPending: false, nowMs: T0, ...over,
  };
}

function tool(over: Partial<ToolActivity> = {}): ToolActivity {
  return {
    id: 't1', name: 'web_search', category: 'web', status: 'running', updatedMs: T0, ...over,
  };
}

describe('priority', () => {
  it('lists every vessel state exactly once', () => {
    expect([...VESSEL_PRIORITY].sort()).toEqual([...VESSEL_STATES].sort());
  });

  it('resolves the highest asserted state', () => {
    expect(resolveByPriority(new Set(['idle', 'thinking', 'speaking']))).toBe('speaking');
    expect(resolveByPriority(new Set(['idle', 'working', 'error']))).toBe('error');
    expect(resolveByPriority(new Set(['idle', 'approval', 'interrupted']))).toBe('approval');
    expect(resolveByPriority(new Set())).toBe('idle');
  });
});

describe('assertedStates / mapping', () => {
  it('maps upstream AiState one to one', () => {
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'loading' }), 0))).toBe('loading');
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'listening' }), 0))).toBe('listening');
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'waiting' }), 0))).toBe('waiting');
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'interrupted' }), 0))).toBe('interrupted');
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'thinking-speaking' }), 0))).toBe('thinking');
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'idle' }), 0))).toBe('idle');
  });

  it('audio playing is speaking regardless of AiState', () => {
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'thinking-speaking', isPlaying: true }), 0))).toBe('speaking');
  });

  it('a running tool is working unless audio is playing', () => {
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'thinking-speaking', tools: [tool()] }), 0))).toBe('working');
    expect(resolveByPriority(assertedStates(inputs({ isPlaying: true, tools: [tool()] }), 0))).toBe('speaking');
  });

  it('a recent tool error is error, an old one is not', () => {
    const fresh = tool({ status: 'error', updatedMs: T0 - 100 });
    const stale = tool({ status: 'error', updatedMs: T0 - TOOL_ERROR_HOLD_MS });
    expect(resolveByPriority(assertedStates(inputs({ tools: [fresh] }), 0))).toBe('error');
    expect(resolveByPriority(assertedStates(inputs({ tools: [stale] }), 0))).toBe('idle');
  });

  it('interrupted beats speaking and working', () => {
    expect(resolveByPriority(assertedStates(inputs({ aiState: 'interrupted', isPlaying: true, tools: [tool()] }), 0))).toBe('interrupted');
  });
});

describe('VesselTracker', () => {
  it('opens a complete window after a clean response and closes it on time', () => {
    const tr = new VesselTracker(T0);
    expect(tr.update(inputs({ aiState: 'thinking-speaking' })).state).toBe('thinking');
    const r1 = tr.update(inputs({ aiState: 'thinking-speaking', isPlaying: true, nowMs: T0 + 500 }));
    expect(r1.state).toBe('speaking');
    expect(r1.stateSinceMs).toBe(T0 + 500);
    const r2 = tr.update(inputs({ aiState: 'idle', nowMs: T0 + 3000 }));
    expect(r2.state).toBe('complete');
    expect(r2.nextChangeMs).toBe(T0 + 3000 + COMPLETE_HOLD_MS);
    expect(tr.update(inputs({ aiState: 'idle', nowMs: T0 + 3000 + COMPLETE_HOLD_MS - 1 })).state).toBe('complete');
    expect(tr.update(inputs({ aiState: 'idle', nowMs: T0 + 3000 + COMPLETE_HOLD_MS })).state).toBe('idle');
  });

  it('does not acknowledge an interrupted response', () => {
    const tr = new VesselTracker(T0);
    tr.update(inputs({ aiState: 'thinking-speaking', isPlaying: true }));
    expect(tr.update(inputs({ aiState: 'interrupted', nowMs: T0 + 100 })).state).toBe('interrupted');
    expect(tr.update(inputs({ aiState: 'idle', nowMs: T0 + 200 })).state).toBe('idle');
  });

  it('does not acknowledge between sentences of one response', () => {
    const tr = new VesselTracker(T0);
    tr.update(inputs({ aiState: 'thinking-speaking', isPlaying: true }));
    // Gap between audio tasks: still thinking-speaking upstream.
    expect(tr.update(inputs({ aiState: 'thinking-speaking', isPlaying: false, nowMs: T0 + 50 })).state).toBe('thinking');
    expect(tr.update(inputs({ aiState: 'thinking-speaking', isPlaying: true, nowMs: T0 + 80 })).state).toBe('speaking');
  });

  it('reports the failed tool and schedules the error expiry', () => {
    const tr = new VesselTracker(T0);
    const failed = tool({ status: 'error', name: 'shell_exec', category: 'code' });
    const r = tr.update(inputs({ tools: [failed], nowMs: T0 + 10 }));
    expect(r.state).toBe('error');
    expect(r.tool).toEqual({ active: false, name: 'shell_exec', category: 'code', failed: true });
    expect(r.nextChangeMs).toBe(T0 + TOOL_ERROR_HOLD_MS);
    expect(tr.update(inputs({ tools: [failed], nowMs: T0 + TOOL_ERROR_HOLD_MS })).state).toBe('idle');
  });

  it('reports the running tool while working', () => {
    const tr = new VesselTracker(T0);
    const r = tr.update(inputs({ aiState: 'thinking-speaking', tools: [tool({ name: 'browser_open' })] }));
    expect(r.state).toBe('working');
    expect(r.tool).toEqual({ active: true, name: 'browser_open', category: 'web' });
  });

  it('cancels a pending acknowledgement when a new turn starts', () => {
    const tr = new VesselTracker(T0);
    tr.update(inputs({ aiState: 'thinking-speaking', isPlaying: true }));
    expect(tr.update(inputs({ aiState: 'idle', nowMs: T0 + 100 })).state).toBe('complete');
    expect(tr.update(inputs({ aiState: 'listening', nowMs: T0 + 200 })).state).toBe('listening');
    expect(tr.update(inputs({ aiState: 'idle', nowMs: T0 + 300 })).state).toBe('idle');
  });
});

describe('ToolActivityStore', () => {
  it('tracks by id, completes remove, errors expire', () => {
    const store = new ToolActivityStore();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().length));
    store.apply({ tool_id: 'a', tool_name: 'web_search', status: 'running' }, T0);
    store.apply({ tool_id: 'b', tool_name: 'read_file', status: 'running' }, T0);
    expect(store.getSnapshot().map((t) => t.id)).toEqual(['a', 'b']);
    store.apply({ tool_id: 'a', tool_name: 'web_search', status: 'completed' }, T0 + 10);
    expect(store.getSnapshot().map((t) => t.id)).toEqual(['b']);
    store.apply({ tool_id: 'b', tool_name: 'read_file', status: 'error' }, T0 + 20);
    expect(store.getSnapshot()[0].status).toBe('error');
    expect(store.prune(T0 + 20 + TOOL_ERROR_HOLD_MS - 1)).toBe(false);
    expect(store.prune(T0 + 20 + TOOL_ERROR_HOLD_MS)).toBe(true);
    expect(store.getSnapshot()).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('ignores malformed events and unknown completions', () => {
    const store = new ToolActivityStore();
    store.apply({ tool_id: '', tool_name: 'x', status: 'running' });
    store.apply({ tool_id: 'z', tool_name: 'x', status: 'weird' });
    store.apply({ tool_id: 'never', tool_name: 'x', status: 'completed' });
    expect(store.getSnapshot()).toEqual([]);
  });

  it('uses the event timestamp when valid', () => {
    const store = new ToolActivityStore();
    store.apply({ tool_id: 'a', tool_name: 'x', status: 'running', timestamp: '2026-09-15T18:30:00Z' }, T0);
    expect(store.getSnapshot()[0].updatedMs).toBe(Date.parse('2026-09-15T18:30:00Z'));
  });

  it('returns the same snapshot reference when nothing changed', () => {
    const store = new ToolActivityStore();
    const a = store.getSnapshot();
    store.apply({ tool_id: 'never', tool_name: 'x', status: 'completed' });
    expect(store.getSnapshot()).toBe(a);
  });
});

describe('classifyTool', () => {
  it('classifies by name, deterministically', () => {
    expect(classifyTool('web_search')).toBe('web');
    expect(classifyTool('BrowserNavigate')).toBe('web');
    expect(classifyTool('home_assistant_light')).toBe('home');
    expect(classifyTool('shell_exec')).toBe('code');
    expect(classifyTool('git_status')).toBe('code');
    expect(classifyTool('read_file')).toBe('files');
    expect(classifyTool('document_lookup')).toBe('files');
    expect(classifyTool('weather')).toBe('other');
    expect(classifyTool('')).toBe('other');
  });
});
