# ADR 0001 — lokalne laboratorium z jednym agentem
Status: ACCEPTED w M0 (2026-10-29) z modyfikacjami: runtime natywny zamiast Compose (ADR 0003), transport mailbox (ADR 0002), datapack `data-canary` zamiast `data-otservbr-global`.

## Decyzja
Preferujemy Canary i OTClient Redemption, lokalny Compose i osobne dane. Kontroler ruchu/fallback w Lua, planowanie w Node/TypeScript, pamięć w SQLite. MariaDB jest własnością silnika. Najpierw rules, później jeden provider LLM.

## Powód
Gotowy quickstart skraca przygotowanie świata. Lua daje dostęp do zachowań jednostek, TypeScript odpowiada doświadczeniu właściciela. Oddzielenie modelu chroni responsywność świata i pozwala testować bez kosztu API.

## Ograniczenia
Przypięcie wersji i assets jest konieczne. Transport dwukierunkowy nie został potwierdzony. Mailbox jest akceptowalnym etapem badawczym tylko po pomiarze i testach filesystemu. Zwykły NPC nie spełnia obietnicy pełnego gracza AI.

## Alternatywy
TFS po konkretnym blokerze Canary. Całość w Lua przy braku mostu daje działającą scenę, ale nie dowodzi integracji z Brain. Pełny bot klienta i przebudowa C++ odkładamy do osobnego prototypu jednostki bojowej.

## Następna decyzja
ADR 0002: transport, z dokładnymi źródłami API, wynikami testu i kosztami utrzymania.
