# Stevium / TibiaAI — wizja produktu i kierunek rozwoju

Data: 2026-11-01. Status: WIZJA / PLAN, nie implementacja. Dokument rozszerza DOCS/VISION.md i nie zastępuje DOCS/STATUS.md, DOCS/PLAN.md, DOCS/ARCHITECTURE.md, DOCS/NPC_RUNTIME.md ani ADR.

## 1. North Star

Tworzymy autorski świat Open Tibia Server zachowujący klimat, grywalność i podstawowe mechaniki MMORPG, ale rozszerzony o autonomicznych graczy AI, inteligentnych mieszkańców NPC i opcjonalnych osobistych asystentów. W tym świecie ludzie i agenci mogą eksplorować, rozmawiać, zawierać znajomości, rywalizować, handlować, rozwijać postacie i współtworzyć historię serwera. Ważne: **wiarygodne zachowania i ciągłość tożsamości, a nie sam fakt generowania tekstu przez model**.

Celem jest lokalne laboratorium, potem mały zamknięty test z dwiema osobami, a dopiero później publiczny OTS z własną stroną, kontami i rankingami. Skalowanie, publiczne usługi i płatności są poza bieżącym MVP.

Zasada produktu: utrzymujemy przyjemność z prawdziwej gry; AI nie powinno odbierać ludziom sprawczości ani łamać zasad serwera. Agenci mogą zachowywać się po ludzku, ale ich status jako AI ma być jasno komunikowany w polityce serwera i tam, gdzie to istotne dla użytkowników.

## 2. Trzy klasy agentów

### A. AI Player — pełnoprawna postać gracza
- Przykładowe etykiety person testowych: ASTRA, SOL i CLAUDE. Nazwy **nie oznaczają automatycznie** używania modeli o takich nazwach; przypisanie modelu jest konfiguracją.
- Konto i postać istnieją w świecie gry, przemieszczają się, rozwijają umiejętności, zdobywają doświadczenie, walczą, handlują, piszą na local/private chat i przestrzegają tych samych ograniczeń mechaniki co ludzie.
- Każda postać ma indywidualną biografię, cele, temperament, priorytety, kodeks, styl języka, stosunek do ryzyka i PvP, historię zdarzeń oraz relacje.
- AI może inicjować działania, reagować na wiadomości i poznawać świat. Nie musi odpowiadać na każdą wiadomość.
- PvP ma wynikać z kontekstu i cech postaci, ale musi przejść przez politykę serwera, cooldown, bezpieczne strefy, reguły ochrony graczy i twarde ograniczenia ataków.

### B. AI NPC — postać świata
- Ma rolę zawodową/społeczną (np. strażnik, zielarka, kupiec, kronikarz), osobowość, wiedzę, wspomnienia, lokalną percepcję i opcjonalne narzędzia.
- Rozmawia na różne tematy w miarę możliwości modelu, bez udawania faktycznej wiedzy o zdarzeniach, których nie widział.
- Nie jest automatycznie graczem bojowym. Zachowanie NPC nadal podlega jego uprawnieniom i mechanice.
- Możliwe przyszłe usługi: opowieści, wskazówki, tutor językowy, questy, porady zawodowe, kronika świata, osobiste interakcje.

### C. Personal Assistant — prywatny pomocnik gracza
- Opcjonalny asystent dostępny przez prywatną wiadomość, specjalnego NPC albo dodatkowy UI.
- Notatki, przypomnienia, osobisty dziennik, pomoc w realnych zadaniach i wiedzy, wyszukiwanie informacji po integracji odpowiednich narzędzi.
- Pamięć i dane asystenta są **odseparowane od pamięci świata, plotek NPC i cudzych postaci**. Uprawnienia, zgoda na zapis, możliwość przeglądu/usunięcia danych i blokada ujawniania prywatnych treści są obowiązkowe.
- Funkcje realnego świata wdrażane jako opcjonalne narzędzia z kontrolą dostępu, nie przez nieograniczone polecenia modelu.

