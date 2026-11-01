# Iteracja 0014 — autonomiczni gracze w świecie
Data: 2026-10-31
Stan: VERIFIED w prawdziwych klientach, z wyjątkami w sekcji „Ograniczenia”
Commit projektu: `f58b71b` na gałęzi `feat/player-agents`. Upstream: Canary `fe0f932`, OTClient `dd56414`.

## Cel i warunek odbioru
Kilka postaci gra samo w prawdziwym kliencie: wychodzi z miasta, poluje, zmienia piętra, ginie, wraca, pisze do innych i pomaga im. Wybory są ich własne i zależą od doświadczeń. Odbiór: agent sam zdobywa doświadczenie na mapie, ginie i wraca bez pomocy, a wiedza przechodzi między agentami wyłącznie przez wiadomości.

## Zmiany
- **Mapa:** `tools/world_atlas.py` (przejścia, 180 teleportów, 11 922 fragmenty), skan silnika `survey.lua` (pola, drzwi), `apps/brain/src/players/nav.ts` (trasy A*, drzwi, teleporty, droga w obie strony).
- **Świat:** `tools/make_spawns.py`, `game/world/canary-monster.xml` (2339 potworów), `hunting-grounds.json` (397 łowisk). Świat nie jest już pusty, poprawiono wiedzę NPC (`mech-spawns`, `mech-travel`, `lore-quiet`).
- **Ciało:** `tools/otclient-agent/agent.lua`: walka, rezygnacja z nieosiągalnego celu, runy, drzwi, lina, łopata, loot, jedzenie, VIP, `follow`, konsola prywatnych rozmów i zakładki.
- **Umysł:** podział na `types`, `knowledge`, `choices`, `mind`, `fleet`. Plan modelu, samotność, kolejka odpowiedzi, koniec rozmowy, filtr powtórzeń, rady i ostrzeżenia, wspólne wyprawy, wołanie o pomoc, podróże do miast, rozmowy z NPC.
- **Zestaw:** kołczan paladyna, czary profesji, odświeżenie po śmierci. Wyjątek deweloperski, tylko `devCharacters`.
- **Pomiar:** `scripts/player-run.ps1`, `metrics.json`, `player-agents.ps1 -Status`.
- ADR 0010, PLAYER_AGENTS.md.

## Weryfikacja
Testy jednostkowe: `node --test test/*.test.ts` w `apps/brain`: 121/121 PASS. `tsc --noEmit`: PASS. Self-test Lua `scripts\selftest.ps1`: 36/36 PASS. `scripts\verify.ps1 -Client`: NOT RUN w tej iteracji, bo testy klienta wymagają zatrzymania agentów.

Biegi w 3 prawdziwych klientach, raporty w `runtime/evidence/`:

| Raport | Czas | Kael | Sira | Ravn | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `player-run-20261031-180759` | 20 min | zabite 13→26, exp +373 | 2→8, 1 śmierć, exp −65 | 34→50, exp +495, pomógł Sirze | 0 błędów ciała, min. wolne RAM 0,7 GB |
| `player-run-20261031-182109` | 12 min | 26→35, exp +270 | 8→8, exp 0 | 50→77, exp +604 | Sira bez strzał i czarów, przyczyna poniżej |
| `player-run-20261031-184253` | 15 min | 42→61, exp +453 | **10→41, exp +630**, miejsca 18→43 | 87→116, exp +851, poziom 9, Alexandria | Po kołczanie Sira gra normalnie; doszła do Katorgi i tam utknęła |
| `player-run-20261031-185500` | 10 min | nie grał | 45→51 | nie grał | **Nieważny dla współpracy:** `-Stop -Only` zatrzymał wszystkich; naprawione |
| `player-run-20261031-190818` | 12 min | 63→71, exp +184, **wyprawy 0→2** | 51→57, exp +156, **wyprawy 0→2** | 122→143, exp +516 | 0 błędów ciała, min. wolne RAM 0,7 GB |

