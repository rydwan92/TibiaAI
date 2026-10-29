# Iteracja 0005: obserwowalność i operacje (oś decyzji, retencja, backup z restore)
Data: 2026-10-29
Stan: VERIFIED (na żywym świecie i w testach)

## Cel i warunek odbioru
Cel zapisany przed pracą. Bez nowych zachowań agentów.
1. Oś decyzji z obu logów po `correlationId`.
2. Retencja katalogów archiwum mailboxa.
3. Backup z niezależnie sprawdzonym odtworzeniem.

Kryterium: pełny łańcuch dla prawdziwego alarmu, testy retencji, backup i restore-test na żywych danych ze zgodną liczbą wierszy, aktualna dokumentacja.

## Zmiany
- Lua: wpis dziennika `event` zawiera `eventId`, `sequence` i `delivered`. `npc_said` z Brain zawiera `commandId` i `correlationId`, a `move_*` dla `move_to` zawiera `commandId`. Mechanizm: opcjonalne `meta` w `T.agentSay` i `T.startMove`.
- Brain: `timeline.ts` (czyste funkcje łączące logi; sortowanie po sekundzie, potem po fazie przyczynowej, bo dziennik Lua ma rozdzielczość 1 s), `cli/timeline.ts`, `retention.ts` (najnowsze N plików, bieżąca sesja chroniona; wywołanie co 10 min w `brain.ts`), `cli/sqlite-tool.ts` (`VACUUM INTO`, `integrity_check`, liczba wierszy).
- Skrypty: `backup.ps1`, `restore-test.ps1`; w `lib.ps1` funkcja `Get-TableRowCounts`.
- Testy: `timeline.test.ts`, `retention.test.ts`.

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| Testy jednostkowe Brain (21) + typecheck | PASS | `pnpm test`, `pnpm typecheck` |
| Self-test Lua po zmianach | PASS 20/20 | `scripts\selftest.ps1` |
| Oś decyzji na żywo: alarm Ardana daje 7 kroków (obserwacja → received → sent → accepted → said → result → completed); Mira kończy na decyzji (pusty `alarmComment`) | PASS | `cli/timeline.ts --last 4`, sesja `cab09415f3b279f2` |
| Backup na żywym świecie | PASS | `runtime/backups/20261029-235334` (world.sql 61 KB, brain.sqlite 68 KB) |
| Restore-test: SHA-256, 48 tabel świata, 7 tabel Brain, integrity_check, usunięcie bazy testowej, live DB bez zmian | PASS | wynik `RESTORE TEST PASSED`; `SHOW DATABASES` po teście |

Uwaga do pierwszego testu osi: moja początkowa asercja była błędna (nic nie sprawdzała), a sortowanie po czasie dawało nieprzyczynową kolejność w obrębie sekundy. Oba problemy poprawiono przed commitem.

## Ograniczenia
- Logi (`world-journal.jsonl`, `brain.log`, `canary.out.log`) nie są rotowane automatycznie. Canary loguje co 10 s ostrzeżenia upstream o braku potworów.
- Restore do bazy produkcyjnej jest opisany jako procedura ręczna, nie skrypt (świadomie).
- Timeline czyta całe pliki logów; przy dużych logach przyda się filtrowanie strumieniowe.

## Następne zadanie
Test GUI (iteracja 0006): oba NPC widoczne, powitania, alarm z gry, restart Brain i pamięć gracza. Wynik prześledzić narzędziem `timeline`.
