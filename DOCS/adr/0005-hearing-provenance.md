# ADR 0005: słyszenie między agentami i pamięć z pochodzeniem
Status: ACCEPTED (2026-10-29)

## Kontekst
VISION i PLAN (M5) zakładają plotki z pochodzeniem („Ardan powiedział, że…”) i komunikację lokalną z limitami pętli rozmów. Agenci muszą słyszeć się nawzajem bez wszechwiedzącej wspólnej pamięci i bez ryzyka niekończącej się rozmowy dwóch modeli.

## Decyzja
- Percepcja jest w silniku: Lua przy każdej wypowiedzi agenta (`T.agentSay`) liczy odległość do innych agentów. Słuchacz z `hearing.range` (lub `hearing.yellRange` dla krzyku) w zasięgu na tym samym piętrze dostaje zdarzenie `agent_heard`. Słyszy tylko ten, kto był w zasięgu.
- Pamięć to **relacja z pochodzeniem**: tabela `heard_statements` (słuchacz, mówca, tekst, krzyk, odległość, sesja, czas, eventId). Tekst nie staje się faktem o świecie.
- **Limit pętli**: ani Lua, ani reguły Brain nie odpowiadają mową na `agent_heard`. Wypowiedź z usłyszanego kontekstu powstaje wyłącznie w reakcji na gracza (powitanie) i tylko dla agentów z niepustym `greetRumor`. Przyszły provider LLM musi zachować tę zasadę: walidator Brain odrzuci intencję mowy, której zdarzeniem źródłowym jest `agent_heard`.
- Świeżość: plotka tylko z wypowiedzi z ostatnich 10 minut. Starsze zostają w pamięci, ale nie są powtarzane.

## Konsekwencje
- Nowy typ zdarzenia w kontrakcie (CONTRACTS.md) i migracja SQLite v2 (kopia bazy przed migracją, `memory.ts`).
- Liczba zdarzeń rośnie z liczbą agentów w zasięgu (n·(n-1) w najgorszym razie na wypowiedź). Ogranicza to backpressure mostu (100 zdarzeń); przy wielu agentach potrzebny będzie limit per słuchacz.
- Agenci nadal nie rozmawiają ze sobą wprost. To świadoma granica, nie brak.

## Alternatywy
- Wspólna pamięć wszystkich agentów: odrzucona (VISION: brak wszechwiedzącej pamięci).
- Dialog agent ↔ agent przez Brain: odłożony do czasu providera LLM z budżetem; wymaga własnego limitu wymian i ADR.
