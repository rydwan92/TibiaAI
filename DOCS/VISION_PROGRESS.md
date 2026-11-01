# Postęp wizji Stevium

Wspólny plik wszystkich sesji i iteracji. Mówi, co z [wizji](STEVIUM_PRODUCT_VISION.md) już istnieje. Czytaj go na początku pracy i dopisuj po każdym większym etapie. Dowody i szczegóły są w `DOCS/iterations/`, stan techniczny w `STATUS.md`.

Stany: PLAN, IMPLEMENTED (kod i testy), VERIFIED (sprawdzone w prawdziwej grze), BLOCKED.

## Mapa pomysłów
| Pomysł | Stan | Gdzie / czego brakuje |
| --- | --- | --- |
| Agent gra jak człowiek: loguje się, poluje, ginie, wraca | VERIFIED | Kael, Sira, Ravn; iteracje 0014–0019 |
| Prywatne wiadomości, VIP, wspólne wyprawy | VERIFIED | iteracje 0014–0016 |
| Reakcja na czat lokalny | VERIFIED | iteracja 0014 |
| Sklep, depo, statek, powrót po zapasy, śmierć i relog | VERIFIED | iteracje 0015–0018 |
| Pamiętanie miejscówek i wybór z własnych wyników | VERIFIED | iteracja 0019 |
| Nauka na błędach po śmierci | VERIFIED | lekcje, iteracja 0015 |
| Walka na dystans według profesji | IMPLEMENTED | dystansu nie mierzono |
| PvP z charakteru (żart, łup, respekt) | VERIFIED dla żartu | Ravn zaczepił Kaela, Kael oddał; łup i respekt nadal bez dowodu |
| Model wymienny, postać zostaje | IMPLEMENTED | `model` w `players.json`, ADR 0011 |
| Copilot: LUNA i HAIKU z budżetem kredytów | VERIFIED | 3 biegi w klientach, iteracja 0020 |
| Porównanie modeli na scenariuszach | VERIFIED bez gry | 42 scenariusze: Luna 41, Haiku 39 |
| Pamięć o konkretnej osobie po restarcie | VERIFIED | `[wspomnien: 5]` w dzienniku, iteracja 0020 |
| Pamięć warstwowa, kompresja | VERIFIED na kopii bazy | 30 partii bez błędu; w żywej bazie pierwsza kompresja 8 listopada |
| Różne profile pamięci (uraza, wybaczanie, interesy) | IMPLEMENTED | `memory` w `players.json`, `detailDays`, `forgives` |
| Relacje z ludźmi i długie cele | IMPLEMENTED | `people.ts`, `ambition` |
| Obietnice odporne na kompresję | VERIFIED | `exp.vows`, iteracja 0022; złamanie po 14 dniach tylko w testach |
| Powrót po przerwie: postać pamięta, pisze pierwsza, proponuje cel | VERIFIED | Luna do dublera człowieka, iteracja 0022 |
| Postać zna tylko to, co odkryła | IMPLEMENTED | `home` i `told`; pierwsze porównanie: bez wyraźnej różnicy w exp, próba mała |
| Rozmowy o wydarzeniach, plotki ze źródłem | VERIFIED | czat lokalny, człowiek dowiedział się o najeździe od Kaela |
| Zwiedzanie innych miast | VERIFIED jeden rejs | Haiku w Carlin, Vesna sama ruszyła do Kazordoon |
| Postać zmienia zdanie na podstawie wyników | IMPLEMENTED | `drives.ts`, próby z liczbami z gry; pierwsze wyniki po biegu |
| Postacie w innych miastach, wysokie poziomy | VERIFIED wejście | Elowen, Vesna, Borgar |
| Prawdziwe czary u nauczycieli | VERIFIED | Luna: `You have learned 'wound cleansing'` od Gregora |
| Zapasy bez dev-kitu | IMPLEMENTED | `selfReliant`, w grze jeszcze nie było bankructwa |
| NPC: rozmowa na każdy temat, żarty | VERIFIED | Ardan na modelu z konta, `client-autotest-20261101-015842.log` |
| Osobisty pomocnik przez VIP lub NPC | VERIFIED | Notka: zapis, przypomnienie, odpowiedź z notatek przez klienta |
| Agent sam decyduje, czy pójść z człowiekiem | VERIFIED | Luna po argumencie poprowadziła dublera na swoją miejscówkę; `follow_them` nadal bez dowodu |
| Jak postać widzi świat: przekonania | IMPLEMENTED | `exp.beliefs`, test na restart |
| Narzędziownik: nasze menu i ustawienia | Częściowo | strona z rankingiem, pamięcią i kosztami; ustawień jeszcze nie ma |
| Edycja mapy, nowe miejsca, narzędzia dla Claude | VERIFIED dla prostych miejsc | `tools/map_place.py`, Plac Stevium; edytor graficzny nadal bez próby |
| Dwóch kolegów jako testerzy, zgoda, dane | Częściowo | obserwacja za zgodą gotowa, lista pusta; S10 w `MILESTONES.md` |
| Strona, konta, rankingi | PLAN | P6 |
| Publiczny OTS, sprzedaż dodatków | PLAN | prawa do zasobów nierozstrzygnięte |

