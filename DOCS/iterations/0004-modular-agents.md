# Iteracja 0004: modułowy runtime agentów opisanych danymi
Data: 2026-10-29
Stan: VERIFIED w silniku (dziennik, self-test, most) i w testach Brain; GUI NOT RUN
Upstream: bez zmian (Canary v3.6.1 `fe0f932`)

## Cel i warunek odbioru
Cel zapisany przed pracą. Zamienić kod „szyty na Ardana” na ogólny system agentów:
- jedno źródło definicji `packages/contracts/agents.json`, czytane przez Lua w Canary i przez Brain;
- generyczne moduły Lua;
- Brain z rejestrem agentów i interfejsem providera;
- drugi agent (Mira) dodany wyłącznie danymi.

Kryterium: Ardan zachowuje się jak wcześniej, Mira spawnuje się i reaguje na alarm, most obsługuje obu agentów i odrzuca nieznanego, testy przechodzą, dokumentacja jest zaktualizowana.

## Zmiany
- `packages/contracts/agents.json` (nowy): definicje, timing, strefy alarmu, akcje, limity. Usunięto `allowlist.json`.
- Lua: `scripts/tibia-ai/init.lua` (jedyny plik auto-ładowany) ładuje przez `dofile` w ustalonej kolejności moduły z `data-canary/tibia-ai/lib/`: `core`, `registry` (walidacja definicji, stan agentów), `movement` (wykonawca ruchu, weryfikacja punktów, skan), `controller` (generyczna maszyna stanów, typy zachowań `patrol`/`stationary`, alarm sterowany danymi), `bridge` (wielu agentów, `world.json.agents`), `npc_types` (rejestracja NpcType z definicji), `startup`, `control` (pliki kontrolne + skan), `talkactions` (`/alarm`, `/ai`), `selftest`. Usunięto `npc/ardan.lua` i pliki specyficzne dla Ardana.
- Brain: `agents.ts` (rejestr + walidacja jak w Lua, tylko ASCII w tekstach), `providers/provider.ts` (interfejs), `providers/rules.ts` (`RulesProvider`, teksty z definicji, `createProvider`), `contracts.ts` (walidacja z rejestru), licznik alarmów per agent, `planRevision` per agent.
- Skrypty: `selftest.ps1`, `scan.ps1`, `alarm.ps1 -Zone`, `lib.ps1` (`Write-ControlRequest`, `Wait-JournalEntry`). `sync-server.ps1` kopiuje `agents.json` i nie nadpisuje działającego Canary.
- `tools/journal.py` pokazuje klucz agenta.
- Dokumentacja: ADR 0004, `DOCS/AGENTS.md`, ARCHITECTURE, CONTRACTS, RUNBOOK, TESTING, STATUS, COMPATIBILITY.

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| Definicje załadowane przez Lua; spawn obu agentów; punkty Ardana i Miry osiągalne (`temple_shelter`: 36 kroków, PZ) | PASS | dziennik, sesja `28502407518e7397`, 22:42:23 UTC |
| Self-test Lua w silniku (JSON, szablony, walidacja definicji i komend) | PASS 20/20 | `scripts\selftest.ps1`, wpis `selftest_result` |
| Alarm dla wielu agentów: Ardan → gate_watch, Mira → temple_shelter, clear → PATROL / HOME | PASS | dziennik 22:42:40–22:44:03 |
| Most na żywym świecie (14 przypadków, w tym say Miry, cudzy waypoint → `invalid_args`, nieznany agent → `unknown_agent`) | PASS 14/14 | `runtime/logs/itest-2026-10-29T22-47-33-846Z.json` |
| Brain + 2 agentów: alarm → komentarz tylko od Ardana (Mira ma pusty `alarmComment`) | PASS | `brain.log` 22:47:46–22:47:50 |
| Testy jednostkowe Brain (17) + typecheck | PASS | `pnpm test`, `pnpm typecheck` |
| Widoczność obu NPC w kliencie, powitanie gracza | NOT RUN | brak assets 15.11 |

## Ograniczenia / rollback
- Zmiana `agents.json` wymaga sync, restartu Canary i restartu Brain. Nie ma hot reload.
- Komunikacja agent ↔ agent (M5) i pamięć z pochodzeniem: nie zaczęte.
- Licznik alarmów liczy także zdarzenia odebrane jako `stale` (zapamiętane podczas braku Brain). To zamierzone: pamięć faktów, nie reakcji.
- Rollback: `git revert` commita iteracji, potem sync i restart. Dane w `runtime/` pozostają kompatybilne (schemat SQLite bez zmian).

## Następne zadanie
Test GUI (iteracja 0005): oba NPC widoczne, powitanie Ardana i Miry, alarm `/alarm start|clear` postacią GOD, restart Brain i „Znowu ty…”.
