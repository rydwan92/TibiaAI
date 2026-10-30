# Runbook: lokalne laboratorium TibiaAI (Windows, natywnie)

Stan: serwer, login-server, agenci, Brain i wejście prawdziwym klientem sprawdzone 2026-10-30.

**Po restarcie komputera serwer nie działa.** Najprostszy start całości i klienta (z dowolnego katalogu):
```powershell
powershell -ExecutionPolicy Bypass -File C:\xampp\htdocs\projects\tibia\TibiaAIServer\scripts\client.ps1 -CopyPassword
```
„Failed to connect to server (HTTP)” w kliencie oznacza zwykle zatrzymany serwer. Sprawdź `scripts\status.ps1`.

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
| Wdrożenie zmian w Lua (`game\overlays\tibia-ai`) lub w `packages\contracts\agents.json` | `stop.ps1 -KeepDb`, potem `scripts\sync-server.ps1`, potem `start.ps1` (sync odmawia, gdy Canary działa) |
| Self-test Lua w działającym Canary | `... scripts\selftest.ps1` |
| Kopia mapy deweloperskiej | `... scripts\map-dev.ps1 -Init` / `-Status` / `-Reset` (DOCS/TOOLING.md) |
| **Wszystkie weryfikacje bez GUI** (unit, typecheck, self-test, most, backup, restore) | `... scripts\verify.ps1` (`-SkipLive` bez świata) |

`stop.ps1` nie kasuje danych. Canary zamyka się przez `runtime\control\shutdown.request` (globalevent wykonuje `GAME_STATE_SHUTDOWN` z zapisem), MariaDB przez `mariadb-admin shutdown`, a Brain przez `brain-stop.request`. Wymuszone zatrzymanie następuje dopiero po timeoucie.

Adresy (wszystkie 127.0.0.1): MariaDB 3317, HTTP login `http://127.0.0.1:8088/login`, gRPC login-server 9090 (tylko wewnętrznie), Canary 7171 (status/legacy) i 7172 (gra).

## 4. Klient (OTClient 4.1)
Assets klienta 15.11 (grafiki, mapa przedmiotów) należą do CipSoft i nie trafiają do repo. OTClient 4.1 ma wbudowany downloader (moduł `client_assets`). Pobiera on pliki z `dudantas/tibia-client`, tag `15.11.c9d1cf` (manifest `assets.json` + ok. 1000 plików w `assets/`), do `vendor\otclient\otclient-dd5641492a71e966b96b8a91398b44bb3df67d88\data\things\1511\`. Pobieranie startuje **dopiero przy próbie logowania z wersją 1511**, nie przy uruchomieniu klienta.

### 4.1 Pobranie assets przez klienta (krok po kroku)
1. Serwer musi działać: `powershell -ExecutionPolicy Bypass -File scripts\status.ps1` pokazuje `canary RUNNING` i `login RUNNING`. Jeśli nie, uruchom `scripts\start.ps1`.
2. Uruchom klienta: `powershell -ExecutionPolicy Bypass -File scripts\client.ps1 -CopyPassword` (hasło trafia do schowka).
3. Przy starcie pojawi się okno **„Blad / Unable to load dat file … /data/things/0/Tibia.dat”**. To normalne przy pierwszym uruchomieniu: klient nie ma jeszcze wybranej wersji. Kliknij **Ok**.
4. Otworzy się okno **Enter Game**. Jeśli go nie widać, kliknij ikonę logowania na górnym pasku albo naciśnij `Ctrl+G`. Pole **Client Version** to lista rozwijana na dole okna.
5. Wypełnij w tej kolejności:
   - **Client Version**: wybierz `1511` z listy (domyślnie bywa `860` albo inna wartość);
   - **Server**: skasuj zawartość i wpisz `http://127.0.0.1:8088/login`;
   - **Port**: `8088`;
   - zaznacz **Enable HTTP login**;
   - **Acc Name / Email**: `tibiaai@localhost` (email, nie nazwa konta);
   - **Password**: wklej ze schowka (`Ctrl+V`).
