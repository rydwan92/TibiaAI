# TibiaAI — pakiet projektowy dla Claude

Data review: 2026-10-31. Zakres: lokalny katalog projektu, w trakcie migracji Montag → otservbr/Thais. Autor review nie zmieniał kodu, konfiguracji ani baz, nie restartował usług. Ten pakiet jest projektem i review statycznym, nie certyfikatem działania.

## Kolejność czytania
1. REVIEW.md — co faktycznie istnieje, konkretne ryzyka, granice dowodów.
2. DESIGN.md — docelowy sposób działania, wiedza, uczenie, osobowość i ekonomia.
3. DELIVERY.md — kolejność realizacji i kryteria odbioru.
4. CLAUDE_PROMPT.md — gotowe zlecenie do wklejenia Claude po zakończeniu migracji.

Istniejące STATUS, RUNBOOK, CONTRACTS i ADR nadal opisują wdrożenie. Ten katalog opisuje nowy kierunek i nie nadaje planom statusu IMPLEMENTED. W przypadku rozbieżności najpierw sprawdzić kod i aktualny runtime. Nie nadpisywać pracy trwającej w innej sesji. Nie zastępować root NEXT_PROMPT.md, zanim właściciel bieżącej migracji jej nie zakończy.

## Decyzja projektowa
Budujemy mieszkańców świata i graczy z własnymi interesami, ograniczoną wiedzą i historią, a nie generator wiadomości na czacie. Pierwszy cel to samodzielne życie na RL mapie: wyprawa → walka → loot → realny zysk lub strata → zakupy → decyzja, co zmienić. Drugi cel: osobowość i relacje mają zmieniać przebieg wypraw. Dopiero potem rynek między graczami i większe wydarzenia.

Lokalne modele pozostają podstawą. Chmura to przyszła opcja wyłączona domyślnie; ten pakiet nie zleca pobierania modeli ani zakupu API. Nie proponuje aktualnego cennika dostawców.

Realizm oznacza konsekwencję, inicjatywę i omylność. Nie wymaga fikcyjnej biografii prawdziwego człowieka. Dla testu impostora uczestnicy wiedzą, że w grupie jest AI, ale nie wiedzą kto; po rundzie następuje ujawnienie. Poza takim trybem odpowiedź na bezpośrednie pytanie o AI jest uczciwa. To rekomendacja projektowa dla przyszłych sesji z ludźmi, nie opis obecnego identity=in_character.
