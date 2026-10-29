# Stan projektu

Aktualizacja: 2026-10-29 (sesja 1, po iteracji 0008). Etap: M1 serwer VERIFIED; M2/M3 VERIFIED w silniku bez GUI; modułowy runtime agentów (dwóch agentów z danych) VERIFIED w silniku. Wejście klienta do gry: NOT RUN (brak assets 15.11).
Repozytorium: https://github.com/rydwan92/TibiaAI (publiczne, gałąź `main`).

## Działa (z dowodem)
| Element | Stan | Dowód |
| --- | --- | --- |
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
| Brain (rules + SQLite + interfejs providera): event → command → wynik, pamięć po restarcie, gra działa bez Brain | VERIFIED headless; 27/27 testów jednostkowych | iteracje 0003, 0004 |

## Nie zrobione / nie sprawdzone
- **Test GUI**: lista postaci w OTClient, wejście, ruch, reconnect, widoczność Ardana i Miry, powitanie z klienta, pamięć spotkania gracza po restarcie Brain w grze. Blokuje go brak assets klienta 15.11. Instrukcja krok po kroku: RUNBOOK §4.1.
- Wyświetlanie polskich znaków w kliencie: nie sprawdzone. Teksty są ASCII i Brain to wymusza.
- `position_observed`, dialog agent ↔ agent, provider LLM (M4): świadomie nie zaczęte. Plotka przekazywana graczowi czeka na test GUI.

## Bieżący stan maszyny (koniec sesji)
Uruchomione: MariaDB, login-server, Canary (sesja świata z Ardanem i Mirą), Brain (`scripts/status.ps1`). Zatrzymanie: `powershell -ExecutionPolicy Bypass -File scripts\stop.ps1`.
Konto testowe: email `tibiaai@localhost`, hasło w `.env` (`TIBIAAI_TEST_PASSWORD`). Postacie: GOD (admin), Knight Sample i inne Sample.
Niezależnie od projektu działa XAMPP użytkownika (Apache :80/:443, MySQL :3306 na wszystkich interfejsach). Nie był modyfikowany.

## Następne pojedyncze zadanie
M1-GUI (iteracja 0006): pobrać assets 15.11 przez wbudowany downloader OTClient (RUNBOOK §4.1: wersja 1511, Login, Download), zalogować się, przejść test „Wejście” i scenariusze Ardana i Miry z TESTING.md.

## Blokery
| Bloker | Kto | Co dokładnie |
| --- | --- | --- |
| Assets klienta Tibia 15.11 | użytkownik | w oknie logowania OTClient wybrać wersję 1511 i kliknąć Login, potem Download (RUNBOOK §4.1), albo skopiować assets własnego klienta 15.11 |
| Docker/WSL2 | użytkownik (opcjonalnie) | włączenie VT-x w BIOS. Niepotrzebne dla obecnego runtime |

## Ważne ustalenia dla kolejnej sesji
- Na start sesji: `scripts\status.ps1`, potem `scriptserify.ps1`. Wszystko powinno być PASS przed nowymi zmianami.
- Gracz loguje się **emailem** i z zaznaczonym HTTP login (TCP 7171 odrzuca 15.11).
- Nowy agent = wpis w `packages/contracts/agents.json` (DOCS/AGENTS.md). Zmiany Lua wprowadzaj w `game/overlays/tibia-ai`. Wdrożenie: `stop.ps1 -KeepDb`, `sync-server.ps1`, `start.ps1`. Nigdy nie edytuj `runtime/server` ani `vendor/`.
- Test mostu wymaga zatrzymanego Brain (`stop.ps1 -BrainOnly`).
- Lista ustaleń o API silnika: COMPATIBILITY.md, sekcja „Ustalenia o API silnika”.
