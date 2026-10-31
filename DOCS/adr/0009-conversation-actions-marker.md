# ADR 0009: otwarta rozmowa, pierwsze działanie z dialogu i oznaczenie agentów
Status: ACCEPTED (2026-10-31). Uzupełnia ADR 0008.

## Kontekst
Po iteracji 0012 NPC rozmawiali i pamiętali, ale tylko mówili: `allowedIntents` zawierało `none`. Zasady świata kazały im znać „tylko to, co podano” i mówić wyłącznie po polsku, więc odmawiali rozmowy spoza zawodu. Gracz nie mógł też odróżnić agenta od zwykłego NPC.

## Decyzja

### Polityki rozmowy zamiast jednej listy zakazów
`world.json` ma `safety` (obowiązuje zawsze) i `conversationPolicies`: `immersive`, `open`, `tutor`. Polityka ma język domyślny, limit długości, reguły i `reminder`. Rola ją ustawia, tożsamość może nadpisać. To sposób rozmowy, nie uprawnienie.

Bezpieczeństwo nie zależy od polityki: rozmowy z innymi osobami pozostają prywatne, instrukcje nie są ujawniane, fakty o bieżącym świecie gry pochodzą z sekcji kontekstu, a model nie udaje dostępu do internetu.

### Co skąd pochodzi
| Rodzaj | Gdzie | Kto może zmienić |
| --- | --- | --- |
| Mechanika tego serwera | `knowledge/server-mechanics.json`, wpis wymaga `source` i `serverVersion` | tylko repozytorium |
| Lokalne fakty i lore | `knowledge/montag.json` | tylko repozytorium |
| Wiedza ogólna | sam model, bez gwarancji poprawności | nikt, wagi się nie zmieniają |
| Obserwacje i wspomnienia | pamięć jednego NPC (ADR 0008) | zdarzenia gry |
| Relacje, fakty o graczu, wybrany język i poziom | pamięć jednego NPC dla jednej postaci | zdarzenia i wybór gracza |
| Styl | wariant i tożsamość | tylko repozytorium |
| Umiejętności i uprawnienia | `actorTypes`, `skills`, `guidePlaces` w `agents.json` | tylko repozytorium |

Poprawka umiejętności działa u wszystkich agentów, którzy ją mają. Wariant i tożsamość nie mogą zawierać `skills`, walidator to odrzuca.

### Pierwsze działanie: przewodnik
Przepływ: prośba gracza → `parseGuideRequest` → model proponuje `guide_to` i `target` → kontrola roli, umiejętności i listy miejsc → komenda `guide_start` → silnik sprawdza alarm, zajętość i adresata → silnik prowadzi → zdarzenie `guide_ended`.

Model nie może uruchomić marszu bez prośby w słowach gracza (`intent_refused`). Gdy gracz prosi, a model zapomni o akcji, Brain ponawia raz, a potem i tak uruchamia marsz regułą z tekstem szablonowym. Ta sama reguła działa bez modelu i w trybie `rules`.

Brain zleca wyłącznie start. Silnik co tick sprawdza gracza i sam ogłasza wynik: `arrived`, `left_behind`, `player_gone`, `cancelled`, `blocked`, `alarm`, `stopped`, `timeout`. `arrived` wymaga pozycji równej celowi. Wypowiedź kończąca pochodzi z szablonu w Lua, więc nie zależy od Brain ani modelu.

Brak drogi rozstrzyga się na dwa sposoby. Miejsce, do którego silnik nie znalazł drogi przy starcie, jest odrzucane od razu (`no_path`). `getPathTo` potrafi jednak chwilowo nie zwrócić drogi do miejsca osiągalnego, co wyszło w teście w kliencie, więc przejściowy brak obsługuje ruch: po `moveTimeoutTicks` bez postępu marsz kończy się wynikiem `blocked`.

Priorytet ruchu: stop > alarm > prowadzenie > rozmowa > rutyna. W czasie prowadzenia `patrol` i `move_to` są odrzucane (`guide_active`). Anulowanie słowem z `cancelWords` działa w Lua, bez Brain.

Moduł `guide.lua` nie zna nazw NPC. Korzystają z niego Tolek i Lena przez `skills` i `guidePlaces`. Ardan i Brom nie mają tej umiejętności, więc nie opuszczają posterunku.

