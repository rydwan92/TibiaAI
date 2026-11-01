# Iteracja 0022: wspólna historia

Stan: VERIFIED w kliencie dla rdzenia; pozycje NOT RUN w tabeli dowodów

## Cel
Efekt z wizji: wracasz po tygodniu, postać przypomina sobie waszą wyprawę, proponuje następny cel i zachowuje się inaczej, bo coś razem przeżyliście. Do tego PvP z motywu widoczne w grze i serwer, który nie gaśnie sam.

## Kryterium odbioru
- Serwer przechodzi przez codzienny zapis o 06:00 bez wyłączenia.
- Postać pisze pierwsza do znajomego po długiej przerwie i odwołuje się do czegoś, co zapisała gra, a nie model.
- Obietnice przeżywają kompresję, są widoczne w decyzjach, kończą się dotrzymaniem albo złamaniem.
- Profil pamięci zmienia wagę tego samego zdarzenia.
- Żart PvP odbywa się w kliencie, druga postać reaguje, a skutek widać po jej stronie.
- Kompresja działa na kopii prawdziwej bazy, bez dotykania żywej.

## Co weszło
- `players/story.ts`: chwile z osobą (`exp.moments`, najwyżej 8, duże zostają), obietnice w obie strony (`exp.vows`, otwarte do dotrzymania, po 14 dniach złamane), linia tygodnia (`exp.chronicle`). To osobna warstwa w doświadczeniu postaci: kompresja jej nie dotyka.
- Spotkanie po przerwie: postać pisze pierwsza, gdy widzi znajomego albo gdy ten wchodzi do gry. Człowiek po 3 godzinach, ktoś z floty po 12. Wrogowi bez modelu nie pisze nic.
- Prowadzenie: model może zwrócić `lead_to` z listy własnych miejsc; identyfikator spoza listy jest ignorowany. Postać idzie, zakłada drużynę, po wyprawie zapisuje liczby z gry.
- Przyjaciele: lubiana osoba trafia na listę VIP przez `orders.addVip`, więc jej wejście do gry dociera do postaci.
- Żart PvP: opcja `prank_*` dla znajomych, 12 s, koniec przy 50% życia celu albo gdy cel zniknie.
- Profile pamięci: `memory` w `players.json` mnoży wagę tematów (`fights`, `friends`, `trade`, `danger`), `detailDays` wydłuża okres pełnych szczegółów.
- Kompresja: zdarzenia postaci podpisane jej imieniem, `retentionByNpc`, `cli/memory-rehearsal.ts` na kopii bazy.
- Serwer: `globalServerSaveShutdown = false`. Upstream wyłączał cały serwer o 06:00.
- `mapKnowledge: 'told'`, postacie Astra, Sol, Claude.
- `scripts\stand-in.ps1` i `tools\scene.py`: dubler człowieka i sceny w grze.
- Budżet na uruchomienie Brain podniesiony do 150 kredytów, równo z dziennym.
- Kolejka modelu: 3 wywołania naraz, 40 na minutę. Pogawędki między agentami ustępują decyzjom (`spare`), najwyżej 4 odpowiedzi na znajomych w 5 minut.
- Narzędziownik `src/panel.ts`, `scripts\panel.ps1`: ranking, pamięć, obietnice, koszty. Plik lokalny, bez serwera.
- Rozmowy o wydarzeniach: `exp.rumors`, `topicsOf`, `gossip`. Między agentami wyłącznie czat lokalny; prywatnie tylko pomoc i umawianie wyprawy.
- Zwiedzanie: `restless`, `canGetTo`, `noticeTown`, `exp.towns`, tempo exp w prompcie.
- Sprzęt: `tools/make_gear.py`, `gear-shops.json`, `nextGear`, zakup potwierdzany linią serwera.
- Własne miejsca: `tools/map_place.py`, `game/world/places`, Plac Stevium, opcja `square`.
- Wydarzenia: `scripts\event.ps1`, najazdy z datapacku; ogłoszenia stają się tematem rozmów.
- Obserwacja za zgodą: `observation.json` (pusta), `lib/observe.lua`, `scripts\observe.ps1`. Bez mowy.
- Strażnik: `scripts\keeper.ps1`.
- Kamienie milowe: `DOCS/MILESTONES.md`.

## Odkrycia
- Sprostowanie: po biegu nocnym napisałem, że agenci grają dalej. Serwer wyłączył się o 06:05 przez dzienny zapis upstream i stał do rana.
- Agent odchodził w trakcie rozmowy: Luna ruszyła na polowanie i nie usłyszała kolejnej wiadomości. Teraz w rozmowie z kimś obok nie podejmuje nowych decyzji, chyba że walczy albo ucieka.
- PvP nie wystąpiło w żadnym biegu, bo wszyscy agenci są znajomymi, a znajomi nie mieli opcji ataku bez urazy. Stąd żart.
- `player-agents.ps1 -Start` przerywał się w połowie i zostawiał klienty bez plików PID. Teraz sprawdza konta przed startem.
- Limit 14 wywołań na minutę głodził decyzje: Sol i Claude stali w świątyni, bo pogawędki zjadały całą pulę.
- Pierwszy skan mapy przez `map_place.py peek` zajął 8 GB, zostawił 0,3 GB wolnej pamięci i zabił klienta Kaela. Skan czyta teraz tylko wskazany fragment.
- „kupione: soldier helmet” w dzienniku było fałszem: serwer odpowiedział `Bought 0x`, bo postać nie uniosłaby hełmu. Zakup liczy się teraz tylko po linii serwera, a oferta sprawdza udźwig.
- Serwer sprzedawał hełmy, ale postacie ich nie nosiły: pętla sprzedaży oddawała świeży zakup za 16 złota („Bought 1x”, sekundę później „Sold 1x”). Haiku straciła tak trzy hełmy. Zakup jest teraz wyłączony ze sprzedaży, a o posiadaniu decyduje `worn`, nie licznik.
- Sira: bez strzał, broni i złota biła trolle gołymi rękami i ginęła. Dostaje zadeklarowany zestaw deweloperski; postacie `selfReliant` go nie dostają.
- Sira chodziła do sklepu z 0 złota. Bez pieniędzy postać najpierw zarabia.

