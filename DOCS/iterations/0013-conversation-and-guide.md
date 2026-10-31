# Iteracja 0013: otwarta rozmowa, przewodnik, nauczycielka, status AI
Data: 2026-10-31
Stan: VERIFIED w prawdziwym kliencie; wyjątki w tabelach i ograniczeniach.

## Cel i warunek odbioru
Agent zrozumiały dla użytkownika: oznaczony w grze, rozmawiający swobodnie, z charakterem i pamięcią, wykonujący pierwsze rzeczywiste działanie na prośbę gracza. Odbiór: kryteria §10 zlecenia, osobno z atrapą, z prawdziwą inferencją i w kliencie. Wagi modelu bez zmian, żadnych nowych modeli.

## Ustalony stan początkowy
HEAD `55d7ba8`, drzewo czyste poza `commands/`. RAM **15,9 GB** (jeden moduł 16 GB, drugie gniazdo wolne, płyta przyjmuje do 32 GB), nie 32 GB. RTX 3060 12 GB, i5-10600. Wagi `C:\Users\<user>\.ollama\models`, 14,5 GB, wspólne dla aplikacji Ollama i procesu gry. Testy bazowe: 62/62, self-test 28/28.

Korekta wcześniejszego raportu: iteracja 0012 podawała blokadę chmury jako „sprawdzaną na żywym procesie”. Tamto sprawdzenie (`Test-CloudBlocked`) wysyłało czat do `glm-5.2:cloud` i uznawało „not found” oraz 403 za dowód. Blokada istniała, bo proces startował z `OLLAMA_NO_CLOUD=1`, ale sam test nie był wiarygodny i mógł wykonać zdalne wywołanie. Zastąpił go odczyt `GET /api/status`.

## Zmiany
- Status: `scripts/ai-status.ps1`, `cli/ai-status.ts`, `runtime/brain/ai-status.json`. `Get-CloudState` w `ollama.ps1`.
- Wiedza i polityki: `safety`, `conversationPolicies`, `aiDisclosureLine` w `world.json`; `knowledge/server-mechanics.json` ze źródłami; `skills`, `places`, `aiMarker` w `agents.json`.
- Postacie: `tolek` (rola `guide`, wariant `guide.joker`), `lena` (rola `tutor`, wariant `tutor.patient`).
- Silnik: `guide.lua`, stan `GUIDE`, komendy `guide_start`, `guide_cancel`, zdarzenie `guide_ended`, nazwa z `T.displayName`.
- Brain: `npc/requests.ts`, przepisane `context.ts` i `dialogue.ts`, migracja v4 `npc_player_prefs`, podział długich odpowiedzi.
- Testy: `test/guide.test.ts`, rozszerzone `ollama.itest.ts`, scenariusz `conversation` z chodzeniem, `npc-two-players.ps1`.
- Plany: COMBAT_PLAN.md, PRIVATE_DEMO_VPN.md, GAME_DIRECTION.md, ADR 0009.
- Zlecenie: `tasks.json`, `tasks.lua`, komenda `task_step`, zdarzenie `task_step_done`, stany zleceń przy wypowiedziach gracza.
- Wiedza: `server-mechanics.json`, `montag.json`, `world-lore.json`; NPC znają się nawzajem (`initialRelationships` trafia do promptu).
- Otwarcie: `generalKnowledge` w polityce, lekki prompt przy pytaniach ogólnych, do 400 znaków.
- Test walki: `dev-no-flasks.request` wyłącza puste flaszki postaci deweloperskiej i usuwa te, które ma. Zgłoszone przez użytkownika: flaszki zajmowały capacity.

## Co pokazała gra i prawdziwy model
| Odkrycie | Skutek | Reakcja |
| --- | --- | --- |
| Na pytanie o `[AI]` Tolek odpowiedział „jestem człowiekiem” | nieuczciwość | zadanie w kontekście, ponowienie, stałe `aiDisclosureLine` |
| Ardan: „wykracza poza moje obowiązki” | zamknięcie w roli mimo polityki `open` | `reminder` tuż przed słowami gracza, ponowienie z dopiskiem |
| `getPathTo` chwilowo nie zwraca drogi do osiągalnego miejsca | „nie znam drogi” do świątyni | odmowa od razu tylko dla miejsc nieosiągalnych przy starcie, reszta przez `moveTimeoutTicks` |
| „Bez nerwów, to prosta sprawa” w każdej wypowiedzi | mechaniczny styl | zwrot znika z profilu po użyciu, zdanie jest usuwane |
| Tolek mówi „ruszamy” przy powitaniu | zapowiedź działania, które nie startuje | `claimsWalk`, ponowienie, potem reguły |
| Lena poprawia wołacz „Leno” | absurdalna lekcja | imię na początku wypowiedzi nie trafia do modelu |
| Zdania sklejone „you.Let's” | błąd `toGameAscii`, usuwał znak nowej linii | białe znaki zamieniane przed filtrem |
| Filtr powtórzeń wyciął odpowiedź o imieniu | zostało „Panie Knight Sample.” | fakt, o który gracz pyta, nie podlega filtrowi |
| Stary alarm w rozmowie o czym innym | model mówił o nim jak o bieżącym | obserwacje tylko na temat, zawsze z wiekiem |
| Imię innego NPC w zdaniu liczyło się jako zwrot do niego | „Miro, zaniosłem list do Broma” nie trafiało do nikogo | adresata wyznaczają tylko pierwsze dwa słowa |
| Model mgliście wydawał zlecenie | gracz nie wiedział, co robić | kroki zlecenia mają stałe kwestie |
| `toGameAscii` wycinał indeks dolny | H₂O stało się HO | normalizacja NFKD |
| Na mapie nie ma potworów | NPC nie mogą mówić o polowaniu | wpis w wiedzy, GAME_DIRECTION.md |
| Pierwszy test dwóch graczy | Tolek zdążył dojść przed logowaniem Kaela | Kael czeka przy NPC i rusza na sygnał |

