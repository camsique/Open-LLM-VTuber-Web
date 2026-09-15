/**
 * Routes backend messages that only the vessel cares about into the
 * tool-activity store. Called from the WebSocket handler; keeps the
 * handler free of vessel logic.
 */
import { toolActivityStore } from '@/services/tool-activity-store';
import { parseVesselStateEvent } from '@/types/vessel-events';

export function handleToolCallStatus(message: {
  tool_id?: string; tool_name?: string; status?: string; timestamp?: string;
}): void {
  if (!message.tool_id || !message.status) return;
  toolActivityStore.apply({
    tool_id: message.tool_id,
    tool_name: message.tool_name ?? message.tool_id,
    status: message.status,
    timestamp: message.timestamp,
  });
}

/** Returns true when the raw message was a valid vessel-state event. */
export function handleVesselStateEvent(raw: unknown): boolean {
  const event = parseVesselStateEvent(raw);
  if (!event) return false;
  // Only `approval` needs an external signal; every other state is derived
  // locally from conversation, audio and tool activity.
  toolActivityStore.setApprovalPending(event.state === 'approval');
  return true;
}

/** A new conversation turn resolves any pending approval. */
export function handleConversationChainStart(): void {
  toolActivityStore.setApprovalPending(false);
}
