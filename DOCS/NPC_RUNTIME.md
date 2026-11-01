# NPC z lokalnym modelem: jak to działa i jak z tego korzystać

Decyzje i ich uzasadnienie są w [ADR 0008](adr/0008-npc-identity-memory.md) i [ADR 0009](adr/0009-conversation-actions-marker.md). Ten dokument opisuje praktykę.

## Co tu czym jest
| Element | Co robi | Czego nie robi |
| --- | --- | --- |
| Claude | pisze kod i testy w sesji roboczej | nie działa w czasie gry i nie steruje NPC |
| Brain (`apps/brain`) | czyta zdarzenia ze świata, buduje kontekst, pyta model, wysyła komendy, zapisuje pamięć | nie porusza NPC, tylko zleca |
| Ollama gry (127.0.0.1:11435) | wykonuje inferencję na GPU | niczego nie zapamiętuje i nie uczy się |
| Canary i Lua | wykonuje i potwierdza działania, jest źródłem prawdy o świecie | nie czeka na model |
| Aplikacja Ollama (11434) | Twoje okno czatu, oddzielne od gry | nie pokazuje rozmów z gry |

Model działa lokalnie. Wagi leżą w `C:\Users\<user>\.ollama\models`, wspólnie dla obu procesów Ollamy; proces gry niczego nie pobiera.

W tym projekcie nie ma treningu: wagi modelu się nie zmieniają. Rozmowa to inferencja, a „uczenie się” NPC to zapis do jego pamięci w SQLite, która trafia do kontekstu kolejnego pytania.

Podgląd na żywo, bez żadnego zapytania do modelu:
```
scripts\ai-status.ps1
```
Pokazuje proces Ollamy, stan blokady chmury, model, dostawcę, kolejkę, ostatnią odpowiedź i fallback oraz co robi każdy agent.

## Uruchomienie
Wymagania: Ollama z modelem `ornith-1.5:9b`, `TIBIAAI_BRAIN_PROVIDER=local-model` w `.env`.

```
scripts\start.ps1              # świat, Brain i osobny proces Ollamy gry
scripts\status.ps1             # procesy i porty
scripts\ai-status.ps1          # model, kolejka, agenci, blokada chmury
scripts\client.ps1 -CopyPassword
```

`scripts\ollama.ps1 -Status` pokazuje proces gry na 127.0.0.1:11435. Aplikacja Ollama użytkownika (port 11434) i jej modele chmurowe nie są zmieniane. Blokada chmury dotyczy tylko procesu gry: `CONFIRMED` znaczy, że działający serwer sam zgłasza `cloud.disabled` w `GET /api/status`, a `UNKNOWN`, że tego nie wiemy. Sprawdzenie nie wysyła nic do modelu.

Gdy Ollamy nie ma, Brain przechodzi na reguły, a gra działa dalej.

## Rozmowa w grze
1. Podejdź do NPC na 3–4 pola. Agenci mają przy imieniu znacznik `[AI]`.
2. Powiedz `hi` albo imię NPC. Odpowiada najbliższy NPC albo ten nazwany: „Ardanie, ...”, „Tolku, ...”, „Leno, ...”.
3. Przez 45 s kolejne wypowiedzi trafiają do tego NPC bez podawania imienia.

Odpowiedź przychodzi po około 3–6 s. Jeśli model nie zdąży w 14 s, NPC powie krótką odpowiedź regułową.

| Agent | Gdzie | Kim jest | Umie |
| --- | --- | --- | --- |
| Ardan | patroluje plac | formalny strażnik | rozmowa |
| Brom | 5014,5003,7 | gawędziarz, były strażnik | rozmowa |
| Mira | 5020,5003,7 | zielarka, plotkara | rozmowa |
| Tolek | 5005,5004,7 | żartobliwy przewodnik | rozmowa, prowadzenie |
| Lena | 5007,5002,7 | nauczycielka angielskiego | rozmowa, lekcja, prowadzenie |

## Przewodnik
Powiedz do Tolka lub Leny: „pokaż mi świątynię”, „zaprowadź mnie na plac”. Tolek zna też stoisko Miry i bramę. „Gdzie jest świątynia?” to pytanie, więc dostaniesz opis, a nie marsz.

| Sytuacja | Co się dzieje naprawdę |
| --- | --- |
| Idziesz za nim | po dojściu mówi, że to tutaj, a potem wraca na miejsce |
| Zostajesz w tyle (ponad 4 pola) | zatrzymuje się i czeka 25 s, potem rezygnuje i wraca |
| Mówisz `stop`, `anuluj`, `wystarczy` albo „jednak nie” | przerywa i wraca |
| Alarm | przerywa i idzie do świątyni |
| Wylogujesz się | wraca bez słowa |
| Inny gracz prosi o prowadzenie | słyszy, że przewodnik jest zajęty; nie może też przerwać Twojego marszu |
| Prosisz o miejsce bez drogi („do magazynu”) | mówi, że nie zna drogi, i zostaje |

Ardan i Brom nie prowadzą: wskażą drogę słowami.

## Pierwsze zlecenie
Powiedz do Miry „masz dla mnie zadanie?”. Silnik da Ci list do Broma. Zanieś go i powiedz Bromowi „mam list od Miry”: silnik zabierze list. Wróć do Miry i powiedz „zaniosłem list”: dostaniesz 50 złota, a jej zaufanie do Twojej postaci wzrośnie.

