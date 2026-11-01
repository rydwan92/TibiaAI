# Stan projektu

Aktualizacja: 2026-11-01 (iteracja 0023). Kamienie milowe: `MILESTONES.md`. Wizja: `STEVIUM_PRODUCT_VISION.md`, postęp: `VISION_PROGRESS.md`. **Świat: prawdziwa mapa `otservbr`, start w Thais (M0, iteracja 0017).** Etap: M1 **VERIFIED w prawdziwym kliencie**; M2/M3 VERIFIED; M4 (lokalny model, dialog) VERIFIED w grze; **NPC z tożsamością, pamięcią i relacjami VERIFIED w kliencie**; **przewodnik, lekcja i pierwsze zlecenie VERIFIED w kliencie**; walka przez klienta VERIFIED jako eksperyment; **autonomiczni gracze-agenci VERIFIED w prawdziwych klientach**.
Repozytorium: https://github.com/rydwan92/TibiaAI (publiczne, gałąź `main`).

## Dowody na aktualnej mapie (Thais)
| Element | Stan | Dowód |
| --- | --- | --- |
| Wejście, ruch, NPC, relog w kliencie | VERIFIED | `world-check-20261031-234011.json` |
| Prowadzenie: dotarcie, anulowanie, brak drogi | VERIFIED | iteracja 0017 |
| Rejs statkiem opłacony rozmową (Thais–Venore) | VERIFIED; rejs powrotny NOT RUN | iteracja 0017 |
| Sklep, depozyt, polowanie, odmowa kapitana | VERIFIED | iteracja 0017 |
| Niezawodny odbiór zdarzeń (R01), restart Brain, śmierć z relogiem | VERIFIED | iteracja 0018 |
| Trzy klienty z modelem i bez modelu | VERIFIED, biegi 10 i 4 min | `player-run-20261101-000348.json`, `-000753.json` |
| Miejscówki, wybór z własnych wyników | VERIFIED | iteracja 0019 |
| Luna i Haiku na modelach z konta GitHub, budżet kredytów | VERIFIED, 3 biegi | iteracja 0020, ADR 0011, `scripts\ai-budget.ps1` |
| Czary od nauczycieli, potwierdzone przez serwer | VERIFIED: Luna u Gregora | iteracja 0020 |
| Pamięć o osobie po restarcie Brain | VERIFIED: `[wspomnien: 5]` | iteracja 0020 |
| Agent dyskutuje z propozycją, NPC na modelu z konta, Notka | VERIFIED w kliencie | iteracja 0021 |
| Pójście za człowiekiem, plotki, wspólny exp w drużynie | IMPLEMENTED, testy | iteracja 0021, w kliencie NOT RUN |
| Bieg 40 min, 6 postaci, 0 śmierci | VERIFIED | `player-run-20261101-024003.json` |
| Powrót postaci po restarcie serwera, przekonania, przerwy | VERIFIED w grze | iteracja 0021 |
| Bieg 45 min, 6 postaci, 0 śmierci | VERIFIED | `player-run-20261101-041258.json` |
| Postać pisze pierwsza po przerwie i pamięta wyprawę, prowadzi człowieka po argumencie | VERIFIED po stronie klienta człowieka | iteracja 0022 |
| Żart PvP z odwetem, rozmowy o wydarzeniach, najazd z datapacku | VERIFIED w kliencie | iteracja 0022 |
| Własne miejsce na mapie (Plac Stevium) | VERIFIED w silniku | iteracja 0022 |
| Kompresja pamięci | VERIFIED na kopii prawdziwej bazy | `memory-rehearsal-20261101-101445.json` |
| Zakup i założenie lepszego sprzętu | VERIFIED w grze | Kael, `worn` slot 1 = 3375, iteracja 0022 |
| Rejs do nowego miasta | VERIFIED: Haiku do Carlin | iteracja 0023 |
| Postacie z innych miast, poziomy 50 i 100 | VERIFIED: wejście, sprzęt, pierwsze decyzje | iteracja 0023; exp na tych poziomach NOT RUN |
| Dobór łowisk do poziomu, popędy, próby strategii, listy między miastami | IMPLEMENTED, testy | iteracja 0023, w grze częściowo NOT RUN |
| Strażnik po awarii, obserwacja za zgodą | IMPLEMENTED, testy | iteracja 0022, w grze NOT RUN |
| Self-test Lua 36/36 (iteracja 0019), testy 269/269 | VERIFIED | `scripts\selftest.ps1`, `apps/brain` |
| `verify -Client`, bieg 30–60 min, kolejka modelu R07 | NOT RUN | |

