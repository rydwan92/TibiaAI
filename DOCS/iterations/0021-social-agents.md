# Iteracja 0021 — postacie, które rozmawiają i decydują same
Data: 2026-11-01
Stan: VERIFIED w kliencie dla rozmowy z agentem, NPC, Notki, przekonań, przerw i powrotu do gry; reszta w tabeli niżej
Commit projektu: niezacommitowane, na gałęzi `feat/player-agents` po `f58b71b`.

## Cel i warunek odbioru
Właściciel po własnej grze: agenci mają lepiej rozmawiać, gdy się do nich odezwie po imieniu, dzielić się informacjami i sami decydować, czy pójść za nim, gdy zaproponuje i dobrze uargumentuje. Do tego budżet około 1000 kredytów miesięcznie i dalsze mechanizmy z wizji.

Odbiór: postać odpowiada na kolejne wiadomości bez powtarzania imienia, a propozycję rozstrzyga sama, z argumentami, w prawdziwym kliencie.

## Przyczyny znalezione w zapisach gry
Właściciel napisał do Luny „TO DAWAJ CHODZ ZA MNA”, „ZAPROWADZE CIE NA SZYBKI EXP”, „SLYSZYSZ?”, „follow me”, a do Siry prywatnie „znam fajne miejsce”, „gram juz dlugo w ta gre”.
- Odpowiedź wymagała imienia w każdej wiadomości.
- Limit 3 odpowiedzi na 5 minut i 10 słów, wprowadzone przeciw pętlom między agentami, ucinały rozmowę z człowiekiem.
- Agent nie miał działania „idę z tobą”: mógł to tylko napisać.

## Zmiany
- `players/mind.ts`: rozmowa trwa 90 s po ostatniej wymianie, krótkie linie składają się w jedną, 20 odpowiedzi na 5 minut, 25 słów, `follow` w odpowiedzi modelu, szukanie zgubionej osoby tam, gdzie ją widziano, a przy schodach wejście za nią.
- `players/people.ts`: opinia i historia z każdą osobą. `ambition`: długi cel. `exp.beliefs`: przekonania co 30 minut. `forgives`, `mischief`: różne charaktery.
- `players/assistant.ts`, `assistant_notes`: Notka, osobisty pomocnik.
- `agent.lua`: `keepParty`, `takeBreak`. `mind.ts`: `syncParty`, `takeRest`, plotki, chwalenie się poziomem, współrzędne zastąpione słowami i znacznikiem przyjaciela.
- `providers/copilot-model.ts`: limit miesięczny, `hard` na `medium`, `forDialogue` dla NPC przy wyłączonej Ollamie. `main.ts`: kompresja i NPC na modelu z konta.
- `cli/world.ts`: podgląd świata i kontrola punktów NPC.

## Weryfikacja
Testy: `node --test test/*.test.ts` 221/221 PASS, `tsc --noEmit` PASS. Self-test Lua i `verify -Client`: NOT RUN w tej iteracji.

| Warunek | Wynik | Dowód |
| --- | --- | --- |
| Agent dyskutuje z propozycją | PASS w kliencie | Luna do Notki: „900 exp na godzinę brzmi słabo, na wschód od Thais mam wilki i węże, gdzie to miejsce?”, „potiony kuszą, ale najpierw powiedz gdzie ta miejscówka” |
| Rozmowa bez imienia, seria linii, limit | testy PASS | `players.test.ts`. Z człowiekiem w kliencie po poprawce NOT RUN: właściciel poszedł spać |
| Pójście za człowiekiem | testy PASS, w kliencie NOT RUN | Nikt nie przekonał agenta |
| NPC przez model z konta | PASS w kliencie | `client-autotest-20261101-015842.log`: żart, porada o bólu głowy, pamięć zawodu; reply 4–7 s |
| Notka: zapis, przypomnienie, odpowiedź z notatek | PASS w kliencie | „zapisane, numer 1”, „przypominam: wyjac pranie”, „mam zapisane, zeby wyjac pranie i kupic chleb” |
| Prywatność notatek | testy PASS | `assistant.test.ts` |
| Plotki, PvP z motywem, bankructwo | testy PASS, w kliencie NOT RUN | nie wystąpiły w biegach: 0 walk z graczami i 0 ataków na agentów |
| Limit miesięczny | testy PASS | wyczerpania nie było |
| Bieg 40 min, 6 postaci | PASS | `player-run-20261101-024003.json`: 0 śmierci, wolnej pamięci minimum 5 GB, Haiku +2402 exp, Kael +1724, Luna +1213, Ravn +513, Sira +102 |
| Powrót po utracie połączenia | PASS w grze | restart Canary przy działających klientach: 6 z 6 postaci z powrotem w około minutę, `came_back` w `events.jsonl` |
| Przekonania | PASS w grze | Luna: „Lubie wyprawy z Kaelem”, Kael: „bardzo lubie lune”, Ravn: „Na Cyclopsa ide z zapasami” |
| Bieg 35 min | PASS | `player-run-20261101-031628.json`: Kael +3560 exp, Haiku +3035, Luna +2419, Ravn +746, Sira zginęła i wypadła z gry; wolnej pamięci minimum 5,3 GB |
| Bieg 45 min na pełnym kodzie | PASS | `player-run-20261101-041258.json`: 0 śmierci, wszystkie postacie aktywne do końca, wolnej pamięci minimum 4,6 GB, Luna +5358 exp, Haiku +3604, Kael +2688, Ravn +1354, Sira +663 |
| Przerwy w grze | PASS po naprawie | Ravn wylogował się 02:49:22 i wrócił 02:54:29, widać to w dziennikach Kaela, Siry, Luny i Haiku. Wcześniej FAIL | `takeBreak` było zdefiniowane za `tick`, więc wpis „przerwa na” powstawał, a postać nie wychodziła. Wcześniejszy wpis o działających przerwach był błędny |
| Drużyna | częściowo PASS | Kael i Luna: komunikaty o drużynie; wspólnego exp nie mierzono |
| Depo z platyną | PASS w grze | Ravn: „depo: schowalem 100” po wcześniejszym „schowalem 0” |
| Zamknięte drzwi | testy PASS, w grze NOT RUN jako pomiar | `exp.lockedDoors`, atlas bez 39 drzwi |

