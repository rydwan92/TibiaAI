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
| `player_greeted` | playerGuid (int, z silnika), playerName, text (≤300), worldMinutes, tasks (taskId → stan z silnika) | powitanie skierowane do tego NPC (`T.onNpcSay`) |
| `player_said` | playerGuid, playerName, text (≤300), addressed (bool), distance (int), worldMinutes, tasks | wypowiedź w zasięgu słuchu. `addressed=true`: do tego NPC, `false`: zasłyszana, nigdy bez odpowiedzi |
| `incident_observed` | incidentId, description, distance, worldMinutes | `T.reportIncident`: tylko agenci w zasięgu wzroku na tym samym piętrze (ADR 0008) |
| `task_step_done` | playerGuid, playerName, taskId, stepId, state | `T.taskStep`: krok zlecenia wykonany przez silnik. Jedyna podstawa zmiany zaufania |
| `guide_ended` | playerGuid, playerName, placeId, outcome, x, y, z | `T.guideEnd`. Jedyny dowód wyniku prowadzenia. outcome: `arrived`, `left_behind`, `player_gone`, `cancelled`, `blocked`, `alarm`, `stopped`, `timeout` (ADR 0009) |
| `training_alarm_started` | zoneId, triggeredBy | `/alarm start [zone]` (GOD) lub `scripts/alarm.ps1 start`; jedno zdarzenie na każdego agenta reagującego na strefę |
| `training_alarm_cleared` | zoneId, clearedBy | `/alarm clear [zone]` lub `scripts/alarm.ps1 clear` |
| `position_observed` | x, y, z | w kontrakcie, jeszcze nie emitowany |
| `agent_heard` | speakerKey (inny znany agent), text (≤200), yelled (bool), distance (int) | `T.propagateSpeech` przy każdej wypowiedzi agenta; słuchacz z `hearing` w zasięgu na tym samym piętrze (ADR 0005). Nigdy nie wywołuje mowy: ani w Lua, ani w Brain (strażnik pętli odrzuca intencje każdego providera) |

GUID i pozycja zawsze pochodzą z silnika. Tekst czatu to niezaufane dane: nie zmienia allowlisty i nie staje się akcją. `threat_observed` dopiero po faktycznej percepcji silnika.

Brain: duplikat `messageId` jest ignorowany (SQLite PK). Zdarzenie ze starej sesji, z `sequence` ≤ ostatniemu albo starsze niż 15 s zostaje zapisane ze statusem `stale`, bez reakcji.

## Command (Brain → Lua)
payload: `commandId` (`[A-Za-z0-9_-]{1,64}`), `planRevision` (int ≥0), `expiresAtMs`, `action`, `args`.

| action | args | skutek |
| --- | --- | --- |
| `say` | text 1–200 znaków, bez znaków sterujących; opcjonalnie toPlayerGuid (cyfry) | lokalna mowa (TALKTYPE_SAY); limit 1 wypowiedź/3 s, z wyjątkiem odpowiedzi na oczekującą rozmowę. Gdy adresata nie ma w zasięgu: `addressee_gone` |
| `patrol` | routeId ∈ trasy agenta | stan PATROL (tylko agenci typu `patrol`, inaczej `not_a_patrol_agent`) |
| `move_to` | waypointId ∈ allowlist (nigdy współrzędne) | `accepted`, potem `completed` lub `failed` |
| `stop` | brak | stan STOPPED; przerywa prowadzenie |
| `guide_start` | placeId ∈ `guidePlaces` agenta, toPlayerGuid, text 1–200 znaków | silnik rozpoczyna prowadzenie i mówi text. Wynik `completed/guide_started` znaczy tylko start. Odmowy: `guide_busy`, `guide_already_active`, `no_path`, `alarm_active`, `addressee_gone`, `guide_not_allowed`, `agent_stopped`. Wymaga umiejętności `guide` |
| `task_step` | taskId, stepId, toPlayerGuid, text | krok zlecenia u agenta, który jest jego właścicielem. Argumenty nie niosą przedmiotów ani złota. Odmowy: `already_done`, `in_progress`, `no_capacity`, `item_missing`, `addressee_gone`, `task_not_allowed` |
| `guide_cancel` | toPlayerGuid | kończy prowadzenie tej osoby, inaczej `guide_not_active` |