Tabela niżej to dowody zebrane **na poprzedniej mapie (Montag)**. Zostają jako historia i nie są dowodem Thais, chyba że wiersz wyżej mówi inaczej.

## Działa (z dowodem)
| Element | Stan | Dowód |
| --- | --- | --- |
| **Wejście do świata w prawdziwym kliencie**: logowanie, postacie, ruch, powitanie, ponowne wejście | VERIFIED 10/10 | iteracja 0009, `scripts/client-autotest.ps1` |
| **Autonomiczni gracze-agenci** (Kael, Sira, Ravn): logują się sami, polują, zbierają łup, zmieniają piętra, giną i wracają, wybierają cele przez model | VERIFIED w 3 klientach, bieg 20 minut | ADR 0010, PLAYER_AGENTS.md, iteracja 0014, `runtime/evidence/player-run-*.json` |
| **Współpraca agentów**: VIP, prywatne rozmowy w zakładkach, rady i ostrzeżenia, wołanie o pomoc, wspólna wyprawa z rozstaniem | VERIFIED w klientach | `diary.log`, `player-run-20261031-190818.json`, iteracja 0014 |
| **Życie gracza**: sklep u Miry, wpłata i wypłata z depo, samodzielny powrót po zapasy, kontrola i odkupienie ekwipunku, liny, łopaty, dziury, lekcje po śmierci | VERIFIED w klientach | iteracje 0015, 0016, `player-run-20261031-221403.json` |
| **Świat PvP**: ataki między graczami, urazy, reakcja na atak, blokada strefy ochronnej | VERIFIED jako mechanika; świadoma walka do śmierci NOT RUN | iteracja 0015 |
| **Bezpieczna pamięć**: kompresja bez utraty i bez mieszania prywatnych treści, atomowe skutki, numer polecenia bez dziur | IMPLEMENTED, testy z atrapą | `npc.test.ts`, `brain.test.ts`, BACKLOG.md |
| **Późne włączenie modelu** bez restartu Brain | VERIFIED | `model_recovered`, iteracja 0015 |
| **Cała mapa jako graf** (dane Montag; Thais w iteracji 0017) | zastąpione | | `tools/world_atlas.py`, `nav.ts` |
| Własne spawny Montag | zastąpione spawnami datapacku | iteracja 0017 |
| **Walka według mechaniki gry przez klienta** (kolizje, obrażenia, mikstura, cooldown, atak, śmierć) | VERIFIED 13/13 (eksperyment) | ADR 0006, iteracja 0010 |
| **Rozmowa z NPC przez lokalny model**: pamięć imienia i zawodu po relogu i restarcie, rozróżnianie postaci po GUID, incydent widziany tylko przez świadków, odporność na próby wymuszenia | VERIFIED w prawdziwym kliencie | ADR 0008, iteracja 0012, `scripts/npc-scenario.ps1` |
| **Przewodnik**: prośba → start → marsz → potwierdzone dotarcie; anulowanie, zostanie w tyle, alarm, wylogowanie, brak drogi; drugi profil przez konfigurację | VERIFIED w kliencie, wynik z dziennika silnika | ADR 0009, `npc-scenario.ps1` |
| **Pierwsze zlecenie**: list od Miry do Broma, przedmiot i 50 złota z silnika, stan w postaci, zaufanie po potwierdzeniu | VERIFIED w kliencie, baza: złoto, stan 3, brak listu | `tasks.json`, iteracja 0013 |
| **Dwóch graczy naraz** na dwóch klientach: jeden marsz, drugi gracz odrzucony, jego „stop” nie przerywa cudzego marszu | VERIFIED | `npc-two-players.ps1` |
| **Lena**: lekcja na żądanie, poziom po restarcie, koniec lekcji, polskie zdania nie są poprawiane | VERIFIED w kliencie | iteracja 0013 |
| **Rozmowa o rzeczywistym świecie** (polityka `open`): quiz 8–10/10, przed zmianą 5/10 | VERIFIED, jakość zależy od modelu | `ollama.itest.ts` |
| **Znacznik `[AI]`** oddzielony od `agentKey`, uczciwa odpowiedź na pytanie o AI | VERIFIED w kliencie | ADR 0009 |
| **Status AI** bez zapytań do modelu | VERIFIED | `scripts/ai-status.ps1` |
| Wiedza agentów ze źródłami: mechanika tej wersji, mapa, lore | VERIFIED, 5–6 pytań quizu na 6 | `knowledge/`, NPC_RUNTIME.md |
| Warstwy NPC (świat, rola, wariant, tożsamość), dwa warianty roli strażnika (Ardan, Brom) | VERIFIED w kliencie | `packages/contracts/npc/`, NPC_RUNTIME.md |
| Prawdziwa inferencja `ornith-1.5:9b`: 33/33 poprawnej struktury, P50 2,2 s, kontekst do 1145 tokenów | VERIFIED (bez klienta) | `test-integration/ollama.itest.ts` |
| Skutki pamięci dopiero po potwierdzeniu silnika, jeden adresat, spóźnione odpowiedzi odrzucane | VERIFIED w grze | `brain.log`: `addressee_gone`, `superseded_by_fallback` |
| Awaria modelu w trakcie gry: reguły w 0,6–1 s, powrót bez restartu Brain | VERIFIED w kliencie | iteracja 0012 |
| Kompresja pamięci, retencja, limity | IMPLEMENTED, testy z atrapą i prawdziwy model na bazie tymczasowej; w działającej bazie jeszcze nie wystąpiła | `npc.test.ts`, iteracja 0012 |
| Local-only: osobny proces Ollamy z `OLLAMA_NO_CLOUD=1`; blokadę zgłasza sam serwer w `GET /api/status`, bez wywołania modelu chmurowego | VERIFIED | ADR 0007, 0008, `scripts/ollama.ps1` |
| Rejestr akcji z capabilities, arena jako kontroler scenariusza | IMPLEMENTED, testy | ADR 0006 |
| Natywny runtime Windows (Docker niemożliwy: wirtualizacja wyłączona w BIOS) | VERIFIED | ADR 0003, `scripts/status.ps1` |
| MariaDB 11.4.13 przenośna, 127.0.0.1:3317, poza XAMPP | VERIFIED | iteracja 0001 |
| Canary v3.6.1 (`fe0f932`), protokół 15.11, `data-canary`, 127.0.0.1:7171/7172 | VERIFIED | `runtime/logs/canary.out.log` |
| login-server `2612930`, HTTP 127.0.0.1:8088, lista postaci | VERIFIED (HTTP, nie wejście do gry) | iteracja 0001 |
| Ochrona przed Apache XAMPP (`.htaccess`, 403) | VERIFIED | iteracja 0001 |
| Start/stop/status/logs bez kasowania danych, łagodny stop z zapisem | VERIFIED | RUNBOOK §3 |
| Agenci z jednego `agents.json` (Lua + Brain), generyczne moduły Lua | VERIFIED w silniku | iteracja 0004, ADR 0004, AGENTS.md |
| Ardan: patrol, alarm, ostrzeżenie, powrót, failure zamiast teleportu | VERIFIED w dzienniku | iteracje 0002, 0004 |
| Mira (tylko dane): stoi przy stoisku, przy alarmie chowa się w świątyni, wraca | VERIFIED w dzienniku | iteracja 0004 |
| Most mailbox Lua ↔ Brain, walidacja w silniku, wielu agentów | VERIFIED 14/14 na żywym świecie | iteracja 0004 |
| Agenci słyszą się w zasięgu; Brain pamięta „X powiedział Y” z pochodzeniem; brak odpowiedzi agent↔agent (zalążek M5) | VERIFIED w silniku | ADR 0005, iteracja 0007 |
| Jedno polecenie weryfikacji `scripts/verify.ps1` (+ `-Client`, `-Model`) + CI GitHub Actions dla Brain | VERIFIED 9/9 z `-Client -Model`; CI success (run 41199794386, commit `ad36d78`) | iteracja 0012 |
| Self-test Lua w Canary | VERIFIED 36/36, także po świecie PvP | `scripts/selftest.ps1` |
| Koszt naszych GlobalEventów zmierzony (most śr. 0,8–1,3 ms, maks. 12 ms; ~0,3% dispatchera) | VERIFIED (pomiar) | ADR 0002, iteracja 0006 |
| Oś decyzji (obserwacja → decyzja → wykonanie → skutek) | VERIFIED na żywym alarmie | `apps/brain/src/cli/timeline.ts`, iteracja 0005 |
| Backup + sprawdzony restore do osobnej bazy; retencja mailboxa; rotacja logów | VERIFIED | `scripts/backup.ps1`, `scripts/restore-test.ps1`, iteracja 0005 |
| Brain (rules + SQLite + interfejs providera): event → command → wynik, pamięć po restarcie, gra działa bez Brain | VERIFIED; 269/269 testów jednostkowych | iteracje 0003, 0004, 0012, 0014 |

