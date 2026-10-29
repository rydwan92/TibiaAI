# Iteracja 0002: Ardan w Lua (M2, poziom silnika)
Data: 2026-10-29
Stan: IMPLEMENTED + VERIFIED w silniku (dziennik, bez GUI); widoczność w kliencie NOT RUN
Upstream: Canary v3.6.1 `fe0f932` (bez zmian; overlay `game/overlays/tibia-ai`)

## Cel i warunek odbioru
Cel zapisany w trakcie sesji, po M1 serwera. Ardan patroluje kilka zweryfikowanych punktów, reaguje na lokalne powitanie, przerywa patrol po kontrolowanym alarmie administratora, ostrzega i wraca. Bez walki, lootu i handlu. Brak przejścia daje failure, nie teleport. Losowe chodzenie nie walczy z kontrolerem.

## Zmiany
- `npc/ardan.lua`: NpcType bez sklepu i walki, `walkInterval = 0`, tylko `onSay`.
- `scripts/tibia-ai/core.lua`: JSON, dziennik `runtime/logs/world-journal.jsonl`, zapis tmp + rename.
- `ardan_config.lua`: spawn, allowlista punktów i trasy (z log-skanu silnika).
- `ardan_controller.lua`: maszyna stanów IDLE/PATROL/ALERT/RETURN/STOPPED + pauza TALK; wykonawca ruchu krok po kroku.
- `startup.lua`: `worldSessionId`, spawn przez `Game.createNpc`, `verifyWaypoints`, skan ASCII okolicy.
- `talkactions.lua`: `/alarm start|clear`, `/ardan status|check|patrol` (grupa god).
- `bridge.lua` (część kontrolna): `runtime/control/*.request` (shutdown, alarm), `scripts/alarm.ps1`.

## API potwierdzone w źródle `fe0f932`
`Game.createNpcType`, `NpcType.register` (`data/scripts/lib/register_npc_type.lua`), `Game.createNpc` (`game_functions.cpp:667`), `Npc:move`/`say`/`turnToCreature` (`npc_functions.cpp`), `Creature:getPathTo`/`getPosition`/`isRemoved`, `Creature.isPlayer` (`data/libs/functions/creature.lua:63`), `Player:getGuid`, `Tile:getGround`/`hasFlag`, `TILESTATE_*`, `TALKTYPE_SAY/YELL`, `MESSAGE_ADMINISTRATOR`, `GlobalEvent:interval/onThink/onStartup`, `TalkAction:groupType`, `Game.setGameState(GAME_STATE_SHUTDOWN)`, `logger.info`, `logCommand`.

## Ustalenia o silniku
- Pierwsza wersja nie ruszała Ardana, bo NPC dostaje `onThink` tylko przy graczu w zasięgu wzroku (`Npc::manageIdle`). Kontroler przeniesiono na `GlobalEvent` co 1 s.
- Druga wersja: `blocked_timeout` przy ścianie. `getPathTo` zwraca kroki od końca (`Creature::getNextStep` → `listWalkDir.back()`). Poprawka: `dirs[#dirs]`. Błąd był w naszym kodzie.
- `Creature:move(dir)` używa `FLAG_NOLIMIT`, więc użyto `Npc:move(dir)`, które respektuje kolizje.

## Weryfikacja (sesje świata w `runtime/logs/world-journal.jsonl`)
| Test | Wynik | Dowód |
| --- | --- | --- |
| Punkty trasy: kafel, grunt, brak BLOCKSOLID, ścieżka z pathfindera | PASS (5 osiągalnych, `test_unreachable` celowo nieosiągalny) | `waypoint_check`, sesja `72b8f8057e2a6a0d` |
| Patrol: pełny cykl 4 punktów bez teleportu | PASS | `move_completed`, sesja `5d28ecf76f4b73af` 22:05:41–22:06:31 UTC |
| Alarm: PATROL → ALERT (krzyk) → gate_watch → clear → RETURN → PATROL | PASS | ta sama sesja 22:06:41–22:07:17 |
| Blokada trasy: `move_to test_unreachable` daje `failed/no_path` po 8 s, pozycja bez zmian | PASS | test integracyjny, iteracja 0003 |
| Łagodne zamknięcie przez plik kontrolny | PASS | log Canary „Saving server…” |
| Powitanie gracza i reakcja widoczna w kliencie | NOT RUN | wymaga GUI i assets |
| Losowe chodzenie nie przeszkadza | PASS (pośrednio) | `walkInterval=0`; w dzienniku brak ruchów spoza kontrolera; trasa powtarzalna |

## Ograniczenia
- Ruch: 1 krok/s (tick GlobalEvent). `internalMoveCreature` przesuwa natychmiast, więc animacji w kliencie nie sprawdzono.
- Powitanie jest wykrywane po słowach kluczowych z listy, bez NLP.
- Pauza po powitaniu trwa 4 s. Gracz blokujący korytarz sprawi, że pathfinder go obejdzie, a jeśli się nie da, nastąpi `blocked_timeout` i ponowienie po 5 s.

## Następne zadanie
Test GUI: obserwacja patrolu, powitanie `hi` postacią Knight Sample, `/alarm start|clear` postacią GOD.
