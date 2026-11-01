# Gracze-agenci

Autonomiczne postacie grające w świecie przez prawdziwego klienta, tak samo jak człowiek. Kael (knight), Sira (paladin), Ravn (sorcerer) oraz Luna i Haiku (knight, ten sam charakter, różne modele) wchodzą do gry, polują, schodzą pod ziemię, giną, wracają i piszą do siebie. Decyzja architektoniczna: ADR 0010. Dowody: `iterations/0014-player-agents.md`.

## Podział ról
| Część | Plik | Co robi | Czy czeka na model |
| --- | --- | --- | --- |
| Ciało | `tools/otclient-agent/agent.lua` | Pakiety klienta: walka, leczenie, ucieczka, chód, drzwi, drabiny, lina, łopata, loot, jedzenie, czat, VIP, zakładki | Nigdy |
| Umysł | `apps/brain/src/players/mind.ts` | Odczucia, pamięć, wybór celu, rozmowy, wspólne wyprawy, prośby o pomoc | Tak, ale gra na niego nie czeka |
| Wybory | `players/choices.ts` | Lista działań możliwych teraz, wybór z temperamentu bez modelu | Nie |
| Wiedza | `players/knowledge.ts` | Czary, runy, potwory, miasta, łowiska z danych serwera | Nie |
| Mapa | `players/nav.ts` | Trasy po polach, drzwiach, piętrach i teleportach | Nie |
| Flota | `players/fleet.ts` | Wspólny budżet modelu lokalnego: 8 wywołań na minutę. Postać z własnym `model` liczy się w budżecie kredytów (ADR 0011) | Nie |

Ciało i umysł rozmawiają plikami w `runtime/players/<klucz>/`:

| Plik | Kierunek | Treść |
| --- | --- | --- |
| `state.json` | ciało → umysł, co sekundę | Co postać widzi i ma, lista VIP |
| `events.jsonl` | ciało → umysł | Usłyszane słowa, komunikaty serwera, śmierć, zmiana stanu VIP |
| `orders.json` | umysł → ciało | Cel, czary, runy, wiadomości do napisania |
| `diary.log` | umysł | Dziennik do czytania przez człowieka |
| `metrics.json` | umysł, co 30 s | Liczby do raportu |

## Skąd agent wie, co robić
- **Model wybiera z listy.** `optionsFor` buduje tylko działania możliwe tu i teraz, a model zwraca identyfikator z enum, własną myśl i plan. Nie może wymyślić miejsca ani akcji.
- **Bez modelu gra dalej.** `chooseByTemperament` losuje z wagami z odwagi, ciekawości, towarzyskości, chciwości i odczuć.
- **Odczucia wynikają ze zdarzeń:** strach rośnie od obrażeń i śmierci, pewność od exp, nuda od chodzenia po znanym.
- **Wiedza pochodzi z serwera:** `knowledgeFor` podaje czary dostępne na tym poziomie, kolejny czar, narzędzia, miasta i radę dla profesji. `lookupFacts` dokłada dane potwora, czaru lub runy nazwanych w wiadomości.

## Czary znane naprawdę
Znane są tylko czary potwierdzone przez serwer. Dane nauczycieli pochodzą z datapacku (`tools/make_teachers.py`, `teachers.json`: 48 NPC, 1778 lekcji). Opcja `learn_*` powstaje, gdy czar leczący lub celowany jest dostępny na ten poziom i profesję, a cenę da się zapłacić. Ciało idzie do nauczyciela i mówi `hi`, nazwę czaru, `yes`. Stan zmienia dopiero odpowiedź NPC: „You have learned” lub „You already know” dodaje czar, odmowa kończy sprawę i wraca do planera na 10 minut. Komunikat „You need to learn this spell first” przy rzucaniu wykreśla listę. Postacie ze starym zestawem (`kitSpells`) liczą te czary jako znane, to zadeklarowany wyjątek.

## Gra bez wyjątków
`selfReliant` w `players.json`: żadnego uzupełnienia z zestawu po złej śmierci. Bez pieniędzy postać zarabia na najsłabszym bezpiecznym celu zamiast iść do sklepu. Zostaje jeden wyjątek: pierwszy zestaw `noviceknight` przy pierwszym wejściu, bo pominęliśmy Rookgard, a nowa postać nie ma z czego wystartować.

