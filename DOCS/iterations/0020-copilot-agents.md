# Iteracja 0020 — LUNA i HAIKU na modelach z konta GitHub
Data: 2026-11-01
Stan: VERIFIED w klientach dla modeli, czarów i pamięci o osobie; reszta w tabeli niżej
Commit projektu: niezacommitowane, na gałęzi `feat/player-agents` po `f58b71b`.

## Cel i warunek odbioru
Właściciel: agenci LUNA i HAIKU podpięci pod dwa różne modele z konta GitHub, z monitorowaniem zużycia, tak żeby nie zużyć kredytów od razu. Do tego wizja w repozytorium i wspólny plik postępu.

Odbiór:
1. Model jest konfiguracją postaci; zmiana modelu nie rusza jej pamięci.
2. Model nie ma żadnych narzędzi: bez shella, plików i sieci.
3. Budżet 5 kredytów na uruchomienie i 20 dziennie, zapisany w SQLite, restart go nie zeruje. Po limicie gra działa na regułach.
4. 30 takich samych scenariuszy dla obu modeli z pomiarem poprawności, opóźnienia i kredytów.
5. Obie postacie grają w prawdziwym kliencie, a zużycie pochodzi z wywołań, nie z szacunku.

## Zmiany
- `apps/brain/src/providers/copilot-model.ts`, `ledger.ts`, `packages/contracts/cloud-ai.json`, migracja 5 `model_usage`, `cli/ai-usage.ts`, `scripts/ai-budget.ps1`, ADR 0011.
- `ModelClient` w `local-model.ts`: `mind.ts` i `fleet.ts` nie zależą od konkretnego modelu. Postać z `model` w `players.json` ma własnego klienta.
- `test-integration/model-compare.ts`: 30 scenariuszy i `--hard` z 12 trudniejszymi.
- `tools/make_teachers.py`, `teachers.json`, `nextLesson`, cel `talk`, `exp.known`: czary tylko potwierdzone przez serwer.
- `selfReliant`: bez dev-kitu. `mapKnowledge: 'home'`. `mischief` i motyw w opcji ataku, 30 minut przerwy na osobę.
- `memoriesOf`, `eventsAbout`, `memoriesAbout`: pamięć o osobie. Rozmowy nie trafiają do ogólnych wspomnień.
- Poprawki z obserwacji w grze: exp w opcjach, łowiska i miejscówki bez exp odpadają, lekka łopata, pełny plecak prowadzi do sklepu, pierwsza nauka leczenia ma pierwszeństwo, odmowa wspólnej wyprawy obowiązuje przez chwilę, decyzja czeka na model przy chwilowym limicie, koniec współrzędnych na czacie (znacznik przyjaciela na mapie).
- `DOCS/STEVIUM_PRODUCT_VISION.md`, `DOCS/VISION_PROGRESS.md`, wskazanie w `CLAUDE.md`.

## Weryfikacja
Testy: `node --test test/*.test.ts` 188/188 PASS, `tsc --noEmit` PASS, `pnpm install --frozen-lockfile` PASS. Self-test Lua i `verify -Client`: NOT RUN w tej iteracji.

| Warunek | Wynik | Dowód |
| --- | --- | --- |
| 1. Model jako konfiguracja | PASS | `model` w `players.json`; pamięć w SQLite |
| 2. Bez narzędzi | PASS | `dir C:\\` odmówione przez oba modele, `toolRequests` puste, test sesji w `copilot.test.ts` |
| 3. Budżet, restart | PASS testem | `copilot.test.ts`. Prawdziwego wyczerpania limitu nie było: zużyte około 2 kredytów |
| 4. Scenariusze | PASS | `model-compare-20261031-234649.json`, `model-compare-20261101-000403.json` |
| 5. Gra w kliencie | PASS | `player-run-20261101-010344.json`, `-011425.json`, `-012558.json`, `model_usage` |
| Nauka czaru | PASS | Gregor: „You have learned 'bruise bane'.”, „You have learned 'wound cleansing'.”, potem `exura ico` w rozkazach |
| Pamięć o osobie po restarcie Brain | PASS | `[wspomnien: 5]` w `diary.log`, Luna: „Mowilem, ze nie schodze” |
| Opcje z exp | PASS | Haiku 0 exp przez 18 min, po poprawce +381 w 10 min |
| PvP z motywem | testy PASS, w grze NOT RUN | nie wystąpiło |
| Bankructwo bez dev-kitu | testy PASS, w grze NOT RUN | nie wystąpiło |
| Mapa tylko wokół domu | testy PASS | w grze włączona, bez osobnego pomiaru |
| Lekka łopata | w grze NOT RUN | nie trafiło się przejście |

Porównanie modeli:

| Zestaw | Luna | Haiku |
| --- | --- | --- |
| 30 podstawowych | 29/30, 0,165 kr, P50 3,1 s | 29/30, 0,273 kr, P50 2,4 s |
| 12 trudnych | 12/12, 0,095 kr | 10/12, 0,132 kr |

Biegi w grze, oba modele z ustawieniem `low`:

| Bieg | Luna | Haiku | Uwagi |
| --- | --- | --- | --- |
| 10 min | +218 exp | 0 exp | kury i psy dają 0 exp |
| 8 min | +978 exp | 0 exp | Haiku dalej na bezwartościowych potworach |
| 10 min | +318 exp | +381 exp | opcje pokazują exp |

Decyzja w grze kosztuje około 0,03–0,05 kredytu. Bez Ollamy wolnej pamięci minimum 3,8 GB, przy dwóch klientach.

## Znalezione przyczyny
- `sessionLimits.maxAiCredits` ma minimum 30 kredytów.
- `max_output_tokens`: Luna ignoruje, a przy Haiku silnik sam dopytuje model po ucięciu.
- Canary daje nowej postaci sprzęt przez `send_first_items.lua`, więc dev-kit Luny i Haiku był zbędny, a prośba i tak została odrzucona (`ok:false`). Przyczyna odrzucenia: lista `devCharacters` w `agents.json`, na której nie było nowych postaci.
- Sprzęt startowy rycerza waży tyle, że wolny udźwig to 15–32. Stąd szybki „pełny plecak”.
- Serwer daje `light shovel` 5710, a ciało znało tylko 3457.
- Instalacja przez npm złamałaby CI: projekt ma pnpm z zamrożonym lockfile'em. Naprawione, `koffi` bez skryptu budowania.

## Ograniczenia / rollback
- Rollback: `TIBIAAI_CLOUD_AI=` w `.env`. Postacie przechodzą na model lokalny albo reguły.
- Ocena scenariuszy jest robiona kodem i na małej próbie, nie mierzy naturalności rozmowy.
- Kluczy do drzwi agenci nie obsługują: drzwi zamknięte, z poziomem lub questem trasa omija.
- Znacznik przyjaciela na mapie działa między agentami. Człowiek musi wpisać współrzędne albo podejść sam.
- Treść czatu trafia do modelu w chmurze: ludzi trzeba o tym uprzedzić przed wpuszczeniem.
- Powody ataku na innego gracza widzi tylko model; temperament liczy się bez kary za nękanie poza 30 minutami przerwy.

## Następne zadanie
Wiarygodna społeczność: spór z rozmowy (Luna i Haiku) ma wpływać na decyzję, a jedna odpowiedź modelu i odpowiedź reguł nie mogą sobie przeczyć.
