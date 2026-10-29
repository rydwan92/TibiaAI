# Weryfikacja

Stan na 2026-10-29. „Silnik” oznacza dowód z działającego Canary (dziennik lub wyniki mostu) bez klienta GUI.

| Test | Oczekiwany wynik | Rodzaj | Stan | Jak uruchomić / dowód |
| --- | --- | --- | --- | --- |
| Cold start | Baza, mapa, login gotowe; bez kasowania innych usług | Integracja | PASS | `scripts\start.ps1`, `scripts\status.ps1` |
| Nasłuch tylko loopback | Wszystkie porty 127.0.0.1 | Integracja | PASS | `scripts\status.ps1` |
| HTTP login | Lista postaci; złe hasło odrzucone | Integracja | PASS | iteracja 0001 (nie jest dowodem wejścia) |
| Wejście | Gracz loguje się, chodzi i wraca po reconnect | Ręczny GUI | NOT RUN | RUNBOOK §4, wymaga assets |
| Patrol | Ardan osiąga punkty, nie teleportuje | Gra | PASS (silnik), GUI NOT RUN | `tools\journal.py --kinds move_completed` |
| Blokada trasy | Timeout/failure; brak pętli bez końca | Gra | PASS (silnik) | itest: `move_to test_unreachable` → `failed/no_path` |
| Alarm treningowy | Przerwanie patrolu, ostrzeżenie, powrót po clear | Gra | PASS (silnik), GUI NOT RUN | `scripts\alarm.ps1 start|clear` lub `/alarm` |
| Powitanie | Ardan zatrzymuje się, odpowiada lokalnie lub przez Brain | Gra | NOT RUN | wymaga gracza w GUI |
| Event roundtrip | Event → Brain → command → wynik świata pod jednym correlationId | Integracja | PASS | `brain.log` (alarm → say → completed) |
| Zły JSON/akcja | Odrzucenie; gra działa dalej | Kontrakt | PASS | itest + `pnpm test` |
| Duplikat komendy | Jeden skutek, wcześniejszy wynik | Integracja | PASS | itest; `npc_said` = 1 |
| Stara sesja/TTL | Brak wykonania | Integracja | PASS | itest (`stale_session`, `ttl_expired`, `ttl_too_long`) |
| Stop Brain | Gra i lokalny kontroler nadal działają | Awaria | PASS | iteracja 0003 (alarm przy `brainOnline=false`) |
| Restart Brain | Wspomnienie rozpoznaje player GUID | Integracja SQLite | PASS (unit), GUI NOT RUN | `brain.test.ts`; w grze: RUNBOOK §6 |
| Restart świata | Stare komendy nie zostają wykonane | Awaria | PASS (mechanizm) | nowa `worldSessionId` w nazwach plików; brak testu z zaległą komendą |
| Prompt injection | Tekst nie wywołuje shell/spawn/SQL | Kontrakt/model, po M4 | PASS (kontrakt) | `contracts.test.ts`; z modelem po M4 |
| Przeciążenie | Bounded queue, brak wzrostu bez granic | Integracja | IMPLEMENTED, NOT RUN | limit 100 zdarzeń, 10 komend/poll |
| Self-test Lua | JSON, szablony, walidacja definicji i komend w LuaJIT Canary | Silnik | PASS 20/20 | `scripts\selftest.ps1` |
| Definicje agentów | `agents.json` poprawny; błędy raportowane z nazwą pola | Kontrakt | PASS | `agents.test.ts`; w Lua: `agent_definition_invalid` |
| Wielu agentów | Drugi agent tylko z danych; allowlista per agent; nieznany agent odrzucony | Integracja | PASS | itest przypadki 12–14 |
| Alarm wielu agentów | Każdy agent strefy reaguje wg definicji i wraca do rutyny | Silnik | PASS | iteracja 0004 |
| Oś decyzji | Łańcuch event → Brain → command → wykonanie → wynik z obu logów | Integracja | PASS | `timeline.test.ts`; na żywo `cli/timeline.ts` (iteracja 0005) |
| Retencja mailboxa | Ograniczona liczba plików, bieżąca sesja chroniona | Jednostkowy | PASS | `retention.test.ts` |
| Backup + restore | Sumy, liczba wierszy 48 tabel świata i 7 tabel Brain, integrity_check | Operacyjny | PASS | `scripts\backup.ps1`, `scripts\restore-test.ps1` |
| Koszt GlobalEventów | Pomiar w spoczynku i pod obciążeniem | Pomiar | PASS (zmierzone) | `perf_stats`, ADR 0002 |
| Rotacja logów | Rotacja powyżej limitu, bez nadpisywania i kasowania | Jednostkowy + silnik | PASS | `logrotate.test.ts`, self-test Lua |
| Słyszenie agentów | `agent_heard` tylko w zasięgu; pamięć z pochodzeniem u słuchacza | Silnik + jednostkowy | PASS | iteracja 0007, `hearing.test.ts` |
| Limit pętli agent ↔ agent | Żadna mowa w odpowiedzi na `agent_heard`, także od złośliwego providera | Jednostkowy + silnik | PASS | `hearing.test.ts`, `brain.log` |
| Plotka przy powitaniu | „Slyszalam, jak Ardan mowil…” po odpowiedzi | Gra | PASS (unit), GUI NOT RUN | `hearing.test.ts` |

## Polecenia
Całość jednym poleceniem: `powershell -ExecutionPolicy Bypass -File scripts\verify.ps1` (raport w `runtime\logs\verify-*.json`). CI (GitHub Actions, `.github/workflows/brain.yml`) uruchamia testy jednostkowe i typecheck Brain przy każdym pushu.
Pojedynczo:
```powershell
cd apps\brain; pnpm install; pnpm test; pnpm typecheck; cd ..\..
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1 -BrainOnly
node --disable-warning=ExperimentalWarning apps\brain\test-integration\bridge.itest.ts
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -BrainOnly
```

Zapisuj także czas poll/tick, długość kolejki, opóźnienie event → accepted → completed, błędy, liczbę wywołań modelu i tokeny po M4. Najpierw zmierz baseline bez Brain. Progi wydajności ustalaj na podstawie tej maszyny; nie wymyślaj benchmarków.

Test jednostkowy mocka transportu nie zastępuje testu z Canary. Film, screenshot lub log ma mieć opis, wersje i datę. Nie zapisuj sekretów w logach.
