# Iteracja 0017 — migracja na prawdziwą mapę (M0)
Data: 2026-10-31 / 2026-11-01
Stan: VERIFIED w prawdziwych klientach, z wyjątkami w sekcji „Ograniczenia”
Commit projektu: niezacommitowane, na gałęzi `feat/player-agents` po `f58b71b`. Upstream: Canary `fe0f932`, OTClient `dd56414`.

## Cel i warunek odbioru
Właściciel: bez Rookgardu i bez bramy poziomu, prawdziwa mapa, start od razu w głównym świecie z profesją. Odbiór według M0 z `DOCS/AI_DESIGN/DELIVERY.md`. Dowody z Montag nie przechodzą na tę mapę.

## Świat i hashe
| Plik | Wartość |
| --- | --- |
| `otservbr.otbm` | v3.6.1, 184 776 037 B, SHA-256 `a80de1dda6a9aca3956a9d5b7fb2e0caebb451570d26853fc21beb40d5f31da2` (`infra/versions.lock.json`) |
| Datapack | `data-otservbr-global` przy `fe0f932` |
| `runtime/atlas/atlas.json` | SHA-256 `3f46b65604e78cc4…` |
| `runtime/atlas/nav-map.jsonl` | SHA-256 `0f7433947925296b…` |
| `game-data.json`, `hunting-grounds.json` | `6b779becffb7024d…`, `d6c121971249fce0…` przy spisaniu; pliki w repozytorium |

Skala: 18 mln pól, 31 miast, 31 477 przejść, 572 szafki, 26 kapitanów. Canary: start 50 s, 1,4 GB RAM. Z Thais w obie strony: 12 miast, 1641 łowisk, 344 stanowiska depo.

## Zmiany
- `infra/versions.lock.json` sekcja `world`, `sync-server.ps1`, `lib.ps1`, `map-dev.ps1`: datapack i mapa z jednego miejsca, mapa poza repozytorium.
- `tools/world_atlas.py`: przejścia liczone offline z OTBM i flagi `unpass` z `appearances.dat`. Skan silnikiem (`survey.lua`) usunięty, bo zająłby wiele GB.
- `tools/make_grounds.py`, `tools/make_boats.py`, `tools/make_shop.py`: łowiska, rejsy i cennik z datapacku. Usunięte `make_spawns.py` i `game/world/`.
- `players/nav.ts`: chunki jako bity, `TileSet`, rejsy z ceną, klucz 16 bitów na oś.
- NPC, testy i skrypty przeniesione z Montag na plac w Thais; `knowledge/thais.json`, `mech-travel`. Stare wspomnienia zostają w bazie, ale `memoryFromMs` odcina je od rozmów.
- Agent mówi do kapitana w oknie NPC. Odmowa kapitana kończy plan.
- `scripts/world-check.ps1`: przegląd podstaw świata.

## Weryfikacja
Testy: `node --test test/*.test.ts` 152/152 PASS, `tsc --noEmit` PASS, `scripts\selftest.ps1` 36/36 PASS. `scripts\verify.ps1 -Client`: NOT RUN.

| Warunek M0 | Wynik | Dowód |
| --- | --- | --- |
| Wejście w Thais | PASS | `world-check-20261031-234011.json`: Knight Sample, 32369,32252,7, ruch, odpowiedź Ardana, relog |
| NPC mają poprawne punkty | PASS | `agent_spawned` wszystkich pięciu, `npc_near`, `npc_visible` |
| Prowadzenie | PASS | `guide_arrives`, `guide_ended outcome=arrived` przy 32369,32250,7; `guide_cancelled`, `guide_no_path` |
| Rejs opłacony rozmową | PASS | Ravn: „Do you seek a passage to Venore for 170 gold?”, „Set the sails!”, złoto 405→235, pozycja 32943,32032,6 |
| Powrót | PASS, pieszo | Ravn wrócił trasą 102 odcinki. Rejs powrotny statkiem: NOT RUN |
| Odmowa kapitana nie wiesza planu | PASS | Yalahar, 22:38:45, plan zakończony |
| Brak gotówki | jednostkowo PASS, w kliencie NOT RUN | `players.test.ts`: trasa nie używa rejsu ponad stan złota |
| Sklep | PASS | Ravn 23:07, handel 6→7, w Thais |
| Depozyt | PASS | Kael 22:36:22, schowane 181 |
| Polowanie | PASS | biegi poniżej |
| Stare dane Montag nie wyznaczają tras | PASS | `places`, `dangerAt`, `chunks`, `stored` wyczyszczone, wspomnienia odcięte `memoryFromMs`, test w `npc.test.ts` |
| Dowody starej mapy | nie przeniesione | historia zostaje w iteracjach 0009–0016 |

Biegi w trzech klientach: `player-run-20261101-000348.json` (10 min, model): Kael +300 exp, 10 zabitych; Sira +94, 13; Ravn +623, 19; 0 śmierci. Wolna pamięć minimum 0,5 GB. `player-run-20261101-000753.json` (4 min, bez modelu): cykl działa, Ravn zginął raz, kupił zapasy.

## Znalezione przyczyny
- Klucz pola miał 15 bitów na oś, a mapa ma współrzędne do 34143: połowa świata była niewidoczna.
- Statek wysadza na polach oznaczonych jako przejście.
- Po `hi` NPC słucha tylko w kanale NPC. Właściciel wskazał to ze zrzutu.
- Pathfinder NPC nie otwiera drzwi, więc cele NPC są przed świątynią, nie w środku.
- `addFloorLinks` i rejs z warunkiem questa: rejsy z warunkiem są pomijane w `boats.json`.

## Ograniczenia / rollback
- Rejs powrotny statkiem i brak gotówki w kliencie: NOT RUN.
- Starsze dzienniki `diary.log` i metryki kumulacyjne zawierają też dane z Montag.
- Część rejsów ma inne warunki w samej akcji, co pokazuje dopiero rozmowa; odmowa jest wtedy obsłużona.
- `4` zapisy `adapter_error` Ravna pochodzą z wersji z błędem `localMessage`, sprzed poprawki.
- Rollback: `infra/versions.lock.json` sekcja `world`; NPC i współrzędne są w gicie.

## Następne zadanie
Iteracja 0018.
