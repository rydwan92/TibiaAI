# Iteracja 0018 — niezawodny odbiór zdarzeń graczy (M1/R01)
Data: 2026-10-31
Stan: VERIFIED: testy i prawdziwy klient, z ograniczeniami poniżej
Commit projektu: niezacommitowane, na gałęzi `feat/player-agents`. Świat: `otservbr`, zob. iteracja 0017.

## Cel i warunek odbioru
Każde zdarzenie, które ciało zapisało do `events.jsonl`, działa w umyśle dokładnie raz, także gdy umysł lub plik mają przerwę. Dziś `readEvents` w `apps/brain/src/players/mind.ts` przesuwa `offset` przed sprawdzeniem rekordów, po cichu pomija błędny JSON, po skróceniu pliku przestaje czytać, a przy każdym odczycie ładuje cały plik.

Odbiór, każdy punkt z testem odtwarzającym awarię:
1. JSON zapisany w dwóch porcjach działa raz, po dopisaniu reszty.
2. Znak UTF-8 przecięty między porcjami nie psuje rekordu.
3. Niekompletny ostatni rekord czeka, kolejne przechodzą bez straty.
4. Plik skrócony albo wymieniony na nowy jest czytany od początku, także gdy nowy jest dłuższy od starego offsetu.
5. Restart odbiorcy wznawia czytanie od zapisanego miejsca. Stan umysłu i pozycja odczytu zapisują się razem, więc skutek nie nalicza się dwa razy ani nie ginie.
6. Powtórzony rekord tej samej sesji ciała nie działa drugi raz.
7. Odczyt i bufor są ograniczone, a nadmiernie długi lub błędny rekord jest policzony, nie blokuje kolejnych.
8. Prawdziwy klient: restart Brain przy działającej grze, śmierć z relogiem, bez zgubionych potwierdzeń.

Bez nowej magistrali i bez nowych zależności.

## Zmiany
- `apps/brain/src/players/events.ts` (nowy): `EventReader`. Kursor stoi za ostatnią kompletną linią, plik rozpoznaje po pierwszych 64 bajtach, odczyt najwyżej 256 KB, zbyt długa linia jest pomijana i liczona, rotacja `events.jsonl.1` oddaje nieprzeczytaną resztę.
- `apps/brain/src/players/mind.ts`: `readEvents` usunięte. Kursor zapisuje się w tej samej transakcji co stan umysłu. Rekordy starsze niż 60 s liczą się, ale agent na nie nie reaguje.
- `tools/otclient-agent/agent.lua`: każdy rekord ma `session` i `seq`, rotacja pliku od 2 MB przy starcie.
- `apps/brain/test/events.test.ts` (nowy), `DOCS/CONTRACTS.md`.

## Semantyka
| Sytuacja | Zachowanie |
| --- | --- |
| Niedokończony rekord | Kursor stoi przed nim, rekord czytany ponownie po dopisaniu reszty |
| Skrócony lub wymieniony plik | Inne pierwsze bajty albo mniejszy rozmiar: czytanie od zera |
| Rotacja | Najpierw reszta `events.jsonl.1`, potem nowy plik |
| Restart Brain | Wznowienie od zapisanego kursora, stan umysłu z tego samego momentu |
| Powtórzenie w sesji | `seq` nie większy od ostatniego: pominięte |
| Pierwszy start bez kursora | Od końca pliku, wcześniejsza historia jest już znana |
| Zdarzenie po przestoju | Liczy się w statystykach, bez odpowiedzi i bez odwetu |

## Weryfikacja
Odtworzenie przed naprawą: `apps/brain/test/events.test.ts`, 8 z 9 testów FAIL, zapis `runtime/evidence/r01-before-fix.txt`.

Po naprawie: `events.test.ts` 10/10 PASS, całość 152/152 PASS, `tsc --noEmit` PASS.

| Warunek | Wynik | Dowód |
| --- | --- | --- |
| 1–4, 6, 7 | PASS | `events.test.ts` |
| 5. Restart odbiorcy | PASS z atrapą | `events.test.ts` |
| 8. Restart Brain przy działającej grze | PASS | `world-check-20261031-234011.json`, 20 s przerwy. Okno 23:03–23:08 zapisy lootu do linii dziennika: Kael 8/8, Sira 1/1, Ravn 4/5. Piąta linia Ravna to rekord z 23:03:48 odczytany ponownie na stan sprzed niego, licznik się nie podwoił. Cała historia Ravna: `kills` w umyśle 416, rekordy lootu w `events.jsonl` 416, linie „zabilem” w `diary.log` 417. Dziennik pomija już powtórki, to po poprawce sprawdzone tylko testem |
| 8. Śmierć i relog | PASS | Sira po `dev-kill`, po kilkunastu sekundach online w świątyni, 1 lekcja |
| 3 klienty bez modelu | PASS | `player-run-20261101-000753.json`, 4 min, śmierć Ravna i zakupy bez modelu |
| Pomiar kolejki modelu R07 (P50/P95, udział agentów) | NOT RUN | zostaje w M1 |
| Bieg 30–60 min | NOT RUN | |

## Ograniczenia / rollback
- Okno porównania „dokładnie raz” w kliencie jest krótkie, a liczba zabić w nim mała.
- Powtórka po restarcie nie pisze już do `diary.log`; liczniki w `mind` i tak przywracają się razem z kursorem. Rekordy powstałe w czasie przestoju Brain też nie trafiają do dziennika, bo mają datę sprzed startu: liczą się w statystykach, ale nie ma ich linii.
- Skutki zapisane poza `mind` z kluczem (`store.addEvent`) są idempotentne. Wiadomości wysłane przed awarią nie są cofane.

## Następne zadanie
M2: zdolności faktycznie znane i legalny cykl zapasów bez `refresh` dev-kit. Pierwszy krok: czary znane postaci jako stan gry, nauka u nauczyciela zamiast `kitSpells`, a odmowa serwera wraca do planera.
