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

## Installazione

1. Installa un userscript manager nel tuo browser: [Tampermonkey](https://www.tampermonkey.net) (Chrome, Firefox, Edge, Safari, Opera) o in alternativa Violentmonkey. Cercalo nello store estensioni del tuo browser oppure vai sul sito ufficiale.
2. Apri questo link nel browser dove hai installato l'estensione: [`src/lot-chat-viewer.user.js`](https://raw.githubusercontent.com/vitocmpl/lot-chat-viewer/main/src/lot-chat-viewer.user.js) — Tampermonkey riconosce automaticamente il file e propone l'installazione.
3. Conferma l'installazione nella finestra che appare.
4. Vai su una pagina di chat salvata di Extremelot, ad esempio `https://www.extremelot.eu/proc/chat/chat_salvate03.asp` (con la tua sessione già loggata). In alto a destra dovresti vedere un banner *"lot-chat-viewer attivo"* — conferma che lo script gira correttamente sulla pagina.

Aggiornamenti successivi dello script verranno rilevati automaticamente da Tampermonkey (grazie a `@updateURL`), senza bisogno di reinstallare a mano.

## Stato

Versione iniziale "hello world": lo script si attiva sulla pagina giusta e lo segnala con un banner, senza ancora leggere/visualizzare la chat. Vedi le issue del repo per lo stato di avanzamento.

## Licenza

MIT — vedi [LICENSE](LICENSE).