## 3. Architektura poznawcza — osobne warstwy zamiast „jeden prompt na postać”

Każda postać AI powinna posiadać:
1. Identity/persona: trwała tożsamość, historia, typ, wartości, temperament i styl komunikacji.
2. Goals/drives: cele krótko- i długoterminowe, potrzeby, zainteresowania, relacje i nastawienie do ryzyka.
3. World knowledge: wspólna, wersjonowana, sprawdzona wiedza o regułach gry, mechanice, profesjach i świecie (ogólna, nie pełna wszechwiedza każdej postaci).
4. Perception/beliefs: co postać rzeczywiście zobaczyła, usłyszała lub dowiedziała się z wiarygodnego źródła; odróżnienie potwierdzonego zdarzenia od plotki lub deklaracji.
5. Episodic memory: surowe zdarzenia, rozmowy, akcje i ich potwierdzone skutki.
6. Semantic/long-term memory: skompresowane wspomnienia, relacje, trwałe fakty, reputacja, zobowiązania.
7. Skills/policies: wielokrotnego użytku procedury ruchu, zdobywania łupu, walki, mikstur, ucieczki, handlu i interakcji. Umiejętności są kodem/konfiguracją i sprawdzanymi procedurami, nie magicznie przesyłanym treningiem wag modelu.
8. Runtime state: pozycja, HP/MP, otoczenie, aktywny plan, cooldowny, tymczasowe zdarzenia i ograniczenia wykonania.

Współdzielone: mechanika, zatwierdzona baza wiedzy, bezpieczne umiejętności, mapy bazowe. Indywidualne: percepcja, doświadczenia, relacje, prywatne sekrety, temperament, wiedza odkryta w świecie, cele i bieżący plan.

## 4. Pamięć — ciągłość postaci

Obowiązuje istniejący projekt NPC (patrz DOCS/NPC_RUNTIME.md oraz ADR 0008); nie budować drugiego, niezgodnego magazynu. Rozszerzyć istniejące schematy tam, gdzie potrzeba, a dla AI Player zapewnić zgodny interfejs.

Szkic:
- Każde zdarzenie: eventId, actorGuid/agentKey, targetGuid, gameTime, observedAt, worldSessionId, location, category, source, confidence, visibility/privacy, salience, payload i confirmedOutcome.
- Zapis surowy na potrzeby bieżących wydarzeń, np. ostatnie 7 dni; zamknięte dni okresowo streszczane; starsze epizody grupowane i ważone.
- Kompresja nie może bezmyślnie usuwać: trwałych relacji, ważnych obietnic, konfliktów, zasad postaci, sprawdzonych faktów i toczących się zadań.
- Każde streszczenie ma provenance: identyfikatory zdarzeń źródłowych, datę kompresji, wersję modelu/algorytmu, zakres czasu i wagę.
- Odróżnić observed (widział), heard/rumor (usłyszał), claimed (ktoś twierdzi), confirmed (potwierdzone przez silnik), inferred (wnioskowanie).
- Persona i historia muszą przetrwać restart serwera, zmianę modelu i migrację. Nie są ukryte wyłącznie w kontekście jednej sesji LLM.
- Poza bazą operacyjną w przyszłości udostępnić administratorowi wgląd w chronologię i możliwość korekty/testowania; nie dawać LLM bezpośredniego dowolnego SQL.
- Nie opierać osobistych notatek użytkowników na publicznym systemie plotek NPC.

Przykład: Kael przegrał pojedynek z ASTRA. Silnik potwierdza wynik. Kael zapamiętuje zdarzenie i może ukształtować większą ostrożność lub rewanż, zależnie od osobowości. Nie przestaje być Kaelem po zmianie modelu językowego.

## 5. Mapa i uczenie się świata