## Nie zrobione / nie sprawdzone
- W kliencie NOT RUN: zobowiązanie NPC, kompresja danych starszych niż 7 dni, blokada drogi w połowie marszu. Prywatny pokaz przez VPN: przygotowany, NOT RUN. Porównanie `bonsai-2:9b`: NOT RUN.
- Gracze-agenci: brak nauczycieli, więc zestaw po śmierci i czary to wyjątek deweloperski. Runa w walce i rozmowa agenta z NPC: w kliencie NOT RUN. `verify -Client` po przejściu na świat PvP: NOT RUN. Pełna lista zadań z przeglądu: BACKLOG.md.
- Scenariusz „spotkanie i trening na arenie”: PLAN.
- Rozłączenie w trakcie walki w adapterze: niesprawdzone.
- Edytor mapy: kandydat, pełny przebieg NOT RUN. Panel MyAAC: kandydat, nie instalowany (TOOLING).
- Plotka Miry przez model i alarm wywołany z gry: w kliencie NOT RUN. Polskie znaki w kliencie: niesprawdzone (teksty ASCII, Brain to wymusza).
- `position_observed`, dialog agent ↔ agent, handel: świadomie nie zaczęte.

## Bieżący stan maszyny
Serwer **nie startuje sam po restarcie komputera**. Uruchomienie: `scripts\client.ps1 -CopyPassword` (RUNBOOK, początek). Zatrzymanie: `scripts\stop.ps1`.
Konto gracza: email `tibiaai@localhost`, hasło w `.env` (`TIBIAAI_TEST_PASSWORD`). Postacie `Knight Sample`, `GOD` startują w Thais.
Konto eksperymentu: `kael@localhost`, postać Kael (test bojowy; jej poziom i przedmioty zmieniają się w testach). Sira i Ravn mają własne konta; hasła w `.env`.
Świat ma `worldType = "pvp"`. Gracze-agenci grają w roli gracza (`identity` w `players.json`), więc przed wpuszczeniem kogokolwiek innego trzeba go uprzedzić. Nie startują sami: `scripts\player-agents.ps1 -Start`, koniec `-Stop`. Przy 3 klientach i modelu wolnego RAM zostaje nawet 0,7 GB.
`.env`: `TIBIAAI_BRAIN_PROVIDER=local-model`. `ornith-1.5:9b` zajmuje 5,2 GB VRAM przez 30 minut od ostatniego użycia, w osobnym procesie na 127.0.0.1:11435.
Klienta uruchamiaj przez `scripts\client.ps1`: instaluje limit 60 FPS, bez którego model zwalnia pięciokrotnie.
Baza Brain zawiera dane z testów: Ardan zna `Knight Sample` jako Marka (iteracja 0012).
Mapa: `vendor/downloads/otservbr-v3.6.1/otservbr.otbm`, hash w `infra/versions.lock.json`. `scripts\map-dev.ps1` tworzy kopię deweloperską.
Kod do iteracji 0023 jest na `main` i na GitHubie; dokładny commit pokazuje historia git. Niezwiązany pusty plik użytkownika: `commands/powershell.txt`, poza repozytorium.

