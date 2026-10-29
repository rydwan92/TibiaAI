# Plan iteracyjny

Szacunki są orientacyjne; pierwsza instalacja, kompilacja i assets mogą zająć cały wieczór.

| Etap | Zakres | Kryterium odbioru |
| --- | --- | --- |
| M0, 20–45 min | Środowisko i zgodność | Wypełnione źródła wersji, lista braków, wybrany jeden runtime |
| M1, 45–120+ min | Serwer, baza, login, klient | Wejście gracza, ruch i ponowne logowanie; zdrowy kontener sam nie wystarczy |
| M2, 45–90 min | Ardan Lua | Patrol, powitanie, alarm treningowy, powrót; widoczne w kliencie |
| M3, osobna iteracja | Bridge + rules Brain + SQLite | Event/command/result, restart pamięci, awaria Brain nie zatrzymuje gry |
| M4 | Jeden provider LLM | Dialog wpływa na dozwolone działania, timeout i budżet działają |
| M5 | Mira i Kael | Pamięć z pochodzeniem, komunikacja lokalna, limity pętli rozmów |
| M6 | Towarzysz bojowy | Osobny proof of concept typu jednostki, walka i ekwipunek przez silnik |

## Cel na dzisiaj
Minimum M1. Ambitny cel M2. M3 tylko jeśli fundament nie zabierze całej sesji. Nie obiecuj pełnego autonomicznego MMORPG w jeden wieczór.

## Warunek zmiany silnika
Canary jest preferowany ze względu na gotowy lokalny quickstart. TFS rozważ dopiero przy konkretnym blokerze zgodności, wymagań sprzętowych lub adaptera, zapisując koszt migracji. Nie mieszaj ich Lua/datapacków.

## Definition of done iteracji
Działa wskazany przepływ; istnieje dowód lub uczciwe NOT RUN; runbook zgodny z plikami; brak sekretów w git; wersje przypięte; STATUS aktualny; znany sposób zatrzymania bez kasowania danych. Nie wymagamy testów pustych folderów i opisów; wymagamy testów walidacji i rzeczywistych skutków działania.
