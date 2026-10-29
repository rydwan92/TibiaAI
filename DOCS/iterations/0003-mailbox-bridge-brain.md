# Iteracja 0003: most mailbox + cienki Brain (M3)
Data: 2026-10-29
Stan: IMPLEMENTED + VERIFIED headless na żywym Canary; pamięć spotkań z prawdziwym graczem NOT RUN (GUI)
Upstream: bez zmian. Node 22.18.0, `node:sqlite` (SQLite 3.50.2), dev: typescript 5.9.3, @types/node 22.18.13

## Cel i warunek odbioru
Cel zapisany w trakcie sesji. Eksperyment transportu (ADR 0002), potem jeden przepływ event → Brain → komenda → walidacja → wynik. Do tego jeden agent, pamięć spotkań po player GUID, `say` i `patrol` jako działania, odrzucanie duplikatu, starej sesji i nieznanej akcji, a gra ma działać po wyłączeniu Brain.

## Zmiany
- `game/overlays/tibia-ai/scripts/tibia-ai/bridge.lua`: mailbox, walidacja komend, wyniki, heartbeat, `world.json`, backpressure.
- `apps/brain/src/`: `contracts.ts` (walidacja v1), `memory.ts` (SQLite + migracje + kopia przed migracją), `rules.ts` (provider rules), `mailbox.ts`, `brain.ts` (pętla 250 ms), `main.ts`.
- `apps/brain/test/*.test.ts` (14 testów), `test-integration/bridge.itest.ts` (test na żywym świecie).
- `packages/contracts/allowlist.json`. Skrypty: Brain w `start.ps1`/`stop.ps1`/`status.ps1`.

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| Testy jednostkowe Brain (kontrakty, deduplikacja, stara sesja, stare zdarzenia, restart pamięci po GUID, wyniki, allowlista = Lua) | PASS 14/14 | `pnpm test` (`node --test`) |
| Typecheck | PASS | `pnpm typecheck` |
| Most na żywym Canary: say, duplikat (jeden skutek), stara sesja, nieznana akcja, TTL wygasły, TTL > 10 s, zły JSON → quarantine, współrzędne zamiast waypointu, nieosiągalny punkt → failed bez teleportu, stary planRevision, wznowienie patrolu | PASS 11/11 (dwa przebiegi) | `runtime/logs/itest-2026-10-29T22-13-41-251Z.json`, `itest-2026-10-29T22-17-12-690Z.json`; dziennik: `npc_said` „Test integracyjny” = 1 raz |
| Event → Brain → command → walidacja → wynik, jeden correlationId | PASS | `brain.log`: alarm 22:15:38, say 22:15:42 (zamierzone 4 s), `completed` 22:15:43 |
| Brain wyłączony: gra i kontroler działają (alarm, patrol) | PASS | dziennik 22:15:56–22:16:10: ALERT → RETURN → PATROL przy `brainOnline=false` |
| Restart Brain: pamięć z SQLite | PASS (licznik alarmów) | po restarcie „To 3. alarm…” (wliczony alarm z czasu offline); zaległe zdarzenia oznaczone `stale` |
| Restart Brain: rozpoznanie gracza po GUID | PASS w teście jednostkowym; NOT RUN w grze | wymaga powitania z klienta |
| Restart świata: komendy starej sesji niewykonywane | PASS (mechanizm) | nowe `worldSessionId` przy każdym starcie, nazwy plików z sesją; Brain: `expireOtherSessions` |

Znaleziony i naprawiony błąd: pierwszy `say` z Brain dostał `stale_plan`, bo `planRevision` sprawdzano także dla mowy. Teraz kontrola dotyczy tylko akcji ruchu, a Brain używa rewizji z `world.json`.

Zmierzone orientacyjnie (bez benchmarku): komenda → wynik ~0,4 s; pamięć procesów: Canary ~235 MB, MariaDB ~56 MB, login-server ~17 MB, Brain ~59 MB.

## Ograniczenia
- Brak providera LLM (M4). `TIBIAAI_BRAIN_PROVIDER` inny niż `rules` kończy start z błędem.
- `position_observed` nie jest jeszcze emitowany.
- Opóźnienia mierzone zegarem Lua o rozdzielczości 1 s. Wpływu I/O na tick nie profilowano.
- Brain zatrzymywany przez plik kontrolny, awaryjnie `Stop-Process` (SQLite w trybie WAL, transakcje).

## Następne zadanie
GUI: powitanie Ardana graczem, restart Brain, ponowne powitanie z oczekiwanym „Znowu ty… 2. spotkanie”.