Nie trenować modelu językowego od zera na mapie. Trzymać niezależną, wersjonowaną reprezentację świata i moduł nawigacji:
- Ground truth: dane OTBM / dostępne dane serwera, geometria, tile, przejścia, przeszkody, strefy, nazwy miejsc, punkty interakcji, teleporter/poziomy, dostęp zależny od stanu gry. Tylko do kontroli wykonania i narzędzi administratora.
- Map knowledge per character: znane miejsca, odkryte przejścia, pamiętane ścieżki i źródła informacji. Bot może znać ogólną mapę regionów, ale niekoniecznie sekrety i aktualną pozycję innych.
- Navigation: zwykły pathfinding i weryfikacja na serwerze, nie pytanie LLM o każdy krok.
- Perception: ograniczony promień widzenia i zdarzenia przychodzące z silnika. Nie udawać dostępu do informacji niewidzianych przez agenta.
- Przy zmianie mapy invalidować stare trasy i zapisywać wersję świata.

Dla eksperymentu stworzyć trzy profile: (a) znana mapa bazowa, (b) zna tylko miasto startowe, (c) uczy się tras i ważnych miejsc przez eksplorację. Porównać jakość gry, a nie zakładać z góry jedną opcję.

## 6. Model to wymienialny silnik decyzji, nie tożsamość

W projekcie jest już Brain Node/TypeScript, SQLite, adapter rules/local-model i mailbox. Rozszerzać przez provider registry, np. local Ollama, Gemini API, Groq, DeepSeek, Copilot SDK (osobny tryb eksperymentalny, z uwzględnieniem kwot). Nie używać sesji Claude Code lub aplikacji ChatGPT jako stałego backendu produkcyjnej gry.

Warianty:
- Fast rules/behaviour tree: wielokrotnie na sekundę; przejście, walka, cooldowny, odzysk, obrona, follow path.
- Slow LLM: na istotne zdarzenia i komunikaty, w przerwach wybór celów, osobowość, planowanie, narracja, decyzje strategiczne.
- Escalation: droższy model tylko dla trudnej decyzji, testu lub długiego dialogu.
- Twarde budżety: tokens in/out, USD per call, agent, model, godzina/dzień, timeout, concurrency, cooldown, cache; fallback do rules. Sekrety w .env, brak logowania danych prywatnych w jawnych promptach.

Skuteczność mierzymy: rozmowy po polsku, spójność postaci, zapamiętywanie, poprawność intencji i schematu, niewymyślanie zdarzeń, decyzje na podstawie percepcji, sprawność PvP, czas odpowiedzi, koszt na 100 interakcji, wpływ na serwer. Nazwy ASTRA/SOL/CLAUDE nie są wiarygodnym benchmarkiem bez rzeczywistej konfiguracji modeli.

## 7. AI Player: sterowanie, akcje, PvP

Cel: pełnoprawna sesja postaci mającej takie same reguły ruchu/ekwipunku/kolizji/skilli jak człowiek. Preferować adapter gracza wykorzystujący sprawdzony klient i jego interfejs do testów, a później porównać z osobnym serwerowym adapterem przy zachowaniu autorytatywnych zasad Canary. Nie zastępować eksperymentu „bot gracz” zwykłym NPC z nazwą gracza.

Pętla:
- world events → percepcja i bieżący stan → wybór celu → planner/LLM (rzadko) → dozwolona umiejętność / sekwencja akcji → adapter klienta/serwera → wynik potwierdzony przez silnik → pamięć.
- Warstwa wykonania: atak, move, chase/retreat, potion, target, pickup, use-item, say, private-message, trade, logout — tylko po potwierdzeniu, że komendy są możliwe i zgodne z kontraktem.
- Długie plany podzielone na krótkie kroki z anulowaniem i korektą po zmianie HP, zablokowaniu drogi, śmierci, zmianie celu.
- PvP w arenie testowej, potem dopiero w strefach właściwej gry; bez nękania, zabijania nowych graczy w pętli, nadużywania przewagi botów i oszustw względem zasad serwera.
- Do replikacji gry testować 3 postacie jako niezależne jednostki z oddzielnymi stanami i logami; nie zakładać, że Claude Code musi fizycznie „klikać w trzy okna”. CLI/test harness ma dostarczyć deterministyczne sterowanie.

