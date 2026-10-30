# NPC z lokalnym modelem: jak to działa i jak z tego korzystać

Decyzje i ich uzasadnienie są w [ADR 0008](adr/0008-npc-identity-memory.md). Ten dokument opisuje praktykę.

## Uruchomienie
Wymagania: Ollama z modelem `ornith-1.5:9b`, `TIBIAAI_BRAIN_PROVIDER=local-model` w `.env`.

```
scripts\start.ps1              # świat, Brain i osobny proces Ollamy gry
scripts\status.ps1             # sprawdzenie, także blokady chmury
scripts\client.ps1 -CopyPassword
```

`scripts\ollama.ps1 -Status` pokazuje proces gry na 127.0.0.1:11435. Aplikacja Ollama użytkownika (port 11434) i jej modele chmurowe nie są zmieniane. Blokada chmury dotyczy tylko procesu gry.

Gdy Ollamy nie ma, Brain przechodzi na reguły, a gra działa dalej.

## Rozmowa w grze
1. Podejdź do NPC na 3–4 pola. Ardan patroluje plac, Brom stoi w `old_post` (5014,5003,7), Mira przy stoisku (5020,5003,7).
2. Powiedz `hi` albo imię NPC. Odpowiada najbliższy NPC albo ten nazwany: „Ardanie, ...”, „Bromie, ...”, „Miro, ...”.
3. Przez 45 s kolejne wypowiedzi trafiają do tego NPC bez podawania imienia.

Odpowiedź przychodzi po około 2,5–3,5 s. Jeśli model nie zdąży w 14 s, NPC powie krótką odpowiedź regułową.

## Co NPC pamięta
| Wypowiedź lub zdarzenie | Zapis | Kto może tego użyć |
| --- | --- | --- |
| Rozmowa skierowana do NPC | `direct`, `claimed`, prywatne | ten NPC w rozmowie z tą postacią |
| Przedstawienie się („nazywam sie”, „jestem kowalem”) | `npc_player_facts`, `claimed` | jak wyżej |
| Mowa zasłyszana obok | `heard`, `rumor`, publiczne | ten NPC, jako plotka, w każdej rozmowie |
| Incydent w zasięgu wzroku | `witnessed`, `confirmed`, publiczne | ten NPC |
| Wypowiedź NPC | zapis po wyniku `completed` z silnika | ten NPC |

Co mówisz głośno obok innego NPC, ten NPC słyszy i może powtórzyć jako plotkę. Tak miało być.

Podgląd pamięci (tylko odczyt):
```
node --disable-warning=ExperimentalWarning apps\brain\src\cli\npc-memory.ts ardan 5
```

Incydent do testów: `scripts\incident.ps1 -Id cart_crash -X 5008 -Y 5006`. Zdarzenia opisuje `packages/contracts/npc/world.json`. Świadków pokazuje dziennik: `python -I tools\journal.py --kinds incident`.

## Co jest zapominane
- Szczegóły rozmów i zdarzeń: po 7 dniach, po zamknięciu doby UTC, zostaje streszczenie.
- Streszczenia: na postać limit 12, potem najstarsze o wadze poniżej 7 łączą się w jedno. Na NPC limit 200.
- Streszczenia o wadze poniżej 3 po 30 dniach znikają.
- Dokładne słowa starszych rozmów nie wracają. Streszczenie może też zgubić drobne szczegóły.

Nie są kompresowane: relacja, fakty o graczu, otwarte zobowiązania.

Retencja danych operacyjnych: `observations` i `heard_statements` 8 dni, bo zawierają surowe słowa graczy; `commands` i `action_results` 30 dni; zamknięte zobowiązania 90 dni; dziennik relacji 180 dni. Bieżąca sesja świata nie jest czyszczona. Gdy partia kompresji trzy razy się nie uda, jej szczegóły zostają w `npc_events`, ale kopie w `observations` mimo to znikną po 8 dniach.

Ruch: limit 2000 zdarzeń na NPC na dobę, ważniejsze są zachowywane ponad limit. Powtórzenia w krótkim oknie nie są zapisywane. `memory_stats` trafia do `brain.log` co 10 minut.

## Dodanie NPC
1. `agents.json`: ciało, spawn, trasa, zasięgi (AGENTS.md).
2. `packages/contracts/npc/identities/<klucz>.json`: tożsamość wskazująca wariant.
3. Jeśli trzeba, nowy wariant lub rola w `variants/` i `roles/`.
4. `scripts\sync-server.ps1`, restart, `scripts\selftest.ps1`.

Wariant zmienia charakter i styl, a tożsamość biografię i cele. Żaden z nich nie nadaje uprawnień. Wiedza (`knowledge/montag.json`) trafia do NPC tylko przez `knowledgeScopes` i tylko gdy pasuje do tematu.

## Wydajność
| Stan | Pomiar |
| --- | --- |
| Pamięć modelu | 5,2 GB VRAM, 100% GPU, kontekst 4096 |
| Zimny start | ok. 14–38 s, Brain rozgrzewa model w tle |
| Bez klienta | 46–47 tok/s |
| Klient bez limitu klatek | 8–9 tok/s |
| Klient z limitem 10, 30 lub 60 FPS | 46–47 tok/s |

Skrypty `client.ps1` i `client-autotest.ps1` instalują mod `tools/otclient-framecap` (60 FPS). Jeśli uruchamiasz klienta inaczej, ustaw limit klatek w opcjach grafiki. Bez limitu odpowiedzi trwają 8–15 s i często kończą się regułami.

Po zatrzymaniu `ollama.ps1 -Stop` kończy też proces `llama-server`. Gdy VRAM jest zajęty mimo zatrzymania, sprawdź osierocone `llama-server.exe` w Menedżerze zadań. Jego rodzicem nie może być aplikacja Ollama użytkownika.

## Znane ograniczenia
- Polszczyzna modelu bywa niezręczna, np. „Dobrej poranku”.
- Rozpoznawanie przedstawienia się działa na wzorcach; „mam na imię”, „nazywam się” i lista zawodów. Inne sformułowania zostają tylko w pamięci rozmowy, nie w faktach.
- Model czasem zmyśla drobiazgi ze swojej roli. Nie mają one skutków w świecie.
- Dwie osoby rozmawiające z różnymi NPC dzielą jedną kolejkę, więc czekają po kolei.
- Pole `action` ma dziś tylko `none`. NPC mówi, ale jeszcze nie wykonuje działań z dialogu.
