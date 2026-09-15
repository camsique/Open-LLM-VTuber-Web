/**
 * Optional narrow extension event an OpenClaw adapter may send. Only state
 * labels and ids are accepted; never visual values (spec section 12).
 */
import { ToolCategory, VesselState, isVesselState } from '@/components/avatar/wintermute/vessel-types';

export interface VesselStateEvent {
  type: 'vessel-state';
  event_id: string;
  state: VesselState;
  tool_category?: ToolCategory;
  operation_id?: string;
  timestamp: string;
}

export function parseVesselStateEvent(raw: unknown): VesselStateEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== 'vessel-state') return null;
  if (typeof r.event_id !== 'string' || !isVesselState(r.state)) return null;
  const event: VesselStateEvent = {
    type: 'vessel-state',
    event_id: r.event_id,
    state: r.state,
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : new Date().toISOString(),
  };
  if (typeof r.operation_id === 'string') event.operation_id = r.operation_id;
  if (typeof r.tool_category === 'string') {
    const c = r.tool_category;
    if (c === 'web' || c === 'home' || c === 'code' || c === 'files' || c === 'other') event.tool_category = c;
  }
  return event;
}