W Brain akcje są zarejestrowane w `apps/brain/src/actions.ts`: każda deklaruje capability i walidację. Agent ma typ ciała `actor`, a `actorTypes` w `agents.json` określa jego capabilities; akcja bez zdolności kończy się `missing_capability` (przed zapisem komendy).

Kolejność walidacji w Lua (pierwszy błąd wygrywa): rozmiar ≤16 KiB (`too_large`), JSON (`invalid_json`, plik trafia do `quarantine/`), envelope (`invalid_envelope`), commandId (`invalid_command`), duplikat commandId (zwraca wcześniejszy wynik z `duplicate: true`, bez ponownej akcji), sesja (`stale_session`), agent (`unknown_agent`), TTL > 10 s (`ttl_too_long`), wygaśnięcie (status `expired`, `ttl_expired`), planRevision (`invalid_plan_revision`), akcja (`unknown_action`), argumenty (`invalid_args`), a dla akcji ruchu `planRevision` < bieżącego (`stale_plan`). Wykonanie: brak jednostki (`agent_missing`), trwający alarm blokuje patrol i move_to (`alarm_active`), limit mowy (`say_rate_limited`), adresat poza zasięgiem (`addressee_gone`), odpowiedź spóźniona po lokalnej odpowiedzi (`superseded_by_fallback`).

`planRevision` porządkuje **plany ruchu** (patrol/move_to/stop): nowsza rewizja anuluje bieżący ruch, a starsza jest odrzucana. `say` nie jest planem i nie podlega tej kontroli. Brain używa rewizji z `world.json` (`agent.planRevision`).

Brain waliduje komendę przed zapisem tymi samymi regułami (`validateCommand`). Domyślny TTL komendy z Brain wynosi 5 s.

`world.json` podaje przy agencie `guide` (placeId, playerGuid, waiting, ticks), gdy prowadzi. W czasie prowadzenia `patrol` i `move_to` kończą się `guide_active`.

Odpowiedź modelu ma schemat `{say, action, target, remember, promise, sentiment}`. Pole `target` istnieje tylko u agentów, którzy mogą prowadzić. `action = guide_to` działa wyłącznie razem z prośbą w słowach gracza. Pola `remember`, `promise` i `sentiment` nie są komendami: zostają przy komendzie jako plan i działają dopiero po wyniku `completed` (ADR 0008).

## Result (Lua → Brain)
payload: `commandId`, `status` (`accepted` | `completed` | `rejected` | `failed` | `expired`), `reasonCode`, opcjonalnie `actualPosition`, `completedAtMs` (dla statusów terminalnych), `duplicate`, `detail`.
`accepted` nie oznacza `completed`. Brain zapisuje skutek wyłącznie na podstawie wyniku silnika (`action_results`, `commands.status`), a duplikat nie nadpisuje statusu.
Kody wykonania ruchu: `arrived`, `no_path` (pathfinder nie znalazł drogi przez `moveTimeoutTicks` = 8 s), `blocked_timeout` (droga jest, ale brak postępu). Nigdy teleport.

## Pliki stanu
- `world.json` (Lua, co ~2 s): worldSessionId, startedAtMs, atMs, nextCommandSeq, lastEventSeq, lastResultSeq, droppedEvents, brainOnline, `agents`: mapa klucz → {state, alarmActive, routeId, routeIndex, moving, position, planRevision}. Stany: IDLE, PATROL, HOME, ALERT, RETURN, COMMAND_MOVE, STOPPED.
- `brain-heartbeat.json` (Brain, co 1 s): atMs, worldSessionId, lastEventSeq (potwierdzenie do backpressure), provider.