| Sprawdzenie | Wynik | Dowód |
| --- | --- | --- |
| Agent sam dochodzi do łowiska i poluje | PASS | `diary.log`, „dotarlem na miejsce”, „zabilem” |
| Loot w plecaku | PASS | złoto 11–90 u agentów |
| Zmiana piętra w trakcie trasy | PASS | „zmiana pietra”, schody i dziury; Sira na piętrze 8, Ravn 6 |
| Podróż przez teleporty | PASS | Ravn w Alexandrii (5471,5087,7), Sira w Katordze (4768,4184,6) |
| Śmierć, powrót, nowy zestaw | PASS | Sira 17:01:37, poziom 8→7→8 |
| Odczucia po śmierci | PASS | strach 1,00 w dzienniku |
| Prywatne wiadomości i odpowiedzi w zakładkach | PASS | zrzuty ekranu użytkownika, `diary.log` |
| VIP i stan online | PASS | `state.json`: `Ravn=True, Kael=True` |
| Rada przechodzi wiadomością | PASS | „Ravn poleca”, „Kael poleca” |
| Prośba o pomoc i reakcja | PASS | Sira 17:00:56, Ravn 17:01:02 rusza na podane pole |
| Odmowa pomocy | PASS | „Sira prosi o pomoc, ale nie dam rady” |
| Wspólna wyprawa: spotkanie, zgubienie, odnalezienie, rozstanie | PASS | Kael 17:58:18, 18:02:55, 18:07:34 |
| Runa w walce | NOT RUN | zestaw ma runy, brak osobnego dowodu użycia |
| Lina i łopata w trasie | NOT RUN | trasy je zawierają, dziennik nie rozróżnia rodzaju zmiany piętra |
| Rozmowa agenta z NPC | NOT RUN | opcja istnieje, model jej nie wybrał w biegach |
| Prawdziwy człowiek rozmawia z agentem | NOT RUN | zachowanie opisane, nie sprawdzone |

## Znalezione przyczyny
- `addItem` z czterema argumentami tworzy `count` osobnych sztuk (kolejny stos kończy w innym miejscu), dlatego zestaw dawał jedną strzałę.
- Łuk w tej wersji bierze strzały wyłącznie z kołczanu w prawej ręce, slot amunicji nic nie daje.
- Czary trzeba się nauczyć. Bez tego paladyn nie leczył się i zginął.
- Klucze pól nakładały się przy x powyżej 16 384.
- Teleporty bywają jednokierunkowe: Sira utknęła w Katordze i wróciła ręcznym wpisem pozycji w bazie gry, gdy była offline.
- Mały model zapętla rozmowy, stąd limit 3 odpowiedzi w 5 minut i filtr powtórzeń.

## Dokumentacja
STATUS, RUNBOOK §5a, CONTRACTS, COMPATIBILITY, TOOLING, ARCHITECTURE, GAME_DIRECTION (mapa, pomysły na grę), PLAYER_AGENTS (nowy), ADR 0010 (nowy).

## Ograniczenia / rollback
- Zestaw, strzały i czary to wyjątek deweloperski, dopóki nie ma handlu i nauczycieli.
- Wolna pamięć spada do 0,7 GB przy 3 klientach i modelu. Czwarty agent wymaga drugiego modułu RAM albo mniejszego klienta.
- Część drzwi jest zamknięta na klucz. Agent traci 30 s na każde, zanim je ominie.
- Rozmowy są krótsze, ale nadal bywają puste; model myli fakty o grze.
- Tihamah, Strongarm i Katorga nie są celami, bo brak drogi w obie strony.
- Rollback: ADR 0010.

## Następne zadanie
NPC sprzedawca w Montag: agent sam sprzedaje łup i kupuje mikstury oraz strzały. To usuwa największy wyjątek deweloperski i daje powód do powrotu do miasta.
