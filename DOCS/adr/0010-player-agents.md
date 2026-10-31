# ADR 0010: autonomiczni gracze przez prawdziwego klienta
Status: ACCEPTED (2026-10-31). Rozwija ADR 0006.

## Kontekst
Właściciel chce postaci, które po prostu grają: chodzą po mapie, walczą, giną, wracają, rozmawiają i wymieniają się wiedzą. ADR 0006 ustalił granicę: bojowy agent jest graczem w prawdziwym kliencie, a nie NPC ze skryptem. Trzeba było zdecydować, gdzie mieszkają odruchy, skąd agent zna świat i jak agenci dzielą się wiedzą.

## Decyzja
1. **Jeden klient na agenta.** Wszystko idzie pakietami klienta, więc serwer stosuje te same reguły co dla człowieka. Bez patcha C++ i bez zmiany protokołu.
2. **Odruchy w ciele, wybory w umyśle.** Walka, leczenie i chód działają w Lua co 300 ms i nie czekają na nic. Model wybiera cel co 1–3 minuty. Brak modelu oznacza wybór z temperamentu.
3. **Model wybiera, nie wymyśla.** Odpowiedź to `choice` z enum działań możliwych teraz. Tekst modelu nigdy nie jest kodem ani poleceniem.
4. **Wiedza między agentami wyłącznie przez mowę.** Bez wspólnej pamięci. Pozycja, rada i ostrzeżenie są w treści wiadomości, którą widać w kliencie.
5. **Mapę pokazuje silnik.** OTBM mówi, co jest na polu, a silnik, czy da się po nim przejść. Trasy liczy Brain z bitmapy pól i linków; klient idzie odcinkami do 6 pól.
6. **Własna tabela spawnów zamiast cudzej mapy.** Niebezpieczeństwo rośnie z dystansem od miasta i z głębokością. Przenosiny na `otservbr.otbm` (184,8 MB) odłożone: mapa `canary` ma 7 miast i wystarcza.
7. **Wspólny budżet modelu:** 8 wywołań na minutę dla całej floty.
8. **Rola gracza.** Do decyzji właściciela agent nie ujawnia, że jest AI (`identity` w `players.json`). Warunek: dotyczy prywatnego laboratorium; inni ludzie są uprzedzani przed wejściem.
9. **Świat PvP.** `worldType = "pvp"`. Atak to decyzja umysłu, a nie odruch: odruch to tylko odpowiedź na zgłoszony przez serwer atak na tę postać. Strony rozróżnia wiersz „You lose”, nie sam podpis ataku.

## Odrzucone
- **Agent jako NPC z walką:** omija reguły gracza, nie ma ekwipunku ani śmierci.
- **Sterowanie pamięcią klienta lub zewnętrzny bot:** kruche, a API Lua klienta daje wszystko, czego trzeba.
- **Wspólna pamięć floty:** szybsza nauka, ale agenci przestają być odrębnymi osobami i znika wartość rozmowy.
- **Pathfinding wyłącznie po stronie klienta:** klient zna tylko to, co widzi; zachłanne podejście utknęło w 33 polach na 4 minuty.

## Konsekwencje
- Około 540 MB RAM na klienta. Trzy agenty i model mieszczą się w 15,9 GB, ale wolnej pamięci zostaje niewiele.
- Zestawy są wyjątkiem deweloperskim, dopóki nie ma handlu.
- Skan mapy trzeba powtarzać po każdej jej zmianie i po nim zrestartować Canary.
- Mały model zapętla się w rozmowie, stąd limit odpowiedzi i filtr powtórzeń.

## Rollback
`scripts\player-agents.ps1 -Stop`. Brain bez działających klientów nic nie robi, bo nie ma świeżego `state.json`. Spawny cofa zastąpienie `game/world/canary-monster.xml` pustym plikiem z `vendor/canary-src` i `scripts\sync-server.ps1`.