## Gracze-agenci (pliki, nie mailbox)
Ciało w kliencie i umysł w Brain wymieniają pliki w `runtime/players/<klucz>/`, opis w PLAYER_AGENTS.md.
- `state.json` (ciało, co 1 s): atMs, name, level, experience, hp, hpMax, mana, manaMax, cap, x, y, z, target, potions, gold, arrows, food, vocation, worn (slot → id), have (id → liczba), vips `[{name, online}]`, seen `[{name, kind, hp, x, y, z}]`.
- `events.jsonl` (ciało): `heard` {from, text, level, private}, `message` {text}, `death`, `vip` {from, online}, `adapter_error` {error}.
- `orders.json` (umysł): goal {type: idle|goto|floor|door|hunt|explore|follow|sail|talk|trade|depot, id, words (kolejne zdania do NPC przy talk), x, y, z, kind, name, heading, flee, buy, deposit}, say `[{id, text, atMs, to?}]`, healSpell, healMana, attackSpell, attackMana, runes, keep (identyfikatory wartego zabrania łupu), pvp (nazwa celu), wear `[{id, slot}]`, needKit (numer żądania zestawu).
- `events.jsonl` ma też `trade_done` {money}, `depot_done` {stored, taken, ok} i `loot_stuck`.
- Każdy rekord ma `session` (bieg ciała) i `seq`. Umysł przesuwa kursor (`players/events.ts`) wyłącznie za kompletne linie. Skrócony lub wymieniony plik poznaje po pierwszych bajtach i czyta od początku; ciało przenosi plik powyżej 2 MB do `events.jsonl.1` przy starcie, a umysł najpierw kończy nieprzeczytaną resztę. Odczyt to najwyżej 256 KB na raz.
- Kursor zapisuje się w tej samej transakcji co stan umysłu. Po restarcie te same rekordy trafiają na ten sam stan, więc skutki w `mind` nie liczą się podwójnie. Rekordy starsze niż 60 s liczą się do statystyk, ale agent nie odpowiada na nie ani nie oddaje ciosu. Powtórzenie w obrębie sesji jest pomijane.
- Żądania deweloperskie: `dev-kit.request` `Postać,zestaw[,refresh]`, `dev-strip.request` `Postać,slot`, `dev-kill.request` `Postać`, `nav-survey.request`, `survey.request`.
- Słowo `trade` przy NPC z `"shop": true` otwiera okno sklepu bez udziału Brain.

## Odporność
- Mailbox w ignorowanym `runtime/`, zablokowany dla Apache (`.htaccess`). Ścieżek nigdy nie podaje model.
- Watchdog: Brain uznaje się za offline, gdy heartbeat jest starszy niż 5 s (3 s + rozdzielczość zegara). Lua odpowiada wtedy od razu z reguł, a przy Brain online czeka na odpowiedź 2 s, potem fallback.
- Kolejka zdarzeń ograniczona do 100 niepotwierdzonych; nadwyżka trafia do dziennika jako `event_dropped_backpressure`.
- Brak exactly-once po awarii procesu; deduplikacja komend w pamięci sesji świata (200 ostatnich).
- Restart świata: nowa `worldSessionId`, więc komendy starej sesji nie są nawet otwierane, a Brain oznacza je jako `expired` (`world_session_ended`).

## Ciało postaci: dopisane pola
- `orders.addVip`: lista ludzi do dodania do VIP, po jednej osobie na 5 s.
- `orders.wear`: może zawierać kupioną zbroję; ciało zakłada ją zamiast tego, co nosi, gdy ma ją w plecaku.
- `goal.greet` przy `trade`: najpierw `hi`, potem `trade` na kanale NPC.
- `goal.deposit`: identyfikatory przedmiotów do depo; do `stored` liczą się tylko monety.
- Zdarzenie `message`: pola `broadcast` (ogłoszenie dla wszystkich) i `mode` (tryb klienta).

## Odpowiedź modelu na rozmowę
Oprócz `say`, `opinion`, `follow`: `lead_to` (identyfikator z listy własnych miejsc), `promise`, `their_promise`, `kept`, `note`. Wszystkie opcjonalne, sprawdzane przez mind. Identyfikator spoza listy jest ignorowany.
