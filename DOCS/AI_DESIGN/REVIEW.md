# Review lokalnego projektu

## Zakres i wiarygodność
Przeczytano m.in. CLAUDE.md, STATUS, ARCHITECTURE, PLAYER_AGENTS, GAME_DIRECTION, BACKLOG, package.json, players.json, local-ai.json oraz kod players/{fleet,knowledge,choices,types,mind}.ts i fragmenty tools/otclient-agent/agent.lua. Sprawdzono git status i historyczny player-run-20261031-221403.json. Bez uruchomienia testów i gry; nie czytano sekretów .env. Migawka jest ruchoma: Claude równolegle zmienia pliki. Przed naprawą ponownie sprawdzić występowanie każdego punktu.

## Co warto zachować
- Prawdziwy OTClient jako ciało gracza i autorytatywny Canary: dobry fundament do wspólnej gry z ludźmi.
- Rozdział szybkich odruchów Lua i wolnego modelu; fallback temperamentu, potwierdzenia skutków, pamięć NPC z pochodzeniem.
- game-data, atlas, hunting-grounds i generatory: wiedzę można wyprowadzać z tej wersji gry zamiast z pamięci LLM.
- Trzy profile o różnych cechach i stylach, odczucia, lekcje po śmierci, VIP i pomoc: istniejące punkty rozszerzeń, bez potrzeby przepisywania całości.
- Local-only oraz limity modelu. Nie znosić ich, aby poprawić widowiskowość.

## Ustalenia do poprawy

### R01 / P1 — utrata zdarzeń przy częściowym zapisie lub skróceniu pliku
Miejsce: apps/brain/src/players/mind.ts, readEvents (od ok. 181). Odczyt ustawia offset=size przed parsowaniem wszystkich linii; niepełny JSON jest pomijany, a następny odczyt zacznie za nim. Gdy plik zostanie skrócony poniżej offset, warunek size<=offset uniemożliwia odczyt nowych zdarzeń aż do przekroczenia starego rozmiaru. Cały plik jest też czytany przy każdym odczycie, mimo użycia offset. To statycznie potwierdzone ścieżki utraty informacji, nie odtworzony incydent w grze.
Odbiór: zapis JSON w dwóch porcjach, podział wielobajtowego znaku, truncate/nowa sesja i ponowny start odbiorcy; brak utraty i niezamierzonego powtórzenia skutku. Buforować niedokończony rekord i identyfikować sesję/ciąg zdarzeń; ograniczyć odczyt i retencję. Dokładną semantykę restartu udokumentować.

### R02 / P1 — poziom nie dowodzi, że czar jest nauczony i wykonalny
Miejsce: players/knowledge.ts spellsFor; types.ts SpellFacts/BodyState; mind.ts aktualizacja ordersExtra. Wybór filtruje profesję, poziom, premium i manę, a następnie wybiera najwyższy poziom; brakuje reprezentacji nauczonych czarów w przeczytanym kontrakcie. runesFor ma stały warunek magicLevel<=1. Ciało używa orders.attackSpell/cfg.attackSpell (agent.lua ok. 460), więc odmowa serwera nie jest jeszcze strategią zdobycia zdolności. STATUS sam opisuje dev-kit uczący czarów do 30.
Odbiór: spełnia warunki, lecz nie zna czaru → nie ponawia bez końca; zakup/nauka i potwierdzenie → dopiero użycie. Zmiana many, magii, profesji i premium zmienia listę. Nie zastępować tego kolejnym darmowym przyznaniem.

### R03 / P1 przed ekonomią — zwykłe życie nadal zależy od wyjątków developerskich
Miejsce: agent.lua askForKit (ok. 613), STATUS, PLAYER_AGENTS. Adapter pisze dev-kit.request, a konfiguracja posiada kit. Wyjątek jest jawny i przydatny w laboratorium, ale maskuje bankructwo oraz koszt śmierci. Nie udowadnia samowystarczalności.
Odbiór: wydzielony profil normal-play bez refreshu, zwykłe zakupy i nauczyciele; raport każdego grant/spawn/gold. Brak pieniędzy skutkuje planem odzyskania sprawności, nie cichą dotacją. Zestaw do scenariusza areny może pozostać osobno.