### Pierwsze zlecenie
Zlecenie to dane w `packages/contracts/tasks.json`. Stan jest w storage postaci, więc przetrwa restart. Lua dołącza stany do każdej wypowiedzi gracza, a Brain wybiera krok ze stanu silnika i słów gracza. „Zaniosłem” bez oddania listu nie przesuwa stanu.

Krok stosuje wszystkie efekty albo żaden. Przedmiot i złoto pochodzą z definicji: komenda `task_step` niesie tylko identyfikatory. Kwestie kroków są stałe, bo gracz musi wiedzieć, co zrobić dalej, a model mówił o tym mgliście. Zlecenie działa więc bez modelu. Zaufanie rośnie dopiero po zdarzeniu `task_step_done`.

### Wiedza ogólna bez blokad
Przy pytaniu o rzeczywisty świat prompt nie zawiera pracy, celów, zakazów ani wspomnień, tylko charakter i styl. Pomiar: 5/10 przed, 8–10/10 po. Pytania osobiste i o ten świat dostają pełny profil.

Model mówi pewnie także wtedy, gdy się myli. Nie da się tego naprawić bez innego modelu albo źródła wiedzy, więc NPC może podać błędną datę lub autora. Nie ma to skutków w grze. Fakty o tym świecie pozostają poza zgadywaniem.

### Treści wymagające pewności
Mały model ignoruje instrukcje dalekie od pytania, co pomiar potwierdził trzy razy. Dlatego:
- `reminder` stoi tuż przed słowami gracza;
- pytanie „czy jesteś AI” ma zadanie w kontekście, a odpowiedź wymijająca jest ponawiana raz i zastępowana stałym `aiDisclosureLine`;
- odpowiedź zasłaniająca się obowiązkami jest ponawiana raz z dopiskiem;
- słowa „ruszamy” bez rozpoczętego marszu są ponawiane, a potem zastępowane odpowiedzią regułową;
- ulubiony zwrot użyty w ostatnich wypowiedziach znika z profilu, a zdanie z nim jest usuwane, jeśli zostaje inne.

### Długie odpowiedzi
Limit jednej linii to 200 znaków (`maxSayLength`). Odpowiedź ma najwyżej dwie linie, druga idzie po 3,3 s, bo silnik pozwala na jedną nieproszoną wypowiedź co 3 s. Druga linia jest kasowana, gdy gracz powie coś nowego albo zacznie się alarm.

### Znacznik
`aiMarker.format` tworzy nazwę w grze (`{name} [AI]`) dla agentów z `marked: true`. Tożsamością pozostaje `agentKey`, a adresowanie używa `npcName` i `addressNames`. Zmiana znacznika nie dotyka pamięci ani mostu. Model nie ma akcji zmieniającej nazwę. Zwykli NPC Canary nie są objęci tą konfiguracją.

`Creature:setIcon` istnieje w tej wersji, ale nie używamy go: obsługi w OTClient nie sprawdzono, a znacznik w nazwie wystarcza.

### Status blokady chmury
Stary `Test-CloudBlocked` wysyłał czat do `glm-5.2:cloud` i uznawał także „not found” lub 403 za dowód. To groziło prawdziwym wywołaniem zdalnym i dawało fałszywą pewność. Teraz stan pochodzi z `GET /api/status` działającego procesu: `CONFIRMED` tylko przy `cloud.disabled = true`, a brak odpowiedzi to `UNKNOWN`. Żadne narzędzie nie wysyła już zapytań do modelu chmurowego.

## Odrzucone
- Zdalne sterowanie krokami z Brain: każdy krok czekałby na mailbox, a utrata Brain zatrzymałaby marsz.
- Ogłaszanie dotarcia przez model: to byłby tekst, nie wynik.
- Osobny system umiejętności obok warstw NPC: wystarcza `skills` przy ciele agenta i `allowedIntents` przy roli.

## Konsekwencje
- Wiedza ogólna jest tak dobra jak model; 9B w języku polskim bywa niedokładny.
- Dwie osoby nie mogą mieć jednego przewodnika naraz: druga słyszy `guideBusy`.
- Odczyt `/api/status` jest cechą Ollamy 0.32.3; w innej wersji stan może być `UNKNOWN`.