## Wspólna historia
Warstwa, której kompresja nie dotyka (`players/story.ts`): chwile z konkretną osobą (`exp.moments`, najwyżej 8), obietnice w obie strony (`exp.vows`, po 14 dniach złamane) i jedna linia na tydzień (`exp.chronicle`). Znajomy, którego postać nie widziała od 3 godzin, dostaje od niej pierwszą wiadomość; ktoś z floty po 12 godzinach. Liczby w chwilach pochodzą z gry, model ich nie zmyśla. Lubiana osoba trafia na listę VIP przez `orders.addVip`.

## Rozmowy o tym, co się dzieje
Tematy to własne przeżycia (`exp.news`) i plotki (`exp.rumors`) z podaniem, od kogo pochodzą; plotka znika po dobie, ogłoszenia serwera mają źródło `serwer`. Gdy obok jest ktoś inny, a postać nie walczy, raz na 10–25 minut sama zagaduje (`gossip`). Bez wolnego budżetu mówi gotowe zdanie bez modelu. Człowiek pytający o nowości dostaje te same tematy w prompcie.

Obok siebie agenci rozmawiają wyłącznie na czacie lokalnym, żeby ludzie mogli to usłyszeć i się włączyć. Gdy są daleko, raz na 20–45 minut jeden pisze prywatnie do drugiego: nowości, pytanie albo zaproszenie na wyprawę. Limit: 2 odpowiedzi na osobę i 4 na wszystkich znajomych w 5 minut, a pogawędka ustępuje decyzjom, gdy pula wywołań jest w połowie zajęta (`spare`).

## Zwiedzanie
Postać, która długo nie widziała niczego nowego (30 minut podzielone przez ciekawość plus 0,3), rusza do miasta, w którym nie była, jeśli ma 300 złota i zapasy. Gdy złoto leży w depo, najpierw je wypłaca. Trasę sprawdza `nav.route` dla pieniędzy w ręku. Nowe miasto trafia do pamięci, do opowieści i do panelu. Wokół odwiedzonych miast postać zna teren tak jak wokół domu.

## Sama decyduje i sama się uczy
Odruchy trzymają postać przy życiu: leczenie, ucieczka, zapasy. Wybór celu należy do modelu. Dobry pomysł, którego model odmówi, wraca przez kolejne decyzje, a po trzech odmowach dzieje się sam; każdy taki przypadek liczy `exp.overrides`. Co 30 minut, albo 2 minuty po śmierci, postać zamyka próbę liczbami z gry (exp, złoto, zgony) i wybiera następną. Popędy (`drives.ts`) mówią w prompcie, co ją teraz ciągnie.

## Dobór łowisk
`huntValue` szacuje exp/h i najmocniejsze uderzenie względem życia postaci. Granica ryzyka rośnie z pewnością siebie. Odległość obniża wartość, więc daleko idzie się tylko po coś lepszego. Własne pomiary z `exp.places` mają pierwszeństwo przed szacunkiem.

## Ulepszanie sprzętu
`tools/make_gear.py` czyta sklep Sama z datapacku. `nextGear` wybiera najwięcej ochrony za złoto, z zapasem 100 na mikstury i w granicach udźwigu. Zakup liczy się dopiero po linii serwera `Bought Nx`; `Bought 0x` to odmowa. Zapasowe bronie i zastąpiona zbroja idą do depo.

## Pamięć o ludziach
`memoriesOf` podaje modelowi to, co postać przeżyła z rozmówcą: jego słowa, własne odpowiedzi, wspólne wyprawy, a ze starszych dni streszczenia. Lista pochodzi z SQLite, więc przetrwa restart i zmianę modelu. Rozmowy nie trafiają do ogólnych wspomnień: to, co jedna osoba napisała prywatnie, nie pojawia się w rozmowie z inną.

## Znajomość mapy
`mapKnowledge: 'home'`: postać zna łowiska w promieniu 80 pól od domu i tam, gdzie była. Resztę musi odkryć albo usłyszeć od kogoś. System nawigacji dalej zna całą mapę, bo to narzędzie, a nie wiedza postaci. Domyślnie `all`.

