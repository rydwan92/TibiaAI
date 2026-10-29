# TibiaAI — pakiet startowy
Przygotowano 29.10.2026. To specyfikacja i zlecenie wdrożenia, nie uruchomiony serwer.

> Po sesji 1 (29.10.2026) serwer działa lokalnie. Aktualny stan: DOCS/STATUS.md. Uruchamianie: DOCS/RUNBOOK.md
> (`scripts\setup.ps1` raz, potem `scripts\start.ps1` / `scripts\stop.ps1`).

## Zacznij tutaj
1. Rozpakuj zawartość do katalogu projektu TibiaAIServer. CLAUDE.md powinien znajdować się w jego głównym katalogu, obok DOCS.
2. Jeżeli pliki o tych nazwach już istnieją, zachowaj ich kopię i scal treść. Nie nadpisuj swojej dokumentacji.
3. Otwórz ten katalog w Claude Code. Wklej całą zawartość FIRST_PROMPT.md.
4. Claude najpierw sprawdzi komputer i dostępne wersje, potem uruchomi świat i przygotuje Ardana. Brak grafik lub dostępu do pulpitu ma zostać wyraźnie zgłoszony.
5. Następną sesję rozpocznij promptem z NEXT_PROMPT.md.

Na screenie projekt jest w C:\xampp\htdocs\projects\tibia\TibiaAIServer. To nie jest aplikacja PHP. Sprawdź, czy Apache nie udostępnia tego folderu: sekrety, kod i bazy nie powinny być obsługiwane przez katalog publiczny. Preferowany nowy katalog to C:\dev\TibiaAIServer, ale nie przenoś automatycznie istniejącego projektu ani nie zmieniaj XAMPP.

## Materiały
- CLAUDE.md — stałe reguły pracy i dokumentowania.
- FIRST_PROMPT.md — kompletne pierwsze zlecenie.
- DOCS/VISION.md — doświadczenie gracza i rozwój.
- DOCS/ARCHITECTURE.md — komponenty, granice i struktura.
- DOCS/CONTRACTS.md — projekt komunikacji i walidacji.
- DOCS/PLAN.md — etapy oraz warunki odbioru.
- DOCS/SOURCES.md — sprawdzone źródła i rozbieżności wersji.
- DOCS/COMPATIBILITY.md — tabela do wypełnienia rzeczywistymi wynikami.
- DOCS/RUNBOOK.md — szablon instrukcji lokalnej.
- DOCS/STATUS.md — bieżący stan i następne zadanie.
- DOCS/TESTING.md — scenariusze weryfikacji.
- DOCS/adr/0001-foundation.md — decyzja architektoniczna.
- DOCS/iterations/TEMPLATE.md — zapis każdej iteracji.

Nie zawiera binariów, grafik Tibii, map ani kluczy API. Nie zakłada, że subskrypcja narzędzia programistycznego opłaca model działający w grze.
