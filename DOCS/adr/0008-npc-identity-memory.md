# ADR 0008: tożsamość, pamięć i relacje NPC na jednym lokalnym modelu
Status: ACCEPTED (2026-10-30). Uzupełnia ADR 0004 (agenci z danych), 0005 (pochodzenie informacji), 0007 (local-only).

## Kontekst
Agenci mieli wspólną personę w jednym polu i pamiętali tylko liczbę spotkań. Celem są NPC z własną tożsamością, trwałą pamięcią i relacjami z graczami, działające lokalnie na jednej karcie RTX 3060 12 GB. Każdy NPC ma być odrębną osobą, a nie osobnym procesem modelu.

## Decyzja

### Jeden model, wiele instancji
Wszystkie NPC korzystają z jednej załadowanej kopii modelu w osobnym procesie Ollamy na 127.0.0.1:11435. Tożsamość i pamięć powstają z danych przy każdym zapytaniu. Zapytania idą pojedynczo przez kolejkę z limitami. Model nie zmienia wag i nie „uczy się”.

### Warstwy konfiguracji
`world.json` < rola < wariant < tożsamość, pliki JSON w `packages/contracts/npc/`, wersjonowane w repo i tylko do odczytu w trakcie działania. Listy się sumują, wartości proste nadpisują. Wariant i tożsamość nie mogą zawierać `capabilities`, `allowedIntents`, `actions` ani `actor`; walidator to odrzuca. Uprawnienia wynikają wyłącznie z `actorTypes` w `agents.json`. Stan zmienny jest w SQLite, a model nigdy nie zapisuje plików konfiguracji.

### Pamięć per NPC (SQLite, migracja v3)
Rozdzielone tabele, klucz zawsze `npc_key` + `player_guid`:
- `npc_events`: szczegóły z ostatnich 7 dni, z polami `source`, `certainty`, `visibility`;
- `npc_memories`: streszczone epizody;
- `npc_relationships` z dziennikiem `npc_relationship_log`: relacja z postacią i powód każdej zmiany;
- `npc_player_facts`: twierdzenia graczy, zawsze jako `claimed`;
- `npc_commitments`: zobowiązania, poza kompresją;
- `npc_memory_batches`, `npc_memory_stats`: partie kompresji i ruch.

Tożsamość rozmówcy to GUID z silnika, nigdy imię z czatu. Relacja dotyczy postaci, nie konta.

### Percepcja bez globalnego strumienia
NPC zna tylko to, co do niego dotarło: zdarzenie Lua nazywa słuchacza w `agentKey`. Rozmowa skierowana do NPC jest prywatna (`direct`, `claimed`). Mowa zasłyszana w zasięgu słuchu jest publiczna i ma status plotki (`heard`, `rumor`). Incydent dostają tylko agenci w zasięgu wzroku (`witnessed`, `confirmed`).

### Odczyt pamięci
`MemoryRetriever` ma implementację tekstową i jest gotowy na embeddingi. Filtr po `npc_key` i rozmówcy działa w SQL, przed oceną podobieństwa, więc podobny tekst nie wyciągnie cudzego wspomnienia.

### Kontekst i decyzja
`buildContext` ma budżet znaków. Zasady, tożsamość i wypowiedź gracza nie są obcinane. Pozostałe sekcje przechodzą według priorytetu, a kolejność w prompcie stawia fakty i świeże obserwacje tuż przed słowami gracza. Odpowiedź przychodzi przez `format: <schema>` z `think: false` i jest walidowana (`parseDecision`). Pole `action` ma listę z capabilities.

Pytanie o rozmówcę lub o wydarzenia ustawia `mustMention`: odpowiedź bez tych informacji jest ponawiana raz. Powód to pomiar: model 9B odpowiadał z własnej biografii, mimo że fakt był w prompcie (0/3 poprawnych zawodów przed zmianą, 3/3 po niej).

### Skutki dopiero po potwierdzeniu silnika
Plan zapisywany jest przy komendzie (`commands.plan_json`). Wypowiedź NPC, relacja i zobowiązanie trafiają do pamięci dopiero po wyniku `completed`, dokładnie raz (`takePlan`, `applyConfirmedReply`). Odrzucona odpowiedź nie zostawia śladu. Model nie potwierdza działań i nie tworzy przedmiotów.

### Izolacja rozmów
`conversationId = npc:guid` z numerem wersji: nowsza wypowiedź gracza unieważnia starszą odpowiedź. Komenda niesie `toPlayerGuid`, a Lua odrzuca ją, gdy adresata nie ma (`addressee_gone`). Wypowiedź trafia do jednego NPC: nazwanego (także w wołaczu), rozmawiającego, a przy powitaniu najbliższego.

### Relacje odporne na polecenia
Zmiana zaufania to krok ±1 z sentymentu oceniającego zachowanie, z limitem 3 na dobę i powodem w dzienniku. Tekst „ustaw zaufanie na maksimum” nie ma drogi do bazy.

### Kompresja
Osobne zadanie w tle, tylko po 60 s bezczynności rozmów. Partia to NPC + rozmówca + zamknięta doba UTC starsza niż 7 dni. Streszczenie powstaje poza transakcją, a zapis wspomnienia i usunięcie dokładnie tych wierszy dzieje się w jednej transakcji. Błąd modelu nie usuwa niczego. Kolejny przebieg po tej samej dobie rozszerza wspomnienie, nie zastępuje go. Partia po 3 nieudanych próbach przestaje blokować kolejkę, a szczegóły zostają.

## Odrzucone
- Osobny model lub proces na NPC: nie mieści się w VRAM i nic nie daje, bo tożsamość jest w danych.
- Baza wektorowa: niepotrzebna przy tej skali, a interfejs pozwala ją dodać później.
- Zapis pamięci w chwili decyzji modelu: zapisywałby rzeczy, które nigdy nie padły w grze.
- Patch C++: niepotrzebny, wystarczają istniejące API Lua.

## Konsekwencje
- Klient bez limitu klatek spowalnia model z 46 do 9 tok/s na wspólnym GPU; limit 60 FPS (`tools/otclient-framecap`) przywraca pełną prędkość.
- Kompresja jest stratna: dokładne słowa starszych rozmów znikają (NPC_RUNTIME.md).
- Jakość języka polskiego zależy od modelu; zdarzają się błędy gramatyczne i dziwne sformułowania. Kandydat do porównania: `bonsai-2:9b`.