## PvP z charakteru
Atak na obcego ma powód widoczny dla postaci: uraza, łatwy łup albo zabawa. `mischief` (0–1) mówi, jak często walka zaczyna się bez urazy. Znajomy wymaga powodu. Po walce ta sama osoba jest bezpieczna przez 30 minut, żeby nikt nie był nękany w pętli. Blokadę stref ochronnych i czaszki pilnuje silnik.

## Rozmowa z człowiekiem
Wystarczy raz zwrócić się po imieniu albo napisać prywatnie. Przez 90 sekund od ostatniej wymiany kolejne wiadomości tej osoby są skierowane do postaci, także bez imienia, a kilka krótkich linii trafia do modelu razem. Limit odpowiedzi to 20 na 5 minut (między agentami 3), odpowiedź ma do 25 słów. Model widzi swój cel, plan, miejsca, przekonania i wspomnienia o rozmówcy, więc może dzielić się tym, co wie. Propozycję wspólnej drogi rozstrzyga sam: `follow_them` zaczyna iść za osobą na 15 minut, `stop_following` kończy. Agenci nie rozmawiają z Notką, a Notka z agentami, bo dwa programy odpisywałyby sobie bez końca.

## Obecność w grze
Serwer wyrzuca po 15 minutach bezczynności, więc ciało obraca się co 8 minut. Po utracie połączenia wraca samo po 15 s, najpierw z listy postaci, a przy kolejnej próbie pełnym logowaniem.

## Drużyny, przerwy, plotki
Wspólna wyprawa zakłada drużynę ze wspólnym exp, gdy postacie się spotkają (`keepParty` w ciele). Co 45–90 minut postać, która nie walczy i nie ma sprawy do załatwienia, pisze do znajomego i wylogowuje się na 3–10 minut; w tym czasie nie wywołuje modelu. Napadnięta postać ostrzega znajomego („uwazaj na X”), a odbiorca zapisuje to jako zasłyszane i lekko obniża opinię o X. Nowy poziom bywa okazją do pochwalenia się znajomemu.

## Osobisty pomocnik (Notka)
Postać z `role: assistant` nie gra. Stoi w świątyni i odpowiada na prywatne wiadomości (`players/assistant.ts`). Dodajesz ją do VIP i piszesz: `zapisz <tekst>`, `moje notatki`, `usun <numer>`, `usun wszystko`, `przypomnij za 10 min <tekst>`, `pomoc`. Polecenia to zwykły kod i działają bez modelu. Inne wiadomości idą do modelu razem z notatkami tylko tej osoby. Notatki są w osobnej tabeli `assistant_notes`, poza pamięcią świata: nie trafiają do `npc_events`, plotek ani innych postaci. Czat lokalny jest ignorowany. Przy pierwszej wiadomości pomocnik mówi, że jest AI i że pytania idą do modelu w chmurze. Rozpoznaje osobę po nazwie postaci.

## Relacje i długie cele
`exp.people` (`players/people.ts`) trzyma dla każdej osoby liczbę spotkań, wspólnych wypraw, pomocy i walk oraz opinię od -5 do 5. Opinia powstaje ze zdarzeń: wspólna wyprawa i pomoc podnoszą, atak obniża, śmierć z ręki gracza obniża mocno, a odpowiedź modelu może ją lekko przesunąć. Model widzi jedno zdanie o każdej osobie w pobliżu i o rozmówcy. `ambition` w `players.json` to długi cel postaci, a `exp.plan` zostaje planem na najbliższy czas.

## Przekonania
Co 30 minut gry postać podsumowuje przeżycia, lekcje, miejsca i ludzi w najwyżej 5 przekonań w pierwszej osobie (`exp.beliefs`). Model myśli wtedy na `medium` i opiera się tylko na zapisie. Przekonanie to opinia postaci, nie fakt świata: może być błędne i następne podsumowanie może je zmienić. Widać je w dzienniku jako „przemyslalem” i w promptach decyzji i rozmów. Przechodzą przez restart i zmianę modelu.

## Różne charaktery pamięci
`memory` w `players.json` mnoży wagę tematów: `fights`, `friends`, `trade`, `danger`, a `detailDays` wydłuża szczegóły przed kompresją. Ravn trzyma walki i pieniądze, Sira ludzi.

