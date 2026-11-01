# Plan dostaw i warunki odbioru — PLAN

Nie wdrażać całej listy w jednej sesji. Jeden pionowy wynik na iterację, aktualizacja dotychczasowych DOCS i dowody. Kolejność: M0 → M1 → M2 → M3; M4 po M2 i M3; M5 po M4. M6 zależy od pomiarów sprzętu. Bez estymat udających gwarancje.

| Etap | Zakres i miejsca startowe | Odbiór |
| --- | --- | --- |
| M0: zamknięcie migracji | Praca obecnego Claude: sync-server, atlas, boats, fixtures, NPC i dokumentacja | Zalogowanie na poziomie 8 w Thais; NPC mają poprawne punkty i prowadzą; rejs opłacony normalną rozmową i powrót; brak gotówki/odmowa kapitana nie zawiesza planu; stare dane Montag nie wyznaczają aktywnych tras. Mapa i atlas z hashami. Testy dotychczasowe nie są automatycznie VERIFIED na nowej mapie |
| M1: niezawodność | R01, obserwacje świeżości stanu i cyklu sesji, pomiar kolejki R07 | Testy częściowego JSON, truncate i restartu; 3 klientów bez modelu, śmierć/relog i brak starego polecenia; brak utraconych potwierdzeń. Zapis limitów RAM/VRAM i czasu reakcji, bez równoległego ciężkiego skanu silnika |
| M2: pełna wyprawa | R02/R03/R05, knowledge, choices, adapter, normalni nauczyciele i sklepy | Knight/paladin/sorcerer wykonują loot→sprzedaż→zakupy→kolejną wyprawę, bez refreshu dev-kit. Czary po legalnym nauczeniu. Przerwane zakupy i bankructwo mają wynik. Druid jako oddzielna kolejna iteracja po tych trzech |
| M3: doświadczenie i wiedza | R04/R06, wynik wyprawy, fakty postaci, ważenie łowisk | Kontrolowany scenariusz braku many/niebezpiecznego miejsca zmienia wybór także bez modelu i po restarcie. Zmiana jest zapisana z powodem; lepszy ekwipunek pozwala ponownie rozważyć miejsce; obcy agent nie zna prywatnej lekcji |
| M4: osobowość we współpracy | players mind/choices, relacje i istniejąca pamięć NPC | Człowiek zaprasza na wyprawę, AI negocjuje cel i podział, wykonuje albo jasno odmawia; śmierć/rozłączenie kończy plan. 3 profile w tych samych warunkach mają różne uzasadnione wybory. Zaufanie zmienia reakcję na tę samą prośbę |
| M5: ekonomia i pierwsza przygoda | Oferty, potwierdzone przekazania i scena dostawy | Dwie strony rozliczają towar i pieniądze bez duplikacji, z anulowaniem i restartem. Jedna przygoda z planem, udziałem człowieka i trwałym skutkiem. Raport źródeł i ujść złota |
| M6: gry eksperymentalne | Najpierw impostor i quiz, potem arena 2v2 | Uczestnicy znają zasady, wyniki weryfikowalne; identyfikacja AI ujawniona po rundzie. 10v10 dopiero po udanym teście obciążenia i ustaleniu zasobów |

## Pierwsza iteracja po migracji
Zrealizować M1 w wąskim zakresie R01: niezawodny odbiór zdarzeń graczy. Równolegle w sensie zakresu raportu, bez wymogu dodatkowych agentów, tylko zmierzyć obciążenie modelu; nie budować od razu nowego schedulera. Następna iteracja: legalny cykl zdolności i zapasów M2, a nie nowe minigry.

## Pakiet dowodów każdej iteracji
- Wersja kodu/dirty state, hash mapy/atlasu/danych, konfiguracja scenariusza i czas lokalny.
- Oddzielnie testy kontraktów/jednostkowe, integracja, klient i dłuższy bieg. PASS/FAIL/NOT RUN wraz z ograniczeniami.
- Stan start/koniec i różnice: exp, zgony, gotówka, loot, zakupy, zużycie, interwencje operatora i wszystkie granty developerskie.
- Próbki osi obserwacja→decyzja→polecenie→potwierdzony skutek. Deklaracja LLM lub wysłana komenda nie jest sukcesem.
- Opóźnienia P50/P95, liczba próbek, timeouty, kolejka, fallbacky, wywołania per agent i zużycie pamięci.
- Krótki test klienta po zmianie; po stabilizacji cel diagnostyczny: 30–60 min z trzema agentami. To plan testu, nie obecny wynik. Sesja z człowiekiem w osobnym uzgodnionym terminie, nie raportować jej bez człowieka.

## Zasady odbioru produktu
Wynik nie przechodzi, jeśli wymaga ręcznego teleportowania co kilka minut, grantów w normal-play, ignorowania niepowodzeń albo dopisywania sukcesów do pamięci bez skutku w silniku. Każdy przestój ma przyczynę: odpoczynek, rozmowa, brak środków lub błąd; nie mylić zamierzonej ciszy z awarią.

Nie ustalać arbitralnej docelowej liczby zgonów ani exp/h przed bazowym pomiarem dla profesji. Porównywać z identycznym scenariuszem, wieloma próbami i takim samym budżetem, uwzględniając niepewność. Dla osobowości oceniać decyzje i ich powody, nie sam styl wypowiedzi.
