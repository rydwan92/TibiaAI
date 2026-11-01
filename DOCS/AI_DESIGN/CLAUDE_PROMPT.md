# Prompt do Claude — po zamknięciu bieżącej migracji

Pracujesz na najbardziej aktualnej lokalnej kopii C:\xampp\htdocs\projects\tibia\TibiaAIServer. Jesteś wykonawcą i inżynierem TibiaAI. Przeczytaj CLAUDE.md, DOCS/STATUS.md i pozostałe wskazane tam dokumenty, następnie cały DOCS/AI_DESIGN/. Ten pakiet opisuje review i PLAN, a nie wdrożone funkcje.

Właściciel chce rozwijać lokalny serwer z prawdziwymi graczami AI: walka profesjami, progresja, ekonomia, wiedza o świecie, własne osobowości i doświadczenia wpływające na decyzje. Priorytetem jest działający cykl życia, nie więcej tekstu generowanego przez model. Zachowaj istniejącą architekturę i fallback bez modelu. Na razie bez chmury, zakupu API, pobierania modeli i publicznego wdrożenia.

1. Najpierw zakończ obecną migrację na RL mapę według M0 w DELIVERY.md. Nie porzucaj jej w połowie i nie cofaj aktualnych zmian. Sprawdź lokalny kod, git status i procesy; nie traktuj historycznych zrzutów i dokumentacji Montag jako aktualnego runtime. Nie odpalaj konfliktujących testów na świecie używanym przez inną sesję. Dokończ prace w swojej sesji, zanim przejdziesz dalej.
2. Zaktualizuj dokumentację migracji i przypnij dowody do aktualnej mapy. Jeśli jakiś scenariusz nie był uruchomiony, wpisz NOT RUN. Nie przepisuj historycznego VERIFIED jako dowodu Thais. Zachowaj historię iteracji.
3. Potem rozpocznij jedną nową iterację: M1/R01, niezawodny odbiór zdarzeń graczy. Ponownie sprawdź readEvents w players/mind.ts, bo kod mógł się zmienić od review. Rozwiąż niepełny rekord, skrócenie/nową sesję pliku i semantykę restartu bez utraty lub podwójnych skutków. Ogranicz koszty odczytu. Nie wprowadzaj nowej magistrali lub infrastruktury bez potrzeby. Dodaj testy odtwarzające konkretne awarie, potem sprawdź prawdziwego klienta.
4. Zanim zmienisz kod, zapisz cel i warunki odbioru w kolejnej wolnej numeracji DOCS/iterations. Uruchamiaj sprawdzenia właściwe dla zmiany; jeżeli wspólny świat jest zajęty, wykonaj niezależne testy i jawnie oznacz blokadę sprawdzenia klienta. Nigdy nie odłączaj czyjejś sesji bez uzgodnienia.
5. Raportuj konkretnie: zmienione pliki, testy i wyniki, ścieżki dowodów, pozostałe braki. Zachowuj rozróżnienie PLAN/IMPLEMENTED/VERIFIED/BLOCKED. Uaktualnij STATUS i CONTRACTS/RUNBOOK tylko jeśli dotyczy. Nie edytuj historycznego review, aby ukryć znaleziony problem; dopisz odnośnik do naprawy.
6. Po odbiorze tej iteracji wskaż następne pojedyncze zadanie M2: zdolności faktycznie znane i legalny cykl zapasów bez refresh dev-kit. Nie implementuj całego planu w jednym przebiegu i nie nazywaj zapisanego zdania „wytrenowanym modelem”.

Swoboda postaci ma rosnąć przez więcej rzeczywistych umiejętności, celów i interakcji, a nie przez dowolne wykonywanie tekstu modelu. Wszystkie nagrody, płatności, zakupy, czary i wyniki walk potwierdza gra. Dane z czatu nie zmieniają uprawnień agenta. Osobowość powinna wpływać na wybory, doświadczenie na strategię, a wiedza mieć pochodzenie.

Przyszłe sceny: wspólna wyprawa i ratunek, dostawa z rzeczywistym kosztem, handel gracz–AI, reputacja z czynów. Minigry impostor/quiz i większe bitwy dopiero po niezawodnym cyklu życia i pomiarach sprzętu. W eksperymencie impostora uczestnicy wiedzą o obecności AI, tożsamość ukrywamy tylko na czas rundy i ujawniamy po niej. Nie rozszerzaj obecnego in_character o zmyślone życie prawdziwej osoby.

Zacznij od krótkiego raportu aktualnego stanu migracji i dowodów M0, a następnie wykonaj opisane zadanie, bez zatrzymywania się na samym planie.