## Dowody
Testy: `node --test test/*.test.ts` 259/259 PASS, `tsc --noEmit` PASS.

| Sprawdzenie | Wynik | Dowód |
| --- | --- | --- |
| Lokalny `ornith-1.5:9b` na tych samych scenariuszach | 21/30 i 7/12, razem 28/42 | `model-compare-20261101-095526.json`, `-095657.json`; Luna 41/42, Haiku 39/42 |
| Żart PvP | PASS w kliencie | u Ravna „Kael loses 3 hitpoints due to your attack”, u Kaela „Ravn mnie atakuje!”, odwet, Ravn uciekł do świątyni; koniec po czasie: „koniec zartu z Kael” |
| Decyzja o prowadzeniu po argumencie | PASS w kliencie | dubler: „mam 10 mikstur...”, Luna: „no dobra, 10 mikstur brzmi sensownie, chodzmy na wilki na wschod”, dziennik `prowadze Knight Sample`, dubler doszedł z nią na 32459,32169 |
| Wyprawa zostawia liczby z gry | PASS | `Wyprawa z Knight Sample: na wschod od Thais, 10 zabitych, 336 exp` w `exp.moments` |
| Obietnica człowieka | PASS | `Knight Sample obiecal: Nastepnym razem pokaze mi cos`, wpis w `exp.vows` |
| Dodanie człowieka do VIP | PASS | `vips` Luny zawiera Knight Sample, dziennik: „Knight Sample wylogowal sie”, „wszedl do gry” |
| Powrót po 8 dniach | PASS w kliencie po drugiej stronie | zdarzenie dublera 11:21:25 `[prywatnie] Luna: Siema, pamietasz nasze 10 wolfow i snake'ow na wschod od Thais? Miales mi cos pokazac, potem mozemy wrocic po exp`. Datę kontaktu cofnięto hakiem testowym `aged`; nie czekano tygodnia |
| Kompresja na kopii bazy | PASS | `memory-rehearsal-20261101-101445.json`: 30 partii, 0 błędów, 548 zdarzeń, 30 wspomnień, 0,732 kredytu, pamięć Luny nietknięta. Kopia usunięta po próbie |
| Dzienny zapis bez wyłączenia | PASS w konfiguracji, w grze NOT RUN | `config.lua`: `globalServerSaveShutdown = false`; czeka na 06:00 |
| Limit wywołań po zmianie | PASS | Sol i Claude ruszyli w ciągu minuty po restarcie Brain |
| Plac Stevium w silniku | PASS | `scripts\scan.ps1 -X 32327 -Y 32300 -Z 7 -Radius 5`: latarnie w rogach i drogowskaz jako pola stałe, Canary wczytał plik bez błędu; Sol doszedł na plac |
| Agent sam wybiera plac | PASS | Haiku: `square: Astra pyta gdzie jestem, a Kael juz idzie, wiec lepiej spotkac sie na placu` |
| Najazd | PASS | `world_event ok:true`, „Rat Plague in Thais!” w `events.jsonl` z `broadcast:true`, tryb klienta 18 |
| Rozmowa o wydarzeniu między agentami | PASS | Claude: „Kael, idziesz na szczury podczas plagi w Thais?”; Sira o wzmocnionych potworach dnia z ogłoszenia serwera |
| Człowiek dowiaduje się nowości | PASS po drugiej stronie | klient dublera 12:11:14 `Kael: knight sample, slyszales o pladze szczurow w thais?`, 12:11:19 `Kael: hej, podobno dzis plaga szczurow w thais, a wzmocniony jest blood beast`. Drugie pytanie do Kaela nie dotarło: nie ma go w jego zdarzeniach |
| Porównanie profili mapy | Wynik wstępny | `player-run-20261101-121003.json`, 45 min, trzy nowe rycerze na tym samym modelu: `told` Astra +1308 exp, `home` Sol +1773, `all` Claude +1298, wszyscy 0 śmierci. Różnica mieści się w przypadku; bieg zakłócały restarty i skok pamięci. Znajomość mapy nie decyduje na tym poziomie, więc ograniczona wiedza nic nie kosztuje |
| Bieg 45 min, 9 postaci | Częściowy | Haiku +4739, Luna +2244, Kael +2076, Ravn +1935, Sira +256; 3 śmierci. Bieg objął kilka restartów, więc liczby nie są czystym pomiarem |
| Zakup sprzętu z założeniem | PASS w grze | Kael: `Bought 1x soldier helmet for 110 gold coins`, złoto 630 na 520, `worn` slot 1 = 3375. Odruch `gear_` wybrał to sam, bez haka testowego |
| Ratunek łucznika | PASS w grze | Sira: `zero zlota, brak 0 rzeczy i strzal: zestaw startowy z miasta`, 149 strzał w `state.json` |
| Podróż do nowego miasta | NOT RUN | napęd działa w testach, żaden rejs jeszcze nie padł po wdrożeniu |
| Obserwacja za zgodą, strażnik po awarii | NOT RUN | lista zgód pusta; strażnik uruchomiony, awarii nie było |
