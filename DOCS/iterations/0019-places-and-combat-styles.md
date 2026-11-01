# Iteracja 0019 — miejscówki, zwiedzanie, walka według profesji
Data: 2026-11-01
Stan: VERIFIED w klientach dla miejscówek; walka na dystans IMPLEMENTED, bez osobnego pomiaru
Commit projektu: niezacommitowane, na gałęzi `feat/player-agents` po `f58b71b`.

## Cel i warunek odbioru
Właściciel: agenci mają pamiętać miejscówki, wiedzieć, gdzie exp idzie szybciej i po co tam byli, więcej zwiedzać. Sorcerer, paladyn i druid walczą z dystansu, knight z bliska. Runy i mikstury zależą od poziomu. Odbiór: postać wraca na miejsce wybrane z własnego wyniku, także bez modelu, a lista zakupów rośnie z poziomem.

## Zmiany
- `players/places.ts` (nowy): własna mapa postaci. Pobyt w obszarze 48×48 liczy minuty, exp, złoto, zabicia, a sklep, depo i port są zapisane z tym, po co tam się chodzi.
- `choices.ts`: opcje `spot_1`, `spot_2` z wynikiem exp/h, pola `risk` i `value` zamiast czytania polskich etykiet (R04), nieużywane zejścia na początku listy, potrzeba many dla magów (R05).
- `mind.ts`: `TWOJE MIEJSCA` w promptcie, „idź w stronę” to trasa 45 pól.
- `knowledge.ts`: `runesFor` według prawdziwego poziomu magii, `potionsFor`, `suppliesFor`.
- `agent.lua`: `keepRange` dla paladyna, sorcerera i druida, mikstury według poziomu.
- `players.json` `potions`, `tools/make_shop.py`: mocniejsze mikstury i runy.

To jest zapis doświadczeń i reguła wyboru, nie wytrenowany model.

## Weryfikacja
`players.test.ts` w całości 152/152 PASS.

| Sprawdzenie | Wynik | Dowód |
| --- | --- | --- |
| Miejscówki zapisują się w grze | PASS | `diary.log`: „nowa miejscowka: na polnoc od Thais, na powierzchni, poluje na Wolf”, „zapamietuje: depo…” |
| Model wraca na własne miejsce | PASS | Ravn 22:53:06: `spot_1: Rat to za malo expa, a wilki daja dobre tempo i mnie nie zabija` |
| Wybór bez modelu | PASS | Kael 23:04:01 `spot_1`, Ravn 23:04:12 `travel_kazordoon`, bieg bez modelu |
| Śmierć obniża wagę bez czytania tekstu | PASS | test jednostkowy, `risk` 0.8 |
| Runy i mikstury według poziomu, zapasy many | PASS | testy jednostkowe. W kliencie tylko poziom startowy |
| Trzymanie dystansu w walce | NOT RUN jako pomiar | Sira przybrała +835 i +94 exp, ale nie mierzono dystansu |
| Mocniejsze mikstury w grze (poziom 50+) | NOT RUN | postacie mają poziom 9–11 |

## Ograniczenia / rollback
- Czary nadal uczone przez wyjątek deweloperski; `spellsFor` nie zna stanu gry (R02).
- Wiedza projektanta i postaci rozdzielona tylko dla miejscówek; łowiska z atlasu nadal są znane wszystkim (R06).

## Następne zadanie
M2 z iteracji 0018.
