# Architektura

## Stan wdrożenia (2026-10-30, po iteracji 0011)
Granice agenta i ciało bojowe: ADR 0006. Lokalny model: ADR 0007. Narzędzia: TOOLING.md.
Komponenty działają natywnie na Windows, bez Compose (ADR 0003). Bridge to mailbox plików (ADR 0002). Agenci są opisani danymi (ADR 0004). MyAAC nie jest używany: konto tworzy `scripts/setup.ps1`, logowanie obsługuje login-server.

```
packages/contracts/agents.json   jedno źródło definicji agentów, timing, limity, akcje
game/overlays/tibia-ai/          overlay na data-canary (kopiowany przez scripts/sync-server.ps1)
  scripts/tibia-ai/init.lua      jedyny plik auto-ładowany; dofile modułów w stałej kolejności
  tibia-ai/lib/
    core.lua         JSON, dziennik world-journal.jsonl, zapis atomowy, szablony
    registry.lua     walidacja definicji, stan agentów, wyszukiwanie po npcId
    movement.lua     wykonawca ruchu (Npc:move + getPathTo), weryfikacja punktów, skan mapy
    controller.lua   generyczna maszyna stanów; typy zachowań (patrol, stationary); alarm; powitanie; komendy
    bridge.lua       mailbox: zdarzenia, komendy, wyniki, world.json, heartbeat, backpressure
    npc_types.lua    rejestracja NpcType z definicji (bez sklepu, walki i losowego chodzenia)
    startup.lua      worldSessionId, spawn agentów, waypoint_check
    control.lua      pliki runtime/control/*.request (shutdown, alarm, selftest, scan)
    arena.lua        kontroler scenariusza areny, jawne wyjątki developerskie
    talkactions.lua  /alarm, /ai (grupa god)
    selftest.lua     testy Lua wykonywane w Canary
apps/brain/src/
  agents.ts          rejestr agentów (ten sam agents.json), walidacja
  contracts.ts       kontrakt v1: envelope, event, command, result, world.json
  actions.ts         rejestr akcji z capabilities
  providers/         Provider, RulesProvider, LocalModelProvider, polityka local-only
  memory.ts          SQLite (node:sqlite): obserwacje, spotkania, komendy, wyniki, migracje
  mailbox.ts         pliki mailbox po stronie Node
  retention.ts       przycinanie katalogów archiwum mailboxa
  timeline.ts        oś decyzji z dziennika świata i logu Brain (czyste funkcje)
  brain.ts, main.ts  pętla 250 ms, heartbeat, harmonogram intencji, retencja co 10 min
  cli/               timeline.ts (odczyt), sqlite-tool.ts (backup/check SQLite)
scripts/             setup, sync-server, start, stop, status, logs, client, alarm, selftest, scan, backup, restore-test
tools/               journal.py, otbm_towns.py, otclient-autotest/ (test prawdziwego klienta)
infra/versions.lock.json  przypięte artefakty z SHA-256
runtime/, vendor/    ignorowane: dane, logi, mailbox / pobrane upstream
```

Zależności między modułami Lua idą w jedną stronę: `core` ← `registry` ← `movement` ← `controller` ↔ `bridge` (wywołania w czasie zdarzeń, nie przy ładowaniu). Kod nie zawiera nazw konkretnych agentów. Testy są w `apps/brain/test*` (jeden pakiet, bez workspace) i w `selftest.lua`. `game/patches/` nie istnieje, bo upstream nie był modyfikowany.

Opis poniżej to pierwotny projekt. Rozbieżności z wdrożeniem zostały opisane powyżej i w ADR.

## Komponenty
| Komponent | Odpowiedzialność | Dane |
| --- | --- | --- |
| OTClient na Windows | Obraz, sterowanie graczem, rozmowa | Zgodne assets; bez kluczy modelu |
| Canary | Autorytatywny świat, pozycje, kolizje, akcje | MariaDB gry |
| Adapter Lua | Percepcja w zasięgu, executor akcji, fallback | Stan krótkotrwały i session ID |
| Bridge | Bounded transport event/command/result | Kolejka limitowana, deduplikacja |
| Brain Node/TypeScript | Cele, rules provider, później LLM | SQLite pamięci i zdarzeń |
| Login-server / MyAAC | Logowanie i konto zgodnie z wybranym zestawem | MariaDB; Brain nie dotyka tabel gry |

