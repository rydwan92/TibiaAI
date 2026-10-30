# Narzędzia

Stan na 2026-10-30. **SPRAWDZONE** oznacza użycie w tym projekcie z dowodem. **KANDYDAT** oznacza sprawdzone źródło i wersję, ale bez uruchomienia.

## Sprawdzone
| Narzędzie | Wersja | Do czego | Uruchomienie |
| --- | --- | --- | --- |
| Canary | v3.6.1 `fe0f932`, protokół 15.11 | serwer | `scripts\start.ps1` |
| login-server | `2612930`, build lokalny | logowanie HTTP klienta; to nie jest panel kont | `scripts\start.ps1` |
| OTClient | 4.1 `dd56414` + assets 15.11 (`appearances` zgodne z serwerem, SHA-256 `5997985a…`) | klient, także sterownik testów | `scripts\client.ps1 -CopyPassword` |
| `scripts\client-autotest.ps1` | projekt | test prawdziwego klienta: `smoke`, `combat` | RUNBOOK §6a |
| `scripts\scan.ps1`, `/ai scan` | projekt | widok przejść mapy z silnika | AGENTS.md |
| `scripts\map-dev.ps1` | projekt | kopia mapy deweloperskiej; oryginał zostaje w `vendor\` | niżej |
| `scripts\lab-fixture.ps1` | projekt | pozycje testowe, konto i postać `Kael` | RUNBOOK |
| `apps\brain\src\cli\timeline.ts`, `tools\journal.py` | projekt | diagnostyka agentów | RUNBOOK §7a |
| `apps\brain\src\cli\model-bench.ts` | projekt | pomiar lokalnego modelu | ADR 0007 |
| Ollama | 0.32.3 | lokalny model | ADR 0007 |

Konta i postacie: dziś przez SQL w skryptach (`setup.ps1`, `lab-fixture.ps1`).

## Edytor mapy: KANDYDAT
**Canary Map Editor v4.0** (`opentibiabr/remeres-map-editor`, tag `v4.0`, commit `2a28ef8b2c96ac84945a49088cf0dd0b85933640`, 2026-06-12). Plik `canary-map-editor-v4.0-windows.zip`, 124 MB, SHA-256 `3b237c1abe32b5ff2286e29fb1db97af3fd1b18df44ec99d49ad6854d825245b`. Wydanie jest sprzed Canary v3.6.1 (2026-07-01), od tego samego zespołu. Nowsze niż klasyczny Remere's; wersja v3.8 („13x”) z 2024 jest za stara.

Zgodność **nie jest potwierdzona**. Po stronie projektu przećwiczono tylko kopię bez edycji: `map-dev.ps1 -Init` → sync → serwer ładuje kopię, self-test 24/24. Pełny przebieg wymaga ręcznej obsługi GUI:
1. Pobierz ZIP z release, sprawdź SHA-256, rozpakuj poza projektem.
2. `powershell -ExecutionPolicy Bypass -File scripts\map-dev.ps1 -Init`
3. W edytorze wskaż assets klienta 15.11 (`vendor\otclient\otclient-dd5641492a71e966b96b8a91398b44bb3df67d88\data\things\1511`, według monitu edytora).
4. Otwórz `runtime\maps\canary.otbm`, zrób małą zmianę na wolnym fragmencie w pobliżu placu (5012,5004,7), zapisz.
5. `scripts\stop.ps1 -KeepDb`, `scripts\sync-server.ps1`, `scripts\start.ps1`.
6. Sprawdź zmianę w `scripts\scan.ps1 -X 5012 -Y 5004` i w kliencie.

Dopiero krok 6 potwierdza zgodność. Powrót: `scripts\map-dev.ps1 -Reset` (kopia zostaje pod nazwą z datą), potem sync i start. Plan obszaru testowego na kopii: miejsce rozmowy, przeszkody do nawigacji i arena. Do tego czasu `arena` w `agents.json` korzysta z istniejącego placu.

## Panel kont: KANDYDAT, nie instalowany
**MyAAC** (`slawkens/myaac`), najnowsze stabilne `v1.9.7` (2026-10-28, commit `1ba78166…`), oraz `v2.0-beta`. Quickstart Canary używa gałęzi `develop` w kontenerze. Fork `opentibiabr/myaac` jest nieaktualizowany od 2025-05.

Panel wymaga PHP i dostępu do bazy. Na tym komputerze uruchomienie bez Dockera oznaczałoby wbudowany serwer PHP na 127.0.0.1 i osobny katalog (PHP 8.2.0 jest w XAMPP; samej konfiguracji XAMPP nie wolno zmieniać). Zgodność ze schematem Canary 58 wymaga sprawdzenia. Nie jest to pilne: do testów wystarczają skrypty. Panel ma pozostać lokalny, bez rejestracji z internetu.

## Edycja treści gry
| Co | Gdzie | Uwagi |
| --- | --- | --- |
| Agenci, teksty, punkty, arena | `packages/contracts/agents.json` | wdrożenie: sync + restart |
| Kod agentów w Lua | `game/overlays/tibia-ai/tibia-ai/lib` | self-test w silniku |
| Potwory, przedmioty, wydarzenia | kopie w `game/overlays/tibia-ai/<ścieżka datapacku>` nadpisują pliki `data-canary` | nie edytuj `vendor\` ani `runtime\server\` |
| Polityka modelu | `packages/contracts/local-ai.json` | ADR 0007 |
