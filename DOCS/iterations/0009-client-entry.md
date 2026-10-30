# Iteracja 0009: wejście klienta do świata
Data: 2026-10-30
Stan: VERIFIED w prawdziwym kliencie

## Cel i warunek odbioru
Pierwszy punkt odbioru: działające wejście do świata przez OTClient. Objaw użytkownika: „Failed to connect to server (HTTP)”, w logu „Could not establish connection”.

## Diagnoza
1. **Procesy i porty**: komputer uruchomiono ponownie o 16:04, wszystkie cztery procesy były zatrzymane, porty puste. To była przyczyna błędu użytkownika; assets pobrały się poprawnie.
2. **Endpoint**: po starcie `POST /login` zwraca świat `TibiaAI`, port 7172, 7 postaci.
3. **Zasoby**: `appearances` klienta i serwera mają ten sam SHA-256 (`5997985a…`).
4. **Klient**: zautomatyzowany test odkrył drugi problem: postacie startują w Strongarm (miasto 8), tysiące kratek od Ardana i Miry w Montag.

## Zmiany
- `scripts\client.ps1` sam uruchamia serwer, gdy nie działa.
- `tools\otclient-autotest\` + `scripts\client-autotest.ps1`: mod klienta instalowany na czas testu; wypełnia formularz logowania, wybiera postać, chodzi, wita NPC, wylogowuje się i wchodzi ponownie. Zapis logu i szczytowego RAM.
- `scripts\lab-fixture.ps1`: start `Knight Sample` i `GOD` w Montag (odwracalne).

## Weryfikacja
| Test | Wynik | Dowód |
| --- | --- | --- |
| Logowanie HTTP, lista postaci, wejście, ruch, widoczność Ardana, powitanie z odpowiedzią Brain, wylogowanie, ponowne wejście | PASS 10/10 | `runtime/logs/client-autotest-20261030-211623.log` |
| Rendering mapy, postaci i interfejsu | PASS | `runtime/evidence/client-entry-20261030.png` |
| Regresja Brain przed zmianami | PASS 27/27 + typecheck | `pnpm test` |

Test obsługuje prawdziwy klient, ale sterowany skryptem; ręczne wejście użytkownika nie było protokołowane jako osobny test (log wskazuje jednak na kliknięcia użytkownika podczas gry postacią Kael).

## Ograniczenia
Serwer nie startuje sam z systemem. Polskie znaki w kliencie: nadal niesprawdzone.

## Następne zadanie
Eksperyment bojowy (iteracja 0010).
