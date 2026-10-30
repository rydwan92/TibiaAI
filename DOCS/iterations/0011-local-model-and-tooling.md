# Iteracja 0011: lokalny model, rejestr akcji i warsztat
Data: 2026-10-30
Stan: VERIFIED w prawdziwej grze (dialog); warsztat: częściowo, edytor mapy NOT RUN

## Cel i warunek odbioru
- Tryb local-only z odrzucaniem chmury, ograniczeniami i fallbackiem na reguły.
- Wybór modelu na podstawie pomiaru.
- Akcje z deklarowanymi capabilities.
- Opis narzędzi i bezpieczna kopia mapy.

## Rozpoznanie
RAM **15,9 GB** (jeden moduł 16 GB), nie 32 GB z opisu zlecenia. RTX 3060 12 GB. Ollama 0.32.3, `OLLAMA_NO_CLOUD` obsługiwane, zmienna nieustawiona. Modele: `qwen2.5-coder:14b` (lokalny), `glm-5.2:cloud` i `kimi-k2.7-code:cloud` (`remote_host: ollama.com`).

## Zmiany
- `packages/contracts/local-ai.json`, `providers/local-model.ts` (polityka, klient), `providers/model-provider.ts` (prompt, parser, kolejka, budżet, fallback), `cli/model-bench.ts`; ADR 0007.
- `brain.ts`: obsługa odpowiedzi asynchronicznej, `decision_stale`, strażnik pętli dla każdego providera; `main.ts`: wybór providera, rozgrzewanie modelu, przejście na reguły.
- `actions.ts`: rejestr akcji; `agents.ts`: `actor`, `persona`, `capabilities()`; `agents.json`: `actorTypes`, `brainReplyTicks = 4`.
- `DOCS/TOOLING.md`, `scripts\map-dev.ps1`, kopia mapy w `sync-server.ps1`.
- `.env` lokalnie: `TIBIAAI_BRAIN_PROVIDER=local-model` (plik ignorowany).

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| Testy jednostkowe (39): chmura i zdalny endpoint odrzucone, `remote_host`, redirect, limit promptu, parser, tekst gracza jako dane, fallback, timeout, kolejka, budżet, spóźniona decyzja, brak capability | PASS | `pnpm test`, `pnpm typecheck` |
| Pomiar modelu | 8/8 poprawnych, 0,4–1,9 s, zimny start 21,5 s | `cli/model-bench.ts`, ADR 0007 |
| Powitanie w prawdziwym kliencie obsłużone modelem | PASS, odpowiedź 1,9 s, klient 10/10 | `brain.log` 21:04:58 UTC, `model_reply` |
| Kopia mapy → sync → serwer ładuje, self-test | PASS 24/24 | `map-dev.ps1`, kopia identyczna z oryginałem |
| Edycja mapy w edytorze i załadowanie | NOT RUN | wymaga GUI edytora (TOOLING) |
| Panel kont MyAAC | NOT RUN | kandydat, nie instalowany |

## Ograniczenia
Model `qwen2.5-coder:14b` jest słaby w odgrywaniu roli. Plotka Miry przez model nie była przećwiczona w grze. `OLLAMA_NO_CLOUD` nieustawione; ochrona jest po stronie Brain.

## Następne zadanie
Scenariusz spotkania i treningu z jednym agentem `client_player`.
