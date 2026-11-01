# Kierunek: od laboratorium do własnej gry

Stan: **PLAN**. Ten dokument opisuje drogę, nie gotowy produkt. Co działa dziś, mówi STATUS.md.

## O co chodzi w tej grze
Świat, w którym mieszkańcy pamiętają gracza, rozmawiają z nim swobodnie i naprawdę coś dla niego robią, a ich reakcje wynikają z tego, co się faktycznie wydarzyło. To odróżnia ten projekt od kolejnego serwera OpenTibia: nie więcej potworów i przedmiotów, tylko świat reagujący na konkretną osobę.

Filary:
1. **Mieszkańcy z pamięcią.** Działa: pamięć, relacje, charaktery.
2. **Słowa mają skutki.** Działa pierwsze działanie: przewodnik. Następne: zlecenia.
3. **Konsekwencje.** Relacja otwiera i zamyka możliwości, plotki krążą z pochodzeniem.
4. **Świat żyje bez gracza.** Reżyser zdarzeń, rutyny mieszkańców.
5. **Towarzysze.** Agent idący z graczem na wyprawę (COMBAT_PLAN.md).
6. **Inni gracze.** Agenci grają obok człowieka, rozmawiają, pomagają i giną (PLAYER_AGENTS.md).

## Bariera, którą trzeba rozstrzygnąć: zasoby
| Warstwa | Dziś | Co to znaczy |
| --- | --- | --- |
| Silnik Canary | GPL-2.0 | Można modyfikować; przy rozpowszechnianiu binarki obowiązują warunki GPL, także udostępnienie źródeł |
| Klient OTClient | licencja w `vendor/otclient/.../LICENSE` | Sprawdzić przed publikacją |
| Grafiki, dźwięki, `appearances` | zasoby Tibii, CipSoft | **Nie są nasze.** Licencja silnika ich nie obejmuje |
| Mapa `otservbr.otbm` | wydanie Canary, odwzorowanie mapy Tibii | Nie jest nasza. Trzymana poza repozytorium, tylko do prywatnego laboratorium |
| Nazwa „Tibia” | znak towarowy | Nie może być nazwą własnej gry |

Prywatne laboratorium na własnym komputerze to jedno. **Gra pokazywana publicznie jako własna nie może stać na tych zasobach.** „Praktycznie nowa gra” w pełnym sensie wymaga własnej grafiki, własnej mapy i własnej nazwy. To nie jest opinia prawna: przed publikacją trzeba to sprawdzić u prawnika.

Dobra wiadomość: treść, charaktery, pamięć, zachowania i logika w `packages/` oraz `apps/brain` są niezależne od grafiki. Praca nad nimi nie przepadnie przy wymianie zasobów.

## Trzy etapy
| Etap | Cel | Warunek przejścia |
| --- | --- | --- |
| **A. Mechanika** (teraz) | Pętla gry na obecnych zasobach, prywatnie | Znajomy gra 30 minut i chce wrócić |
| **B. Własny świat** | Własna mapa, nazwy, historia, zadania; nadal prywatnie | Nic w treści nie odwołuje się do Tibii |
| **C. Własna tożsamość** | Własne grafiki i dźwięki, własna nazwa, klient bez cudzych znaków | Audyt pochodzenia każdego pliku, porada prawna |

Publikacja jest możliwa dopiero po etapie C.

## Kolejne pionowe kawałki (etap A)
Każdy kawałek działa w całości i kończy się testem w kliencie, zanim zacznie się następny.

| Nr | Kawałek | Co gracz czuje | Kryterium |
| --- | --- | --- | --- |
| 1 | **Pierwsze zlecenie** | Mira prosi o przysługę, a wykonanie zmienia jej stosunek | Przedmiot i nagroda z silnika, zapis po restarcie |
| 2 | Relacja otwiera drzwi | Po kilku przysługach NPC mówi i robi więcej | Warunek z pamięci, nie ze słów gracza |
| 3 | Plotka o czynach | Brom wie, że pomogłeś Mirze, bo to słyszał | Pochodzenie informacji w pamięci |
| 4 | Dzień w Thais | Mieszkańcy mają pory dnia, handel, odpoczynek | Rutyny z konfiguracji, czas świata |
| 5 | Reżyser zdarzeń | Wilk w mieście, przewrócony wóz, prośby o pomoc | Limit, cooldown, bez dowolnego spawnowania przez model |
| 6 | Towarzysz na wyprawie | Kael idzie z Tobą i reaguje | Plan z COMBAT_PLAN.md |
| 7 | Własna mapa | Pierwsza własna kraina obok prawdziwej mapy | Mapa w edytorze, TOOLING.md |

## Świat i mapa
Świat to prawdziwa mapa z pakietu Canary (`data-otservbr-global`): 18 mln pól, 31 miast, 1035 NPC, 1656 potworów, statki u kapitanów. Rookgardu i Dawnport nie używamy: gra zaczyna się od razu w Thais, z profesją i na poziomie 8, bez bramy poziomu. Nasi NPC z pamięcią mieszkają na placu w Thais obok NPC z pakietu. 12 miast ma z Thais drogę w obie strony.

## Pomysły na rozgrywkę (PLAN)
Wszystko poniżej wynika z tego, co agenci już potrafią. Kolejność to propozycja, nie obietnica.

| Pomysł | Co gracz czuje | Na czym stoi | Koszt |
| --- | --- | --- | --- |
| **Kronika świata** | NPC wiedzą, że Ravn padł od hydry, bo to słyszeli; w mieście krążą historie zrobione przez agentów | Pamięć NPC, rozmowy agentów z NPC, pochodzenie plotki | Mały |
| **Agent-mentor** | Nowy gracz spotyka Sirę, która pokazuje mu łowisko i pomaga, gdy mu ciężko | Wspólna wyprawa i pomoc działają już dla agentów | Mały |
| **Nazwane miejsca** | Pierwszy, kto odkryje jaskinię, nadaje jej nazwę, a nazwa rozchodzi się przez rozmowy | Rady idą mową; potrzebny rejestr nazw | Mały |
| **Rywalizacja i gildia** | Agenci mają ranking i spór o łowisko, można stanąć po jednej ze stron | `metrics.json`, relacje między agentami | Średni |
| **Zlecenia od agentów** | Gracz dostaje od Kaela prośbę o pomoc w konkretnej walce | Prywatne wiadomości, kontrakt zadań | Średni |
| **Legenda dnia** | Reżyser wypuszcza silnego potwora, agenci ostrzegają się nawzajem, a NPC o nim mówią | Reżyser z limitem, ostrzeżenia działają | Średni |
| **Agenci przekazują sobie doświadczenie** | Weteran uczy nowicjusza, co działa na danego potwora | Zapis pamięci, rady z danych o walkach | Mały |

## Czego nie robimy teraz
Publicznego serwera, rozbudowanej ekonomii MMO, własnego silnika, wymiany modelu „na lepszy” bez konkretnej potrzeby.

## Ograniczenie sprzętowe
Jeden model na RTX 3060 obsługuje jedno zapytanie naraz, około 3 s. Przy kilku graczach mówiących jednocześnie kolejka rośnie, więc NPC nie mogą rozmawiać z każdym bez przerwy. Limit to 20 wywołań na minutę. Dla kilku znajomych to wystarczy, dla publicznego serwera nie. Z tego też powodu większość zachowań musi działać w silniku, a model zostaje do rozmowy i decyzji.
