# Źródła i wnioski — sprawdzone 29.10.2026

To rozpoznanie dokumentacji i kodu, nie test lokalnego uruchomienia. Wersje dynamicznych stron trzeba sprawdzić ponownie przy instalacji.

## Podstawa projektu
1. Canary: https://github.com/opentibiabr/canary
   C++20/Lua, repo obejmuje silnik, datapacki, schema i narzędzia. Preferowany kandydat.
2. Quickstart: https://github.com/opentibiabr/canary/blob/main/docs/docker/quickstart-for-beginners.md
   Opisuje Docker bez lokalnej kompilacji, MariaDB, Canary, MyAAC i osobny login-server. Pierwszy start pobiera również mapę. Adresy panelu i loginu są oddzielne.
3. Compose: https://github.com/opentibiabr/canary/blob/main/docker/docker-compose.yml
   Odczyt wykazał floating latest, ref MyAAC 2.x i mapowania ports bez jawnego 127.0.0.1. Nasz projekt ma przypiąć wersje i ograniczyć publikację do loopback. Nie kopiować bez sprawdzenia.
4. Release: https://github.com/opentibiabr/canary/releases/tag/v3.6.1
   API releases/latest zwróciło v3.6.1 (publikacja 2026-07-01). Dostępne Windows, Linux, macOS, Docker ZIP oraz mapa. Opis release wskazuje klienta 15.11; main opisuje 15.25. To rozbieżność do rozwiązania, nie gotowy zestaw.
5. Klient: https://github.com/opentibiabr/otclient
   Dawny adres https://github.com/mehah/otclient przekierowuje tu. README zawiera tabelę obsługiwanych protokołów, w tym TFS i Canary; zgodność konkretnej konfiguracji nadal wymaga testu.
6. Pliki do pobrania klienta: https://github.com/opentibiabr/otclient/releases
   Wybierz wydanie/artefakt wskazany przez projekt i zapisz checksum. Nie zakładaj automatycznie zgodności ostatniej binarki ze starszym serwerem.
7. Konfiguracja klienta: https://github.com/opentibiabr/otclient/wiki/Tutorial-to-use-OTC-in-Canary-main
   Instrukcja opisuje assets i protokół 1525; zawiera przykłady login.php. Obecny quickstart Canary używa osobnego login-server. Należy zastosować kontrakt logowania wybranego środowiska, nie kopiować przykładu bez adaptacji.
8. Alternatywa: https://github.com/otland/forgottenserver
   TFS jako kandydat po udokumentowanym blokerze Canary. Bez mieszania skryptów między silnikami.

## Potwierdzone fragmenty kodu
- https://github.com/opentibiabr/canary/blob/main/src/lua/functions/creatures/npc/npc_functions.cpp
  Odczyt zawiera bindingi Npc.say, move i follow. move przyjmuje kierunek; nie dowodzi gotowego move_to ani zachowania na dowolnej trasie. Sprawdzić ponownie na przypiętej wersji.
- https://github.com/opentibiabr/canary/blob/main/src/lua/functions/core/network/webhook_functions.cpp
  Webhook.sendMessage jest wysyłką wiadomości, binding zwraca nil. Nie jest potwierdzeniem ogólnego klienta HTTP z odpowiedzią dla Brain. Nie dowiedziono też braku wszystkich innych możliwości — potrzebny eksperyment transportu.

## Weryfikacja na przypiętych commitach (2026-10-29, sesja 1)
- Canary v3.6.1 = commit `fe0f932c380583871ce640a32628d397d3fa02ff`, `src/core.hpp: CLIENT_VERSION = 1511`. To rozwiązuje rozbieżność 15.11/15.25: 15.25 dotyczy main, release to 15.11.
- `src/server/network/protocol/protocollogin.cpp` (v3.6.1): TCP login przyjmuje tylko 11.00 (`allowOldProtocol`). Klient 15.11 dostaje „Only protocol version 15.11 or outdated 11.00 is allowed”, więc HTTP login jest konieczny.
- opentibiabr/login-server: release'y binarne pochodzą z 2021 (v1.1.3). Commit `2612930de4…` (2026-05-22) jest ostatnim przed v3.6.1. Main od 2026-10-23 („enforce TOTP… opaque session”) jest niezweryfikowany z 3.6.1. `LOGIN_IP` wiąże HTTP i gRPC z podanym adresem.
- OTClient 4.1 = commit `dd5641492a…`. Release zawiera tylko `otclient.exe` (+pdb), a `data/`, `modules/` i `init.lua` pochodzą ze źródeł tego commita. Moduł `client_assets` pobiera assets z `dudantas/tibia-client` (repo bez licencji; zasoby CipSoft).
- Lua: `luaL_openlibs` (`src/lua/functions/lua_functions_loader.cpp:38`) daje `io`/`os`; brak ogólnego HTTP w Lua (ADR 0002).
- Zachowanie NPC: `Npc::manageIdle` (think tylko przy graczu), `Npc::onThinkWalk` (`walkInterval == 0` wyłącza losowy ruch), `Npc::isInSpawnRange` (brak spawnu oznacza brak teleportu), `Map::getPathMatching` + `Creature::getNextStep` (lista kroków od końca), `CreatureFunctions::luaCreatureMove` (`FLAG_NOLIMIT`).

## Fora i narzędzia
- https://www.mpcforum.pl/forum/9-tibia/ — wskazany dział działa; odsyła do OTS i „Silniki, mapy itp.”. Dobre miejsce na polskie dyskusje, nie źródło zweryfikowanego kompletnego zestawu dla tego projektu.
- https://otland.net/ — działy Support, Downloads, Data Packs, Maps, Tools i odnośniki do poradników OTS/Lua. Przy problemie szukaj po wersji silnika i treści błędu.
- https://github.com/opentibiabr/remeres-map-editor/ — edytor map wskazany przez Canary; wybór wersji po przypięciu assets. Dziś wystarczy fragment dostępnej mapy.
- https://github.com/Arch-Mina/Assets-Editor — narzędzie wskazane przez Canary; późniejsza praca z assets, nie warunek pierwszego NPC.

## Pobieranie
Preferuj release i źródła utrzymywane przez autorów. Zapisuj URL, tag/commit, datę i hash. Nie ma tu rekomendacji niezweryfikowanego gotowca z forum. Klient, jego kod, grafiki i mapa to osobne elementy; do naszego repo trafia manifest pochodzenia, nie cudze paczki assets. Jeśli zasobów brakuje, Claude ma podać dokładną wymaganą wersję i oczekiwane pliki, zamiast pobierać przypadkowy klient.
