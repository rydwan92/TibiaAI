# ADR 0006: granice agenta i ciało bojowe sterowane przez klienta
Status: ACCEPTED (2026-10-30). Eksperyment VERIFIED; integracja z Brain: PLAN.

## Kontekst
Docelowo agenci mają walczyć, handlować i towarzyszyć graczowi według zasad gry. Trzeba było ustalić, jak sterować jednostką z prawdziwymi możliwościami gracza. Porównanie na Canary v3.6.1 (`fe0f932`):

| Droga | Możliwości | Koszt | Ocena |
| --- | --- | --- | --- |
| NPC | `say`, `move`, `follow`; bez ekwipunku, ataku i otrzymywania obrażeń | brak | Mieszkańcy, nie walka |
| Player sterowany z serwera | Lua nie ma `attack`/`useItem`; `Game::playerUseItemEx` i `playerSetAttackedCreature` tylko z C++. Postać po rozłączeniu zostaje w świecie jako `Player` (obserwacja) | patch C++ + własny build (MSVC, vcpkg) | Możliwe później, gdy jeden proces klienta na agenta okaże się za drogi |
| Prawdziwy klient (OTClient + skrypt) | pełna mechanika: `g_game.attack`, `useInventoryItemWith`, `walk` idą przez walidację serwera | ~450–580 MB RAM na proces | **Wybrane** |

## Decyzja
Agent zdolny do walki to zwykła postać (własne konto) sterowana przez proces klienta. Silnik nie jest zmieniany, a klient nie dostaje żadnych uprawnień ponad gracza.

Granice (zaimplementowane tylko te, których dziś używamy):
- **AgentIdentity**: klucz z `agents.json` + `persona`, pamięć w SQLite po kluczu, nie po ID jednostki. WDROŻONE.
- **ActorAdapter**: typ ciała `actor` w definicji (`npc`, `client_player`), `actorTypes` opisuje capabilities. `npc` WDROŻONY w Lua; `client_player` istnieje jako scenariusz w `tools/otclient-autotest/combat.lua`, jeszcze nie jako adapter Brain. PLAN: obsługa pojawienia się, śmierci i rozłączenia.
- **Perception**: agent dostaje tylko zdarzenia ze swojego zasięgu (powitanie, `agent_heard`, alarm strefy). Pamięć trzyma źródło i czas. WDROŻONE dla tych zdarzeń.
- **Capabilities + ActionRegistry**: `apps/brain/src/actions.ts`; akcja deklaruje capability i walidację, `validateCommand` jest generyczny, brak zdolności daje `missing_capability`. WDROŻONE w Brain.
- **Skills/Behaviors**: role komponują typy zachowań z danych (`patrol`, `stationary`, reakcja na alarm). Wieloetapowe umiejętności ze stanem i przerwaniem: PLAN.
- **DecisionProvider**: interfejs `Provider`, reguły lub lokalny model proponują tylko intencje. WDROŻONE.
- **WorldPolicy/GameMode**: `arena.lua` jako kontroler scenariusza: allowlista potworów, granice areny, jawne wyjątki developerskie (`dev_exception_used`). WDROŻONE w wersji minimalnej.

Szybkie reakcje (ruch, leczenie, atak) mają działać w adapterze ciała, a nie czekać na model. Model dotyczy dialogu i planowania.

## Dowód eksperymentu
`scripts\client-autotest.ps1 -Scenario combat`: 13/13 PASS, `runtime/logs/client-autotest-20261030-220014.log`.

| Możliwość | Stan | Dowód |
| --- | --- | --- |
| Logowanie, wejście do świata | potwierdzona | log klienta |
| Ruch i kolizje | potwierdzona | wejście w ścianę nie zmienia pozycji |
| Otrzymanie obrażeń | potwierdzona | `170 → 154` od Valkyrie |
| Leczenie z zużyciem zasobu | potwierdzona | `+110 HP`, mikstury `6 → 4` |
| Cooldown przedmiotu | potwierdzona | druga mikstura po 1004 ms; serwer kolejkuje, nie odrzuca (`setNextPotionActionTask`) |
| Atak według mechaniki | potwierdzona | obrażenia, krytyk, zabity Cave Rat, `+15 exp`, loot, awans umiejętności |
| Śmierć i koniec sterowania | potwierdzona | sygnał śmierci w kliencie, `player_deaths: a valkyrie`, ponowne wejście w kolejnym przebiegu |
| Runy i czary | jeszcze niesprawdzona | postać testowa ich nie ma |
| Rozłączenie w trakcie walki | obserwacja | postać zostaje w świecie; wymaga obsługi w adapterze |

Wyjątki developerskie w eksperymencie: ustawienie HP i wylogowanie, jawne i zapisane w dzienniku. Leczenie i śmierć pochodzą z gry.

## Pułapki znalezione przez test
- Forge co 10 s zamieniał jedynego potwora w Fiendish (HP ×3,6, silniejsze ciosy). Wyłączone w konfiguracji laboratorium.
- Wbudowany bot OTClient (`mods/game_bot`) i ręczne kliknięcia w oknie fałszują wynik. Test wyładowuje bota i na czas walki blokuje wejście spoza scenariusza; każde działanie loguje ze stosem wywołań.
- Standardowy Troll nie przebija pancerza postaci 8 poziomu. Do testu obrażeń służy Valkyrie, do zabicia Cave Rat.

## Konsekwencje
- Limit procesów: 15,9 GB RAM i model 9,5 GB w VRAM. Przy 2–3 agentach bojowych trzeba zmierzyć łączne zużycie; lżejsza alternatywa to własny klient protokołu lub patch C++ (osobny ADR).
- Patch C++ nie jest dziś potrzebny, więc nie ma forka ani patchy.

## Następna decyzja
Adapter `client_player` sterowany z Brain: kanał między Brain a procesem klienta i jego cykl życia.