Lekcja z testów: walidacja JSON przepuszczała odpowiedzi bez sensu. Testy z prawdziwym modelem i klientem sprawdzają teraz treść.

## Weryfikacja
Testy z atrapą modelu nie są dowodem działania AI. Wyniki podane są osobno.

### Testy automatyczne (raport `runtime/logs/verify-20261031-152941.json`, 8/8 kroków)
| Test | Wynik |
| --- | --- |
| Testy jednostkowe Brain z atrapą modelu, typecheck | PASS 100/100 |
| Self-test Lua w Canary | PASS 36/36 |
| Most na żywym świecie, backup, restore | PASS |
| Klient: smoke, walka | PASS |

### Prawdziwa inferencja, bez klienta (`ollama.itest.ts`, 3 przebiegi na końcowym kodzie)
| Pomiar | Wynik |
| --- | --- |
| Gwarancje kodu | 21/21 w każdym przebiegu |
| Jakość modelu | 13/13, 11/13, 12/13 |
| Wiedza o rzeczywistym świecie | 8, 9, 10 z 10; przed otwarciem 5/10 |
| Struktura za pierwszym razem | 135/137 |
| Czas modelu, P50 / P90 / maks. | 3,1–3,4 s / 4,5–5,1 s / 6,6 s |
| Kontekst | do 1594 tokenów z 4096, odpowiedź do 276 tokenów |

Test sprawdza tylko słowo kluczowe, więc treść bywa błędna mimo zaliczenia: w tych przebiegach judo przypisano Ueshibie i Matsumoto, a Bella nazwano Kanadyjczykiem.

### Demonstracja w prawdziwym kliencie
| Krok | Wynik | Dowód |
| --- | --- | --- |
| Przedstawienie, restart, inny gracz, wyciek, wymuszenie, styl, drugi NPC, incydent | PASS 11/11 | `npc-scenario.ps1` |
| Pytanie o judo w kliencie | FAIL przed otwarciem: „z Dalekiego Wschodu”, bez Japonii. Po otwarciu nie powtórzono w kliencie | quiz: 2/3 z Japonią |
| Znacznik, strażnik nie prowadzi | PASS | Tolek wyjaśnia `[AI]`, Ardan odmawia i opisuje drogę |
| Dotarcie | PASS | `guide_ended arrived at 5004,4999,7`, 16 ticków |
| Anulowanie | PASS | `cancelled`, po 10 tickach |
| Alarm | PASS | `alarm` w 5003,5000,7 |
| Brak drogi | PASS | „Nie znam drogi”, NPC zostaje |
| Zostanie w tyle | PASS | `left_behind`; wykonane przed ostatnią zmianą adresowania |
| Wylogowanie | PASS | `player_gone`; jak wyżej |
| Lena jako drugi przewodnik | PASS | `arrived`, ten sam moduł; jak wyżej |
| Dwóch graczy naraz, dwa klienty | PASS 4/4 | jeden marsz, `guide_busy`, cudzy „stop” bez skutku |
| Lekcja: start, poprawka „went”, po restarcie, koniec | PASS 3/3 | `lesson`, `lesson_level` w bazie |
| Zlecenie | PASS 5/5 | stan 3, 50 złota i brak listu w bazie, wpis w pamięci Miry |
| Model wyłączony | PASS w iteracji 0012, przewodnik i zlecenie bez modelu z atrapą | `guide.test.ts` |
| Flaszki | PASS | silnik usunął 6, potem 0; `no_flasks_left` |

### Status AI
`scripts\ai-status.ps1` pokazał proces, `CONFIRMED` dla chmury (`cloud.disabled`, źródło `env`), wagi lokalne, 5,6 GB VRAM, kolejkę 0/3, ostatnią odpowiedź i agentów. Nie wysyła zapytań do modelu.

Skan zmian pod kątem wartości z `.env`: 4 sprawdzone, 0 trafień.

## Ograniczenia
- Model mówi pewnie także wtedy, gdy się myli. Dotyczy to wiedzy ogólnej i zdarza się często przy nazwiskach i datach.
- Polszczyzna modelu bywa niezręczna, a w rozmowie potrafi on mówić rzeczy nieprawdziwe o grze: Mira pochwaliła „dotarł”, choć list nie dotarł, a Tolek wymyślił napis na drzwiach magazynu. Silnik tego nie przyjmuje: stan, złoto i wyniki się nie zmieniają.
- Style Ardana i Broma zbliżają się, gdy słyszą nawzajem swoje wypowiedzi.
- NOT RUN: blokada drogi w połowie marszu w kliencie, zobowiązanie NPC, kompresja w działającej bazie, pokaz przez VPN, drugi komputer.
- Kroki `left_behind`, `player_gone` i drugi profil wykonano przed ostatnią zmianą adresowania, której nie dotyczą.
- Baza zawiera dane testowe. Kael stracił poziom przez wielokrotne śmierci w teście walki (7 zamiast 8).
- Ostatni test scenariusza nie obejmuje pełnej listy naraz: kroki szły partiami.

## Następny krok
Kawałek 2 z GAME_DIRECTION.md: relacja otwiera możliwości. Pierwsze zlecenie jest gotowe w tej iteracji.
