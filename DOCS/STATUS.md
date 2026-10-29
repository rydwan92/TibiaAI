# Stan projektu

Aktualizacja: 2026-10-29 (koniec sesji 1). Etap: M1 serwer VERIFIED, M2/M3 VERIFIED w silniku bez GUI. Wejście klienta do gry: NOT RUN (brak assets 15.11).

## Działa (z dowodem)
| Element | Stan | Dowód |
| --- | --- | --- |
| Natywny runtime Windows (Docker niemożliwy: wirtualizacja wyłączona w BIOS) | VERIFIED | ADR 0003, `scripts/status.ps1` |
| MariaDB 11.4.13 przenośna, 127.0.0.1:3317, poza XAMPP | VERIFIED | iteracja 0001 |
| Canary v3.6.1 (`fe0f932`), protokół 15.11, `data-canary`, 127.0.0.1:7171/7172 | VERIFIED | `runtime/logs/canary.out.log` |
| login-server `2612930`, HTTP 127.0.0.1:8088, lista postaci | VERIFIED (HTTP, nie wejście do gry) | iteracja 0001 |
| Ochrona przed Apache XAMPP (`.htaccess`, 403) | VERIFIED | iteracja 0001 |
| Start/stop/status/logs bez kasowania danych, łagodny stop z zapisem | VERIFIED | RUNBOOK §3 |
| Ardan: patrol, alarm administratora, ostrzeżenie, powrót, failure zamiast teleportu | VERIFIED w dzienniku silnika | iteracja 0002 |
| Most mailbox Lua ↔ Brain, walidacja w silniku | VERIFIED 11/11 na żywym świecie | iteracja 0003, ADR 0002 |
| Brain (rules + SQLite): event → command → wynik, restart pamięci, gra działa bez Brain | VERIFIED headless; 14/14 testów jednostkowych | iteracja 0003 |

## Nie zrobione / nie sprawdzone
- **Test GUI**: lista postaci w OTClient, wejście, ruch, reconnect, widoczność Ardana, powitanie `hi` z klienta, pamięć spotkania gracza po restarcie Brain w grze. Blokuje go brak assets klienta 15.11 (decyzja użytkownika, RUNBOOK §4).
- Wyświetlanie polskich znaków w kliencie: nie sprawdzone (teksty NPC są bez diakrytyków).
- Restore backupu do osobnej bazy, profil wpływu I/O mailboxa na tick.
- `position_observed`, provider LLM (M4): świadomie nie zaczęte.
- Repo git zainicjowane lokalnie, **nic nie zacommitowano** i nic nie wypchnięto.

## Bieżący stan maszyny (koniec sesji)
Uruchomione: MariaDB, login-server, Canary, Brain (`scripts/status.ps1`). Zatrzymanie: `powershell -ExecutionPolicy Bypass -File scripts\stop.ps1`.
Konto testowe: email `tibiaai@localhost`, hasło w `.env` (`TIBIAAI_TEST_PASSWORD`). Postacie: GOD (admin), Knight Sample i inne Sample.
Niezależnie od projektu działa XAMPP użytkownika (Apache :80/:443, MySQL :3306 na wszystkich interfejsach). Nie był modyfikowany.

## Następne pojedyncze zadanie
M1-GUI: dostarczyć assets 15.11 do `vendor\otclient\otclient-dd5641492a71e966b96b8a91398b44bb3df67d88\data\things\1511\`, zalogować się (RUNBOOK §4), przejść test „Wejście” i scenariusz Ardana z TESTING.md, a wynik zapisać w iteracji 0004.

## Blokery
| Bloker | Kto | Co dokładnie |
| --- | --- | --- |
| Assets klienta Tibia 15.11 | użytkownik | zgoda na wbudowany downloader OTClient (`dudantas/tibia-client`, release `15.11.c9d1cf`) albo skopiowanie assets własnego klienta 15.11 |
| Docker/WSL2 | użytkownik (opcjonalnie) | włączenie VT-x w BIOS. Niepotrzebne dla obecnego runtime |

## Ważne ustalenia dla kolejnej sesji
- Gracz loguje się **emailem** i z zaznaczonym HTTP login (TCP 7171 odrzuca 15.11).
- Zmiany Lua: edytuj `game/overlays/tibia-ai`, potem `stop.ps1 -KeepDb`, `sync-server.ps1` i `start.ps1`. Nigdy nie edytuj `runtime/server` ani `vendor/`.
- Test mostu wymaga zatrzymanego Brain (`stop.ps1 -BrainOnly`).
- Lista ustaleń o API silnika: COMPATIBILITY.md, sekcja „Ustalenia o API silnika”.
