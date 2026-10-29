# Iteracja 0007: agenci słyszą się nawzajem, pamięć wypowiedzi z pochodzeniem (zalążek M5)
Data: 2026-10-29/30
Stan: VERIFIED w silniku i w testach; plotka przekazana graczowi: NOT RUN (wymaga GUI)

## Cel i warunek odbioru
Cel zapisany przed pracą.
- `agent_heard` dla agentów z `hearing` w zasięgu.
- Pamięć z pochodzeniem w Brain.
- Brak odpowiedzi agent ↔ agent.
- Plotka przy powitaniu gracza (`greetRumor`).

Kryterium: na żywo krzyk Ardana daje `agent_heard` u Miry, Brain zapisuje go w SQLite, nie powstaje żadna odpowiedź. Testy kontraktu, migracji i plotki przechodzą. Dokumentacja jest zaktualizowana.

## Zmiany
- Lua: `T.propagateSpeech` w `controller.lua` (wywoływane z `T.agentSay`), walidacja `hearing` w `registry.lua`, sprawdzenie w self-teście (24).
- `agents.json`: `hearing {range 7, yellRange 30}` dla obu agentów; `greetRumor` dla Miry (Ardan: pusty).
- Brain: zdarzenie `agent_heard` w kontrakcie; migracja SQLite v2 (`heard_statements`, kopia przed migracją); `recordHeard`/`latestHeard`; `ProviderContext.latestHeard`; reguła plotki (3,5 s po odpowiedzi na powitanie, ≤10 min, cytat ≤60 znaków); strażnik pętli w `brain.ts` dla każdego providera.
- ADR 0005; CONTRACTS, AGENTS, TESTING, STATUS.

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| Testy jednostkowe Brain (27: kontrakt `agent_heard`, pamięć tylko u słuchacza, plotka z poprawnym cytatem i czasem, strażnik pętli ze złośliwym providerem, migracja v1→v2 z kopią) + typecheck | PASS | `pnpm test`, `pnpm typecheck` |
| Self-test Lua | PASS 24/24 | `scripts\selftest.ps1` |
| Migracja v2 na prawdziwej bazie | PASS | `schema_migrations` = [1, 2]; plik `runtime/brain/brain.sqlite.bak-v1-1793314953970` |
| Słyszenie na żywo: Mira ← krzyk Ardana z 13 kratek, Mira ← mowa Ardana z 6 i 4 kratek, Ardan ← Mira z 4 kratek; wypowiedź Miry z >7 kratek niesłyszana | PASS | dziennik 23:02:39–23:02:49 UTC (sesja po restarcie), tabela `heard_statements` (4 wiersze) |
| Brak odpowiedzi na usłyszaną mowę | PASS | `brain.log`: jedyne `command_sent` w sesji to komentarz alarmu Ardana |
| Plotka przekazana graczowi w grze | NOT RUN | wymaga powitania z klienta |

## Ograniczenia
- Słyszenie liczy tylko odległość (Chebyshev, to samo piętro), bez ścian i linii wzroku.
- n·(n-1) zdarzeń na wypowiedź w najgorszym razie. Przy wielu agentach potrzebny będzie limit per słuchacz (ADR 0005).
- Mowa Brain (np. komentarz alarmu) też jest słyszana: to mowa jak każda inna.

## Następne zadanie
GUI: powitać Mirę po alarmie i sprawdzić plotkę („Slyszalam, jak Ardan mowil…”) w narzędziu `timeline`.
