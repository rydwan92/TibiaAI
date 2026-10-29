# Kontrakt v1 (IMPLEMENTED, transport mailbox, ADR 0002)

Wiadomości JSON w plikach `runtime/mailbox`. Ta sama walidacja po obu stronach: Lua w `game/overlays/tibia-ai/tibia-ai/lib/bridge.lua`, TypeScript w `apps/brain/src/contracts.ts`. Agenci, ich punkty i trasy, akcje oraz limity pochodzą z jednego pliku `packages/contracts/agents.json` (ADR 0004, opis pól w AGENTS.md). Allowlista punktów i tras obowiązuje **dla każdego agenta osobno**.

## Envelope
| Pole | Typ | Uwagi |
| --- | --- | --- |
| schemaVersion | 1 | inna wartość → `invalid_envelope` |
| messageId | string ≤64 | UUID |
| kind | `event` \| `command` \| `result` | |
| worldSessionId | `[A-Za-z0-9_-]{1,64}` | losowany przez Lua przy każdym starcie świata (16 hex) |
| agentKey | klucz z `agents.json` (`ardan`, `mira`) | stabilny klucz agenta; nieznany → `unknown_agent` (komenda) / odrzucenie (event) |
| createdAtMs | integer, epoch ms | Lua ma rozdzielczość 1 s (`os.time()*1000`) |
| correlationId | string ≤64 | event: = messageId; command: = eventId, na który odpowiada; result: = correlationId komendy |
| sequence | integer ≥1 | tylko event, monotoniczny w sesji |
| payload | obiekt | zależny od kind |

Zmiana względem v0: znaczniki czasu to liczby epoch ms (`createdAtMs`, `expiresAtMs`, `completedAtMs`) zamiast ISO, bo Lua nie parsuje ISO bez dodatkowego kodu.

## Event (Lua → Brain)
| type | pola | źródło |
| --- | --- | --- |
| `player_greeted` | playerGuid (int, z silnika), playerName, text (≤300) | `npcType.onSay` + dystans ≤4 + cooldown 8 s na gracza |
| `training_alarm_started` | zoneId, triggeredBy | `/alarm start [zone]` (GOD) lub `scripts/alarm.ps1 start`; jedno zdarzenie na każdego agenta reagującego na strefę |
| `training_alarm_cleared` | zoneId, clearedBy | `/alarm clear [zone]` lub `scripts/alarm.ps1 clear` |
| `position_observed` | x, y, z | w kontrakcie, jeszcze nie emitowany |

GUID i pozycja zawsze pochodzą z silnika. Tekst czatu to niezaufane dane: nie zmienia allowlisty i nie staje się akcją. `threat_observed` dopiero po faktycznej percepcji silnika.

Brain: duplikat `messageId` jest ignorowany (SQLite PK). Zdarzenie ze starej sesji, z `sequence` ≤ ostatniemu albo starsze niż 15 s zostaje zapisane ze statusem `stale`, bez reakcji.

## Command (Brain → Lua)
payload: `commandId` (`[A-Za-z0-9_-]{1,64}`), `planRevision` (int ≥0), `expiresAtMs`, `action`, `args`.

| action | args | skutek |
| --- | --- | --- |
| `say` | text 1–200 znaków, bez znaków sterujących | lokalna mowa (TALKTYPE_SAY); limit 1 wypowiedź/3 s, z wyjątkiem odpowiedzi na oczekujące powitanie |
| `patrol` | routeId ∈ trasy agenta | stan PATROL (tylko agenci typu `patrol`, inaczej `not_a_patrol_agent`) |
| `move_to` | waypointId ∈ allowlist (nigdy współrzędne) | `accepted`, potem `completed` lub `failed` |
| `stop` | brak | stan STOPPED |

Kolejność walidacji w Lua (pierwszy błąd wygrywa): rozmiar ≤16 KiB (`too_large`), JSON (`invalid_json`, plik trafia do `quarantine/`), envelope (`invalid_envelope`), commandId (`invalid_command`), duplikat commandId (zwraca wcześniejszy wynik z `duplicate: true`, bez ponownej akcji), sesja (`stale_session`), agent (`unknown_agent`), TTL > 10 s (`ttl_too_long`), wygaśnięcie (status `expired`, `ttl_expired`), planRevision (`invalid_plan_revision`), akcja (`unknown_action`), argumenty (`invalid_args`), a dla akcji ruchu `planRevision` < bieżącego (`stale_plan`). Wykonanie: brak jednostki (`agent_missing`), trwający alarm blokuje patrol i move_to (`alarm_active`), limit mowy (`say_rate_limited`), odpowiedź spóźniona po lokalnym powitaniu (`superseded_by_fallback`).

`planRevision` porządkuje **plany ruchu** (patrol/move_to/stop): nowsza rewizja anuluje bieżący ruch, a starsza jest odrzucana. `say` nie jest planem i nie podlega tej kontroli. Brain używa rewizji z `world.json` (`agent.planRevision`).

Brain waliduje komendę przed zapisem tymi samymi regułami (`validateCommand`). Domyślny TTL komendy z Brain wynosi 5 s.

## Result (Lua → Brain)
payload: `commandId`, `status` (`accepted` | `completed` | `rejected` | `failed` | `expired`), `reasonCode`, opcjonalnie `actualPosition`, `completedAtMs` (dla statusów terminalnych), `duplicate`, `detail`.
`accepted` nie oznacza `completed`. Brain zapisuje skutek wyłącznie na podstawie wyniku silnika (`action_results`, `commands.status`), a duplikat nie nadpisuje statusu.
Kody wykonania ruchu: `arrived`, `no_path` (pathfinder nie znalazł drogi przez `moveTimeoutTicks` = 8 s), `blocked_timeout` (droga jest, ale brak postępu). Nigdy teleport.

## Pliki stanu
- `world.json` (Lua, co ~2 s): worldSessionId, startedAtMs, atMs, nextCommandSeq, lastEventSeq, lastResultSeq, droppedEvents, brainOnline, `agents`: mapa klucz → {state, alarmActive, routeId, routeIndex, moving, position, planRevision}. Stany: IDLE, PATROL, HOME, ALERT, RETURN, COMMAND_MOVE, STOPPED.
- `brain-heartbeat.json` (Brain, co 1 s): atMs, worldSessionId, lastEventSeq (potwierdzenie do backpressure), provider.

## Odporność
- Mailbox w ignorowanym `runtime/`, zablokowany dla Apache (`.htaccess`). Ścieżek nigdy nie podaje model.
- Watchdog: Brain uznaje się za offline, gdy heartbeat jest starszy niż 5 s (3 s + rozdzielczość zegara). Lua odpowiada wtedy od razu z reguł, a przy Brain online czeka na odpowiedź 2 s, potem fallback.
- Kolejka zdarzeń ograniczona do 100 niepotwierdzonych; nadwyżka trafia do dziennika jako `event_dropped_backpressure`.
- Brak exactly-once po awarii procesu; deduplikacja komend w pamięci sesji świata (200 ostatnich).
- Restart świata: nowa `worldSessionId`, więc komendy starej sesji nie są nawet otwierane, a Brain oznacza je jako `expired` (`world_session_ended`).
