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
| Datapack i mapa | `data-otservbr-global` ze źródeł przy tym samym commicie + `otservbr.otbm` z wydania v3.6.1 (184 776 037 B, SHA-256 `a80de1dda6a9aca3956a9d5b7fb2e0caebb451570d26853fc21beb40d5f31da2`). Plik leży w `vendor/downloads/`, poza repozytorium; `infra/versions.lock.json`, sekcja `world`. Do iteracji 0016 świat działał na `data-canary` + `canary.otbm`. |
| Login-server | opentibiabr/login-server @ `2612930de4d97123a397f8f2cd0d5f784094af40` (ostatni przed v3.6.1); źródło sha256 `d0524f49…`; zbudowany `login-server.exe` sha256 `f08696c0…` | log: „http: 127.0.0.1:8088 \| gRPC: 127.0.0.1:9090”; POST /login zwraca 7 postaci |
| Go (tylko build) | 1.27.3 windows-amd64, sha256 `f26081f4…` | `go version` |
| MariaDB | 11.4.13 winx64 ZIP, sha256 `d62986d4…` (z REST API MariaDB), port 3317 | `scripts/status.ps1` |
| MyAAC | nieużywany (logowanie przez login-server, konto tworzy `setup.ps1`) | — |
| OTClient | opentibiabr/otclient tag `4.1` → commit `dd5641492a71e966b96b8a91398b44bb3df67d88`. `otclient.exe` z `otclient-windows-cmake-release.zip` (sha256 `8ca7a802…`) + moduły ze źródeł tego commita (sha256 `366b1403…`) | obsługuje 1511 (`modules/gamelib/game.lua:64`); RSA serwera = `OTSERV_RSA` |
| Assets klienta 15.11 | Pobrane przez wbudowany downloader OTClient (`dudantas/tibia-client`, `15.11.c9d1cf`), 5810 plików, 112 MB, w ignorowanym `vendor/…/data/things/1511/`. Własność CipSoft; nie dołączamy ich do repo | `appearances` = serwer, SHA-256 `5997985a…`; rendering na zrzucie |
| Ollama | 0.32.3; lokalny `qwen2.5-coder:14b` (Q4_K_M, 9,5 GB, 100% GPU) | `ollama list`, `/api/tags`, ADR 0007 |
| Sprzęt | RAM 15,9 GB, RTX 3060 12 GB, sterownik 581.80 | `nvidia-smi`, CIM |
| Node / pnpm | Node 22.18.0 (`.nvmrc`, `engines >=22.18 <23`), pnpm 12.4.1. Jedyna zależność runtime: `@github/copilot-sdk` 1.0.28, ładowana dopiero gdy włączone `TIBIAAI_CLOUD_AI=1`; dev: typescript 5.9.3, @types/node 22.18.13 | `pnpm install`, `tsc --noEmit` |
| GitHub Copilot | SDK 1.0.28 (npm, MIT), CLI 1.0.105, konto `rydwan92`, autoryzacja przez `gh`. Modele `gpt-6-luna`, `claude-haiku-5.5`; koszt 10/50 kredytów za milion tokenów | `listModels`, `assistant.usage`, ADR 0011 |
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
- Postać po zerwaniu połączenia zostaje w świecie. `players_online` odświeża się co 10 minut (`UPDATE_PLAYERS_ONLINE_DB`, `game.hpp:74`), a wpis może zostać po śmierci postaci, więc skrypty pytają o obecność silnik, nie tę tabelę.
- Miasta na tej mapie mają inne numery: Thais to 8, Rookgaard 3. Wszystkie postacie laboratorium mają `town_id = 8`.
- `Creature:remove()` na graczu wylogowuje go z zapisem.
- OTClient z opcją „max” klatek renderuje bez limitu nawet przy włączonym vsync. Na wspólnej karcie spowalnia to model z 46 do 9 tok/s; limit do 60 FPS usuwa problem. `client_options` nadpisuje `g_app.setMaxFps` przy starcie, więc limit trzeba ustawić po załadowaniu opcji.
- `npc:getPathTo` potrafi chwilowo nie zwrócić drogi do osiągalnego miejsca, co zaobserwowano u NPC tuż po poprzednim marszu. Brak drogi nie jest więc dowodem blokady, dopóki nie utrzyma się przez kilka tików.
- `Game.createNpcType` i `Game.createNpc` przyjmują nazwy z nawiasami (`Ardan [AI]`). OTClient pokazuje taką nazwę nad postacią i w czacie.
- `Creature:setIcon` istnieje w tym commicie; obsługa w OTClient niesprawdzona, nieużywane.
- Ollama 0.32.3: `GET /api/status` zwraca `{"cloud":{"disabled":true,"source":"env"}}`. `/api/tags` instancji z `OLLAMA_NO_CLOUD=1` nadal wymienia modele chmurowe z `remote_host`, więc sama lista niczego nie dowodzi.
- Spawny, NPC, domy i strefy pochodzą z `data-otservbr-global/world/`. Własnych spawnów już nie generujemy.
- `Player:addItem(id, count, canDrop, subType, slot)`: przy czterech lub więcej argumentach `count` to liczba **osobnych** przedmiotów. Jeden stos 100 strzał to `addItem(id, 1, true, 100, slot)`; inaczej w slocie ląduje jedna sztuka.
- `Tile(pos)` buduje pole z pamięci podręcznej mapy. Na tej mapie (18 mln pól) skan silnikiem zająłby wiele GB, dlatego `tools/world_atlas.py` liczy przejścia z OTBM i flagi `unpass` z `appearances.dat`. Przekrój Thais zgadza się z `scan.ps1`, z odchyleniem na pojedynczych polach.
- Canary na tej mapie: start 50 s, 1,4 GB RAM.
- Łuk i kusza biorą amunicję wyłącznie z kołczanu w prawej ręce (`Player::getQuiverAmmoOfType`). Slot amunicji nic im nie daje, a strzały nie mają tam wstępu bez `enablePlayerPutItemInAmmoSlot`; przy `canDrop=true` lądują na ziemi.
- Kupione strzały lądują w plecaku. `g_game.equipItemId(strzała, 0)` przy kołczanie w prawej ręce przekłada stos do kołczanu (`Game::playerEquipItem`). Ten sam `equipItemId` na założonej rzeczy ją zdejmuje.
- Czary wymagają nauki: bez `player:learnSpell` serwer odpowiada „You need to learn this spell first”.
- Komunikat „A wolf loses 21 hitpoints due to an attack by Kael” dociera do wszystkich obok. O ataku na siebie mówi tylko „You lose ...”.
- OTClient startuje z wyłączonym trybem bezpiecznym; agent ustawia `g_game.setSafeFight(true)` po każdym wejściu.
- Po ataku na gracza strefa ochronna jest zamknięta przez `pzLocked` (60 s): „You can not enter a protection zone after attacking another player”.
- Sklep NPC: maska `shop` w `npcType:register`, `npc:openShopWindow(player)`, `onBuyItem` z `npc:sellItem`. W kliencie `onOpenNpcTrade(items)`, gdzie `item[1]` to przedmiot, `[4]` cena kupna, `[5]` cena sprzedaży; `onPlayerGoods(money, goods)`.
- Depozyt: szafka (`type="depot"`, 3497–3500) → `depot chest` 3502 → `depot box I` 22797; każde otwiera się przez `g_game.open(item, container)`.
- Teleporty i rejsy nie zawsze mają powrót, dlatego Brain liczy zbiór pól z drogą w obie strony.
- Po `hi` NPC słucha tylko w kanale NPC: `sendMessage(tekst, getTab("NPCs"))` albo `talkPrivate(NpcTo, "NPCs", tekst)`. Tekst z Local Chat kończy rozmowę.
- Statek wysadza czasem na polu oznaczonym w mapie jako przejście; lądowanie w grafie wybiera pole obok.
- Poniżej poziomu 21 serwer daje „adventurer's blessings”: postać nie traci ekwipunku przy śmierci.
- Współrzędne prawdziwej mapy sięgają 34143, więc klucze pól w Brain używają pełnych 16 bitów na oś. Mniejszy klucz po cichu łączy różne pola.
- Teleporty są w OTBM jako atrybut 8 przedmiotu z `type="teleport"` w `items.xml`.
- OTClient: `g_game.addVip`, zdarzenia `onAddVip` i `onVipStateChange`, `g_game.follow`, `modules.game_console.addTab` i `sendMessage(text, tab)` potwierdzone w `dd56414`. `g_game.talkPrivate` sam nie pokazuje linii w zakładce nadawcy, robi to konsola.
- Potwory mówią trybami `MonsterSay` i `MonsterYell`, a ich nazwa przychodzi w `onTalk` jak nazwa gracza; filtr jest w ciele agenta i w umyśle.
- Puste flaszki po miksturach można wyłączyć per postać: `player:kv():set("talkaction.potions.flask", true)`, to samo robi `!flask on`.
- Player:addItem(id, count, false) zwraca nil, gdy przedmiot się nie mieści; przy `true` upuszcza go na ziemię. Stan zleceń jest w storage 47100+ (zakres zarezerwowany zaczyna się od 10000000).
- Zatrzymanie `ollama.exe` nie kończy potomnego `llama-server.exe`: zostaje on sierotą z załadowanym modelem. Ollama 0.32.3 w tej konfiguracji.

- `globalServerSaveShutdown` w `config.lua.dist` jest domyślnie `true`: serwer wyłącza się po zapisie o 06:00. U nas `false`.
- Mapa z `world/custom` zastępuje pola mapy głównej. Nagłówek ostatniego wczytanego pliku ustawia wymiary mapy, więc nasze pliki mają wymiary `otservbr.otbm`.
- `items.xml` nie ma `slotType` dla zbroi; miejsce noszenia jest w `script="moveevent"`, atrybut `slot`.
- Sklep odpowiada `Bought 0x <przedmiot>`, gdy postać nie uniesie zakupu; okno handlu nie zgłasza błędu.
- `player:addItem` z podanym, zajętym miejscem i `canDropOnMap` kładzie przedmiot na ziemię.
- `getInventoryCount` w kliencie daje 0 dla nierozkładalnych przedmiotów w plecaku; `equipItemId` i tak działa.
- NPC z datapacku wymagają powitania `hi`, a dopiero potem `trade` na kanale NPC.

## Do weryfikacji
Polskie znaki w kliencie, runy i czary, współbieżność kilku klientów-agentów.
