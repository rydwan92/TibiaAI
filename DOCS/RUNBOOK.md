# Runbook: lokalne laboratorium TibiaAI (Windows, natywnie)

Stan: serwer, login-server, Ardan i Brain uruchomione i sprawdzone 2026-10-29. Test GUI klienta: NOT RUN.

## 1. Wymagania
- Windows 10/11 x64, **Windows PowerShell 5.1** (`powershell.exe`). Polecenia wykonujesz w katalogu projektu:
  `C:\xampp\htdocs\projects\tibia\TibiaAIServer`.
- Node **22.18.0** (`.nvmrc`; przy nvm-windows: `nvm use 22.18.0`), pnpm (tylko do testów i typecheck).
- Internet przy pierwszym `setup.ps1`. Później praca jest w pełni offline (tryb rules).
- Nie potrzeba Docker, WSL ani uprawnień administratora (ADR 0003). XAMPP nie jest używany ani modyfikowany.

## 2. Pierwszy start (jednorazowo, ~5 min)
```powershell
cd C:\xampp\htdocs\projects\tibia\TibiaAIServer
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```
Skrypt pobiera artefakty z `infra/versions.lock.json` i sprawdza SHA-256, rozpakowuje je do `vendor\`, buduje login-server, tworzy `.env` z losowymi hasłami, inicjuje MariaDB w `runtime\mariadb`, importuje `schema.sql`, zmienia konto upstream god/god na konto testowe i składa `runtime\server`. Skrypt jest idempotentny, więc można go uruchomić ponownie.

## 3. Codzienna praca
| Cel | Polecenie |
| --- | --- |
| Start całości (DB, login, Canary, Brain) | `powershell -ExecutionPolicy Bypass -File scripts\start.ps1` |
| Start bez Brain | `... scripts\start.ps1 -NoBrain` |
| Tylko Brain | `... scripts\start.ps1 -BrainOnly` |
| Status i kontrola nasłuchu (tylko loopback) | `... scripts\status.ps1` |
| Logi | `... scripts\logs.ps1 -Name canary\|login\|mariadb\|brain\|journal [-Follow]` |
| Dziennik świata dla bieżącej sesji | `python -I tools\journal.py` |
| Stop całości (łagodnie, z zapisem świata) | `... scripts\stop.ps1` |
| Stop bez zatrzymania bazy | `... scripts\stop.ps1 -KeepDb` |
| Stop tylko Brain (gra działa dalej) | `... scripts\stop.ps1 -BrainOnly` |
| Wdrożenie zmian w Lua (`game\overlays\tibia-ai`) | `stop.ps1 -KeepDb`, potem `scripts\sync-server.ps1`, potem `start.ps1` |

`stop.ps1` nie kasuje danych. Canary zamyka się przez `runtime\control\shutdown.request` (globalevent wykonuje `GAME_STATE_SHUTDOWN` z zapisem), MariaDB przez `mariadb-admin shutdown`, a Brain przez `brain-stop.request`. Wymuszone zatrzymanie następuje dopiero po timeoucie.

Adresy (wszystkie 127.0.0.1): MariaDB 3317, HTTP login `http://127.0.0.1:8088/login`, gRPC login-server 9090 (tylko wewnętrznie), Canary 7171 (status/legacy) i 7172 (gra).

## 4. Klient (OTClient 4.1)
1. Assets klienta 15.11 (własność CipSoft, poza repo). Wybierz jedną z opcji:
   - wbudowany downloader OTClient (moduł `client_assets`, źródło `dudantas/tibia-client`, release `15.11.c9d1cf`) proponuje pobranie, gdy brakuje plików. Decyzja o pobraniu należy do Ciebie;
   - albo skopiuj assets własnego klienta Tibia 15.11 do `vendor\otclient\otclient-dd5641492a71e966b96b8a91398b44bb3df67d88\data\things\1511\` (`catalog-content.json`, `appearances-*.dat`, sprite'y, `staticdata`).
2. `powershell -ExecutionPolicy Bypass -File scripts\client.ps1 -CopyPassword` uruchamia klienta, wypisuje wartości i kopiuje hasło do schowka.
3. Na ekranie logowania:
   - Server: `http://127.0.0.1:8088/login`, Port: `8088`, Client version: `1511`, zaznacz **HTTP login**;
   - Email: `tibiaai@localhost` (wpisz email, nie nazwę konta: Canary 3.6.1 szuka konta po email), hasło z `.env` (`TIBIAAI_TEST_PASSWORD`).
4. Postacie: **GOD** (komendy administratora) albo **Knight Sample** (zwykły gracz). Start w świątyni Montag (5010,4998,7).