6. Kliknij **Login**. Pojawi się okno **„Missing Assets: Assets for client 15.11 are not installed. Download them now?”**. Kliknij **Download**.
7. Pojawi się pasek postępu. Pobieranych jest ponad 1000 plików z GitHub; dokładnego rozmiaru nie zmierzyłem (same pliki z katalogu `assets/` widoczne przez API to ok. 29 MB), więc czas zależy od łącza. Nie zamykaj klienta.
8. Po zakończeniu klient sam ponawia logowanie i pokazuje listę postaci. Wybierz **Knight Sample** (zwykły gracz) albo **GOD** (admin) i kliknij **Ok**.

Sprawdzenie, czy pliki są na miejscu: w katalogu `...\data\things\1511\` powinny być `catalog-content.json`, `assets.json.sha256` i pliki `appearances-*.dat`, `sprites-*.bmp.lzma`, a po udanej instalacji także `.client-assets-complete`.

### 4.2 Gdy pobieranie się nie udaje
| Objaw | Co zrobić |
| --- | --- |
| Brak okna „Missing Assets” po kliknięciu Login | sprawdź, czy wybrana jest wersja `1511` (dla wersji < 1281 downloader się nie włącza) |
| „Another asset download is already running.” | zamknij i uruchom klienta ponownie |
| Błąd sieci / timeout / „No assets source found” | sprawdź dostęp do `api.github.com` i `raw.githubusercontent.com` (proxy, firewall, antywirus); limit API GitHub bez logowania to 60 zapytań/h, więc odczekaj i spróbuj ponownie |
| „Assets were downloaded but the client files are still incomplete” | usuń katalog `data\things\1511` i powtórz pobieranie |
| Szczegóły błędu | plik `vendor\otclient\otclient-dd5641492a71e966b96b8a91398b44bb3df67d88\otclient.log` (linie z `client_assets`) |

Alternatywa bez downloadera: skopiuj zawartość katalogu `assets` z własnej instalacji klienta Tibia **15.11** do `...\data\things\1511\`.

### 4.3 Po wejściu do gry
Postacie: **GOD** (komendy administratora) albo **Knight Sample** (zwykły gracz). Start w świątyni Montag (5010,4998,7). Kolejne logowania: te same wartości, a klient zapamiętuje serwer i wersję.

Rozróżnienie: HTTP login (8088) zwraca tylko listę postaci i adres świata 127.0.0.1:7172. Wejście do gry to osobne połączenie TCP z 7172. Odpowiedź HTTP nie jest dowodem wejścia do gry.

### 4.4 Test prawdziwego klienta bez ręcznego klikania
```powershell
powershell -ExecutionPolicy Bypass -File scripts\client-autotest.ps1                   # logowanie, wejście, ruch, powitanie, ponowne wejście
powershell -ExecutionPolicy Bypass -File scripts\lab-fixture.ps1 -Combatant            # raz: osobne konto i postać Kael
powershell -ExecutionPolicy Bypass -File scripts\client-autotest.ps1 -Scenario combat  # kolizja, obrażenia, mikstura, walka, śmierć
```
Scenariusz NPC (cała lista kroków z restartem świata, kilka minut): `scripts\npc-scenario.ps1`. Jedna rozmowa: `scripts\client-autotest.ps1 -Scenario conversation -Npc Ardan -Lines "hi|Jak mam na imie?" -Expect "mar"`.
Skrypt otwiera okno klienta, zminimalizowane; nie klikaj w nim, scenariusze walki i rozmowy i tak blokują wejście. Wynik PASS/FAIL trafia na konsolę, log do `runtime\logs\client-autotest-*.log`. Wyjątki developerskie (ustawienie HP, przedmioty, wylogowanie) są zapisywane w dzienniku jako `dev_exception_used`.

## 5. Agenci (Ardan, Brom, Mira): jak ich znaleźć i przetestować
Rozmowa z NPC przez model: DOCS/NPC_RUNTIME.md.
- `Knight Sample` i `GOD` startują obok placu po `scripts\lab-fixture.ps1` (poza grą). Kael to postać eksperymentu; nie zaleca się gry nią.
Definicje i procedura dodawania: DOCS/AGENTS.md.
- **Ardan** (strażnik): spawn 5010,5003,7, na południe od świątyni Montag. Patroluje trasę `montag_square`: temple_south (5010,5003), square_west (5006,5005), road_south (5010,5009), square_east (5016,5005). Przy alarmie idzie do gate_watch (5019,5012).
- **Mira** (zielarka): stoi przy herb_stall (5020,5003,7). Przy alarmie chowa się w świątyni (temple_shelter 5007,4998,7).
- **Brom** (strażnik, wariant weterana): stoi w old_post (5014,5003,7). Bez reakcji na alarm.
- Ze świątyni wyjdź na zachód, potem na południe i na wschód przez otwarcie przy x≈4998–5001, y=5001.
- Powitanie: stań blisko NPC (Ardan: 4 kratki, Mira: 3) i napisz `hi`, `witaj`, `czesc` lub `dzien dobry` na kanale Default. NPC się odwraca i odpowiada. Przy włączonym Brain odpowiedź pochodzi z pamięci („Znowu ty…”, „Milo cie znow widziec…”), bez Brain z reguły lokalnej.
- Alarm treningowy (zdarzenie testowe, nie wykrycie potwora), działa na wszystkich agentów strefy `montag_gate`:
  - w grze postacią GOD: `/alarm start` i `/alarm clear`;
  - z konsoli: `powershell -ExecutionPolicy Bypass -File scripts\alarm.ps1 start` (oraz `clear`).
- W grze postacią GOD: `/ai status`, `/ai check ardan` (punkty w silniku), `/ai patrol ardan`, `/ai scan`.
- Z konsoli:
  - `scripts\selftest.ps1`: testy Lua wewnątrz Canary;
  - `scripts\scan.ps1 -X 5010 -Y 5003`: mapa przejść w okolicy;
  - `python -I tools\journal.py`: dziennik bieżącej sesji.

## 6. Brain i pamięć
- Dostawca: `.env` → `TIBIAAI_BRAIN_PROVIDER=local-model` (Ollama, tylko lokalnie) lub `rules` (bez modelu). Zmiana wymaga `stop.ps1 -BrainOnly` i `start.ps1 -BrainOnly`. Polityka: `packages\contracts\local-ai.json`, ADR 0007. Gdy Ollama nie działa, Brain sam używa reguł (`model_unavailable_using_rules` w logu).
- Proces modelu: `scripts\ollama.ps1 -Start|-Stop|-Status`. To osobny proces gry na 127.0.0.1:11435 z `OLLAMA_NO_CLOUD=1`; `start.ps1` uruchamia go przy `local-model`, `stop.ps1` zatrzymuje razem z `llama-server`. Aplikacja Ollama użytkownika zostaje bez zmian.
- Pomiar modelu i scenariusz na prawdziwej inferencji, bez klienta (proces Ollamy musi działać, Brain nie przeszkadza): `node --disable-warning=ExperimentalWarning apps\brain\test-integration\ollama.itest.ts`. Inny model wymaga wpisu w `allowedModels`.
- Pamięć NPC (tylko odczyt): `node --disable-warning=ExperimentalWarning apps\brain\src\cli\npc-memory.ts ardan 5`.
- Dane: `runtime\brain\brain.sqlite` (kopia przed każdą migracją: `brain.sqlite.bak-v*`). Log: `runtime\logs\brain.log`.
- Test pamięci: przywitaj Ardana, uruchom `stop.ps1 -BrainOnly`, potem `start.ps1 -BrainOnly` i przywitaj go ponownie. Oczekiwane: „Znowu ty, <imię>. To nasze 2. spotkanie…”.
- Testy: `cd apps\brain; pnpm install; pnpm test; pnpm typecheck`.
- Test mostu na żywym świecie (Brain musi być zatrzymany): `stop.ps1 -BrainOnly`, potem `node --disable-warning=ExperimentalWarning apps\brain\test-integration\bridge.itest.ts`, a na koniec `start.ps1 -BrainOnly`.

## 7. Backup i sprawdzenie odtworzenia
```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1        # runtime\backups\<data>\ (world.sql, brain.sqlite, manifest.json)
powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1  # najnowszy backup -> osobna baza tibiaai_restore_test
```
- Backup działa przy uruchomionym świecie i Brain (`mariadb-dump --single-transaction`, SQLite `VACUUM INTO`) i niczego nie kasuje. `manifest.json` zawiera SHA-256 plików i liczbę wierszy każdej tabeli.
- `restore-test.ps1` sprawdza sumy, odtwarza `world.sql` do bazy **tibiaai_restore_test** (tylko tę bazę tworzy i usuwa; `-Keep` ją zostawia), porównuje liczbę wierszy z manifestem i robi `integrity_check` kopii SQLite. Bazy `tibiaai_canary` nie dotyka.
- Odtworzenie produkcyjne (świadoma decyzja, nie skrypt): zatrzymaj świat (`stop.ps1 -KeepDb`), zaimportuj `world.sql` do `tibiaai_canary` klientem `mariadb` z `--defaults-extra-file=runtime\mariadb\root-client.cnf` i podmień `runtime\brain\brain.sqlite` kopią. Wcześniej zrób świeży backup.

## 7a. Oś decyzji (obserwacja → decyzja → wykonanie → skutek)
```powershell
node --disable-warning=ExperimentalWarning apps\brain\src\cli\timeline.ts --last 10 [--agent ardan] [--id <eventId>] [--json]
```
Łączy `runtime\logs\world-journal.jsonl` (Lua) i `runtime\logs\brain.log` po `eventId`/`correlationId`/`commandId` dla bieżącej sesji świata (`--session <id>` dla starszej). Narzędzie tylko czyta.

## 7b. Retencja
Brain co 10 min (i przy starcie) przycina `runtime\mailbox\processed`, `brain-processed` (po 2000 najnowszych plików) i `quarantine` (200). Pliki bieżącej sesji świata nie są usuwane.
Co 10 min Brain usuwa też stare wiersze operacyjne i uruchamia kompresję pamięci NPC. Okresy i co jest zapominane: DOCS/NPC_RUNTIME.md.
Rotacja logów: `world-journal.jsonl` (Lua) i `brain.log` (Brain) po przekroczeniu 10 MB dostają nazwę z datą UTC (`world-journal.20261029-230000.jsonl`). Stare pliki zostają. `canary.out.log`, `login.out.log` i `mariadb.err.log` rotuje `start.ps1` przy starcie. `timeline` i `journal.py` czytają tylko bieżące pliki.

## 7c. Koszt po stronie silnika
Co minutę dziennik dostaje wpis `perf_stats` z czasem naszych GlobalEventów (`bridge_poll`, `agent_tick`, `control`: liczba wywołań, średnia, maksimum w ms):
`python -I tools\journal.py --kinds perf_stats`. Punkt odniesienia z 2026-10-29: ADR 0002.

## 8. Typowe problemy
| Objaw | Przyczyna / rozwiązanie |
| --- | --- |
| `Port 3317/8088/7171/7172 is used` | inny proces na porcie: `Get-NetTCPConnection -LocalPort <port>` |
| „Only protocol version 15.11 or outdated 11.00 is allowed” | klient próbuje TCP login: zaznacz HTTP login i użyj adresu `http://127.0.0.1:8088/login` |
| „Email or password is not correct” w grze, choć lista postaci się pokazała | wpisano nazwę konta zamiast emaila |
| „Things are not loaded, please put assets in things/1511” | brak assets (sekcja 4) |
| NPC stoi lub go nie ma | `python -I tools\journal.py --kinds agent_definition_invalid,agent_spawn_failed,state_changed,move_failed,controller_error`; `/ai check <agent>` |
| `brainOnline=false` w `runtime\mailbox\world.json` | Brain nie działa albo heartbeat jest starszy niż 5 s; gra działa dalej na regułach Lua |
| Zaległe pliki w `runtime\mailbox\events` | Brain wyłączony; maksymalnie 100 zdarzeń, potem `event_dropped_backpressure` w dzienniku |
| Spam „createFiendishMonsters … no progress” w logu | `data-canary` nie ma potworów; ostrzeżenie upstream, nieszkodliwe |
| XAMPP uruchomiony | `.htaccess` blokuje projekt (403). Nie wyłączaj go bez potrzeby |

## Granice środowiska
Klient Windows łączy się z 127.0.0.1. Kontenerów nie ma. Brain i Canary komunikują się wyłącznie plikami w `runtime\mailbox`. Bazy ani gRPC nie są wystawione poza loopback. Nie używaj globalnych poleceń czyszczących i nie kasuj `runtime\`.
