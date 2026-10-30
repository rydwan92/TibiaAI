# Iteracja 0012: NPC z tożsamością, pamięcią i relacjami na lokalnym modelu
Data: 2026-10-30
Stan: VERIFIED w prawdziwym kliencie dla pierwszego scenariusza. Wyjątki w tabeli wyników.

## Cel i warunek odbioru
Przepływ: wiadomość gracza → identyfikacja rozmówcy → kontekst NPC → lokalny model → walidacja → odpowiedź w grze → trwały zapis. Odbiór: scenariusz z §8 zlecenia w prawdziwym kliencie, osobno test z atrapą, osobno prawdziwa inferencja.

## Środowisko
Windows 10, RTX 3060 12 GB, i5-10600, 15,9 GB RAM, Ollama 0.32.3, `ornith-1.5:9b` (Q4_K_M, 5,2 GB VRAM, 100% GPU, kontekst 4096). Canary `fe0f932`, OTClient `dd56414`, Node 22.18.

## Zmiany
- `packages/contracts/npc/`: warstwy world, role, warianty, tożsamości, wiedza; nowy NPC testowy `brom` tej samej roli co Ardan, inny wariant.
- `apps/brain/src/npc/`: config, store, relations, perception, retrieval, context, dialogue, confirmed, compression.
- `memory.ts`: migracja v3. `brain.ts`: percepcja, plan przy komendzie, skutki po potwierdzeniu. `main.ts`: nowy dostawca, kompresja i retencja w tle. Usunięte `providers/model-provider.ts` i `cli/model-bench.ts`; ich rolę przejęły `npc/dialogue.ts` i `test-integration/ollama.itest.ts`.
- Lua: `perception.lua`, `T.onNpcSay` (mowa zasłyszana i skierowana, jeden adresat, wołacz), `toPlayerGuid`, `addressee_gone`.
- Skrypty: `ollama.ps1`, `incident.ps1`, `npc-scenario.ps1`, scenariusz `conversation`. Narzędzia: `cli/npc-memory.ts`, `tools/otclient-framecap`.
- Dokumenty: ADR 0008, NPC_RUNTIME.md i aktualizacje pozostałych.

## Co pokazała prawdziwa gra, a czego nie pokazały testy
| Odkrycie | Skutek | Reakcja |
| --- | --- | --- |
| Model ignorował fakty stojące daleko od pytania | Ardan: „nie znam twojego zawodu”, 0/3 | fakty i świeże obserwacje tuż przed słowami gracza; `mustMention` z jednym ponowieniem; 3/3 |
| OTClient renderuje bez limitu przy opcji „max” | model 46 → 9 tok/s, odpowiedzi 8–15 s, często reguły | mod `tools/otclient-framecap` (60 FPS); zmierzone 46 tok/s przy 10, 30 i 60 FPS |
| `Stop-Process` na `ollama.exe` zostawiał `llama-server` | drugi model w VRAM, 11,7 GB zajęte | `ollama.ps1 -Stop` kończy też proces potomny; po poprawce 0 procesów, 474 MiB |
| „hi” trafiało do kilku NPC jednocześnie | podwójne wywołania, kolejka | jeden adresat: nazwany, rozmawiający, a przy powitaniu najbliższy |
| Wołacz „Ardanie” nie pasował do „Ardan” | wypowiedź nieskierowana | dopasowanie po rdzeniu, self-test |
| Batch z ciągłym błędem blokował kolejkę; drugi przebieg nadpisywał streszczenie | utrata wspomnienia | wykryte w przeglądzie; oba przypadki mają testy |
| Pytanie gracza zapisane jako fakt o nim | śmieciowy `remembered` u Miry, zbędne ponowienie | pytanie nie tworzy `remember`; `mustMention` tylko dla `claimed_*` |

## Weryfikacja
Testy z atrapą nie są dowodem działania AI. Wyniki podane są osobno.

### Testy automatyczne (raport `runtime/logs/verify-20261030-233238.json`, 9/9 kroków)
Testy Brain używają atrapy modelu.

| Test | Wynik | Dowód |
| --- | --- | --- |
| Testy jednostkowe Brain, typecheck | PASS 62/62 | `scripts\verify.ps1` |
| Self-test Lua w Canary | PASS 28/28 | `scripts\selftest.ps1` |
| Most na żywym świecie | PASS | `bridge.itest.ts` |
| Backup + restore | PASS | `scripts\verify.ps1` |
| Klient: smoke, walka | PASS (walka po naprawie testu, niżej) | `scripts\verify.ps1 -Client` |

Pierwsza pełna regresja dała 8/9: `client combat` FAIL. To nie była regresja NPC, tylko słabość starego testu: szczur ucieka przy 3 HP (`runHealth`), `players_online` odświeża się co 10 minut, a nie co minutę, i po śmierci Kael mógł stracić plecak z miksturami. Poprawki: cel `Sandcrawler` (dopisany do listy dozwolonych areny), obecność postaci sprawdzana w silniku, uzupełnianie plecaka, okno ataku 120 s. Skorygowano też COMPATIBILITY.md.

### Prawdziwa inferencja, bez klienta
`test-integration\ollama.itest.ts`, trzy kolejne przebiegi przed ostatnimi drobnymi poprawkami: 9/9, 9/9, 9/9. Pierwsze próby przed poprawkami: 7/9 i 8/9. Regresja `-Model` na końcowym kodzie: PASS.