### R04 / P2 — fallback słabo przekłada śmierć na wybór łowiska
Miejsce: choices.ts optionsFor i chooseByTemperament. Etykieta śmierci zawiera „tu zginales przez”, lecz obniżenie wagi rozpoznaje tylko „ostrzegal” i „prawie zginales”. lessons są tekstem dla modelu; to nie gwarantuje zmiany polityki bez modelu.
Odbiór: ustrukturyzowany koszt/ryzyko wyniku wyprawy wpływa na wybór także offline; bez parsowania polskich etykiet. Jedna porażka nie blokuje łowiska na zawsze; poprawa ekwipunku lub pomoc może uzasadnić powrót.

### R05 / P2 — brak many nie jest pełnoprawną potrzebą zaopatrzenia
Miejsce: choices.ts needsSupplies/outOfSupplies: warunki dotyczą mikstur zdrowia, strzał, udźwigu i braków ekwipunku; mana nie uruchamia tych warunków. Dla profesji magicznej kończąca się mana może nie wymusić zakupów wystarczająco wcześnie.
Odbiór: mag bez zapasu many, ale z hp potions, potrafi wrócić i kupić środki na kolejną wyprawę; knight ma inny profil rezerw. Weryfikować też odruchy ciała, zanim przypisze się rzeczywistą śmierć temu punktowi.

### R06 / P2 — możliwości wiedzy przewyższają doświadczenie postaci
Miejsce: knowledge.ts loadWorldFacts/knowledgeFor/monsterNotes; choices.ts groundsFor. Łowiska i dokładne statystyki pochodzą z globalnych danych. To poprawne źródło dla projektanta, ale agent łatwo staje się wszechwiedzący. Cechy wyboru łowiska nie uwzględniają wprost profesji, kosztów walki czy aktualnej broni.
Odbiór: oddzielić katalog projektanta od wiedzy postaci; nowicjusz zna bazowy poradnik, resztę odkrywa lub słyszy. Runtime zachowuje pełną wiedzę do walidacji. Fakty mechaniczne nie muszą być błędne, by postać mogła się mylić w ocenie ryzyka.

### R07 / P2 — budżety są, ale brakuje dowodu sprawiedliwości pod obciążeniem
Miejsce: fleet.ts CALLS_PER_MINUTE=8, stała kolejność tick; local-ai.json maxConcurrent=1, maxQueue=3, maxCallsPerMinute=20. Są to dwa poziomy limitów, nie dowód błędu limitowania. BACKLOG T06 wskazuje brak wspólnej kolejki priorytetów. Zbadać konkurencję dialogów NPC, decyzji graczy i kompresji.
Odbiór: 3 graczy + rozmowy z NPC + kompresja: brak zagłodzenia jednego agenta, przeterminowane decyzje odrzucane, podane P50/P95, odsetek fallbacków i udział wywołań per agent. Najpierw pomiar, potem scheduler.

## Co dowody mówią, a czego nie
player-run-20261031-221403.json ma minutes=15 i pozycje ok. 5000,5000. Dokumentuje poprzedni świat, nie Thais. Liczniki kills/trades/pvpFights są kumulacyjne: raportować różnice start/koniec, a nie przypisywać cały stan jednemu biegowi. Sam wzrost pvpFights nie dowodzi ukończenia świadomego pojedynku.

players.json już ma home=Thais, są boats.json i knowledge/thais.json, ale README/AGENTS/STATUS nadal zawierają Montag. To oczekiwana niespójność w trakcie migracji, nie gotowy wynik. Zrzuty Claude traktowano jako kontekst, nie jako dowody wykonania. Nie przenosić VERIFIED ze starej mapy na nową bez powtórzenia scenariuszy.

Nie wykonywano pełnego audytu bezpieczeństwa, wszystkich ścieżek Lua ani benchmarku modelu. Ten review wskazuje konkretne następne prace; nie potwierdza gotowości publicznego serwera.

## Odnośniki do napraw
Dopisane przez wykonawcę; treść review pozostaje bez zmian.
- R01: naprawione w iteracji 0018, `apps/brain/src/players/events.ts`.
- R04: etykiety zastąpione polem `risk` w opcjach, iteracja 0019.
- runesFor (część R02) i R05: rzeczywisty poziom magii i potrzeba many, iteracja 0019. Znajomość czarów pozostaje otwarta.