## Następne pojedyncze zadanie
Bieg ze strażnikiem przez noc: czy próby zmieniają zachowanie, ile exp robią poziomy 50 i 100, przejście przez zapis o 06:00 (S3, S6 w `MILESTONES.md`).

## Decyzje użytkownika
| Temat | Co jest potrzebne |
| --- | --- |
| Kierunek gry | GAME_DIRECTION.md: gra publiczna wymaga własnych grafik, mapy i nazwy |
| Lepszy model do dialogu | Zgoda na pobranie `bonsai-2:9b` do porównania |
| Edytor mapy i arena | Ręczny przebieg z TOOLING |
| Sprzęt | Faktycznie 15,9 GB RAM, nie 32 GB |

## Ważne ustalenia dla kolejnej sesji
- Na start sesji: `scripts\status.ps1`, potem `scripts\verify.ps1`. Wszystko powinno być PASS przed nowymi zmianami.
- Gracz loguje się **emailem** i z zaznaczonym HTTP login (TCP 7171 odrzuca 15.11).
- Nowy agent = wpis w `packages/contracts/agents.json` (DOCS/AGENTS.md). Zmiany Lua wprowadzaj w `game/overlays/tibia-ai`. Wdrożenie: `stop.ps1 -KeepDb`, `sync-server.ps1`, `start.ps1`. Nigdy nie edytuj `runtime/server` ani `vendor/`.
- Test mostu wymaga zatrzymanego Brain (`stop.ps1 -BrainOnly`).
- Podczas `client-autotest` nie klikaj w okno klienta; ręczne wejście fałszowało wyniki (ADR 0006).
- Lista ustaleń o API silnika: COMPATIBILITY.md, sekcja „Ustalenia o API silnika”.
