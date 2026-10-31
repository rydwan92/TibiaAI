# Prywatny pokaz dla znajomego przez VPN

Stan: **przygotowane, NOT RUN**. Nic z tego nie zostało uruchomione ani sprawdzone z drugim komputerem. Żaden publiczny port nie jest otwierany, a zaproszeń nie wysyłamy.

## Co jest potrzebne na czas pokazu
Znajomy łączy się przez prywatną sieć Tailscale, tylko z dwoma usługami.

| Usługa | Port | Dla znajomego |
| --- | --- | --- |
| Logowanie HTTP | 8088 | tak |
| Świat gry | 7172 | tak |
| gRPC login-servera | 9090 | **nie** |
| MariaDB | 3317 | **nie**, zostaje na 127.0.0.1 |
| Ollama gry | 11435 | **nie**, zostaje na 127.0.0.1 |
| Metryki | 9464 | **nie**, zostaje na 127.0.0.1 |

Wszystko oprócz dwóch pierwszych wierszy zostaje dostępne tylko lokalnie albo jest zablokowane regułami. To samo dotyczy `runtime/control`, czyli narzędzi administracyjnych.

## Przygotowanie (wykonuje właściciel)
1. Zainstaluj Tailscale i zaloguj się. To osobna decyzja: instalacja dodaje usługę i interfejs sieciowy do systemu.
2. Sprawdź swój adres: `tailscale ip -4`. Ma postać `100.x.y.z`.
3. Ustaw reguły w panelu Tailscale według [przykładu](../infra/vpn/tailscale-acl.example.json), podstawiając adres znajomego.
4. Dodaj znajomego do sieci przez udostępnienie urządzenia, a nie przez dodanie go jako administratora.
5. W `.env` ustaw `TIBIAAI_WORLD_HOST=100.x.y.z`.
6. Zastosuj i uruchom:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1 -KeepDb
powershell -ExecutionPolicy Bypass -File scripts\sync-server.ps1
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
powershell -ExecutionPolicy Bypass -File scripts\status.ps1
```

`TIBIAAI_WORLD_HOST` przyjmuje tylko `127.0.0.1` albo adres z zakresu Tailscale `100.64.0.0/10`, inaczej skrypty przerywają. Trafia do `ip` Canary oraz do `SERVER_IP` i `LOGIN_IP` login-servera. Klient dostaje go przy logowaniu jako adres świata, dlatego `127.0.0.1` nie zadziała u znajomego.

`status.ps1` pokaże wtedy `NOT LOOPBACK!` przy portach 7172, 7171, 8088 i 9090: to oczekiwane w tym trybie i dlatego reguły z kroku 3 są obowiązkowe. Przy bazie danych i Ollamie ta flaga nie może się pojawić.

Zapora Windows też musi przepuścić 7172 i 8088 na interfejsie Tailscale. Zmiana zapory należy do właściciela, skrypty tego nie robią.

## Konto dla znajomego
Osobne konto, zwykły gracz, własna postać. Nigdy konto `tibiaai@localhost` ani GOD. Tworzenie konta zwykłego gracza nie ma jeszcze skryptu: to pierwsza rzecz do dopisania przed pokazem. Po pokazie zablokuj lub usuń to konto.

## Klient znajomego
Ta sama wersja OTClient (`dd56414`) i assets 15.11, RUNBOOK §4. Zasoby gry mają własne warunki użycia, więc znajomy pobiera je sam tą samą drogą, a nie dostaje ich od nas. W kliencie: serwer `http://100.x.y.z:8088/login`, wersja 15.11, zaznaczone HTTP login, logowanie emailem.

Klient znajomego działa u niego, więc nie obciąża Twojego GPU. Twój klient powinien nadal mieć limit klatek.

## Test połączenia (u znajomego, PowerShell)
```powershell
Test-NetConnection 100.x.y.z -Port 8088   # True
Test-NetConnection 100.x.y.z -Port 7172   # True
Test-NetConnection 100.x.y.z -Port 3317   # False
Test-NetConnection 100.x.y.z -Port 9090   # False
Test-NetConnection 100.x.y.z -Port 11435  # False
```
Trzy ostatnie muszą dać `False`. Jeśli którykolwiek jest otwarty, przerwij pokaz i popraw reguły.

## Powrót do trybu lokalnego
1. W `.env` usuń `TIBIAAI_WORLD_HOST` albo ustaw `127.0.0.1`.
2. Uruchom te same polecenia co w kroku 6.
3. Sprawdź `scripts\status.ps1`: wszystkie porty `loopback`.
4. Cofnij udostępnienie urządzenia w panelu Tailscale.

## NOT RUN
| Element | Stan |
| --- | --- |
| Połączenie z drugiego komputera | NOT RUN |
| Reguły Tailscale | NOT RUN |
| Start serwera z adresem VPN | NOT RUN |
| Konto znajomego | NOT RUN, brak skryptu |
| Zachowanie klienta lokalnego w trybie VPN | NOT RUN. Przy `bindOnlyGlobalAddress = true` serwer słucha tylko na adresie VPN, więc własny klient też musi go używać |