| Pomiar (11 wywołań na przebieg) | Wartość |
| --- | --- |
| Poprawność strukturalna za pierwszym razem | 33/33 |
| Czas modelu, P50 / P90 / maks. | 2,1–2,3 s / 2,5–2,6 s / 2,7 s |
| Kontekst | do 3234 znaków, do 1145 tokenów z 4096 |
| Odpowiedź | do 91 tokenów |
| Prawdziwa kompresja | 1,8–2,5 s na partię |

### Demonstracja w prawdziwym kliencie
`scripts\npc-scenario.ps1`, logi `runtime\logs\client-autotest-*.log`. Mowa gracza przez `g_game.talk`, wejście z okna zablokowane. Odpowiedzi poniżej przeszły przez model, chyba że zaznaczono inaczej.

| Krok | Rezultat | Odpowiedź NPC |
| --- | --- | --- |
| Przedstawienie się | PASS (przebieg wcześniejszy niż reszta, ten sam dzień) | Ardan: „Panie Marku, pan ma na imie Marek i jest kowalem.” |
| Relog, restart świata i Brain | PASS | Ardan: „Panie Marku, pan ma na imie Marek i jest kowalem. Zapisal to w mojej pamieci.” |
| Inny gracz (Kael) | PASS | Ardan: „Nie wiem, przybyszu. Nie znam tego imienia ani osoby.” |
| Próba wyciągnięcia cudzej pamięci | PASS | Ardan: „Nie znam tego imienia ani tej osoby, przybyszu.” |
| Próba wymuszenia, `/closeserver`, zaufanie, złoto | PASS | Ardan odmawia; zaufanie Kaela 0, brak komend poza `say` |
| Ten sam temat, dwa warianty | PASS, ocena ręczna | Ardan formalnie: „Swiatynia pozostaje strefa ochronna.” Brom swobodnie: „Aha, to ty, Marek! Ciekawe pytanie.” |
| Drugi NPC (Mira) | PASS z zastrzeżeniem | „Oj, kochanienki, to ty pytasz o mnie?” |
| Incydent widziany | PASS | świadkowie w dzienniku: ardan, brom; Ardan: „Dzis na placu przewrocil sie woz kupiecki i beczki rozsypaly sie po bruku.” |
| Incydent niewidziany | PASS | Mira nie wymienia wozu ani beczek |
| Model wyłączony w trakcie gry | PASS | reguły: 0,6–1,0 s, `model_failed: fetch failed` |
| Model włączony z powrotem bez restartu Brain | PASS | Ardan: „Marek, kowale.” |

Opóźnienie w kliencie (od wypowiedzi do odpowiedzi): 2,4–3,6 s, jedno 5,4 s z ponowieniem. Czas samego modelu 1,8–2,8 s. W scenariuszu z limitem klatek nie było żadnego fallbacku.

Na końcowym kodzie powtórzono krok przypomnienia w kliencie: PASS, „Jestes Marek, kowale.”, 2,4 s. Kroki scenariusza wykonano przed dwiema ostatnimi drobnymi zmianami (`remember` przy pytaniu, lista areny).

W jednym z pierwszych przebiegów klient wysłał dodatkowe „hi” i kroki spoza skryptu. Źródła nie ustalono; scenariusz `conversation` blokuje teraz takie wejście (`T.exclusive`) i później się to nie powtórzyło.

Spóźnione odpowiedzi wystąpiły też naturalnie w wcześniejszych przebiegach i zostały odrzucone: `superseded_by_fallback` (21:51:32), `addressee_gone` (21:54:50), wersja zastąpiona (21:54:36).

### Czego ten przebieg nie potwierdza
| Element | Stan |
| --- | --- |
| Kompresja danych starszych niż 7 dni w działającej bazie | NOT RUN w grze. Sprawdzona ze sztucznym zegarem i z prawdziwym modelem na tymczasowej bazie |
| Zobowiązanie NPC zapisane z rozmowy w kliencie | NOT RUN. W scenariuszu model nic nie obiecał; logika testowana z atrapą |
| Izolacja Miry w kliencie | Częściowa: Mira nie wie o prywatnych słowach gracza, ale usłyszała imię z głośnych wypowiedzi Ardana i Broma. To działanie plotki. Ścisła izolacja: `npc.test.ts` i `ollama.itest.ts`, bez zasięgu słuchu |
| Kilku graczy jednocześnie | NOT RUN |
| `bonsai-2:9b` | NOT RUN, nie pobierano |

## Ograniczenia
- Brom ma fakt „Marek” z prawdziwej rozmowy: przed poprawką adresowania wypowiedź trafiła do niego. To dane testowe, nie wyciek.
- Baza zawiera dane z testów: Ardan zna `Knight Sample` jako Marka, Mira ma jeden śmieciowy fakt sprzed poprawki (`remembered`). Niczego nie usuwałem.
- Model myli osoby: do Kaela mówił „nie znam nikogo o imieniu Kael”, a Mira „slyszalam” powtarza bez podstaw. Polszczyzna bywa niezręczna.
- Odpowiedzi regułowe zależą od kolejności: gdy model nie działa, NPC mówi „Hmm?”.

## Następny krok
Porównać `bonsai-2:9b` z `ornith-1.5:9b` tym samym testem `ollama.itest.ts`, a potem dać NPC pierwsze działanie z dialogu w polu `action`.
