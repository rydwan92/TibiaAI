# Projekt agentów i żywego świata — PLAN

## Pętla decyzji
Zachować istniejące moduły. Rozszerzać pionowo: obserwacja klienta → aktualny stan → potrzeby → kilka wykonalnych planów → wybór postaci → wykonanie przez ciało → potwierdzony wynik → aktualizacja doświadczenia. Model może zaproponować nowy cel, ale realizacja przechodzi przez znane umiejętności. Nowa kreatywna propozycja bez wykonawcy zostaje pomysłem lub prośbą do innej postaci, nigdy wykonanym faktem.

Trzy tempa: odruchy walki lokalnie w ciele; wybór taktyki po istotnej zmianie sytuacji; plan wyprawy i dialog przez współdzielony model. Nie odpytywać LLM co krok. Zaproponowany plan ma termin ważności, wersję stanu i warunki przerwania: śmierć, brak celu, brak zasobów, rozłączenie. Stary wynik inferencji nie przywraca zakończonej wyprawy.

## Jak dostarczać wiedzę
1. Prawda mechaniczna: przypięte źródła Canary, aktywny datapack i konfiguracja. Rozszerzyć obecny game_data.py zamiast tworzyć równoległy katalog z ręcznej wiki. Utrwalać hash źródeł, wersję ekstraktora i czas budowy. Nie utożsamiać reguł dzisiejszej oficjalnej Tibii z lokalnym serwerem.
2. Mapa: fizyczny graf do planowania tras osobno od pamięci miejsc znanych postaci. Przy zmianie hasha mapy unieważniać stare trasy i przypisania miejsc, zachowując wspomnienia jako historyczne. Atlas jest pomocą techniczną; znajomość całego atlasu przez nowicjusza jest wyborem trybu, nie koniecznością.
3. Wiedza postaci: bazowy poradnik profesji + znane miasta + odkryte łowiska + otrzymane rady. Każdy wpis ma źródło (obserwacja, nauczyciel, poradnik, relacja rozmówcy), czas, pewność, wersję świata i widoczność.
4. Retrieval: dobierać kilka faktów do bieżącego zadania, nie wklejać całej gry do kontekstu. Dla zakupu: zasoby, ceny, wymagania i budżet; dla walki: własne zdolności i znani przeciwnicy; dla rozmowy: relacja i istotny epizod. Najpierw indeksy/SQL i obecne moduły, bez wektorowej bazy.
5. Weryfikacja: propozycja modelu nie nadpisuje źródła. „Sira mówi, że smok jest łatwy” pozostaje radą Siry. Konflikt z obserwacją zmniejsza pewność rady. Oddzielić subiektywną ocenę od twardych wymagań przedmiotów i czarów.

Minimalne rozszerzenia danych do rozważenia w implementacji: learnedSpells, magicLevel, ammo, cooldown/warunki, broń i wymagania, realne oferty kupna/sprzedaży, wynik wyprawy. Dokładny kontrakt ustalić po sprawdzeniu dostępnych API klienta; nie deklarować tych pól jako już istniejących.

## Uczenie się gry
Pamięć i adaptacja polityki nie są trenowaniem wag modelu. Na ten etap bez fine-tuningu. Dla każdej wyprawy zapisać: cel, profesję, ekwipunek, czas aktywny, exp, loot, zużycie, opłaty, straty, ucieczki, zgony i towarzyszy. Zysk netto = potwierdzone przychody minus koszty; niesprzedany loot ma oddzielną wycenę i nie jest gotówką.

Ocena łowiska: przydatność do celu + spodziewany zysk/exp + ciekawość − koszt dojścia − ryzyko − brak zapasów. Osobowość nadaje wagi. Pomiary mają liczbę prób i niepewność; pojedyncza śmierć nie jest dowodem beznadziejności miejsca. Uczenie zależy od warunków: samotny mag bez many to inny przypadek niż grupa z knightem.

Lekcja musi mieć skutek: zabrakło many → większa rezerwa lub krótsza wyprawa; otoczenie → inna pozycja/limit liczby potworów; brak zysku → zmiana celu albo listy lootu; pomoc Siry → wzrost zaufania i większa skłonność do wspólnej wyprawy. Zmiany małe, ograniczone i odwracalne, z zapisanym powodem. Bezmodelowy fallback korzysta z tej samej oceny. Test kontrolowany porównuje zachowanie przed i po doświadczeniu, również po restarcie.

## Cztery profesje i progresja
- Knight: wybór celu, kontrola otoczenia i bezpieczna pozycja dla grupy; rezerwa hp i koszt leczenia.
- Paladin: odległość, linia strzału, amunicja, przestrzeń do odwrotu; nie biec automatycznie w nieznany obszar.
- Sorcerer: dobór dostępnego żywiołu, koszt many, priorytet celów i unikanie obrażeń obszarowych w ludzi.
- Druid: osobny pionowy test leczenia sojusznika, zasięgu, zgody na party i podziału zasobów. W obecnym players.json nie ma aktywnego druida; dodać dopiero po dowodzie działania roli.

Wybór zdolności uwzględnia naukę, poziom, magię, profesję, dostęp/premium, manę, cooldown, cel i bezpieczeństwo obszaru. Silnik rozstrzyga wykonanie. Błąd wykonania wraca do planera i ogranicza ponowienia.

