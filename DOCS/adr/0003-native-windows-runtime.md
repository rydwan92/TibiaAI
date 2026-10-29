# ADR 0003: natywny runtime Windows zamiast Docker Compose
Status: ACCEPTED (2026-10-29).

## Kontekst
CLAUDE.md preferuje Docker Compose, „jeśli działa lokalnie”. Na tym komputerze nie działa:
- `systeminfo`: „Virtualization Enabled In Firmware: No”, `HypervisorPresent = False`.
- Brak Docker Desktop. `wsl.exe` to tylko stub bez zainstalowanej dystrybucji.
- WSL2 i Docker Desktop wymagają wirtualizacji, a zmiany BIOS są wykluczone przez CLAUDE.md.

## Decyzja
Natywne procesy Windows uruchamiane przez skrypty PowerShell (`scripts/*.ps1`), bez usług Windows i bez uprawnień administratora:
- Canary v3.6.1: oficjalna binarka `canary-windows-cmake-release.zip`, linkowana statycznie (bez VC runtime);
- MariaDB 11.4.13: przenośny ZIP, dane w `runtime/mariadb/data`, port 3317, `--bind-address=127.0.0.1`. To nie jest MariaDB z XAMPP i XAMPP nie jest ruszany;
- login-server zbudowany ze źródeł przy commicie `2612930` przenośnym Go (zmienne środowiskowe, bez pliku z sekretami);
- Brain: Node 22.18 z `node:sqlite`.

Wszystkie porty nasłuchują na 127.0.0.1, co weryfikuje `scripts/status.ps1`. Upstream leży w `vendor/` (ignorowany), a `runtime/server` składa się z kopii upstream i naszego overlayu.

## Konsekwencje
- Brak izolacji kontenerowej. Procesy działają na koncie użytkownika.
- Powtarzalność zapewniają `infra/versions.lock.json` (URL + SHA-256) i `scripts/setup.ps1`.
- Projekt leży pod `C:\xampp\htdocs`. Apache XAMPP (Listen 80, `AllowOverride All`) mógłby go udostępnić, więc `.htaccess` w katalogu głównym blokuje dostęp (sprawdzone: 403 dla `/`, `/.env`, `/runtime/...`, `/vendor/`). Przeniesienie do `C:\dev\TibiaAIServer` pozostaje decyzją użytkownika.
- Gdy wirtualizacja zostanie włączona, można wrócić do Compose. Wymaga to nowego przypięcia digestów obrazów.

## Alternatywy
- Docker/WSL2: zablokowane sprzętowo (BIOS).
- MariaDB z XAMPP: zabronione przez CLAUDE.md, a do tego współdzielona instancja innych projektów (10.4.27, nasłuch `::`:3306).
