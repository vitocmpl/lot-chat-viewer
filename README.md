# lot-chat-viewer

Visualizzatore non ufficiale, fan-made, per [Extremelot](https://www.extremelot.eu) — trasforma la chat testuale del gioco in una scena spaziale (mappa + modellini dei personaggi), sia per rileggere chat già giocate sia — quando disponibile — per seguire una chat in corso.

## Cos'è e cosa NON è

- **Non ufficiale.** Nessuna affiliazione con Extremelot o con la sua proprietà. Se la proprietà fosse interessata a integrare qualcosa di simile nativamente nel gioco, il codice è qui, MIT, libero di essere riusato o preso a riferimento — contattatemi pure.
- **Sola lettura.** Non invia comandi, non simula azioni, non interagisce in alcun modo con il gioco. Legge quello che il browser del giocatore vede già, nella sua sessione già autenticata, e basta.
- **Non aggiunge funzionalità di gioco.** Nessuna informazione, meccanica o vantaggio che non sia già visibile al giocatore tramite l'interfaccia normale di Extremelot. È solo un modo diverso di *guardare* dati che il giocatore ha già davanti.
- **Non intercetta né salva nulla lato server.** Non esiste un backend. Tutto gira client-side, nel browser del singolo giocatore, dentro la sua sessione. Nessun dato transita o si ferma su un server terzo gestito da questo progetto.
- **Non cambia l'input dei giocatori.** Non altera form, comandi, invio messaggi o qualunque altra interazione che il giocatore ha con lot.

## Come funziona (in breve)

Uno userscript (Tampermonkey/Violentmonkey — funziona su Chrome, Firefox, Edge, Safari, Opera) si attiva sulle pagine di chat di Extremelot già aperte dal giocatore nel proprio browser, con la propria sessione. Da lì:

- legge il testo della chat (salvata o live) già presente nella pagina
- arricchisce la visualizzazione recuperando, con richieste same-origin nella stessa sessione del giocatore (nessuna credenziale gestita da questo progetto), dati già pubblici per quel giocatore su lot: scheda dei personaggi citati in chat, mappa del luogo
- disegna una scena con mappa e modellini al posto — o accanto — al testo grezzo

## Stato

In fase di progettazione iniziale. Vedi le issue del repo per lo stato di avanzamento.

## Licenza

MIT — vedi [LICENSE](LICENSE).