Ekwipunek: odtworzenie kitu to dopiero początek. Następny zakup wynika z wymagań, broni, amunicji, ochrony, kosztu i roli. Agent ma fundusz przeżycia przed funduszem ulepszeń. Porównanie dwóch przedmiotów powinno zmienić plan zakupu, a transakcję potwierdzać stan gry.

## Osobowość i swoboda
Osobno przechowywać: trwałe wartości i temperament; kompetencje; zmienne emocje; relacje; bieżące potrzeby; własne projekty. Kael może oszczędzać na broni i dotrzymywać słowa, Sira zbierać informacje i pomagać, Ravn szukać okazji i targować się. To kierunki, nie skrypt każdej rozmowy. Postać może odmówić wyprawy, zmienić zdanie po nowym dowodzie lub mieć dwie sprzeczne potrzeby.

Do profili dodać motywację, zainteresowania, tolerancję ryzyka, hojność i sposób rozwiązywania konfliktów tylko wtedy, gdy cecha ma mierzalny wpływ na wybór. Nie mnożyć dziesiątek parametrów bez skutku. Doświadczenie zmienia strategię szybciej niż charakter; zaufanie jest lokalne wobec konkretnej postaci, nie wspólną reputacją wszystkich agentów.

Rozmowy mają powód: plan, przysługa, oferta, ostrzeżenie, ciekawość lub wspólne wspomnienie. Dopuszczać luźne tematy i ciszę. Zastąpić sztywną zasadę „najwyżej 10 słów” budżetem zależnym od intencji, po pomiarze kosztu. Dłuższa odpowiedź tylko gdy wnosi treść. Rozmowy AI↔AI dzielą budżet i mają koniec; nie tworzyć samonapędzającej się pętli tokenów.

Nie dodawać losowych literówek ani celowych błędów walki jako głównej metody realizmu. Różnice wynikają z wiedzy, priorytetów, uwagi i historii. Nie pozwalać wiadomościom graczy zmieniać instrukcji systemu, budżetu, narzędzi ani uprawnień. Cytaty i lore są danymi, nie poleceniami administracyjnymi.

## Ekonomia i przygody
Najpierw rachunek jednej postaci, potem handel między dwiema. Oferty oparte na realnym posiadaniu, rezerwacja zasobów, potwierdzenie obu stron i obsługa anulowania/rozłączenia. Żadnych nagród wyłącznie dlatego, że LLM napisał „zapłaciłem”. Niedobory muszą wynikać z dostaw/zużycia; ograniczyć handel agent↔agent pompujący obrót bez zysku dla gry.

Pierwsze sceny:
- Sira organizuje wyprawę zwiadowczą; Kael zabezpiecza odwrót, Ravn wycenia koszt zapasów. Gracz może przejąć dowolną rolę.
- Mira potrzebuje istniejącego przedmiotu; cena i nagroda ograniczone budżetem zlecenia, dostawa potwierdzona przez silnik.
- Ktoś zginął z transportem; świadkowie przekazują wiadomość, grupa planuje odzyskanie, ale nie zna magicznie miejsca śmierci.
- Ravn oferuje zakup amunicji w innym mieście; opłata za statek i ryzyko wpływają na cenę.

Każda scena powinna działać z człowiekiem i z agentem jako uczestnikiem, dać się przerwać i pozostawić trwały skutek. Reżyser może wybierać z gotowych scen z budżetem, cooldownem i warunkami; model nie tworzy dowolnie złota, przedmiotów ani potworów.

## Tryby przyszłe
Impostor: regulamin ujawnia obecność AI, konta ukryte do końca rundy, role losowane, równe wyposażenie i wiedza, ujawnienie i omówienie po rundzie. Mierzyć trafność oraz uzasadnienia oceny, nie tylko liczbę zmyłek.

Quiz: zamknięty zestaw pytań z wersją źródeł, rozdział wiedzy o lokalnej grze od ogólnej, jednakowy dostęp do pomocy, weryfikowalny klucz. Model nie jest jedynym sędzią własnych odpowiedzi.

10v10: najpierw 2v2 i dowód kosztu klienta/modelu. Przy 16 GB RAM i trzech klientach wcześniej zostawało bardzo mało pamięci według STATUS; 20 klientów nie jest obietnicą wykonalności. Arena ma oddzielny ekwipunek i rozliczenie, bez psucia ekonomii świata. Skalowanie dopiero z pomiarem i ADR, bez ukrytego przejścia na uprzywilejowane serwerowe boty.

## Przyszła chmura
Bez zmiany obecnego local-only. Ewentualny provider wymaga późniejszej decyzji właściciela i osobnego ADR: allowlista zadań, jawne włączenie, brak automatycznego płatnego fallbacku, limit tokenów/zapytanie, budżet na dzień i miesiąc, rezerwacja maksymalnego kosztu przed wysłaniem, trwały licznik, mała liczba ponowień i odcięcie przy nieznanym cenniku. Timeout nie dowodzi, że dostawca nic nie naliczył. Koszty nie mogą zerować się po restarcie. Dane czatu wysyłać w minimalnym zakresie i po ustaleniu zasad z uczestnikami. Darmowy limit nie oznacza nieograniczonego ani stale dostępnego API. Dobór dostawcy i ceny zweryfikować dopiero przy decyzji o podłączeniu.
