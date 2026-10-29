# Iteracja 0006: koszt ticku po stronie Lua i rotacja logów
Data: 2026-10-29
Stan: VERIFIED

## Cel i warunek odbioru
Cel zapisany przed pracą.
1. Zmierzyć czas wykonania naszych GlobalEventów w Canary (otwarte pytanie ADR 0002).
2. Rotować `world-journal.jsonl` i `brain.log` po przekroczeniu rozmiaru, bez kasowania starych plików.

Kryterium: `perf_stats` z prawdziwego świata w spoczynku i pod obciążeniem, wyniki w ADR 0002, rotacja sprawdzona testami, dokumentacja.

## Zmiany
- `core.lua`: `T.measure(name, fn)` (pcall + `os.clock()`, błędy dalej propagowane), `T.flushPerf(60)` → wpis `perf_stats` co minutę (oraz przy łagodnym zamknięciu), `T.rotateIfLarger(path, max)`. Dziennik sprawdza rozmiar co 200 zapisów, limit 10 MB.
- `bridge.lua`, `controller.lua`, `control.lua`: GlobalEventy owinięte w `T.measure`.
- `selftest.lua`: testy rotacji (własny plik tymczasowy, usuwany po teście) i pomiaru (23 sprawdzenia).
- Brain: `logrotate.ts` (limit 10 MB, sprawdzany co 500 linii w `main.ts`, bez nadpisywania wcześniejszych rotacji) + `logrotate.test.ts`.
- `.gitattributes`: LF w repo, CRLF dla `.ps1`/`.bat`, pliki binarne oznaczone.

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| Self-test Lua (w tym rotacja i pomiar) | PASS 23/23 | `scripts\selftest.ps1`, sesja `366d7519ec8bd61a` |
| Testy jednostkowe Brain (22) + typecheck | PASS | `pnpm test`, `pnpm typecheck` |
| Most po zmianach | PASS 14/14 | `runtime/logs/itest-2026-10-29T22-58-15-484Z.json` |
| `perf_stats` w spoczynku | bridge_poll śr. 0,84 ms / maks. 6; agent_tick 0,23 / 1; control 0,43 / 7 | dziennik 22:57:47 UTC |
| `perf_stats` pod obciążeniem (14 komend + alarm z Brain) | bridge_poll 1,26 / 12; agent_tick 0,63 / 6; control 0,32 / 3 | dziennik 22:58:47 UTC |

## Ograniczenia
- Rozdzielczość pomiaru to 1 ms (CRT `clock()`), więc średnie poniżej 1 ms to średnie z próbek 0/1 ms. Mierzone są tylko nasze GlobalEventy, nie cały tick Canary.
- `canary.out.log` (stdout procesu) rotuje się tylko przy starcie (`start.ps1`), bo podczas pracy trzyma go `cmd.exe`.
- Rotacja nie kasuje starych plików; sprzątanie archiwum logów pozostaje ręczne.

## Następne zadanie
Test GUI (RUNBOOK §4.1), a następnie śledzenie powitań narzędziem `timeline`.
