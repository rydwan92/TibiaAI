# ADR 0004: agenci opisani danymi, jedno źródło definicji
Status: ACCEPTED (2026-10-29)

## Kontekst
Po iteracji 0003 zachowanie Ardana było zapisane w kodzie Lua (`ardan_config.lua`, `ardan_controller.lua`). Allowlistę Brain trzymaliśmy osobno w `allowlist.json`, a zgodność obu miejsc pilnował test porównujący tekst Lua. Każdy nowy NPC wymagałby nowego kodu w dwóch językach.

## Decyzja
- `packages/contracts/agents.json` to jedyne źródło definicji agentów: nazwa NPC, wygląd, spawn, punkty, trasy, typ zachowania (`patrol` | `stationary`), reakcja na alarm (strefy, punkt docelowy, krzyk, interwał ostrzeżeń), słowa powitania, teksty persony oraz globalne parametry czasu i limity.
- `scripts/sync-server.ps1` kopiuje plik do `runtime/server/data-canary/tibia-ai/agents.json`. Lua czyta go przy ładowaniu skryptów (`io.open` + własny dekoder JSON) i rejestruje typy NPC (`Game.createNpcType`) ze skryptu. Potwierdzone w źródle: katalog `npc/` jest ładowany tym samym `g_scripts().loadScripts`, a callbacki NpcType zawsze używają interfejsu `g_scripts` (`npc_type_functions.cpp:388`).
- Kod Lua jest generyczny: `registry` (definicje i stan agentów), `movement` (wykonawca ruchu), `agent_controller` (maszyna stanów sterowana danymi), `npc_types`, `bridge`, `startup`, `talkactions`.
- Brain czyta ten sam plik (`apps/brain/src/agents.ts`). Walidacja komend używa punktów i tras agenta z definicji. Provider dostaje profil agenta, a reguły wypełniają szablony tekstów.
- Nowy agent = nowy wpis w `agents.json` (+ restart świata). Kod się nie zmienia, o ile zachowanie mieści się w istniejących typach.

## Konsekwencje
- Znika `allowlist.json` i test porównujący tekst Lua. Zastępuje je walidacja definicji (Brain: test schematu; Lua: błędy definicji trafiają do dziennika `agent_definition_invalid`, a agent nie jest spawnowany).
- Zmiana definicji wymaga `sync-server.ps1` i restartu Canary oraz restartu Brain.
- Teksty w grze i w Brain pochodzą z jednego miejsca.
- Nowy rodzaj zachowania (np. eskorta, walka) nadal wymaga kodu: nowego typu w `agent_controller` i ADR.

## Alternatywy
- Generowanie plików Lua z JSON podczas synchronizacji: dodatkowy krok i dwa formaty w runtime. Odrzucone, bo Lua i tak ma dekoder JSON.
- Definicje w Lua czytane przez Brain: parsowanie Lua w TypeScript jest kruche. Odrzucone.