`forgives` (0–1) mówi, jak szybko gaśnie uraza: Sira 0,9 wybacza w kilka minut, Ravn 0,05 pamięta przez godziny. To pierwsza z różnic z wizji; zapis i odzyskiwanie wspomnień są jeszcze wspólne.

## Wiedza krąży tylko przez mowę
Każdy agent pamięta wyłącznie to, co go spotkało. Nie ma wspólnej pamięci. Rada działa, bo ktoś ją napisał:

- „polecam na polnoc od Thais, na powierzchni, sa tam Wolf” zamienia się u odbiorcy w działanie `tip_1` na liście wyborów.
- „uwazaj ...” dopisuje ostrzeżenie do etykiety łowiska.
- Współrzędne przechodzą tylko przez tekst wiadomości, więc człowiek może uczestniczyć w tej samej rozmowie.

## Współpraca
| Zachowanie | Przebieg |
| --- | --- |
| VIP | Ciało dodaje znajomych po wejściu do gry i zgłasza, kto jest online. Tylko oni dostają rady i prośby |
| Prywatne rozmowy | Wiadomość przechodzi przez konsolę klienta: zakładka rozmówcy wychodzi na wierzch, a linia pojawia się w niej. Mowa lokalna wraca do Local Chat |
| Odpowiedzi | Wiadomość czeka w kolejce na wolną chwilę i budżet modelu. Rozmowa kończy się po 3 odpowiedziach w 5 minut, a powtórzona myśl zostaje niewysłana |
| Wspólna wyprawa | Pyta: „idziemy razem? gdzie jestes?”. Drugi podaje `x,y,z` albo odmawia. Pytający idzie tam, potem używa `follow` klienta. Po 4–8 minutach się rozdzielają; zgubiony pyta o pozycję najwyżej 3 razy |
| Pomoc | Poniżej 35% hp z potworem obok: „pomocy, X mnie bije, jestem x,y,z”. Znajomy przychodzi, jeśli sam jest zdrowy i odważny, inaczej odmawia |

## Życie gracza
| Zachowanie | Przebieg |
| --- | --- |
| Zaopatrzenie | Opcja `supply`: droga do Miry, okno handlu jak u człowieka: sprzedaje łup z cennika, kupuje listę z `players.json` (`supplies`), na ile starczy złota. Przy pustym plecaku bez modelu temperament sam tam prowadzi |
| Ekwipunek | Co chwilę porównuje to, co ma na sobie i w plecaku, z zestawem postaci. Brak idzie na początek listy zakupów, a kupione zakłada sam |
| Depozyt | Opcja `depot` od 100 złota: szafka w mieście, skrzynia, pudło, przeniesienie złota. Chroni przed stratą przy śmierci |
| Łup | Zabiera złoto, mikstury, jedzenie, runy i wszystko, co kupuje Mira, jeśli zostaje udźwig |
| Piętra | Trasa używa schodów, dziur, drabin, lin, łopat i teleportów. `ways` w `metrics.json` liczy, czego użył |
| PvP | Świat ma `worldType = "pvp"`. Obcego można zaatakować zawsze, znajomego dopiero przy urazie 3. Tryb bezpieczny schodzi tylko przy świadomym ataku. Po ataku nie ma wstępu do strefy ochronnej przez minutę, więc agent czeka |
| Urazy | Rosną od ataków, śmierci z czyjejś ręki i złych opinii po rozmowie, wygasają około 1 punktu na 5 minut. Decyzja o ataku należy do umysłu |
| Reakcja na atak | Serwer mówi „You lose ... by X”: odwaga i zdrowie decydują, czy oddać, czy uciekać do miasta |
| Nauka po śmierci | Model pisze jedną lekcję, która zostaje na stałe (ostatnich 6) i wraca w każdej decyzji. Bez modelu lekcję układa zdanie z danych. Łowisko z zabójcą ma ostrzeżenie w etykiecie |
| Opowieści | Po zakupach lub rozmowie z NPC mówi na głos o śmierci, nowym poziomie albo nowym piętrze. NPC w pobliżu zapamiętują to jako publiczną plotkę |
| Miejscówki | Własna mapa postaci (`places.ts`): pobyt liczy minuty, exp, złoto i zabicia w obszarze 48×48, a sklep, depo i port są zapisane z tym, po co się tam chodzi. Najlepsze wracają jako `spot_1`, `spot_2` z wynikiem exp/h, a śmierci obniżają wartość. Model widzi je w `TWOJE MIEJSCA`. To wiedza z przeżyć, nie z atlasu |
| Zwiedzanie | „Idź na północ” to trasa 45 pól w tym kierunku, a nie pchanie się w ścianę. Nieużywane zejścia i niewidziane łowiska idą na początek listy |
| Walka | Knight bije z bliska i goni. Paladyn, sorcerer i druid strzelają: odsuwają się od tego, co podeszło, a do celu poza zasięgiem podchodzą. Runy i mikstury zależą od poziomu, magii i profesji; lista zakupów rośnie razem z postacią |
| Plan | Model prowadzi własny plan, a trudne łowiska są dostępne z ostrzeżeniem, nie zakazem |

