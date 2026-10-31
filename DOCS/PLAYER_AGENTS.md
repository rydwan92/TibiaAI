# Gracze-agenci

Autonomiczne postacie grające w świecie przez prawdziwego klienta, tak samo jak człowiek. Kael (knight), Sira (paladin) i Ravn (sorcerer) wchodzą do gry, polują, schodzą pod ziemię, giną, wracają i piszą do siebie. Decyzja architektoniczna: ADR 0010. Dowody: `iterations/0014-player-agents.md`.

## Podział ról
| Część | Plik | Co robi | Czy czeka na model |
| --- | --- | --- | --- |
| Ciało | `tools/otclient-agent/agent.lua` | Pakiety klienta: walka, leczenie, ucieczka, chód, drzwi, drabiny, lina, łopata, loot, jedzenie, czat, VIP, zakładki | Nigdy |
| Umysł | `apps/brain/src/players/mind.ts` | Odczucia, pamięć, wybór celu, rozmowy, wspólne wyprawy, prośby o pomoc | Tak, ale gra na niego nie czeka |
| Wybory | `players/choices.ts` | Lista działań możliwych teraz, wybór z temperamentu bez modelu | Nie |
| Wiedza | `players/knowledge.ts` | Czary, runy, potwory, miasta, łowiska z danych serwera | Nie |
| Mapa | `players/nav.ts` | Trasy po polach, drzwiach, piętrach i teleportach | Nie |
| Flota | `players/fleet.ts` | Wspólny budżet: 8 wywołań modelu na minutę | Nie |

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

## Wiedza krąży tylko przez mowę
Każdy agent pamięta wyłącznie to, co go spotkało. Nie ma wspólnej pamięci. Rada działa, bo ktoś ją napisał:

- „polecam na polnoc od Montag, na powierzchni, sa tam Wolf” zamienia się u odbiorcy w działanie `tip_1` na liście wyborów.
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
| Depozyt | Opcja `depot` od 100 złota: szafka w mieście, skrzynia, pudło, przeniesienie złota. Chroni przed stratą przy śmierci |
| Łup | Zabiera złoto, mikstury, jedzenie, runy i wszystko, co kupuje Mira, jeśli zostaje udźwig |
| Piętra | Trasa używa schodów, dziur, drabin, lin, łopat i teleportów. `ways` w `metrics.json` liczy, czego użył |
| PvP | Świat ma `worldType = "pvp"`. Obcego można zaatakować zawsze, znajomego dopiero przy urazie 3. Tryb bezpieczny schodzi tylko przy świadomym ataku. Po ataku nie ma wstępu do strefy ochronnej przez minutę, więc agent czeka |
| Urazy | Rosną od ataków, śmierci z czyjejś ręki i złych opinii po rozmowie, wygasają około 1 punktu na 5 minut. Decyzja o ataku należy do umysłu |
| Reakcja na atak | Serwer mówi „You lose ... by X”: odwaga i zdrowie decydują, czy oddać, czy uciekać do miasta |
| Nauka po śmierci | Model pisze jedną lekcję, która zostaje na stałe (ostatnich 6) i wraca w każdej decyzji. Bez modelu lekcję układa zdanie z danych. Łowisko z zabójcą ma ostrzeżenie w etykiecie |
| Plan | Model prowadzi własny plan, a trudne łowiska są dostępne z ostrzeżeniem, nie zakazem |

## Mapa
- `tools/world_atlas.py` czyta OTBM: 5720 przejść między piętrami, 180 teleportów, 11 922 fragmenty 16×16.
- `nav-survey.request` pyta silnik o każde pole (`runtime/atlas/nav-map.jsonl`, 1 MB): co blokuje i gdzie są zamknięte drzwi, bez domów i drzwi z `actionId`.
- `tools/make_spawns.py` tworzy `game/world/canary-monster.xml` i `packages/contracts/hunting-grounds.json`: 2339 potworów w 1199 grupach, 397 łowisk.
- Przy starcie Brain liczy, skąd da się wrócić do Montag: 256 612 pól, 4 z 7 miast (Montag, Nahag Village, Alexandria, Thalom), 209 łowisk. Do Katorgi prowadzi teleport bez powrotu, więc nie jest celem; Tihamah i Strongarm są odcięte.

Pola, po których wejściu zmienia się piętro, są końcem odcinka, więc trasa nie wchodzi na nie przypadkiem. Zablokowany odcinek trafia na listę tej postaci i trasa liczy się od nowa. Serwer sprawdza każdy krok, więc nieaktualna mapa kosztuje tylko ponowne liczenie.

Skanowanie buduje wszystkie pola w pamięci silnika (1,3 GB zamiast 0,25 GB). Pamięć wraca dopiero po restarcie Canary, dlatego po skanie trzeba go zrestartować.

Odświeżenie po zmianie mapy:

```bash
python -I tools/world_atlas.py runtime/maps/canary.otbm <items.xml> runtime/atlas/canary-atlas.json packages/contracts/game-data.json
```

Potem przy działającym Canary żądania `nav-survey.request` i `survey.request` (`Write-ControlRequest`), restart i `make_spawns.py`.

## Ekwipunek
Handel jest prawdziwy: Mira ma cennik `packages/contracts/shop.json` (`tools/make_shop.py`), a agent zarabia sam. Zostaje jeden wyjątek deweloperski, tylko dla postaci z `arena.devCharacters`: `dev-kit.request` daje startowy zestaw i po śmierci (`refresh`) ten sam zestaw, bo nie ma jeszcze sposobu na odzyskanie ekwipunku. Ten wyjątek uczy też czarów profesji do poziomu 30 (`arena.kitSpells`), bo świat nie ma nauczycieli. Paladyn ma łuk i kołczan w prawej ręce, bo tylko stamtąd ten silnik bierze strzały.

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
