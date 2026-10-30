// Perception: turns engine events into what one NPC actually experienced. Each engine event names
// its listener in agentKey, so an NPC only ever records what reached it; there is no global stream.
import type { Envelope, EventPayload } from '../contracts.ts';
import type { NpcEventInput } from './store.ts';

const NAME_PATTERNS = [
  /\b(?:nazywam si[eę]|mam na imi[eę]|jestem znany jako|m[oó]wi[aą] mi)\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż][\wĄĆĘŁŃÓŚŹŻąćęłńóśźż-]{1,24})/i,
];
const OCCUPATION_PATTERN = /\bjestem\s+(kowalem|kupcem|rycerzem|magiem|zlodziejem|złodziejem|lucznikiem|łucznikiem|druidem|kucharzem|rybakiem|gornikiem|górnikiem|podroznikiem|podróżnikiem|poszukiwaczem przygod|lekarzem|bardem)\b/i;

/** Self-descriptions the NPC should remember. They stay claims; the engine confirms none of them. */
export function extractClaims(text: string): { key: string; value: string }[] {
  const claims: { key: string; value: string }[] = [];
  for (const re of NAME_PATTERNS) {
    const m = text.match(re);
    if (m) claims.push({ key: 'claimed_name', value: m[1] });
  }
  const job = text.match(OCCUPATION_PATTERN);
  if (job) claims.push({ key: 'claimed_occupation', value: job[1].toLowerCase() });
  return claims;
}

function isPlayerSpeech(p: EventPayload): p is Extract<EventPayload, { type: 'player_greeted' | 'player_said' }> {
  return p.type === 'player_greeted' || p.type === 'player_said';
}

export function isConversationTurn(ev: Envelope<EventPayload>): boolean {
  const p = ev.payload;
  return p.type === 'player_greeted' || (p.type === 'player_said' && p.addressed);
}

/** Maps an engine event to the memory row of its listener; null when it is not worth remembering. */
export function perceive(ev: Envelope<EventPayload>): NpcEventInput | null {
  const base = {
    eventKey: ev.messageId,
    npcKey: ev.agentKey,
    worldSessionId: ev.worldSessionId,
    realAtMs: ev.createdAtMs,
  };
  const p = ev.payload;
  if (isPlayerSpeech(p)) {
    const addressed = p.type === 'player_greeted' || p.addressed;
    return {
      ...base,
      kind: addressed ? 'said_by_player' : 'heard',
      subjectGuid: p.playerGuid,
      actorName: p.playerName,
      text: p.text,
      source: addressed ? 'direct' : 'heard',
      certainty: addressed ? 'claimed' : 'rumor',
      visibility: addressed ? 'private' : 'public',
      importance: extractClaims(p.text).length > 0 ? 6 : 3,
      worldMinutes: p.worldMinutes,
    };
  }
  switch (p.type) {
    case 'agent_heard':
      return { ...base, kind: 'heard', subjectGuid: null, actorName: p.speakerKey, text: p.text, source: 'heard', certainty: 'rumor', visibility: 'public', importance: p.yelled ? 4 : 2 };
    case 'training_alarm_started':
      return { ...base, kind: 'witnessed', subjectGuid: null, actorName: 'swiat', text: 'Oglosono alarm cwiczebny przy bramie.', source: 'witnessed', certainty: 'confirmed', visibility: 'public', importance: 5 };
    case 'training_alarm_cleared':
      return { ...base, kind: 'witnessed', subjectGuid: null, actorName: 'swiat', text: 'Alarm cwiczebny odwolano.', source: 'witnessed', certainty: 'confirmed', visibility: 'public', importance: 3 };
    case 'incident_observed':
      return { ...base, kind: 'witnessed', subjectGuid: null, actorName: 'swiat', text: p.description, source: 'witnessed', certainty: 'confirmed', visibility: 'public', importance: 6, worldMinutes: p.worldMinutes };
    default:
      return null;
  }
}
