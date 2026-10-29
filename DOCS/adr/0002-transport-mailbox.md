# ADR 0002: transport Lua ↔ Brain przez lokalny mailbox plików JSON
Status: ACCEPTED (2026-10-29), etap badawczy MVP. Zweryfikowany na Canary v3.6.1 (fe0f932), Windows 10, NTFS.

## Kontekst
Potrzebny jest dwukierunkowy, asynchroniczny kanał event → Brain → komenda → wynik, bez blokowania pętli świata.

Sprawdzone w źródle przypiętego commita:
- `Webhook.sendMessage` (`src/lua/functions/core/network/webhook_functions.cpp`) tylko wysyła, binding zwraca nil, brak odpowiedzi. To nie jest transport request/response.
- W `src/lua/` nie ma ogólnego klienta HTTP ani socketu z callbackiem odpowiedzi.
- `src/lua/functions/lua_functions_loader.cpp:38` wywołuje `luaL_openlibs(L)`, więc dostępne są `io` i `os` z LuaJIT. Lua nie ma listowania katalogów, a `io.popen`/`os.execute` (shell) są dla nas zakazane.

## Decyzja
Mailbox w `runtime/mailbox/` (ignorowany przez git, zablokowany dla Apache przez `.htaccess`):

| Plik | Pisze | Czyta |
| --- | --- | --- |
| `events/evt-<session>-<seq8>.json` | Lua (tmp + `os.rename`) | Brain, potem przenosi do `brain-processed/` lub `quarantine/` |
| `commands/cmd-<session>-<seq8>.json` | Brain (tmp + `renameSync`) | Lua otwiera wyłącznie następny oczekiwany numer, potem przenosi do `processed/` lub `quarantine/` |
| `results/res-<session>-<seq8>.json` | Lua | Brain |
| `world.json` | Lua co ~2 s: sesja, `nextCommandSeq`, stan agenta | Brain (wykrycie sesji, numeracja komend) |
| `brain-heartbeat.json` | Brain co 1 s: `atMs`, ostatni przetworzony `seq` | Lua (watchdog 5 s, backpressure) |

Ciągła numeracja na sesję zastępuje listowanie katalogu po stronie Lua. Sesja w nazwie pliku sprawia, że komendy starej sesji świata nigdy nie zostaną otwarte. Polling: GlobalEvent co 500 ms, max 10 komend na poll, pliki do 16 KiB, max 100 niepotwierdzonych zdarzeń (nadwyżka jest odrzucana i zapisywana w dzienniku).

## Dowody (2026-10-29)
- Test na żywym silniku `apps/brain/test-integration/bridge.itest.ts`: 11/11 PASS (raporty `runtime/logs/itest-*.json`).
- Pełny przepływ z Brain: `training_alarm_started` → Brain (rules, opóźnienie 4 s) → `say` → walidacja Lua → `completed`, pod jednym `correlationId` (`runtime/logs/brain.log` 22:15:38–22:15:43 UTC).
- Opóźnienie komenda → wynik: ~0,4 s (poll 500 ms). Pomiar orientacyjny, `os.time()` w Lua ma rozdzielczość 1 s.

## Ograniczenia
- Na Windows `os.rename` nie nadpisuje istniejącego pliku, więc `world.json` jest zastępowany przez remove + rename. Brain toleruje chwilowy brak pliku.
- Brak gwarancji exactly-once po awarii procesu. Deduplikacja `commandId` działa w pamięci sesji świata (200 ostatnich), `eventId` w SQLite.
- Luka w numeracji komend (np. awaria Brain między zapisem pliku a SQLite) zatrzymałaby odbiór. Brain wybiera `max(world.nextCommandSeq, max seq w SQLite + 1)` i pomija zajęte numery. Ryzyko jest udokumentowane, nie wyeliminowane.
- Stałe I/O: 2 próby `io.open` na sekundę oraz zapis `world.json` co 2 s. Wpływu na tick nie mierzono profilerem (TODO).
- To prosty most lokalny, nie transport skalowalny.

## Alternatywy
- Adapter C++ z asynchroniczną kolejką: odłożony. Wymaga patcha upstream i własnego buildu Canary (MSVC + vcpkg), a mailbox wystarcza dla jednego agenta.
- Tabele gry jako magistrala: odrzucone (ARCHITECTURE: nie używamy tabel gry).
- Login-server gRPC: to usługa logowania, nie kanał dla NPC.

## Następna decyzja
Po pomiarze wpływu I/O na tick przy kilku agentach: zostaje mailbox albo ADR na adapter C++.