## Mapa
- Świat: `otservbr.otbm`, 18 mln pól (hash w `infra/versions.lock.json`).
- `tools/world_atlas.py` czyta OTBM, `items.xml` i `appearances.dat`: 31 477 przejść, 826 teleportów, 572 szafki, 95 736 fragmentów przejść w `runtime/atlas/nav-map.jsonl`. Liczy się 74 s, bez udziału silnika.
- `tools/make_grounds.py` grupuje prawdziwe spawny w 5383 łowiska, `tools/make_boats.py` czyta 26 kapitanów i 116 rejsów.
- Przy starcie Brain liczy pola z drogą w obie strony z Thais: 12 miast, 1641 łowisk, 344 stanowiska depo.

Pola, po których wejściu zmienia się piętro, są końcem odcinka, więc trasa nie wchodzi na nie przypadkiem. Zablokowany odcinek trafia na listę tej postaci, a trasa liczy się od nowa. Serwer sprawdza każdy krok, więc nieaktualna mapa kosztuje tylko ponowne liczenie.

Rejs to odcinek trasy z ceną. Agent idzie do kapitana, mówi `hi`, a nazwę miasta i `yes` pisze w oknie NPC. Trasa nie używa rejsu, na który go nie stać. Odmowa kapitana kończy plan i przez 10 minut agent nie liczy na statki.

## Ekwipunek
Handel jest prawdziwy: Mira ma cennik `packages/contracts/shop.json` (`tools/make_shop.py`), a agent zarabia sam. Zostaje jeden wyjątek deweloperski, tylko dla postaci z `arena.devCharacters`: `dev-kit.request` daje startowy zestaw, a powtórnie (`refresh`) tylko komuś, komu czegoś brakuje i kto ma razem poniżej 30 złota. Ten wyjątek uczy też czarów profesji do poziomu 30 (`arena.kitSpells`), bo świat nie ma nauczycieli. Paladyn ma łuk i kołczan w prawej ręce, bo tylko stamtąd ten silnik bierze strzały; kupione strzały przekłada z plecaka do kołczanu.

## Uruchomienie
```bash
powershell -ExecutionPolicy Bypass -File scripts\player-agents.ps1 -Start
```

```bash
powershell -ExecutionPolicy Bypass -File scripts\player-agents.ps1 -Status
```

```bash
powershell -ExecutionPolicy Bypass -File scripts\player-run.ps1 -Minutes 20
```

```bash
powershell -ExecutionPolicy Bypass -File scripts\player-agents.ps1 -Stop
```

Każdy agent to osobny klient: około 540 MB RAM. Hasła kont są w `.env`.

## Rola
Decyzja właściciela projektu na ten etap (2026-10-31): `players.json` ma `identity: "in_character"`, więc gracze-agenci nie mówią o sobie jako o AI, a nazwy nie mają znacznika `[AI]`. To dotyczy tylko prywatnego laboratorium, w którym gra właściciel. **Zanim wejdzie ktoś inny, trzeba go uprzedzić, że na serwerze są postacie AI, albo ustawić `identity: "honest"`.** NPC nadal mają `[AI]` i przyznają się do tego (ADR 0009).

## Test w kliencie
`runtime/players/<klucz>/force.json` wybiera działanie zamiast modelu, na przykład `{"option":"supply"}` albo `{"route":{"x":5012,"y":5093,"z":7}}`. To haczyk testowy, plik znika po użyciu.
