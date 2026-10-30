# Iteracja 0010: eksperyment z jednostką zdolną do walki
Data: 2026-10-30
Stan: VERIFIED jako eksperyment; integracja z Brain: PLAN

## Cel i warunek odbioru
Sprawdzić najważniejsze ryzyko przed abstrakcjami: jak sterować jednostką z możliwościami gracza. Warunek: ruch i kolizje, obrażenia, leczenie z faktycznym zużyciem, atak z cooldownem, śmierć i koniec sterowania. Każda możliwość: potwierdzona, niewspierana lub niesprawdzona. Bez bezpośredniego dodawania HP jako „leczenia”.

## Zmiany
- ADR 0006: porównanie NPC, Player po stronie serwera i klienta; wybór klienta.
- `game/overlays/tibia-ai/tibia-ai/lib/arena.lua`: kontroler scenariusza (allowlista potworów, granice areny, limit), jawne wyjątki developerskie `dev-set-health`, `dev-give-item`, `dev-kick`, sonda `arena-probe`.
- `control.lua`: rejestr `T.registerControl` zamiast listy na sztywno.
- `tools/otclient-autotest/combat.lua`, `scripts\client-autotest.ps1 -Scenario combat`, `scripts\lab-fixture.ps1 -Combatant` (osobne konto `kael`, hasło w `.env`).
- `sync-server.ps1`: `forgeInfluencedLimit = 0`, `forgeFiendishLimit = 0`.

## Weryfikacja
Wynik końcowy **13/13 PASS**: `runtime/logs/client-autotest-20261030-220014.log`; tabela możliwości w ADR 0006. Baza: `player_deaths` „a valkyrie”, `skill_axe` 10 → 12 w trakcie prób. Proces klienta: szczyt 422–582 MB.

Przebiegi pośrednie były porażkami i niosły informację:
| Objaw | Przyczyna | Rozwiązanie |
| --- | --- | --- |
| „2 mikstury zużyte” | błędne założenie testu: serwer kolejkuje, nie odrzuca | mierzy odstęp: 1004 ms |
| 0 obrażeń przez 60 s, Troll 180/180 HP | Forge zamienił go w Fiendish | wyłączone Forge |
| Chodzenie, leczenie i zmiana celu „same” | kliknięcia użytkownika w oknie testu (`processMouseAction` w stosie), a nie bot | blokada wejścia spoza scenariusza, wyładowanie `game_bot` |
| Kael „online” bez klienta | postać zostaje po rozłączeniu | `dev-kick` przed przebiegiem |
| Troll nie zadaje obrażeń | pancerz blokuje ciosy do 15 | Valkyrie do obrażeń, Cave Rat do zabicia |

## Ograniczenia
Runy i czary: niesprawdzone. Scenariusz jest skryptem w kliencie, nie decyzją agenta. Uruchomienie wymaga okna klienta.

## Następne zadanie
Adapter `client_player`: jeden agent sterowany z Brain na arenie (ADR 0006).
