# Iteracja 0023: postacie, które same się uczą

Stan: VERIFIED częściowo, szczegóły w tabeli

## Cel
Agenci mają być zwykłymi graczami: sami dobierają łowiska do poziomu, zarabiają, odkładają, zmieniają zdanie na podstawie wyników, piszą do znajomych z innych miast i żyją także poza Thais. Nowe postacie na poziomach 50 i 100.

## Kryterium odbioru
- Silniejsza postać dostaje silniejsze łowiska, a wybór wynika z danych o potworach.
- Postać ma popędy, próbuje czegoś przez pół godziny, a wynik z gry wraca do kolejnej decyzji.
- Decyzje modelu zastąpione przez odruch są policzone.
- Postać mieszka i kupuje w innym mieście.

## Analiza zapisków (przed zmianami)
- Kael, Sira i Ravn najczęściej wybierali proszenie o wspólną wyprawę: 64, 81 i 77 razy. Wymuszał to próg samotności.
- Uczucia stały na skrajach: nuda 1, pewność 1, lęk 0. Nie wnosiły nic do decyzji.
- Łowiska były ograniczone poziomem trudności liczonym z poziomu postaci, z górnym limitem 4 i wyborem według odległości, więc poziom 13 nadal bił szczury i wilki.
- Wilki dają exp i prawie zero złota. Ravn z celem 10000 złota miał 0 w depo.
- Kupiec tylko w Thais: postać z innego miasta nie miałaby gdzie uzupełnić zapasów.
- 230 zapisów „utknąłem” u Ravna to w większości współrzędne starej mapy, nie obecny błąd.
- Luna i Haiku: prawie ten sam exp (26876 i 27034), Haiku drożej: 16,18 i 11,23 kredytu.

## Co weszło
- `huntValue`: szacunek exp/h z życia i exp potworów oraz obrażeń na poziom, granica ryzyka zależna od pewności siebie, odległość obniża wartość. Działa dla każdego poziomu.
- `huntingAdvice` i `player-guide.json`: poradnik. Lista potworów wynika z danych tego świata, ogólne rady są naszymi słowami. Wyszukiwanie w sieci nie dało rzetelnej listy miejsc według poziomu, więc listy z internetu nie ma.
- `drives.ts`: pięć popędów w słowach, zmęczenie niepowodzeniami, informacja, że idzie wolniej niż potrafi.
- Próby: co 30 minut, albo 2 minuty po śmierci, postać zamyka poprzednią próbę liczbami z gry i wybiera następną (`exp.strategy`, `exp.trials`).
- Odruchy nie wyprzedzają modelu: zakup i wyprawa są propozycją, a dopiero po trzech odmowach dzieją się same. `exp.overrides` liczy każdy taki przypadek, narzędziownik go pokazuje.
- Uczucia wracają do środka, poziom i nowe miejsce zmieniają nastrój.
- Kupcy mikstur z datapacku: 29 NPC, najbliższy zamiast Miry. Liczba mikstur rośnie z poziomem.
- `home` i `startLevel`: Elowen (druid 50, Ab'Dendriel), Vesna (rycerz 50, Carlin), Borgar (rycerz 100, Venore).
- Listy: przyjaciel daleko dostaje czasem prywatną wiadomość, może to być zaproszenie. Obok siebie agenci nadal mówią na głos. Pomoc tylko do 150 pól.
- Zarobek na godzinę w pamięci miejsc.

## Odkrycia
- `player:addItem` z zajętym miejscem kładzie przedmiot na ziemię. Zestaw zdejmuje teraz stary sprzęt (`arena.replaceWorn`).
- Klient nie liczy nierozkładalnych przedmiotów w plecaku: `getInventoryCount` daje 0. O posiadaniu decyduje `worn`.
- Elowen ruszyła na pomoc Haiku przez pół świata; stąd limit odległości.

## Dowody
Testy: `node --test test/*.test.ts` 269/269 PASS, `tsc --noEmit` PASS, self-test Lua 36/36 przed ostatnimi zmianami.

| Sprawdzenie | Wynik | Dowód |
| --- | --- | --- |
| Rejs do nowego miasta | PASS w grze | Haiku: `przeszedlem: boat`, `NOWE MIASTO: Carlin (2 z 12)`. Start przez hak `force`, cała droga sama |
| Zakup i założenie | PASS w grze, S4 spełniony | `worn` slot 1 = 3375 u Kaela, Luny i Haiku |
| Wysoki poziom w bazie | PASS | Borgar 100, 15694800 exp, 1565 hp; Elowen i Vesna 50 |
| Start w innym mieście | PASS | Elowen na 32696,31660, Borgar 32954,32035, Vesna 32380,31789 |
| Sprzęt weterana | PASS po poprawce | Borgar: 3385, 3381, 3415, 3295, 3382, 3554 |
| Wybór modelu bez reguły | PASS | Vesna: `travel_kazordoon: Nowe miasto i krasnoludy moga przyniesc lupy warte zlota` |
| Próby strategii w grze | NOT RUN | pierwsze zamknięcie po 30 minutach od startu Brain |
| Listy między miastami i zaproszenie | testy PASS, w grze NOT RUN | |
| Zakup u kupca poza Thais | NOT RUN | |
| Exp na poziomie 50 i 100 | NOT RUN | za krótko; Borgar +1126 exp w 5 minut po drodze, bez dotarcia na łowisko |

## Ograniczenia
Szacunek exp/h jest przybliżony. Sprzęt ze sklepu to tylko oferta Sama. Broń zostaje bez zmian. Handel między graczami nie istnieje. Kolejne zadanie: bieg przez noc ze strażnikiem i raport z prób.
