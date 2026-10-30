// Memory effects of a reply, applied only after the engine confirmed the speech. A planned reply
// that never reached the world leaves no trace in the NPC's memory.
import type { DialoguePlan } from './dialogue.ts';
import { recordInteraction, applySentiment } from './relations.ts';
import type { NpcMemoryStore } from './store.ts';

export interface ConfirmedReply {
  commandId: string;
  npcKey: string;
  text: string;
  worldSessionId: string;
  atMs: number;
  plan: DialoguePlan;
}

export function applyConfirmedReply(store: NpcMemoryStore, r: ConfirmedReply): void {
  const { plan } = r;
  store.tx(() => {
    store.addEvent({
      eventKey: `reply:${r.commandId}`, npcKey: r.npcKey, kind: 'said_by_npc', subjectGuid: plan.playerGuid, actorName: 'ty', text: r.text,
      source: 'server_confirmed', certainty: 'confirmed', visibility: 'private', importance: plan.promise ? 7 : 3, worldSessionId: r.worldSessionId, realAtMs: r.atMs,
    });
    recordInteraction(store, r.npcKey, plan.playerGuid, plan.playerName, r.commandId, r.atMs);
    if (plan.remember) store.setClaim(r.npcKey, plan.playerGuid, 'remembered', plan.remember, r.commandId, r.atMs);
    if (plan.promise) store.addCommitment(r.npcKey, plan.playerGuid, 'npc', plan.promise, r.commandId, r.atMs);
    if (plan.sentiment !== 0) applySentiment(store, r.npcKey, plan.playerGuid, plan.sentiment, r.text, r.commandId, r.atMs);
  });
}