Rozróżnienie: HTTP login (8088) zwraca tylko listę postaci i adres świata 127.0.0.1:7172. Wejście do gry to osobne połączenie TCP z 7172. Odpowiedź HTTP nie jest dowodem wejścia do gry.

## 5. Ardan: jak go znaleźć i przetestować
- Spawn 5010,5003,7, na południe od świątyni Montag. Trasa `montag_square`: temple_south (5010,5003), square_west (5006,5005), road_south (5010,5009), square_east (5016,5005). Punkt alarmowy: gate_watch (5019,5012).
- Ze świątyni wyjdź na zachód, potem na południe i na wschód przez otwarcie przy x≈4998–5001, y=5001.
- Powitanie: stań do 4 kratek od Ardana i napisz `hi`, `witaj`, `czesc` lub `dzien dobry` na kanale Default. Ardan się zatrzymuje, odwraca i odpowiada. Przy włączonym Brain odpowiedź pochodzi z pamięci („Znowu ty, …”), bez Brain z reguły lokalnej.
- Alarm treningowy (zdarzenie testowe, nie wykrycie potwora):
  - w grze postacią GOD: `/alarm start` i `/alarm clear`;
  - z konsoli: `powershell -ExecutionPolicy Bypass -File scripts\alarm.ps1 start` (oraz `clear`).
- `/ardan status`, `/ardan check` (sprawdza punkty trasy w silniku), `/ardan patrol`.

## 6. Brain i pamięć
- Dane: `runtime\brain\brain.sqlite` (kopia przed każdą migracją: `brain.sqlite.bak-v*`). Log: `runtime\logs\brain.log`.
- Test pamięci: przywitaj Ardana, uruchom `stop.ps1 -BrainOnly`, potem `start.ps1 -BrainOnly` i przywitaj go ponownie. Oczekiwane: „Znowu ty, <imię>. To nasze 2. spotkanie…”.
- Testy: `cd apps\brain; pnpm install; pnpm test; pnpm typecheck`.
- Test mostu na żywym świecie (Brain musi być zatrzymany): `stop.ps1 -BrainOnly`, potem `node --disable-warning=ExperimentalWarning apps\brain\test-integration\bridge.itest.ts`, a na koniec `start.ps1 -BrainOnly`.

## 7. Backup (bez kasowania czegokolwiek)
```powershell
# Świat (MariaDB działa):
# (--result-file zamiast ">", bo PowerShell 5.1 zapisuje przekierowanie w UTF-16)
vendor\mariadb\mariadb-11.4.13-winx64\bin\mariadb-dump.exe --defaults-extra-file=runtime\mariadb\root-client.cnf --result-file=runtime\backup-world.sql tibiaai_canary
# Brain (najlepiej po stop.ps1 -BrainOnly):
Copy-Item runtime\brain\brain.sqlite runtime\backup-brain.sqlite
```
`root-client.cnf` tworzą skrypty (zawiera hasło root, leży w ignorowanym `runtime\`). Restore do osobnej testowej bazy: NOT RUN (TODO).

## 8. Typowe problemy
| Objaw | Przyczyna / rozwiązanie |
| --- | --- |
| `Port 3317/8088/7171/7172 is used` | inny proces na porcie: `Get-NetTCPConnection -LocalPort <port>` |
| „Only protocol version 15.11 or outdated 11.00 is allowed” | klient próbuje TCP login: zaznacz HTTP login i użyj adresu `http://127.0.0.1:8088/login` |
| „Email or password is not correct” w grze, choć lista postaci się pokazała | wpisano nazwę konta zamiast emaila |
| „Things are not loaded, please put assets in things/1511” | brak assets (sekcja 4) |
| Ardan stoi | `python -I tools\journal.py --kinds state_changed,move_failed,controller_error`; `/ardan check` |
| `brainOnline=false` w `runtime\mailbox\world.json` | Brain nie działa albo heartbeat jest starszy niż 5 s; gra działa dalej na regułach Lua |
| Zaległe pliki w `runtime\mailbox\events` | Brain wyłączony; maksymalnie 100 zdarzeń, potem `event_dropped_backpressure` w dzienniku |
| Spam „createFiendishMonsters … no progress” w logu | `data-canary` nie ma potworów; ostrzeżenie upstream, nieszkodliwe |
| XAMPP uruchomiony | `.htaccess` blokuje projekt (403). Nie wyłączaj go bez potrzeby |

## Granice środowiska
Klient Windows łączy się z 127.0.0.1. Kontenerów nie ma. Brain i Canary komunikują się wyłącznie plikami w `runtime\mailbox`. Bazy ani gRPC nie są wystawione poza loopback. Nie używaj globalnych poleceń czyszczących i nie kasuj `runtime\`.
