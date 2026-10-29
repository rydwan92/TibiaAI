# Iteracja 0001: środowisko, zgodny zestaw i natywny runtime (M0 + serwerowa część M1)
Data: 2026-10-29
Stan: serwer VERIFIED; wejście klienta do gry BLOCKED (assets) / NOT RUN (GUI)
Commit projektu: brak (repo zainicjowane lokalnie `git init`, nic nie zacommitowano)
Upstream: Canary v3.6.1 `fe0f932`, login-server `2612930`, OTClient 4.1 `dd56414`, MariaDB 11.4.13 (sumy w `infra/versions.lock.json`)

## Cel i warunek odbioru
Cel zapisany przed pracą: rozpoznać komputer, wybrać jeden zgodny zestaw Canary + OTClient, uruchomić lokalnie bazę i serwer.
Kryterium: wersje i sumy w COMPATIBILITY; baza, Canary i mapa startują; porty wyłącznie na 127.0.0.1; powtarzalne start/stop/status/logs bez kasowania danych; RUNBOOK. Wejście do gry wymaga testu GUI.

## Rozpoznanie środowiska
| Pozycja | Wynik |
| --- | --- |
| System | Windows 10 Education 10.0.19045 x64, sesja lokalna (nie zdalna, nie kontener) |
| CPU / RAM / GPU | i5-10600 (6C/12T) / 15,9 GB (wolne ~2,3 GB w chwili pomiaru) / RTX 3060 |
| Dysk C: | 118,9 GB wolne |
| Wirtualizacja | „Virtualization Enabled In Firmware: No”, `HypervisorPresent=False` |
| Docker / WSL | Docker brak; `wsl.exe` to stub bez dystrybucji, więc Docker i WSL2 są zablokowane bez zmiany BIOS (ADR 0003) |
| Node / pnpm / git / gh | Node 22.18.0 (nvm4w; dostępne też 22.23.3 i 20.16.0), pnpm 12.4.1, git 2.45.1, gh zalogowany |
| XAMPP | Apache `Listen 80`, `DocumentRoot C:/xampp/htdocs`, `AllowOverride All`, `Options Indexes`. W trakcie sesji użytkownik uruchomił Apache (:80/:443 na 0.0.0.0) i MySQL 10.4.27 (:3306 na `::`). Nie dotykaliśmy ich |
| Ryzyko Apache | Projekt był dostępny pod `http://<host>/projects/tibia/TibiaAIServer/`. Dodano `.htaccess` (`Require all denied`). Sprawdzono: 403 dla `/`, `/.env`, `/DOCS/STATUS.md`, `/runtime/server/config.lua`, `/scripts/setup.ps1`, `/vendor/` |
| Inne usługi | Ollama nasłuchuje na 127.0.0.1:11434 (kandydat na późniejszy provider M4, nie używany) |

## Zmiany
- `.gitignore`, `.htaccess`, `.env.example`, `.nvmrc` (sekrety tylko w ignorowanym `.env`, generowane losowo).
- `infra/versions.lock.json`: URL, commit i SHA-256 każdego artefaktu.
- `scripts/lib.ps1`, `setup.ps1`, `sync-server.ps1`, `start.ps1`, `stop.ps1`, `status.ps1`, `logs.ps1`, `client.ps1`.
- `tools/otbm_towns.py`: odczyt miast i świątyń z OTBM (wybór współrzędnych).

## Kluczowe ustalenia
1. Release v3.6.1 ma natywną binarkę Windows (statyczną) i `CLIENT_VERSION=1511`, zgodne z opisem release „Tibia Client 15.11”. 15.25 dotyczy main, więc nie mieszamy.
2. `data-canary` + `canary.otbm` są w źródłach przy tym samym commicie: mała mapa, 1 NPC, bez potworów, start ~1–7 s, ~235 MB RAM.
3. TCP login (7171) w 3.6.1 odrzuca 15.11, więc potrzebny jest HTTP login. Release'y login-server pochodzą z 2021 r., a main z 2026-10-23 wprowadza opaque session/TOTP. Wybrano commit `2612930` (2026-05-22), ostatni przed v3.6.1, zbudowany lokalnie.
4. Gra szuka konta po **emailu** (dla protokołu innego niż 11.00), login-server po email lub nazwie. Gracz musi więc podać email.
5. Klucz RSA serwera = `OTSERV_RSA` klienta (porównany moduł).
6. `Start-Process -RedirectStandardOutput` dziedziczy uchwyty potoku wywołującego, przez co narzędzia czekają bez końca. Przekierowanie przeniesiono do `cmd.exe` (`Start-Detached`).

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| SHA-256 wszystkich artefaktów = digest GitHub / MariaDB API | PASS | `sha256sum` (wartości w lock) |
| `setup.ps1` (init DB, schema, konto) | PASS | log konsoli; ponowne uruchomienie idempotentne |
| Canary start: protokół 15.11, DB, datapack, „TibiaAI server online!” | PASS | `runtime/logs/canary.out.log` |
| Nasłuch tylko na loopback (3317, 8088, 9090, 7171, 7172) | PASS | `scripts/status.ps1` + `Get-NetTCPConnection` |
| HTTP login: poprawne hasło daje 7 postaci, błędne `errorCode 3` | PASS | POST `http://127.0.0.1:8088/login` (hasło nie było logowane) |
| Łagodny stop (zapis świata) | PASS | log: „Saving server… Server saved… Shutting down…”, 3,6 s |
| Apache nie serwuje projektu | PASS | 403 (lista wyżej) |
| Lista postaci w OTClient, wejście, ruch, reconnect | NOT RUN | brak assets 15.11 i testu GUI |

Polecenia (bez sekretów): `scripts\setup.ps1`, `scripts\start.ps1`, `scripts\status.ps1`, `scripts\stop.ps1 -KeepDb`, `curl -X POST http://127.0.0.1:8088/login`.

## Dokumentacja
STATUS, COMPATIBILITY, RUNBOOK, SOURCES, ARCHITECTURE; ADR 0003 (runtime natywny), ADR 0001 → ACCEPTED z modyfikacjami.

## Ograniczenia / rollback
- `runtime/` zawiera bazę i logi: nie kasować. Rollback kodu polega na usunięciu dodanych plików; dane zostają.
- Nie zweryfikowano GUI klienta ani wyświetlania polskich znaków (teksty NPC są bez diakrytyków).
- XAMPP MySQL nasłuchuje na `::`:3306 (wszystkie interfejsy). To konfiguracja użytkownika spoza projektu, tylko odnotowana.

## Następne zadanie
Dostarczyć assets 15.11 i wykonać test GUI: lista postaci → wejście → ruch → reconnect.
