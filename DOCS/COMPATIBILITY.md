# Zgodność: zestaw przypięty 2026-10-29

Stan: serwer i klient **VERIFIED** (2026-10-30): logowanie, lista postaci, wejście, ruch, widoczność NPC, walka, ponowne wejście w prawdziwym kliencie. Dowód: iteracje 0009 i 0010.
Maszynowe przypięcie: `infra/versions.lock.json`. Pliki pobierane są do `vendor/downloads` (ignorowany), a SHA-256 sprawdza `scripts/setup.ps1`.

| Element | Wartość potwierdzona lokalnie | Jak potwierdzono |
| --- | --- | --- |
| Źródła Canary | tag `v3.6.1` → commit `fe0f932c380583871ce640a32628d397d3fa02ff` (obiekt taga `a9366a3…`) | `gh api git/ref/tags/v3.6.1` + `git/tags/…` |
| Binarka Canary | `canary-windows-cmake-release.zip`, sha256 `7a7a7985…a89f93` = digest release | `sha256sum`; log: „Canary - Version 3.6.1”, „Compiled … Jul 1 2026” |
| Protokół | 15.11 (`CLIENT_VERSION = 1511` w `src/core.hpp`) | log: „Server protocol: 15.11” |
| Logowanie | **HTTP** przez login-server. TCP 7171 odrzuca 15.11 (`protocollogin.cpp`: „Only protocol version 15.11 or outdated 11.00 is allowed” dla klienta innego niż 1100) | odczyt źródła |
| `authType` | `password`: klucz sesji = `email\nhasło`, gra szuka konta **po email** | `protocolgame.cpp:871`, `account_repository_db.cpp:33` |
| Datapack i mapa | `data-canary` + `data-canary/world/canary.otbm` (19,7 MB) ze źródeł przy tym samym commicie. Nie używamy `otservbr.otbm` (pobrany, sha256 `a80de1dd…`, poza runtime) | log: „Loading datapack scripts on folder: data-canary/” |
| Login-server | opentibiabr/login-server @ `2612930de4d97123a397f8f2cd0d5f784094af40` (ostatni przed v3.6.1); źródło sha256 `d0524f49…`; zbudowany `login-server.exe` sha256 `f08696c0…` | log: „http: 127.0.0.1:8088 \| gRPC: 127.0.0.1:9090”; POST /login zwraca 7 postaci |
| Go (tylko build) | 1.27.3 windows-amd64, sha256 `f26081f4…` | `go version` |
| MariaDB | 11.4.13 winx64 ZIP, sha256 `d62986d4…` (z REST API MariaDB), port 3317 | `scripts/status.ps1` |
| MyAAC | nieużywany (logowanie przez login-server, konto tworzy `setup.ps1`) | — |
| OTClient | opentibiabr/otclient tag `4.1` → commit `dd5641492a71e966b96b8a91398b44bb3df67d88`. `otclient.exe` z `otclient-windows-cmake-release.zip` (sha256 `8ca7a802…`) + moduły ze źródeł tego commita (sha256 `366b1403…`) | obsługuje 1511 (`modules/gamelib/game.lua:64`); RSA serwera = `OTSERV_RSA` |
| Assets klienta 15.11 | Pobrane przez wbudowany downloader OTClient (`dudantas/tibia-client`, `15.11.c9d1cf`), 5810 plików, 112 MB, w ignorowanym `vendor/…/data/things/1511/`. Własność CipSoft; nie dołączamy ich do repo | `appearances` = serwer, SHA-256 `5997985a…`; rendering na zrzucie |
| Ollama | 0.32.3; lokalny `qwen2.5-coder:14b` (Q4_K_M, 9,5 GB, 100% GPU) | `ollama list`, `/api/tags`, ADR 0007 |
| Sprzęt | RAM 15,9 GB, RTX 3060 12 GB, sterownik 581.80 | `nvidia-smi`, CIM |
| Node / pnpm | Node 22.18.0 (`.nvmrc`, `engines >=22.18 <23`), pnpm 12.4.1. Brain bez zależności runtime; dev: typescript 5.9.3, @types/node 22.18.13 | `pnpm install`, `tsc --noEmit` |
| Bridge | mailbox JSON (ADR 0002) | test integracyjny 11/11 |
| Docker / obrazy | nie dotyczy: wirtualizacja wyłączona w BIOS (ADR 0003) | `systeminfo` |

## Wersja kodu a wersja działającej binarki
Kod Lua/datapack pochodzi ze źródeł `fe0f932`, a binarka z release `v3.6.1` zbudowanego z tego samego taga (workflow release „materialize tags”). Nie łączymy skryptów main z binarką release. Lokalnych zmian w upstream nie ma: nasze pliki są w `game/overlays/tibia-ai` i nakłada je `scripts/sync-server.ps1`.

## Ustalenia o API silnika (v3.6.1), ważne dla agentów
- `Npc:move(dir)` → `internalMoveCreature` bez flag, czyli z kolizjami. `Creature:move(dir)` używa `FLAG_NOLIMIT`, więc go nie używamy.
- `Creature:getPathTo(...)` zwraca kierunki **od końca**: pierwszy krok to ostatni element (`Creature::getNextStep` bierze `listWalkDir.back()`).
- NPC dostaje `onThink` tylko wtedy, gdy widzi go gracz (`Npc::manageIdle`). Kontroler Ardana działa więc na własnym `GlobalEvent` co 1 s.
- NPC z `Game.createNpc` nie ma spawnu, więc `isInSpawnRange` nie teleportuje go do pozycji startowej.
- `walkInterval = 0` wyłącza losowe chodzenie (`Npc::onThinkWalk`).
- `Game.createNpcType` + `NpcType:register` działają z dowolnego skryptu datapacku. Katalog `npc/` ładuje ten sam `g_scripts().loadScripts`, a callbacki zawsze wiążą się z interfejsem `g_scripts` (`npc_type_functions.cpp:388`). Zweryfikowane: Ardan i Mira rejestrowani z `agents.json`.
- `DATA_DIRECTORY` (globalne z `data/core.lua`) i `dofile` (biblioteka bazowa LuaJIT) pozwalają ładować moduły spoza skanowanych katalogów w ustalonej kolejności. Revscript (`GlobalEvent`, `TalkAction`) rejestrowany w czasie takiego `dofile` działa.

- `Game::playerUseWithCreature` kolejkuje kolejne użycie mikstury do końca cooldownu (1000 ms), a nie odrzuca go.
- Forge zamienia potwory w Fiendish co 10 s (HP ×3,6). W konfiguracji laboratorium wyłączone (`forgeInfluencedLimit`, `forgeFiendishLimit` = 0).
- Postać po zerwaniu połączenia zostaje w świecie; `players_online` odświeża się co minutę.
- Postacie Sample z `schema.sql` startują w Strongarm (miasto 8), a agenci są w Montag (miasto 1).
- `Creature:remove()` na graczu wylogowuje go z zapisem.

## Do weryfikacji
Polskie znaki w kliencie, runy i czary, współbieżność kilku klientów-agentów.
