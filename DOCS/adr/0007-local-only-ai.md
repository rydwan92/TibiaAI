# ADR 0007: tryb local-only dla modelu językowego
Status: ACCEPTED (2026-10-30). Dotyczy etapu M4. Uzupełnione przez ADR 0008: osobny proces gry na 127.0.0.1:11435 z `OLLAMA_NO_CLOUD=1`, model `ornith-1.5:9b`, dialog zamiast powitań. Limity i nazwy plików poniżej opisują stan z iteracji 0011; aktualne wartości są w `local-ai.json`.

## Kontekst
Właściciel projektu nie zgadza się na płatne API ani automatyczne użycie chmury. Na komputerze jest Ollama 0.32.3, ale jej lista modeli miesza modele lokalne i chmurowe (`glm-5.2:cloud`, `kimi-k2.7-code:cloud`, działające przez `https://ollama.com`).

## Decyzja
Polityka w `packages/contracts/local-ai.json`, egzekwowana w `apps/brain/src/providers/local-model.ts`, odmawia domyślnie:
- endpoint tylko loopback po http, bez poświadczeń;
- jawna lista `allowedModels`; nazwy `*:cloud`/`*-cloud` są odrzucane już przy walidacji;
- przed użyciem `verifyModel()` sprawdza `/api/tags`: model musi istnieć i nie mieć `remote_host`, więc o lokalności decyduje Ollama, nie nazwa;
- `redirect: 'error'`, brak nagłówków autoryzacji i kluczy, brak SDK dostawców;
- brak fallbacku do chmury: każdy problem przechodzi na `RulesProvider`.

Ograniczenia wywołań: jedna prośba naraz (`maxConcurrent 1`), kolejka 3, budżet 12/min, timeout 8 s, prompt do 1500 znaków, odpowiedź do 60 tokenów i 120 znaków. Model dostaje tylko personę, fakty ze spotkań i wypowiedź gracza jako cytat JSON; nie dostaje historii ani stanu świata.

Model wyłącznie formułuje tekst powitania. Nie wybiera akcji, a wynik przechodzi przez `parseReply` (JSON, długość, ASCII, brak komend) i normalną walidację komendy w Brain i Lua. Odpowiedź po zmianie sesji świata lub starsza niż 10 s jest odrzucana (`decision_stale`), a spóźniona względem lokalnego powitania odrzuca Lua (`superseded_by_fallback`).

`OLLAMA_NO_CLOUD=1` jest obsługiwane w 0.32.3 (`ollama serve --help`) i wyłącza funkcje chmurowe całej instancji. Działa tylko po ustawieniu zmiennej przed startem procesu Ollamy, więc ustawienie jej w Brain niczego nie zmienia. Nie ustawiamy jej automatycznie, bo to konfiguracja użytkownika dotycząca także innych zastosowań; instrukcja jest w RUNBOOK. Ochrona projektu nie zależy od tej zmiennej.

## Pomiar (2026-10-30, RTX 3060 12 GB, RAM 15,9 GB)
`qwen2.5-coder:14b` (Q4_K_M, jedyny model lokalny na komputerze): 100% GPU, 9,5 GB, kontekst 4096. Pierwsze załadowanie 21,5 s, potem 0,4–1,9 s, mediana 0,75 s. Poprawność formatu 8/8, próba wstrzyknięcia poleceń zignorowana. W prawdziwej grze powitanie → odpowiedź w 1,9 s.

Słabości: model do kodu; odpowiedzi lakoniczne, błędy rodzaju gramatycznego, słabe odgrywanie roli. Nadaje się do sprawdzenia przepływu, nie do końcowej jakości dialogu.

## Konsekwencje
- Brain rozgrzewa model przy starcie, żeby 21 s nie trafiło na powitanie gracza.
- `brainReplyTicks` podniesiono do 4 s; dłuższa odpowiedź kończy się lokalnym powitaniem.
- Wybór lepszego modelu to decyzja użytkownika: wymaga pobrania. Kandydaci widoczni w aplikacji: `qwen3.5:4b`, `gemma4:12b`. Pomiar: `apps/brain/src/cli/model-bench.ts --model <nazwa>` po dopisaniu modelu do `allowedModels`.
- Agent zapamiętuje spotkania i zmienia wypowiedzi. To nie jest trenowanie modelu: wagi się nie zmieniają.
