# ADR 0011: modele z konta GitHub Copilot dla graczy-agentów
Status: ACCEPTED (2026-11-01). Uzupełnia ADR 0007: przy `TIBIAAI_CLOUD_AI=1` postacie z wpisem `model` grają na modelu z konta, a NPC i kompresja korzystają z niego tylko wtedy, gdy lokalny model nie działa. Bez tej zmiennej wszystko zostaje lokalne.

## Kontekst
Właściciel chce porównać modele ze swojego konta GitHub (plan z kredytami AI) na postaciach LUNA i HAIKU i monitorować zużycie. Oficjalny `@github/copilot-sdk` steruje silnikiem agentowym Copilota, który domyślnie ma shell i dostęp do plików. Gra nie może mu tego dać: zasada „nigdy nie wykonuj kodu wygenerowanego przez model”.

## Decyzja
- Model jest konfiguracją postaci (`model` w `players.json`), a pamięć zostaje w SQLite. Zmiana modelu nie dotyka postaci.
- Domyślnie wyłączone: `TIBIAAI_CLOUD_AI=1` w `.env`. Bez tego i bez internetu postać gra na regułach albo modelu lokalnym, a SDK nie jest nawet ładowane.
- Sesja nie ma żadnych możliwości: `mode: 'empty'`, `availableTools: []`, pusty katalog `runtime/copilot`, każda prośba o uprawnienie odrzucona, a odpowiedź z prośbą o narzędzie jest błędem. Do modelu idzie tekst, od modelu wraca tekst.
- Każda odpowiedź przechodzi walidację schematu: wartość `choice` spoza oferowanej listy nie jest odpowiedzią. Działania dalej sprawdza silnik.
- Nowa sesja na każde wywołanie, usuwana po użyciu. Inaczej historia rozmowy wracałaby w każdym zapytaniu i kosztowała.
- Budżet egzekwuje aplikacja (`packages/contracts/cloud-ai.json`, `CreditLedger`). Właściciel podniósł limit 2026-11-01 do około 1000 kredytów miesięcznie (pierwotnie 5 na test i 20 dziennie): 60 na uruchomienie Brain, 150 dziennie, 1000 miesięcznie, jedno wywołanie naraz, 14 na minutę, jedno ponowienie, po błędzie 30 s przerwy. Każde wywołanie trafia do `model_usage` z kosztem podanym przez usługę, także nieudane i ponowione. Gdy usługa nie poda kosztu, liczymy rezerwę 0,05 kredytu.
- Rezerwa jest sprawdzana przed każdą próbą. Wyłącznik: `scripts\ai-budget.ps1 -Stop` tworzy `runtime/control/ai-stop`.
- Logowanie należy do CLI GitHuba. W repozytorium i `.env` nie ma żadnego tokenu.

## Ustalenia z konta (2026-11-01, SDK 1.0.28)
- Na koncie jest 14 modeli. `gpt-6-luna` i `claude-haiku-5.5` kosztują 10/50 kredytów za milion tokenów wejścia/wyjścia. `GPT-6.1 Sol` z notatek nie jest dostępny; `gpt-6.1-terra` kosztuje 100/500.
- `totalNanoAiu` z `assistant.usage` podzielone przez 1e9 to kredyty: zmierzone 0,00607 zgadza się z cennikiem co do cyfry.
- `sessionLimits.maxAiCredits` ma minimum 30, więc nie nadaje się na tani bezpiecznik.
- Limit odpowiedzi `modelCapabilities.limits.max_output_tokens` (w polityce `maxOutputTokens` 500) nie jest pewnym bezpiecznikiem. Sprawdzone przy limicie 40: `gpt-6-luna` go zignorowała i oddała 1171 tokenów (0,059 kr), a `claude-haiku-5.5` go respektuje, ale silnik po ucięciu sam dopytuje model: 3 wywołania po 40 tokenów. `maxTokens` z `mind.ts` dotyczy tylko modelu lokalnego. Koszt ogranicza budżet aplikacji, a jedna odpowiedź może składać się z kilku wywołań, które ledger sumuje.
- Autoryzacja przechodzi przez `gh`, także przy pustym `baseDirectory`.

## Pomiar (2026-11-01, `low`)
| Zestaw | Luna | Haiku |
| --- | --- | --- |
| 30 podstawowych | 29/30, 0,165 kr, P50 3,1 s | 29/30, 0,273 kr, P50 2,4 s |
| 12 trudnych | 12/12, 0,095 kr, P50 3,8 s | 10/12, 0,132 kr, P50 2,7 s |

Jedna decyzja w grze: około 0,032 kredytu przy 1600 tokenach wejścia. Mała próba i ocena kodem, nie człowiekiem: nie mierzy naturalności rozmowy.

## Konsekwencje
- Treść promptu, w tym czat innych graczy, opuszcza komputer. Przed wpuszczeniem ludzi trzeba ich o tym uprzedzić albo przełączyć te postacie na model lokalny.
- Własne dodatki poza kontraktem nie powstały: agent dalej wybiera wyłącznie spośród opcji.
- Timeout nie przerywa rozliczenia po stronie usługi; `abort` jest wysyłany, a koszt liczony jako rezerwa.