Postęp jest w samej postaci, więc przetrwa restart. To, co mówisz, nie przesuwa zlecenia: „zaniosłem” bez oddania listu nic nie da, a nagrodę dostaniesz tylko raz. Przedmioty i złoto wynikają z `packages/contracts/tasks.json`, a model ich nie rozdaje.

## Lekcja angielskiego
Lena uczy tylko, gdy o to poprosisz: „chcę się uczyć angielskiego, poziom A2”. Poprawia jeden błąd naraz i pyta dalej. „Koniec lekcji” wyłącza tryb, a poziom zostaje na następny raz. Lekcja i wybrany język („mów do mnie po angielsku”) dotyczą jednej postaci u jednego NPC i przetrwają restart. Alarm przerywa ćwiczenie. Na spacer: włącz lekcję i poproś Lenę, żeby zaprowadziła Cię do świątyni. To nie jest kompan do expienia, bo agenci nie walczą.

## Czego agenci są nauczeni
Agenci nie są trenowani: wagi modelu się nie zmieniają. Uczymy ich plikami wiedzy w `packages/contracts/npc/knowledge/`. Do każdej rozmowy trafiają najwyżej 4 wpisy pasujące do tematu, wybrane spośród zakresu danego NPC.

| Plik | Co zawiera | Zakres |
| --- | --- | --- |
| `server-mechanics.json` | profesje, mikstury, komendy, śmierć, brak potworów; każdy wpis ma źródło z tej wersji serwera | wszyscy |
| `thais.json` | geografia, miasta z mapy, mieszkańcy | wszyscy, część tylko strażnicy lub zielarka |
| `world-lore.json` | opowieść projektu: historia, rada, handel. Fikcja, nie mechanika | wszyscy, część tylko role |

Nowy wpis: `id`, `category`, `scope`, `tags` i `text`, a mechanika także `source`. Działa dla wszystkich NPC z tym zakresem i dla każdego modelu, po restarcie Brain. Tagi trzeba dobierać do słów, których użyje gracz: dopasowanie to pierwsze 4 litery.

## Polityki rozmowy
`open` to rozmowa na każdy temat: agent zna rzeczywisty świat jak wykształcony człowiek i nie udaje niewiedzy. `immersive` to tylko konwencja gry, `tutor` nauka języka. Ustawia je rola lub tożsamość (`conversationPolicy`). Przy pytaniu ogólnym prompt nie zawiera pracy, zakazów ani wspomnień, zostają charakter i styl.

Wiedza ogólna pochodzi z modelu i brzmi pewnie także wtedy, gdy jest błędna. Fakty o tym świecie gry pochodzą wyłącznie z konfiguracji, obserwacji i potwierdzonych wyników. Model nie ma internetu.

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

Wariant zmienia charakter i styl, a tożsamość biografię i cele. Żaden z nich nie nadaje uprawnień. Umiejętności i dozwolone miejsca są w `agents.json` (`skills`, `guidePlaces`), a rola dopuszcza intencje (`allowedIntents`). Żeby kolejny NPC prowadził: dopisz mu `skills: ["guide"]`, `guidePlaces` i teksty `guide*`, a jego roli intencje `guide_to` i `guide_cancel`.

Wiedza trafia do NPC tylko przez `knowledgeScopes` i tylko gdy pasuje do tematu. Wpis o mechanice (`knowledge/server-mechanics.json`) wymaga źródła z tej wersji serwera. Poradniki do innych wersji Tibii się nie liczą. Gracz nie zmienia tych plików rozmową.

## Wydajność
| Stan | Pomiar |
| --- | --- |
| Pamięć modelu | 5,2 GB VRAM, 100% GPU, kontekst 4096 |
| Zimny start | ok. 14–38 s, Brain rozgrzewa model w tle |
| Bez klienta | 46–47 tok/s |
| Klient bez limitu klatek | 8–9 tok/s |
| Klient z limitem 10, 30 lub 60 FPS | 46–47 tok/s |

Odpowiedzi w polityce `open` są dłuższe niż w iteracji 0012 (do 400 znaków, dwie linie czatu), więc model pracuje około 3–5 s zamiast 2 s.

Skrypty `client.ps1` i `client-autotest.ps1` instalują mod `tools/otclient-framecap` (60 FPS). Jeśli uruchamiasz klienta inaczej, ustaw limit klatek w opcjach grafiki. Bez limitu odpowiedzi trwają 8–15 s i często kończą się regułami.

Po zatrzymaniu `ollama.ps1 -Stop` kończy też proces `llama-server`. Gdy VRAM jest zajęty mimo zatrzymania, sprawdź osierocone `llama-server.exe` w Menedżerze zadań. Jego rodzicem nie może być aplikacja Ollama użytkownika.

## Znane ograniczenia
- Polszczyzna modelu bywa niezręczna, np. „Dobrej poranku”.
- Rozpoznawanie przedstawienia się działa na wzorcach; „mam na imię”, „nazywam się” i lista zawodów. Inne sformułowania zostają tylko w pamięci rozmowy, nie w faktach.
- Model czasem zmyśla drobiazgi ze swojej roli. Nie mają one skutków w świecie.
- Dwie osoby rozmawiające z różnymi NPC dzielą jedną kolejkę, więc czekają po kolei.
- Jedyne działanie z dialogu to prowadzenie. Agenci nie walczą (COMBAT_PLAN.md).
- Mechanizm blokady w połowie drogi nie był sprawdzony w kliencie; sprawdzono miejsce bez drogi i ten sam ruch przy `move_to`.