OTClient łączy się z login-server i Canary. Canary adapter wymienia wiadomości z Brain przez wybrany bridge. Brain czyta i zapisuje tylko SQLite. Wywołanie modelu jest poza procesem gry. Brak odpowiedzi powoduje kontynuację lokalnej maszyny stanów.

## Kontroler
Warstwa szybka w Lua: ruch, zatrzymanie, cooldown, walidacja, lokalny patrol i reakcja awaryjna. Warstwa wolna w Brain: wybór intencji, rozmowa i pamięć. LLM nie wybiera każdego kroku. Po przyjęciu nowego planu starsze polecenia są anulowane przez planRevision. Jeden aktywny plan ruchu na agenta.

Na start stany IDLE → PATROL → ALERT → RETURN → PATROL, z lokalnym STOP oraz timeoutem ruchu. Przejścia mają tabelę warunków i priorytety: stop/nieprawidłowa jednostka > alarm > rozmowa > patrol. Nie zakładaj, że npc:move(direction) jest pełnym pathfinderem. Trasa i zachowanie blokady wymagają osobnego wykonawcy.

## Transport: bramka decyzyjna
Preferowany: potwierdzony asynchroniczny adapter request/response z callbackiem wykonania na wątku świata. Nie znaleziono tu dowodu gotowego ogólnego HTTP Lua z odpowiedzią; sprawdzony Webhook.sendMessage takiej odpowiedzi nie zwraca.

Fallback MVP: lokalny mailbox w dedykowanym współdzielonym katalogu, jeśli sandbox Lua i runtime pozwalają na I/O. Oddzielne skrzynki event/command/result, pliki JSON z limitem 16 KiB, max 10 odczytów na tick poll i limit całej kolejki 100. Interwał pilotażowo 500 ms, pomiar czasu wykonania; producent zapisuje tymczasowy plik i atomowo zmienia nazwę w tym samym filesystemie. Konsument odbiera przez rename, waliduje, przenosi do processed albo quarantine; żadnych ścieżek dostarczonych przez model. Udowodnij semantykę rename na wybranym Windows/WSL/mouncie. To prosty most lokalny, nie transport skalowalny ani gwarancja exactly-once.

Jeśli I/O powoduje opóźnienia lub jest niedostępne, zapisz ADR dla asynchronicznego C++ bridge z ograniczoną kolejką. Nie używaj tabel gry jako magistrali. NPC Lua działa również przed implementacją mostu.

## Pamięć
SQLite: agents, encounters, observations, commands, action_results, schema_migrations. Stabilny agentKey (ardan); playerGuid ze świata. Creature runtime ID jest tylko chwilowym uchwytem. Zapisuj eventId, source, observedAt, expiresAt, worldSessionId. Unikalność eventId i commandId; transakcje, migracje, kopia przed migracją. Pamięć „gracz twierdzi X” nie staje się faktem X. Po restarcie trwałe wspomnienia zostają, stare polecenia ruchu wygasają. Na początek jawne fakty i zapytania SQL, bez embeddingów.

## Struktura docelowa
- apps/brain/src/{domain,providers,memory,transport,telemetry}
- packages/contracts/ — schematy i przykłady testowe
- game/overlays/tibia-ai/ — nasze Lua i deklaracje NPC
- game/patches/ — tylko uzasadnione zmiany upstream
- infra/ — Compose, konfiguracja i plik wersji
- scripts/ — doctor, start, stop, status, smoke, backup
- tests/{contracts,integration,fixtures}
- runtime/ — ignorowane bazy, mailbox, logi
- vendor/ — ignorowane albo jawnie przypięte upstream; bez przypadkowego zagnieżdżenia repo
- DOCS/ — jedno źródło dokumentacji, zgodne z istniejącym katalogiem użytkownika

Nie twórz pustych abstrakcji dla każdego przyszłego modułu. Użyj pnpm workspace dopiero gdy istnieją rzeczywiście współdzielone pakiety. Start może być jednym pakietem TypeScript.

## Model i koszty
Provider interface: rules (domyślny), później jeden z Ollama lub Anthropic API. Model opcjonalny; nie należy do warunków pierwszego startu. Wybór lokalnego modelu po sprawdzeniu RAM/VRAM. API dopiero z kluczem i zaakceptowanym budżetem. Limity początkowe do strojenia: jedna prośba naraz na NPC, cooldown 10 s, timeout 5 s, limit długości kontekstu i odpowiedzi, licznik użycia; osiągnięcie limitu przełącza rules. Nie interpretuj tych wartości jako wyników benchmarku. Nie używaj sesji Claude Code jako backendu gry.