## Dziennik
Najnowsze na górze. Jeden wpis to jeden większy etap: co weszło, dowód, co dalej.

### 2026-11-01, iteracja 0023: postacie, które same się uczą
- Analiza zapisków pokazała: wymuszone prośby o wyprawę, uczucia bez znaczenia, łowiska niedopasowane do poziomu, brak zarobku. Wszystko poprawione.
- Doszły Elowen (50, Ab'Dendriel), Vesna (50, Carlin) i Borgar (100, Venore). Gra 11 postaci i Notka, wszystkie na modelach z konta.
- Odruch zmienia decyzję modelu dopiero po trzech odmowach i jest to policzone.
- Luna i Haiku grają niemal równo, Haiku kosztuje około dwa razy więcej za godzinę.

### 2026-11-01, iteracja 0022: świat żyje i ma plan
- Kamienie milowe w `MILESTONES.md`: 12 kroków do chwili, gdy ludzie chcą tu grać.
- Agenci rozmawiają o wydarzeniach na czacie lokalnym, plotkę podają jako plotkę, a człowiek może dopytać. Kael sam powiedział dublerowi o pladze szczurów.
- Najazdy z datapacku: `scripts\event.ps1`. Plac Stevium stoi na mapie bez zmiany oryginału, Haiku sama umówiła się tam z innymi.
- Zwiedzanie i zakup sprzętu są w kodzie. Pierwszy zakup się nie udał: dziennik mówił „kupione”, a serwer „Bought 0x”. Teraz liczy się tylko słowo serwera.
- Narzędziownik: `scripts\panel.ps1`. Strażnik serwera: `scripts\keeper.ps1`.

### 2026-11-01, iteracja 0022: wspólna historia
- Efekt z wizji działa w prawdziwej grze. Luna poprowadziła „Marka” (dubler człowieka) na wilki po jego argumencie, zapisała „10 zabitych, 336 exp”, a po symulowanej przerwie 8 dni sama napisała mu prywatnie: „Siema, pamietasz nasze 10 wolfow i snake'ow na wschod od Thais? Miales mi cos pokazac, potem mozemy wrocic po exp”. Wiadomość odebrał klient dublera.
- PvP pierwszy raz w grze: Ravn zaczepił Kaela dla żartu, Kael oddał, Ravn uciekł.
- Odpowiedź na pytanie o modele: lokalny `ornith` 28/42, Luna 41/42, Haiku 39/42. Lokalny rozmawia dobrze (8/8 rozmów), ale źle decyduje, np. idzie polować bez mikstur.
- Sprostowanie: serwer wyłączył się o 06:05 przez dzienny zapis, więc noc skończyła się wcześniej, niż napisałem. Naprawione.
- Kompresja przećwiczona na kopii bazy: 30 partii, 0 błędów, 0,73 kredytu.

### 2026-11-01, iteracja 0021: stan na rano
- Bieg 45 min na pełnym kodzie: 0 śmierci, Luna +5358 exp (poziom 11), Haiku +3604 (poziom 11), Kael +2688 (poziom 12), Ravn +1354, Sira +663.
- Przerwy potwierdzone: Ravn wyszedł na 5 minut i wrócił, a inni to widzieli.
- Do sprawdzenia przez właściciela: przekonać Lunę, żeby poszła za nim. Rozmowa bez imienia z człowiekiem i pójście za nim są dotąd tylko po testach.
- Następne: porównanie profili mapy, plotki i PvP w grze, uprzedzenie gości o chmurze.

### 2026-11-01, iteracja 0021: odporność
- Restart serwera przy działających klientach: wszystkie 6 postaci wróciło samo w około minutę.
- Nowy test czyta kod ciała i wykrywa funkcje użyte przed definicją; sprawdzone na wprowadzonym celowo błędzie.

### 2026-11-01, iteracja 0021: drugi długi bieg
- 35 minut. Kael +3560 exp (poziom 11), Haiku +3035 (poziom 10), Luna +2419 (poziom 10), Ravn +746. Sira nic: zginęła, a potem serwer ją wylogował i nie wróciła.
- Przekonania działają w grze. Luna: „Lubie wyprawy z Kaelem”, Kael: „bardzo lubie lune”, Haiku: gdzie zdobywa najlepszy exp, Ravn: „Na Cyclopsa ide z zapasami”.
- Znalezione: serwer wyrzuca po 15 minutach bezczynności, a ciało nie logowało się ponownie. Ciało obraca się teraz co 8 minut i wraca po utracie połączenia.

### 2026-11-01, iteracja 0021: pierwszy długi bieg
- 40 minut, 6 postaci, 0 śmierci. Haiku +2402 exp, Kael +1724, Luna +1213, Ravn +513, Sira +102. Decyzja 0,04 kredytu, odpowiedź 0,023.
- Sprostowanie: przerwy nie działały. Dziennik pisał „przerwa na”, a postać nie wychodziła, bo `takeBreak` było zdefiniowane za `tick`. Naprawione, a nowy test wykrywa taki błąd. Kael i Luna założyli drużynę.
- Sira przez 40 minut próbowała wejść na pole Tolka. Naprawione ogólnie: pole obok NPC, „blisko” to dotarcie, po 4 porażkach zmiana planu.

### 2026-11-01, iteracja 0021: noc, naprawy z gry
- Ravn marnował kredyty na puste wyprawy do depo, bo 100 złota to jedna platyna. Naprawione, w grze: „schowalem 100”.
- Drzwi domów nie wchodzą już do tras, a postać pamięta drzwi, które się nie otworzyły.
- Społeczność działa bez reżysera: Luna gratuluje Haiku 9 poziomu, Mira przekazuje plotkę o Haiku, Kael i Luna idą razem na wilki.

### 2026-11-01, iteracja 0021: rozmowa z człowiekiem
- Właściciel zauważył, że agenci słabo z nim rozmawiają. Zapisy pokazały przyczyny: reakcja tylko na imię, limit 3 odpowiedzi na 5 minut, maksymalnie 10 słów i brak działania „idę z tobą”.
- Teraz rozmowa trwa bez powtarzania imienia, krótkie wiadomości składają się w jedną, odpowiedź ma do 25 słów, model zna swoje miejsca i plan, może powiedzieć o nich rozmówcy i sam decyduje `follow_them` albo `stop_following`.
- Sprawdzone w kliencie: Notka zaproponowała Lunie wyprawę, a Luna odpisała „900 exp na godzinę brzmi słabo, na wschód od Thais mam wilki i węże, gdzie to miejsce?”, potem „potiony kuszą, ale najpierw powiedz gdzie ta miejscówka”.
- Notka sprawdzona w kliencie: zapis, przypomnienie po minucie, odpowiedź z notatek. Testy złapały i naprawiono wzajemne odpisywanie Siry i Notki oraz odmowę przy kolejce do modelu.
- NPC na modelu z konta sprawdzone w kliencie: Ardan opowiedział żart i dał rozsądną poradę o bólu głowy z ostrzeżeniem, kiedy iść do lekarza.
- Drużyny ze wspólnym exp, przerwy, plotki i chwalenie się poziomem są w kodzie; ich stan w grze opisują wpisy wyżej.

### 2026-11-01, iteracja 0021: relacje, cele i większy budżet
- Właściciel podniósł limit do około 1000 kredytów miesięcznie. Egzekwuje to aplikacja: 60 na uruchomienie, 150 dziennie, 1000 miesięcznie.
- Kael, Sira i Ravn też grają na `gpt-6-luna`. Ich pamięć jest ta sama: to sprawdzian zmiany modelu bez utraty postaci.
- Po porażce następna decyzja idzie na `medium`.
- Relacje: `exp.people`, opinia ze zdarzeń, jedno zdanie o każdej osobie w promptcie. Długie cele: `ambition`.
- Zaproszenie na wyprawę to decyzja modelu, a nie szablon. Sira i Ravn różnie wybaczają urazy (`forgives`).
- Kompresja wspomnień działa też na modelu z konta.
- Narzędzie `cli/world.ts`: podgląd okolicy i sprawdzenie punktów NPC.
- Notka, osobisty pomocnik: notatki i przypomnienia na prywatnym czacie, osobna tabela, 9 testów prywatności. W grze jeszcze nie uruchomiona.
- Przekonania: co 30 minut postać podsumowuje przeżycia w najwyżej 5 przekonań.
- NPC mówią przez model z konta, gdy Ollama jest wyłączona. Kod gotowy, w grze jeszcze nie sprawdzony.

### 2026-11-01, iteracja 0020: uwagi właściciela z gry
- Właściciel zauważył, że Haiku goni kurczaki. Potwierdzone: 0 exp przez 18 minut. Po pokazaniu exp w opcjach Haiku zyskała +381 w 10 minut, Luna +318.
- Pamięć o osobie działa w grze po restarcie Brain: `[wspomnien: 5]`, Luna: „Mowilem, ze nie schodze”.
- Serwer sam daje nowemu rycerzowi sprzęt, linę, lekką łopatę i 10 mikstur. Dev-kit dla Luny i Haiku jest zbędny i został usunięty.
- Poprawione: lekka łopata, pełny plecak prowadzi do sklepu, pierwsza nauka leczenia ma pierwszeństwo, współrzędne zniknęły z czatu.
- Kluczy do drzwi agenci nie obsługują.

### 2026-11-01, iteracja 0020: trudne scenariusze i pierwszy bieg w grze
- Trudny zestaw 12 scenariuszy rozdzielił modele: Luna 12/12 (0,095 kredytu), Haiku 10/12 (0,132 kredytu). Haiku pisała za długo na czacie i raz zgadywała bez danych. Razem z łatwym zestawem: Luna 41/42, Haiku 39/42. Haiku jest szybsza, Luna tańsza. Próba jest mała.
- Bieg 10 min w klientach: `player-run-20261101-010344.json`. 0 błędów klienta, 0 śmierci, wolnej pamięci minimum 5,8 GB, bo Ollama była wyłączona. 10 wywołań, 0,284 kredytu, jedna decyzja 0,032 kredytu.
- Znalezione w grze: kury i psy dają 0 exp, a model o tym nie wiedział. Haiku zabiła 13 sztuk i została bez doświadczenia. Łowiska pokazują już exp, a bezwartościowe nie są oferowane.

### 2026-11-01, iteracja 0020: modele z konta GitHub i prawdziwa nauka czarów
- Adapter `CopilotModels`: bez narzędzi, shella i plików; model zwraca tylko tekst sprawdzany schematem. Budżet 5 kredytów na uruchomienie i 20 dziennie, zapisany w SQLite (`model_usage`), wyłącznik `scripts\ai-budget.ps1 -Stop`. ADR 0011.
- Porównanie 30 tych samych scenariuszy: `runtime/evidence/model-compare-20261031-234649.json`. Luna 29/30, 0,165 kredytu, P50 3,1 s. Haiku 29/30, 0,273 kredytu, P50 2,4 s. Scenariusze okazały się za łatwe, żeby rozdzielić modele, więc wybór rozstrzygnie gra i trudniejszy zestaw.
- Jedna decyzja kosztuje około 0,006–0,008 kredytu w teście, a 60 wywołań zużyło 0,44 kredytu z 1500 miesięcznych.
- 48 nauczycieli i 1778 lekcji z datapacku (`tools/make_teachers.py`). Postać zna czar dopiero, gdy serwer to potwierdzi; odmowa wraca do planera. Testy 173/173.

### 2026-11-01, iteracja 0020: start
- Wizja przeniesiona do `STEVIUM_PRODUCT_VISION.md` wraz z notatkami właściciela (sekcja 14).
- Stan startowy: gracze AI działają w Thais na lokalnym modelu, testy 152/152.
- Konto GitHub sprawdzone przez SDK bez wydawania kredytów: `rydwan92` zalogowany, 14 modeli, `gpt-6-luna` i `claude-haiku-5.5` dostępne. `GPT-6.1 Sol` z notatek nie jest na liście konta; o tej samej cenie jest `gpt-6.1-terra`.
