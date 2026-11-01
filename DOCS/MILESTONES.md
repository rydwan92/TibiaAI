# Kamienie milowe Stevium

Plan drogi do miejsca, w którym ludzie chcą u nas grać właśnie z tymi agentami. Każdy kamień kończy się czymś, co człowiek poczuje w grze, i ma kryterium, które da się sprawdzić. Stan szczegółowy: [VISION_PROGRESS.md](VISION_PROGRESS.md).

Dlaczego ktoś miałby tu grać zamiast na zwykłym OTS: postacie pamiętają go i piszą pierwsze, świat zmienia się także bez niego, zawsze ktoś jest online, ma z kim polować, z kim się kłócić i przed kim się chwalić.

| # | Kamień | Co czuje gracz | Kryterium odbioru | Stan |
| --- | --- | --- | --- | --- |
| S1 | Ktoś mnie pamięta | Po przerwie postać pisze pierwsza, wspomina wyprawę, trzyma obietnice | Wiadomość odebrana przez klienta człowieka, oparta na zapisie z gry | VERIFIED, iteracja 0022 |
| S2 | Świat ma życie towarzyskie | Na czacie lokalnym słychać, co się działo, można dopytać i dowiedzieć się czegoś | Rozmowa o wydarzeniu w kliencie, plotka podana jako plotka, koszt poniżej 25 kredytów na godzinę | VERIFIED dla rozmowy; koszt jeszcze bez pomiaru po zmianie |
| S3 | Świat jest wielki | Agentów spotyka się w różnych miastach, opowiadają, co widzieli | Każdy z 5 starszych agentów był w co najmniej 3 miastach i wrócił statkiem | Początek: Haiku w Carlin, Vesna w drodze do Kazordoon |
| S4 | Postacie rosną jak gracze | Agent ma lepszy sprzęt, nowe czary, chwali się nimi | Co najmniej 3 postacie kupiły zbroję za własne złoto i ją noszą | VERIFIED: Kael, Luna i Haiku noszą kupiony hełm |
| S5 | Rywal i przyjaciel | Ktoś mnie lubi, ktoś się mści, jest o co walczyć | Rewanż po porażce z pamięci, pojedynek za zgodą na arenie | Częściowo: żart i odwet VERIFIED |
| S6 | Serwer, który po prostu działa | Wchodzę kiedy chcę, ktoś zawsze gra | 24 godziny bez ręcznej pomocy, sam wraca po awarii i po zapisie o 06:00 | IMPLEMENTED, `scripts\keeper.ps1`, strażnik działa, awarii jeszcze nie było |
| S7 | Wydarzenia | Najazd na Thais, agenci wołają pomoc, wszyscy o tym mówią | Najazd uruchomiony przez reżysera, agenci reagują, tydzień później jeszcze o tym pamiętają | Częściowo: `scripts\event.ps1`, najazd i rozmowy VERIFIED; pamięć po tygodniu nie |
| S8 | Agenci dają zadania | Agent prosi o przysługę, płaci, pamięta, kto pomógł | Zlecenie od agenta wykonane przez człowieka, nagroda potwierdzona przez serwer | PLAN, wymaga handlu między graczami |
| S9 | Ranking i kronika | Widzę, kto jest najlepszy i co się wydarzyło w tym tygodniu | Lista najlepszych i kronika tygodnia na stronie i u NPC | Częściowo: ranking w narzędziowniku |
| S10 | Pierwsi goście | Dwóch kolegów gra bez mojej pomocy | Konto, wejście z innego komputera, jasna informacja o AI i chmurze, zgoda na zapis, kopia zapasowa | PLAN, obserwacja za zgodą gotowa |
| S11 | Własne miejsca | Coś, czego nie ma w innych OTS: Plac Stevium, własni NPC | Nowe miejsce z `tools\map_place.py` działa w kliencie, agenci z niego korzystają | VERIFIED dla Placu Stevium; własny NPC jeszcze nie |
| S12 | Otwarcie | Strona, rejestracja, regulamin, własne grafiki | Publiczna beta po przeglądzie bezpieczeństwa i praw do zasobów | PLAN |

Kolejność ma znaczenie: S6 przed S10, bo gość nie może trafić na wyłączony serwer. S8 wymaga handlu między graczami, który ma też własną wartość: kupiec Sol z wizji.
