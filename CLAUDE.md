# TibiaAI: instrukcje projektu

## Cel i język
Budujemy prywatne lokalne laboratorium OpenTibia z agentami działającymi w prawdziwym świecie gry. Rozmawiaj i dokumentuj po polsku, identyfikatory kodu po angielsku. Czytaj najpierw DOCS/STATUS.md, DOCS/PLAN.md, DOCS/ARCHITECTURE.md i DOCS/COMPATIBILITY.md.

## Zasady implementacji
- Pierwszy priorytet: zalogowanie do świata, później jeden NPC, potem integracja Brain. Nie buduj najpierw panelu administracyjnego.
- Preferencja: Canary + OTClient Redemption + wydzielona MariaDB, Brain Node.js/TypeScript + SQLite. Docker Compose jeśli działa lokalnie. Wybierz wspieraną wersję Node i przypnij ją w projekcie.
- Zweryfikuj faktyczne środowisko: Windows/WSL/kontener/zdalna sesja. Nie zakładaj dostępu do komputera użytkownika tylko dlatego, że widzisz jego pliki.
- Sprawdź istniejące pliki przed edycją. Zachowaj DOCS, konfigurację i bazy. Nie zmieniaj baz XAMPP ani innych projektów.
- Utrzymuj własne dodatki poza źródłami upstream. Nie zmieniaj protokołu klienta dla MVP. Patch C++ dopiero po udokumentowanej próbie transportu i ADR.
- Każde użyte API Lua musi mieć potwierdzenie w źródle wybranego commita. Funkcje na main nie muszą istnieć w wydaniu.
- Nie wywołuj synchronicznego HTTP, shell/curl ani modelu w pętli świata. Nigdy nie wykonuj kodu wygenerowanego przez model.
- Model proponuje wyłącznie działania z kontraktu, silnik sprawdza możliwość wykonania. Zwykły NPC nie jest automatycznie botem graczem i wojownikiem.
- Tryb rules musi działać bez internetu i API. Wolny lub wyłączony Brain nie może zatrzymywać gry.
- Sekrety wyłącznie w ignorowanym .env; przykład bez wartości. Nie publikuj ani nie pushuj bez zlecenia. Serwisy lokalne publikuj wyłącznie na loopback; nie wystawiaj bazy ani gRPC, jeśli nie są potrzebne.
- Nie używaj floating latest jako końcowego przypięcia. Zapisz commit źródeł, digest obrazów i sumy plików; rozróżnij wersję kodu i wersję działającego obrazu.
- Nie usuwaj wolumenów, nie wykonuj globalnego docker prune, resetów baz ani zmian firewall/BIOS. Rutynowe odwracalne prace wykonuj samodzielnie.
- Zasoby gry mają osobne pochodzenie i warunki użycia. Nie uznawaj licencji silnika za licencję grafik; nie dołączaj ich do naszego repo.

## Dokumentacja w każdej iteracji
Zmiana jest gotowa dopiero z testem odpowiednim do zmiany i dokumentacją w tym samym zestawie zmian.
1. Przed pracą: krótki cel i kryterium odbioru w DOCS/iterations/NNNN-nazwa.md.
2. Po pracy: dowody, uruchomione polecenia (bez sekretów), wyniki PASS/FAIL/NOT RUN, ograniczenia i następny krok.
3. Aktualizuj STATUS.md zawsze. RUNBOOK.md przy zmianie uruchamiania, CONTRACTS.md przy zmianie komunikacji, COMPATIBILITY.md przy zmianie zależności, ADR przy ważnej decyzji.
4. Odróżniaj PLAN / IMPLEMENTED / VERIFIED / BLOCKED. Kod napisany i test jednostkowy nie potwierdzają działania w Tibii.
5. Nigdy nie wpisuj fikcyjnego SHA, wyników testów, endpointów silnika ani informacji o zalogowaniu gracza.
6. Kończ konkretnym raportem: co działa, dowód, co wymaga działania użytkownika, jedno następne zadanie.

## Kontrola rozmiaru
Bez Redis, Kafka, Kubernetes, LangChain, vector DB, mikroserwisów i dashboardu na pierwszym etapie. Dodawaj zależności tylko z uzasadnieniem. Nie implementuj całego backlogu w jednej sesji.
