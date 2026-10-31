# Plan: agent walczący przez `client_player`

Stan: **PLAN**. Test `client-autotest -Scenario combat` to skrypt, który wykonuje z góry zapisane kroki. Nie jest autonomicznym graczem, a Kael niczego się w nim nie uczy.

| Co potrafi Kael dziś | Skrypt testowy | Agent sterowany z Brain |
| --- | --- | --- |
| Logowanie i ruch | tak | nie |
| Atak, mikstura, śmierć | tak, w ustalonej kolejności | nie |
| Reakcja na sytuację | nie, tylko kroki scenariusza | nie |
| Rozmowa przez model | nie | nie, Kael nie jest wpisany w `agents.json` |

## Czego brakuje
**Kanał sterowania.** Proces klienta z modem-adapterem czyta polecenia i zgłasza wyniki. Najprościej tym samym mailboxem plików, z osobnym katalogiem na agenta i tym samym kontraktem. Adapter nie może wymagać okna: potrzebny jest cykl życia procesu (start, restart, wykrycie zawieszenia).

**Obserwacje** (nowe zdarzenia po obu stronach kontraktu):
| Zdarzenie | Pola | Skąd |
| --- | --- | --- |
| `self_status` | hp, mana, pozycja, poziom, stan celu | klient, co 1 s |
| `creature_seen` | id, nazwa, odległość, procent hp, czy wrogi | `g_map.getSpectators` |
| `damage_taken` | wartość, źródło | komunikaty klienta |
| `combat_ended` | wynik: zabity, ucieczka, śmierć | klient i serwer |

**Akcje** (rejestr `actions.ts`, capability już są w `actorTypes.client_player`):
| Akcja | Capability | Silnik sprawdza |
| --- | --- | --- |
| `attack_target` | `melee` | zasięg, pz, cel |
| `use_item_self` | `use_item` | zasoby, cooldown |
| `walk_to` | `walk` | kolizje |
| `flee_to` | `walk` | kolizje |

## Moduły wielokrotnego użytku
Moduły działają w adapterze, bez czekania na model, a model tylko je wybiera i komentuje. Pętla leczenia nie może czekać 3 s na odpowiedź.

| Moduł | Parametry profilu | Co pozostaje poza profilem |
| --- | --- | --- |
| Nawigacja | dystans od celu | kolizje, droga |
| Leczenie | próg hp | zapas mikstur, cooldown |
| Walka | wybór celu, próg ucieczki | zasięg, obrażenia, pz |
| Towarzyszenie | dystans, kogo chroni | ruch jak w `guide.lua` |

Osobowość może zmieniać próg ucieczki albo wybór celu. Nie może dać dodatkowej mikstury ani skrócić cooldownu, bo te sprawdza serwer.

## Kolejność
1. Adapter tylko z `self_status` i `say`: Kael widoczny w `ai-status.ps1`, rozmowa przez model.
2. `walk_to` i towarzyszenie, na wzór przewodnika.
3. Leczenie jako odruch adaptera.
4. Walka z allowlisty areny.
5. Scenariusz: zaproszenie w rozmowie, trening, komentarz do rzeczywistego wyniku.

## Ryzyka
- Pamięć: każdy klient to ok. 450–580 MB RAM przy 15,9 GB w komputerze; przy 2–3 agentach trzeba zmierzyć całość.
- GPU: każdy klient renderuje, więc limit klatek jest obowiązkowy (COMPATIBILITY.md). Trzeba sprawdzić, czy kilka okien nie spowalnia modelu.
- Rozłączenie: postać zostaje w świecie, adapter musi to obsłużyć.
