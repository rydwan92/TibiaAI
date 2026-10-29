# Agenci: jak dodać lub zmienić NPC

Agenci są opisani danymi w `packages/contracts/agents.json` (ADR 0004). Ten sam plik czytają Lua w Canary i Brain. Nowy agent nie wymaga kodu, jeśli jego zachowanie mieści się w istniejących typach.

## Obecni agenci
| Klucz | NPC | Zachowanie | Alarm `montag_gate` |
| --- | --- | --- | --- |
| `ardan` | Ardan, strażnik | `patrol`, trasa `montag_square` (4 punkty) | idzie do `gate_watch`, krzyczy, ostrzega co 20 s |
| `mira` | Mira, zielarka | `stationary`, dom `herb_stall` (5020,5003,7) | chowa się w `temple_shelter` (świątynia, PZ) |

## Pola definicji
| Pole | Znaczenie |
| --- | --- |
| klucz agenta | `[a-z][a-z0-9_]*`, stabilny identyfikator (pamięć Brain, pliki mailbox) |
| `npcName`, `description` | nazwa i opis NPC w grze (rejestrowane przez `Game.createNpcType`) |
| `outfit`, `speed` | wygląd (lookType itd.) i prędkość animacji |
| `spawn` | id punktu startowego (musi istnieć w `waypoints`) |
| `waypoints` | allowlista punktów `{x,y,z}`. Tylko te id może wskazać Brain (`move_to`) |
| `routes` | trasy jako listy id punktów (`patrol`) |
| `behavior` | `{type:"patrol", defaultRoute}` albo `{type:"stationary", home}` |
| `greeting` | słowa powitania, zasięg w kratkach, cooldown na gracza |
| `alarm` (opcjonalne) | `zones` (z globalnego `alarmZones`), `moveTo`, `yell`, `rewarnSeconds` (0 = bez ponawiania) |
| `texts` | teksty persony; placeholdery `{name}`, `{nth}`, `{since}`, `{n}`; pusty tekst = brak wypowiedzi |

Teksty: `greetFallback` (lokalna odpowiedź Lua bez Brain), `greetFirst`/`greetRepeat` (Brain, z pamięci), `greetDuringAlarm`, `alarmStart`, `alarmArrive`, `alarmBlocked`, `alarmRewarn`, `alarmClear`, `alarmComment` (Brain, po 4 s). Używaj drukowalnego ASCII, bo kodowania polskich znaków w kliencie nie sprawdzono. Walidacja Brain to wymusza.

Globalne: `timing` (w tickach po 1 s: pauza po powitaniu, czas czekania na Brain, timeout ruchu, ponowienia, zasięg pathfindera, cooldown mowy), `alarmZones`, `actions`, `limits`.

## Procedura dodania agenta
1. Wybierz miejsce, korzystając z widoku silnika (Canary musi działać):
   `powershell -ExecutionPolicy Bypass -File scripts\scan.ps1 -X 5010 -Y 5003 -Radius 12`
   Legenda: `.` można chodzić, `#` przeszkoda, `^` schody lub dziura (unikaj). W grze postacią GOD: `/ai scan`.
2. Dopisz wpis do `packages/contracts/agents.json`.
3. Sprawdź definicję: `cd apps\brain; pnpm test` (test `agents.test.ts` waliduje plik).
4. Wdróż: `scripts\stop.ps1 -KeepDb`, `scripts\sync-server.ps1`, `scripts\start.ps1`.
5. Zweryfikuj: `python -I tools\journal.py --kinds agent_spawned,waypoint_check,agent_definition_invalid`. Każdy punkt powinien mieć `reachable: true` (poza celowo nieosiągalnymi punktami testowymi). Potem `scripts\selftest.ps1`.
6. Dopisz agenta do tabeli powyżej i do STATUS.

Błędna definicja nie zatrzymuje świata: agent jest pomijany, a w dzienniku pojawia się `agent_definition_invalid` z opisem problemu. Brain natomiast nie wystartuje z błędnym plikiem i wypisze listę błędów.

## Kiedy potrzebny jest kod
Nowy typ zachowania (np. eskorta, podążanie, handel, walka) wymaga nowej pozycji w `routines` w `game/overlays/tibia-ai/tibia-ai/lib/controller.lua`, rozszerzenia walidacji w Lua (`registry.lua`) i TS (`apps/brain/src/agents.ts`) oraz ADR. Nowa akcja Brain wymaga zmiany kontraktu (CONTRACTS.md) po obu stronach.