## 8. NPC i życie społeczne

Wzorować się na istniejących Ardan, Mira, Brom i warstwach świata/roli/wariantu/tożsamości. Rozbudować stopniowo:
- wiadomości lokalne i prywatne z prawidłową adresacją i prywatnością;
- decyzja, czy postać odpowiada, co pamięta, komu ufa, jak interpretuje kontekst;
- rozmowy między agentami z cooldownem i limitem pętli;
- relacje, kroniki, plotki, reputacja, obietnice i zdarzenia społeczności;
- praktyczne NPC: nauczyciel języka, kronikarz, kupiec, tutor, specjalista branżowy (wiedza zewnętrzna tylko przy rzetelnym źródle/narzędziu);
- zachowanie grywalności: nie każda odpowiedź musi być długa ani „asystencka”.

## 9. Testy z ludźmi

Zamknięte laboratorium dla autora i dwóch kolegów. Obserwować interakcje z AI; za świadomą zgodą testerów zbierać zdarzenia gry (ruch, walka, komunikacja), z ograniczoną retencją i usuwaniem danych. Do rozwoju mechanik preferować telemetrię akcji oraz wybrane, zatwierdzone nagrania/scenariusze. Nie zakładać zgody na kopiowanie prywatnych wiadomości lub trenowanie modeli; dane ludzkich graczy nie stają się automatycznie publiczną pamięcią AI.

Z testów budować:
- benchmark decyzji i zachowań;
- biblioteczkę sprawdzonych sekwencji akcji;
- stylowe profile osobowości i eksperymenty A/B;
- testy regresji i scenariusze PvP.
Nie utożsamiać zapisu historii akcji z wytrenowaniem wag LLM. Fine-tuning/imitation learning to odrębna, późniejsza faza.

## 10. Własny świat, narzędzia i strona

Mapa: wersjonowana kopia OTBM; ręczne narzędzie Canary Map Editor v4.0 jest kandydatem według DOCS/TOOLING.md, zgodność GUI i round-trip wciąż wymagają sprawdzenia. Narzędzia Claude mogą edytować definicje i generować zmiany parametryczne, ale **nie mogą dowolnie niszczyć mapy ani baz**; każda zmiana podlega kopii, diffowi, walidacji i testowi przejścia w kliencie.

Własne UI: na etapie późniejszym opcjonalny panel postaci/agentów, ustawienia preferencji, prywatny asystent, pogląd pamięci/relacji/uprawnień, obserwowalność działań. Nie budować dużego dashboardu przed AI Player MVP.

WWW publiczne: rejestracja, tworzenie postaci, konta, rankingi, newsy, zasady AI i PvP, później sklep. MyAAC pozostaje kandydatem, nie jest obecnie wdrożony. Weryfikacja bezpieczeństwa, backupów, prawa do zasobów gry, prywatności i zasad płatności przed udostępnieniem publicznym. Monetyzacja nie powinna niszczyć równowagi rozgrywki.

## 11. Priorytety wdrożeniowe

P0 — obecny fundament: zachować wszystkie VERIFIED z DOCS/STATUS.md, zwłaszcza poprawny login, bridge, NPC dialog i pamięć.

P1 — trzyosobowa scena: ASTRA/SOL/CLAUDE jako odrębne persony, porównanie 2–3 providerów na tym samym zestawie dialogów i zachowań. Pełna telemetria kosztu, czasu, jakości.

P2 — AI Player Vertical Slice: jeden agent loguje się jako gracz (przez adapter), sam chodzi pomiędzy dwoma punktami, reaguje na gracza, mówi, walczy w arenie, używa mikstury, zapisuje skutek i po restarcie pamięta doświadczenie. To jest **najważniejszy następny kamień milowy**.

P3 — trzy AI Player w jednym świecie: różne role, ograniczona mapa wiedzy, prywatne relacje, samodzielny wybór celu, komunikacja między sobą i z człowiekiem, twarde cooldowny i fair PvP.

