# Wizja i doświadczenie gracza

TibiaAI — The Living Outpost. Jedna placówka, kilku rozpoznawalnych mieszkańców, konsekwencje działań. Świat ma być ciekawy już przy trzech postaciach.

## Pierwsza scena
Ardan patroluje. Gracz się wita. Ardan odpowiada i zapisuje spotkanie. Administrator uruchamia alarm treningowy przy bramie. Ardan przerywa patrol, ostrzega, idzie do osiągalnego punktu obserwacyjnego; po odwołaniu wraca. Po restarcie Brain rozpoznaje tego samego gracza. To scenariusz testowy; prawdziwą percepcję potworów dodajemy oddzielnie.

## Pomysły po MVP
| Pomysł | Zachowanie w świecie | Warunek |
| --- | --- | --- |
| Pamięć i reputacja | Ardan pamięta udzieloną pomoc i złamaną obietnicę | Fakty potwierdzone przez silnik, nie tekst gracza |
| Plotki z pochodzeniem | Mira mówi „Ardan powiedział, że…” | Rozróżnienie obserwacji, relacji i pogłoski; TTL |
| Towarzysz wypraw | Kael proponuje cel i punkt spotkania | Najpierw escort, później osobna jednostka bojowa |
| Tablica zleceń | Brak dostawy tworzy zadanie z katalogu szablonów | Stan i nagroda w silniku, limit emisji |
| Reżyser zdarzeń | Alarm, zagubiony kurier, prośba o eskortę | Seed, cooldown, reset; bez dowolnego spawnowania przez LLM |
| Dziennik świata | Oś: obserwacja → decyzja → wykonanie → skutek | Log techniczny najpierw, panel później |
| Eksperyment społeczny | Trzech agentów ma różne cele i dostęp do wiedzy | Lokalna percepcja; brak wszechwiedzącej wspólnej pamięci |

Dziennik pokazuje krótkie uzasadnienie operacyjne i użyte fakty, nie ukryty tok rozumowania modelu. Odtwarzanie obejmuje wejścia i decyzje kontrolera, nie gwarantuje deterministycznej reprodukcji całego silnika gry.

## Poza pierwszym zakresem
Publiczny hosting, ekonomia MMO, PvP, expienie botów, pełne ekwipunki agentów, klany, handel generowany przez LLM, wiele map, głos, duży panel React, boty na cudzych serwerach.
