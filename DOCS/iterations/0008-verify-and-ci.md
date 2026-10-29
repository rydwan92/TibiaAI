# Iteracja 0008: jedno polecenie weryfikacji i CI dla Brain
Data: 2026-10-30
Stan: VERIFIED lokalnie; CI: workflow dodany, wynik pierwszego przebiegu w GitHub Actions (patrz STATUS)

## Cel i warunek odbioru
Cel zapisany przed pracą.
- Jedno polecenie uruchamiające wszystkie weryfikacje dostępne bez GUI, z raportem.
- Automatyczne testy Brain i walidacja `agents.json` przy każdym pushu.

Kryterium: `scripts\verify.ps1` przechodzi na działającym świecie i zapisuje raport. Workflow jest w repo.

## Zmiany
- `scripts/verify.ps1`: testy jednostkowe, typecheck, self-test Lua, test mostu (zatrzymuje Brain na czas testu i wznawia go), backup, restore-test. Tabela PASS/FAIL, raport `runtime/logs/verify-*.json`, kod wyjścia 1 przy błędzie. `-SkipLive` uruchamia tylko część bez świata.
- `.github/workflows/brain.yml`: Ubuntu, Node z `.nvmrc`, pnpm 12.4.1, `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`.

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| `scripts\verify.ps1` na żywym świecie | PASS 6/6 (~28 s) | `runtime/logs/verify-20261030-000441.json` |

## Ograniczenia
- CI nie uruchamia Canary (assets, binarka Windows), więc testy silnika zostają lokalne (`verify.ps1`).
- `verify.ps1` tworzy przy każdym uruchomieniu nowy katalog backupu (nic nie kasuje); archiwum backupów trzeba sprzątać ręcznie.

## Następne zadanie
Test GUI (RUNBOOK §4.1), a po nim uruchomienie `scripts\verify.ps1` jako regresji.