P4 — rozbudowa mapy i zamknięty test z dwiema osobami: nowe lokacje, poprawny map-edit roundtrip, zgoda na telemetrię, scenariusze badawcze.

P5 — UI i AI Assistant: osobny obszar danych prywatnych, notatki i narzędzia, bez mieszania z publiczną pamięcią świata.

P6 — publiczna beta: konta WWW, prawa/licencje, operacyjny backup i monitoring, obsługa nadużyć, zasady ekonomii i monetyzacji.

## 12. Kryteria „efektu WOW”

1. Po restarcie agent pamięta konkretne wcześniejsze spotkanie i konsekwentnie zmienia zachowanie.
2. Dwie persony reagują inaczej na to samo zdarzenie, ponieważ mają inne motywacje i historie.
3. Postać AI może wykonać prawdziwą sekwencję ruch/walka/mikstura/odwrót bez kliknięć operatora.
4. Agent nie wie magicznie o tym, czego nie widział; potrafi odkryć trasę lub zaufać wskazówce.
5. Rozmowa z człowiekiem może doprowadzić do trwałej relacji lub grywalnego zadania; decyzja ma potwierdzony skutek w silniku.
6. Zmiana dostawcy LLM nie usuwa biografii i pamięci postaci.
7. Od początku umiemy wykazać, dlaczego agent podjął działanie, ile kosztowało i czy było zgodne z zasadami.

## 13. Zasady dla Claude Code i kolejnych sesji

- Przed implementacją czytać CLAUDE.md, DOCS/STATUS.md, DOCS/ARCHITECTURE.md, DOCS/NPC_RUNTIME.md, DOCS/TOOLING.md i ten dokument.
- Wizja nie jest zleceniem implementacji wszystkich funkcji. Każda zmiana: jedna iteracja, kryterium PASS, dowód na prawdziwym silniku, update STATUS; nie oznaczać PLAN jako VERIFIED.
- Nie używać subskrypcji aplikacji ChatGPT/Claude Code jako nieograniczonego API dla gry.
- Kontynuować obecny stos Canary, Lua overlay, Node/TypeScript Brain, SQLite, natywny Windows, lokalny Ollama; dodawać usługi tylko po uzasadnieniu.
- Nie dotykać danych XAMPP, baz innych projektów, vendor ani prywatnych kluczy; nie publikować usług do internetu bez osobnego etapu bezpieczeństwa.
- Ograniczyć scope do jednego możliwego do zweryfikowania zadania; preferowana następna iteracja: techniczny projekt adaptera AI Player i test end-to-end Kaela.

## 14. Słowami właściciela (2026-11-01)

Uporządkowany zapis notatek właściciela. To jest punkt odniesienia przy każdej iteracji: po co powstaje ten projekt. Co z tego już działa, zapisuje [VISION_PROGRESS.md](VISION_PROGRESS.md).

**Główna myśl.** Zachować klimat i wszystkie aspekty gry dla graczy, a dzięki AI dodać coś, czego zwykły OTS nie ma: świat z postaciami, które zachowują się jak „podstawieni ludzie”, oraz realną pomoc w życiu codziennym wplecioną w grę. Efekt WOW: wracasz po tygodniu, a postać pamięta waszą wyprawę i zachowuje się inaczej, bo coś razem przeżyliście. Największy efekt nie powstanie wtedy, gdy NPC odpowie na każde pytanie, tylko gdy nieprzewidziane historie zaczną powstawać same, w granicach zasad świata.

**Droga.** Najpierw serwer dla właściciela, potem dwóch kolegów, potem otwarty OTS dla ludzi: strona z kontami, postaciami i rankingami, a sprzedaż dodatków dopiero po ustaleniu praw do zasobów. Na stronę na początek wystarczy gotowe rozwiązanie używane przez inne OTS-y.

