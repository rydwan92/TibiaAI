# Backlog z przeglądu projektu

Stan zadań T01–T11 z zewnętrznego przeglądu, sprawdzony w kodzie 2026-10-31. Przegląd oparto na starszym stanie (62 testy, brak działania z dialogu), więc część punktów była już nieaktualna.

| ID | Zadanie | Stan | Dowód lub brak |
| --- | --- | --- | --- |
| T01 | Bezpieczna kompresja | IMPLEMENTED, test z atrapą | Błąd był prawdziwy. Testy partii 41, 100, 2000 w `npc.test.ts`. W żywej bazie jeszcze nie wystąpiła |
| T02 | Prywatność i pochodzenie wspomnień | IMPLEMENTED, test z atrapą | Partie rozdzielone po widoczności i pewności, także przy łączeniu i dopisywaniu |
| T03 | Atomowe skutki odpowiedzi | IMPLEMENTED, test z atrapą | `pendingPlan` i `markPlanApplied` w jednej transakcji ze skutkami, ponowienie w `processResults` |
| T04 | Odzyskiwanie kolejki poleceń | IMPLEMENTED, test z atrapą | Numer i plik w jednej transakcji: nieudany zapis nie zużywa numeru. Awaria po zapisie pliku a przed COMMIT daje polecenie bez wiersza, które wykona się raz |
| T05 | Dwóch graczy i awaria | Częściowo | Dwa klienty VERIFIED w 0013, trzy klienty w 0014. Restart Brain z zablokowaną kolejką: NOT RUN |
| T06 | Wspólne zarządzanie modelem | Częściowo | Późne włączenie Ollamy przywraca model: IMPLEMENTED (zob. iteracja 0015). Kolejka priorytetów dialog–kompresja: PLAN |
| T07 | Pierwsza akcja z dialogu | VERIFIED | Przewodnik, iteracja 0013. Kryterium M4 z PLAN jest przez to spełnione |
| T08 | Cykl życia zobowiązania | PLAN | |
| T09 | Scena zagubionej dostawy | PLAN | Po T08 |
| T10 | Porównanie modeli | PLAN | Pobranie modelu to osobna decyzja |
| T11 | Minimalny adapter Kaela | VERIFIED, szerzej niż zadanie | Gracze-agenci, ADR 0010 |
