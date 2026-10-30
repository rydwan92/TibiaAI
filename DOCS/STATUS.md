# Stan projektu

Aktualizacja: 2026-10-30 (po iteracji 0011). Etap: M1 **VERIFIED w prawdziwym kliencie**; M2/M3 VERIFIED; M4 (lokalny model, dialog) VERIFIED w grze; walka przez klienta VERIFIED jako eksperyment.
Repozytorium: https://github.com/rydwan92/TibiaAI (publiczne, gałąź `main`).

## Działa (z dowodem)
| Element | Stan | Dowód |
| --- | --- | --- |
| **Wejście do świata w prawdziwym kliencie**: logowanie, postacie, ruch, powitanie, ponowne wejście | VERIFIED 10/10 | iteracja 0009, `scripts/client-autotest.ps1` |
| **Walka według mechaniki gry przez klienta** (kolizje, obrażenia, mikstura, cooldown, atak, śmierć) | VERIFIED 13/13 (eksperyment) | ADR 0006, iteracja 0010 |
| **Lokalny model w dialogu** (tylko Ollama, bez chmury, fallback na reguły) | VERIFIED w grze | ADR 0007, iteracja 0011 |
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
| Jedno polecenie weryfikacji `scripts/verify.ps1` (6 kroków) + CI GitHub Actions dla Brain | VERIFIED lokalnie 6/6; CI success (run 40970632174) | iteracja 0008 |
| Self-test Lua w Canary | VERIFIED 24/24 | `scripts/selftest.ps1` |
| Koszt naszych GlobalEventów zmierzony (most śr. 0,8–1,3 ms, maks. 12 ms; ~0,3% dispatchera) | VERIFIED (pomiar) | ADR 0002, iteracja 0006 |
| Oś decyzji (obserwacja → decyzja → wykonanie → skutek) | VERIFIED na żywym alarmie | `apps/brain/src/cli/timeline.ts`, iteracja 0005 |
| Backup + sprawdzony restore do osobnej bazy; retencja mailboxa; rotacja logów | VERIFIED | `scripts/backup.ps1`, `scripts/restore-test.ps1`, iteracja 0005 |
| Brain (rules + SQLite + interfejs providera): event → command → wynik, pamięć po restarcie, gra działa bez Brain | VERIFIED; 39/39 testów jednostkowych | iteracje 0003, 0004 |

## Nie zrobione / nie sprawdzone
- Agent bojowy sterowany z Brain (adapter `client_player`): PLAN. Dziś walkę prowadzi skrypt w kliencie.
- Scenariusz „spotkanie i trening na arenie”: PLAN.
- Runy i czary przez klienta, rozłączenie w trakcie walki w adapterze: niesprawdzone.
- Edytor mapy: kandydat, pełny przebieg NOT RUN. Panel MyAAC: kandydat, nie instalowany (TOOLING).
- Plotka Miry przez model i alarm wywołany z gry: w kliencie NOT RUN. Polskie znaki w kliencie: niesprawdzone (teksty ASCII, Brain to wymusza).
- `position_observed`, dialog agent ↔ agent, handel, questy: świadomie nie zaczęte.

## Bieżący stan maszyny
Serwer **nie startuje sam po restarcie komputera**. Uruchomienie: `scripts\client.ps1 -CopyPassword` (RUNBOOK, początek). Zatrzymanie: `scripts\stop.ps1`.
Konto gracza: email `tibiaai@localhost`, hasło w `.env` (`TIBIAAI_TEST_PASSWORD`). Postacie `Knight Sample`, `GOD` startują przy placu w Montag.
Konto eksperymentu: `kael@localhost`, postać Kael (test bojowy; jej poziom i przedmioty zmieniają się w testach).
`.env`: `TIBIAAI_BRAIN_PROVIDER=local-model`. Model zajmuje 9,5 GB VRAM przez 10 minut od ostatniego użycia.
Mapa: aktywna kopia `runtime\maps\canary.otbm`, identyczna z oryginałem (`scripts\map-dev.ps1 -Status`).
Kod iteracji 0009–0011 nie jest zacommitowany ani wypchnięty, chyba że historia git mówi inaczej. Niezwiązany pusty plik użytkownika: `commands/powershell.txt`.

## Następne pojedyncze zadanie
Adapter `client_player`: jeden agent (Kael) sterowany z Brain na arenie, z zaproszeniem w rozmowie i komentarzem do rzeczywistego wyniku walki.

## Decyzje użytkownika
| Temat | Co jest potrzebne |
| --- | --- |
| Lepszy model do dialogu | Zgoda na pobranie i wybór, np. `qwen3.5:4b` lub `gemma4:12b` (ADR 0007). Obecny model do kodu jest lakoniczny |
| Blokada chmury całej Ollamy | Opcjonalnie `OLLAMA_NO_CLOUD=1` (RUNBOOK §6) |
| Edytor mapy i arena | Ręczny przebieg z TOOLING |
| Sprzęt | Faktycznie 15,9 GB RAM, nie 32 GB |

## Ważne ustalenia dla kolejnej sesji
- Na start sesji: `scripts\status.ps1`, potem `scripts\verify.ps1`. Wszystko powinno być PASS przed nowymi zmianami.
- Gracz loguje się **emailem** i z zaznaczonym HTTP login (TCP 7171 odrzuca 15.11).
- Nowy agent = wpis w `packages/contracts/agents.json` (DOCS/AGENTS.md). Zmiany Lua wprowadzaj w `game/overlays/tibia-ai`. Wdrożenie: `stop.ps1 -KeepDb`, `sync-server.ps1`, `start.ps1`. Nigdy nie edytuj `runtime/server` ani `vendor/`.
- Test mostu wymaga zatrzymanego Brain (`stop.ps1 -BrainOnly`).
- Podczas `client-autotest` nie klikaj w okno klienta; ręczne wejście fałszowało wyniki (ADR 0006).
- Lista ustaleń o API silnika: COMPATIBILITY.md, sekcja „Ustalenia o API silnika”.
