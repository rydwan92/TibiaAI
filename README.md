# TibiaAI
Projekt Tibia z agentami AI: prywatne, lokalne laboratorium OpenTibia (Canary + OTClient), w którym NPC działają w prawdziwym świecie gry, a ich decyzje i pamięć dostarcza osobny proces Brain.

Pierwsza scena: strażnik **Ardan** patroluje plac w Montag, reaguje na powitanie, przerywa patrol po alarmie treningowym, ostrzega i wraca na trasę, a po restarcie Brain pamięta spotkanie z graczem. Każde zdarzenie i wynik działania trafiają do dziennika.

Stan bieżący: [DOCS/STATUS.md](DOCS/STATUS.md). Uruchamianie: [DOCS/RUNBOOK.md](DOCS/RUNBOOK.md).

## Szybki start (Windows, PowerShell 5.1, Node 22.18)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1    # raz: pobiera przypięte wersje (SHA-256), baza, konto
powershell -ExecutionPolicy Bypass -File scripts\start.ps1    # MariaDB, login-server, Canary, Brain (tylko 127.0.0.1)
powershell -ExecutionPolicy Bypass -File scripts\client.ps1 -CopyPassword
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1     # łagodny stop, bez kasowania danych
```
Klient potrzebuje assets Tibii 15.11, które nie są częścią repo (RUNBOOK §4).

## Architektura w skrócie
| Komponent | Gdzie | Rola |
| --- | --- | --- |
| Canary v3.6.1 + `data-canary` | `vendor/` (ignorowany) → `runtime/server` | autorytatywny świat |
| Overlay Lua | `game/overlays/tibia-ai` | NPC, kontroler ruchu, walidacja komend, mailbox |
| Brain (Node/TypeScript, SQLite) | `apps/brain` | reguły, pamięć, komendy z kontraktu |
| Kontrakt i allowlista | `packages/contracts`, `DOCS/CONTRACTS.md` | jedyne dozwolone akcje |
| Skrypty i przypięcia | `scripts/`, `infra/versions.lock.json` | powtarzalne uruchomienie |

Decyzje: [DOCS/adr](DOCS/adr). Plan etapów: [DOCS/PLAN.md](DOCS/PLAN.md). Zasady pracy: [CLAUDE.md](CLAUDE.md).

## Czego tu nie ma
Binariów, grafik Tibii, map spoza źródeł Canary, kluczy API ani sekretów (`.env` jest generowany lokalnie i ignorowany). Zasoby gry mają osobne pochodzenie i warunki użycia.

## Pakiet startowy
Pliki `FIRST_PROMPT.md` i `NEXT_PROMPT.md` to oryginalne zlecenia dla sesji Claude Code; `NEXT_PROMPT.md` służy do kontynuacji pracy.
