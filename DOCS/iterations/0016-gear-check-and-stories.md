# Iteracja 0016 — ekwipunek po śmierci i opowieści w mieście
Data: 2026-10-31
Stan: VERIFIED w prawdziwych klientach, z wyjątkami w sekcji „Ograniczenia”
Commit projektu: niezacommitowane, na gałęzi `feat/player-agents` po `f58b71b`. Upstream: Canary `fe0f932`, OTClient `dd56414`.

## Cel i warunek odbioru
Zgłoszenie właściciela ze zrzutem: po śmierci postacie tracą ekwipunek i muszą sprawdzać, czego im brakuje, a paladyn tego nie zrobił. Odbiór: agent bez fragmentu ekwipunku sam kupuje brak i zakłada go, a paladyn strzela strzałami ze sklepu.

## Zmiany
- **Strzały:** sklepowe strzały lądowały w plecaku, a łuk bierze je tylko z kołczanu. Ciało co 20 s przekłada je przez `equipItemId`.
- **Kontrola ekwipunku:** ciało zgłasza `worn` i `have`, umysł liczy `missing` z zestawu postaci, ciało zakłada wszystko, co jest w plecaku, a braki trafiają na początek listy zakupów.
- **Darmowy zestaw:** po śmierci nie ma go już automatycznie. Zostaje tylko dla kogoś, komu czegoś brakuje i kto ma razem poniżej 30 złota.
- **Sklep:** Mira sprzedaje też plecak, zbroję, hełm, nogawice, buty, miecz, tarczę, łuk, kołczan i różdżkę; rope i shovel są na liście zapasów.
- **Opowieści:** agent po zakupach lub rozmowie z NPC mówi na głos o ważnym zdarzeniu. Mowa bez imienia to dla NPC publiczna plotka.
- **Testy:** `dev-strip.request`, `dev-kill.request` (tylko `devCharacters`).
- **Pełny plecak:** ciało wisiało bez końca na przekładaniu łupu ze zwłok i nie chodziło; to było też źródło „Sorry, not possible” na zrzucie właściciela. Limit prób, a pełny plecak to powód wizyty w sklepie.
- **Trasy:** gdy blokady nie zostawiają żadnej drogi, agent o nich zapomina. „Sorry, not possible” liczy się tylko przy drzwiach i przejściach.

## Weryfikacja
`node --test test/*.test.ts` w `apps/brain`: 135/135 PASS. `tsc --noEmit`: PASS. `scripts\selftest.ps1`: 36/36 PASS. `scripts\verify.ps1 -Client`: NOT RUN.

| Sprawdzenie w prawdziwym kliencie | Wynik | Dowód |
| --- | --- | --- |
| Paladyn strzela kupionymi strzałami | PASS | Sira: exp 6772→7607, zabite 105→133, strzały 106→38 |
| Brak w ekwipunku wykryty, kupiony, założony | PASS | Sira kupiła łuk; Kael po `dev-strip` kupił zbroję, slot 4 znów 3361 |
| Handel zarabia na łupie | PASS | Kael: 73 złota przed, 263 po, mimo zakupów |
| Powrót po śmierci | PASS | Ravn po `dev-kill`: śmierć 20:56:24, w grze 20:56:29, lekcja 20:56:26 |
| Opowieść słyszana przez NPC | PASS | Pamięć Miry, 21:25: `[heard/rumor/public] Ravn: nie wiem co mnie dzis zabil na pietrze 7, uwazajcie` |
| Pełny plecak nie zatrzymuje postaci | PASS | Ravn po poprawce doszedł do Miry: złoto 216→400, mikstury 2/4→4/10 |
| NPC opowiada usłyszaną plotkę innemu graczowi | NOT RUN | |
| Sytuacja bez złota i bez ekwipunku | NOT RUN w kliencie | test jednostkowy |

Bieg: `player-run-20261031-221403` (15 min), 0 błędów ciała. Wolna pamięć minimum 1,4 GB.

## Dokumentacja
STATUS, PLAYER_AGENTS, CONTRACTS, COMPATIBILITY.

## Ograniczenia / rollback
- Test utraty ekwipunku użył `dev-strip`, a nie prawdziwej utraty plecaka przy śmierci.
- Plecak w depo nie wraca po śmierci: agent kupuje nowy.
- Mały model czasem powtarza zaczepki potworów na czacie.

## Następne zadanie
Teleporty z warunkiem poziomu: Montag jako teren startowy, brama w świat od poziomu 8.