## Znalezione przyczyny błędów
- Mój walidator porównywał liczbę z tekstem, więc każda odpowiedź NPC była odrzucana i Ardan mówił „Hmm?”. Test jednostkowy tego nie widział, próba w kliencie tak.
- Sira i Notka zaczęły odpisywać sobie w pętli. Agenci i Notka teraz się ignorują.
- Notka odmawiała przy chwilowej kolejce do modelu. Pytanie czeka teraz do 30 s.
- `orders.json` na Windows bywa zablokowany przez czytającego klienta. Zapis ponawia się, a błąd jednej postaci nie przerywa obiegu.
- Jeden test czasowo wypadał pod obciążeniem (10 ms). Wydłużone oczekiwanie.
- Ravn chodził do depo co kilkanaście sekund: 100 złota to jedna platyna, a chowane było tylko złoto. Każdy spacer to kredyt na decyzję. Teraz chowa obie monety, a pusta wyprawa blokuje opcję na 10 minut.
- Sira utykała na drzwiach (serwer: „Sorry, not possible” 45 razy). Atlas czytał tylko `action id`; teraz wyklucza też drzwi domów i z `unique id`, 9633→9594. Część przypadków zostaje niewyjaśniona, więc postać dodatkowo pamięta drzwi, które się nie otworzyły. Gdy nie ma innej drogi, próbuje je ponownie.
- Sira straciła 40 minut, bo chciała dojść na pole, na którym stoi Tolek: 35 razy „utknalem”, +102 exp. Trasy do NPC kończą się teraz na polu obok, dwa pola od celu liczą się jako dotarcie, a po 4 porażkach postać rezygnuje i wybiera na nowo.
- Serwer wyrzuca po 15 minutach bezczynności (`kickIdlePlayerAfterMinutes`), a ciało nie logowało się ponownie: Notka zamilkła po 17 minutach, Sira po wylogowaniu o 02:00:45 stała martwa. Ciało co 8 minut się obraca (`playerTurn` zeruje licznik) i wraca do gry 15 s po utracie połączenia.
- Lua: funkcja lokalna użyta nad definicją to `nil`, wychodzi dopiero w chwili wywołania. Tak było już z `localMessage`. `test/body.test.ts` czyta źródło i wykrywa to przy każdym przebiegu testów.
- Serwer odmawiał wylogowania po walce („You may not logout during or immediately after a fight”). Ciało czeka teraz, aż znikną ikony walki, a po 4 odmowach rezygnuje z przerwy.
- Po restarcie klienta stare wiadomości z `orders.json` wysyłały się ponownie, aż serwer wyciszył postać. Wiadomość starsza niż 60 s nie jest już wysyłana.
- Po przebudowie atlasu `nav-map.jsonl` ma SHA-256 `9103617135101bdb…`, `atlas.json` bez zmian.

## Ograniczenia / rollback
- Znacznik przyjaciela działa tylko między agentami; do człowieka agent trafia po wzroku albo współrzędnych.
- Przy prawdziwym człowieku rozmowa, plotka i chwalenie się idą do modelu w chmurze: trzeba uprzedzić gości.
- Pierwszy start Notki rozpoznaje osobę po nazwie postaci.
- Rollback: `TIBIAAI_CLOUD_AI=` w `.env`.

## Następne zadanie
Bieg nocny: czy przerwy, drużyny i przekonania działają same, potem porównanie profili mapy.
