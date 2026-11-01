# Iteracja 0015 — życie gracza i naprawy pamięci
Data: 2026-10-31
Stan: VERIFIED w prawdziwych klientach, z wyjątkami w sekcji „Ograniczenia”
Commit projektu: `f58b71b` na gałęzi `feat/player-agents`. Upstream: Canary `fe0f932`, OTClient `dd56414`.

## Cel i warunek odbioru
Właściciel: agenci mają żyć jak gracze, wracać do miasta po zapasy, chować łup, walczyć ze sobą, gdy się nie dogadają, uczyć się po śmierci i nie przyznawać się do bycia AI. Przegląd zewnętrzny: najpierw naprawić utratę danych w pamięci. Odbiór: agent bez strzał sam zdobywa pieniądze i zapasy, a kompresja nie traci przeczytanych danych.

## Zmiany
- **Pamięć:** `npc/compression.ts` (partie po 40, osobno widoczność i pewność, łączenie w tych samych grupach), `memory.ts` i `brain.ts` (skutki i znacznik w jednej transakcji, numer i plik polecenia w jednej transakcji, ponawianie skutków).
- **Model:** Brain przełącza się na model, gdy ten pojawi się po starcie (`main.ts`, `start.ps1 -NoModel` do testu).
- **Handel:** `tools/make_shop.py`, `shop.json`, Mira z `"shop": true`, okno handlu w ciele agenta.
- **Depozyt:** szafki w atlasie (185), wpłata i wypłata przez skrzynię i pudło.
- **PvP:** `worldType = "pvp"`, tryb bezpieczny, urazy z wygasaniem, reakcja na atak, blokada strefy ochronnej, opcja ataku.
- **Nauka:** lekcja po śmierci, ostrzeżenia w etykietach łowisk, liczniki `ways`.
- **Potrzeby:** brak zapasów wygrywa z planem, przerwa 12 minut między wyprawami, zdjęcie łuku bez strzał.
- **Rola:** `identity: "in_character"` (ADR 0010 pkt 8).
- **Haczyk testowy:** `force.json`.
- `DOCS/BACKLOG.md`: stan zadań T01–T11.

## Weryfikacja
`node --test test/*.test.ts` w `apps/brain`: 132/132 PASS. `tsc --noEmit`: PASS. `scripts\selftest.ps1`: 36/36 PASS. `scripts\verify.ps1 -Client`: NOT RUN.

| Sprawdzenie w prawdziwym kliencie | Wynik | Dowód |
| --- | --- | --- |
| Sklep: sprzedaż i kupno, wynik z serwera | PASS | Ravn: „Bought 7x mana potion for 105 gold coins” |
| Samodzielny powrót po zapasy | PASS | Ravn 19:37:49 „bez zapasow”, 19:41:00 u kupca, bez `force.json` |
| Wpłata do depozytu | PASS | Sira 19:08:19 „schowalem 309”; po teście haczykiem |
| Wypłata z depozytu | PASS | Sira 20:02:25 „wyplacilem 200”, bez `force.json` |
| Pełna pętla bez ingerencji | PASS | Sira 20:02–20:03: depo, Mira, „Bought 100x arrow”, „Bought 5x health potion” |
| Dziura i lina | PASS | Ravn 19:00:38 `hole`, 19:01:00 `rope_spot` (trasa z `force.json`) |
| Łopata | PASS | Ravn 19:04:16 i 19:04:48 `shovel_hole` |
| Schody, teleport, drzwi w trasie | PASS | `ways`, iteracja 0014 |
| Atak na gracza dociera do serwera | PASS | „You can not enter a protection zone after attacking another player” |
| Śmierć i lekcja modelu | PASS | Kael: „nie wchodzilbym do walki bez mikstur na zycie” |
| Późne włączenie modelu | PASS | `model_unavailable_using_rules` 19:36:31, `model_recovered` 19:37:03 |

Biegi: `player-run-20261031-203411` (25 min), `-205252` (15 min), `-210811` (8 min). Stan końcowy: Ravn poziom 10 i ponad 230 zabitych, Kael i Sira poziom 9, zero błędów ciała.

## Znalezione przyczyny
- Kompresja czytała 40 zdarzeń, a usuwała całą partię; dopisek ucinał nową treść do 400 znaków.
- **Błąd z tej iteracji:** „A wolf loses 21 hitpoints due to an attack by Kael” pasowało do wzorca ataku, więc agenci odpowiadali na cudzą walkę z wilkiem i bili się w kółko. Pierwsza diagnoza (czary obszarowe) była błędna; ograniczenie do czarów celowanych zostało jako rozsądna zasada.
- Dwaj agenci proszący się nawzajem szli za sobą w kółko.
- Ponowne liczenie trasy gubiło cel „do depo”.
- Paladyn bez strzał nie umiał się przebić przez potwory w wąskim przejściu.
- Monety leżą w kilku stosach, pierwszy może mieć 9 sztuk.

## Dokumentacja
STATUS, PLAYER_AGENTS, ADR 0010, CONTRACTS, COMPATIBILITY, TOOLING, TESTING, GAME_DIRECTION, BACKLOG (nowy).

## Ograniczenia / rollback
- NOT RUN w kliencie: rozmowa agenta z NPC (`force.json` był gotowy, ale restart przerwał marsz), runa w walce, walka do śmierci między agentami z własnego wyboru, człowiek rozmawiający z agentem.
- `verify -Client` nie był uruchomiony po przejściu na świat PvP.
- Kompresja nadal nie wystąpiła w żywej bazie, testy są na atrapie.
- Priorytet dialogu nad kompresją (T06): PLAN.
- Zamknięte drzwi kosztują 30 s na sztukę. Po śmierci zestaw wraca jako wyjątek deweloperski.
- Wolna pamięć spadała do 0,6 GB. Przy 3 klientach maszyna nie ma zapasu.
- Mały model nadal bywa pusty w rozmowie.
- Rollback świata PvP: `worldType` w `sync-server.ps1`. Rola: `identity: "honest"`.

## Następne zadanie
Kronika świata: NPC dowiadują się o czynach agentów przez rozmowę i opowiadają o nich graczom, z pochodzeniem plotki.