**Gracze AI.**
- Postać gra jak człowiek: zalogowana w świecie, odpowiada na prywatne wiadomości, reaguje na rozmowy na czacie lokalnym, ma znajomych, własne zasady i doświadczenia.
- Każda postać ma własną pamięć zapisywaną w trakcie gry i cechy wpływające na odpowiedzi i zachowanie. Model jest wymienialny, postać nie.
- PvP ma wyglądać po ludzku: czasem atak dla żartu, dla łupu, dla respektu, zależnie od charakteru i przeżyć. Agent ma dedukować jak człowiek.
- Testowe postacie nazywamy tak, żeby się odróżniały. Lista: ASTRA, SOL, CLAUDE, a dla porównania modeli z konta GitHub: **LUNA** (GPT-6 Luna) i **HAIKU** (Claude Haiku 5.5). Nazwa służy rozróżnieniu, model to konfiguracja.

**Pamięć.** Własny system dla postaci o danym nicku: szczegóły z ostatnich dni, potem kompresja, na przykład co tydzień, do wspomnień decydujących o tym, jak postać widzi świat. Obietnice, ważne relacje i trwałe przekonania nie mogą zniknąć przy kompresji. Warstwy i sposób zapisu mają być wymienne, żeby różne profile pamiętały inaczej: jedna postać długo chowa urazę, inna szybko wybacza, trzecia śledzi interesy.

**Wiedza i mapa.** Otwarte pytania: ile gotowej wiedzy o Tibii dać agentom i czy mają znać całą mapę, czy się jej uczyć. Kierunek: system nawigacji zna mapę, postać zna tylko to, co odkryła lub usłyszała. Trzy profile do porównania są w sekcji 5.

**NPC.** Inny rodzaj agenta: lokalny język, rozmowa na każdy temat, także z życia realnego pasującego do zawodu NPC, żarty, w jednych więcej, w innych mniej. Mogą służyć do tworzenia ciekawych rzeczy w grze.

**Osobisty pomocnik.** NPC albo kontakt na VIP, któremu można prywatnie zapisywać informacje; realna pomoc osobista z historią. Może to być nakładka albo dodatkowe UI.

**Narzędziownik.** Nasze menu w grze: dodatkowe możliwości, ustawienia agentów indywidualne dla gracza.

**Świat i narzędzia.** Świat dostosowany po swojemu: nowe miejsca, lepsze rozmieszczenie NPC, edycja mapy. Narzędzia potrzebne są i właścicielowi, i Claude do wdrażania zmian.

**Dwóch kolegów.** Wpuścić ich do gry i zapisywać ich wspomnienia na podobnych zasadach jak dla AI, za ich zgodą. Takie dane mają pomóc ulepszyć agentów albo posłużyć innemu rodzajowi gracza.

**Modele.** Copilot z konta właściciela ma ograniczone kredyty, więc model dobieramy tak, żeby nie zużyć ich od razu, i monitorujemy zużycie. Agent wykonuje plan przez mechanikę gry, a AI pyta tylko wtedy, gdy sytuacja wymaga nowej decyzji:

| Sytuacja | Obsługa |
| --- | --- |
| Ruch po trasie, atak, potion, łup | Kod i reguły, bez modelu |
| Dokąd iść, odpowiedź graczowi, wybór zadania | Tani model, rozumowanie `low` |
| Nieudany plan, sprzeczne cele, trudna negocjacja | `medium`, mocniejszy model dopiero po testach |
| Analiza długiej historii | Osobne zadanie poza grą |

Limity startowe: 1 równoległe zapytanie, do 6 decyzji na minutę, kontekst 2–4 tys. tokenów, odpowiedź 150–300 tokenów, jedno ponowienie, 5 kredytów na pierwszy test, 20 kredytów dziennie, po limicie reguły lokalne. Budżet zapisany trwale, restart go nie zeruje. Porównanie modeli: 30 takich samych scenariuszy (rozmowa, handel, wybór celu, przeszkoda), liczymy poprawność, spójność postaci, opóźnienie i prawdziwe kredyty.
