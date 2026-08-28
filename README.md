# lot-chat-viewer

Visualizzatore non ufficiale, fan-made, per [Extremelot](https://www.extremelot.eu) — trasforma la chat testuale del gioco in una scena spaziale (mappa + modellini dei personaggi), sia per seguire una chat in corso sia per rileggere chat già giocate.

## Cos'è e cosa NON è

- **Non ufficiale.** Nessuna affiliazione con Extremelot o con la sua proprietà. Se la proprietà fosse interessata a integrare qualcosa di simile nativamente nel gioco, il codice è qui, MIT, libero di essere riusato o preso a riferimento — contattatemi pure.
- **Sola lettura.** Non invia comandi, non simula azioni, non interagisce in alcun modo con il gioco. Legge quello che il browser del giocatore vede già, nella sua sessione già autenticata, e basta. Nella chat live sostituisce solo l'area messaggi: toolbar e barra di scrittura restano intatte e funzionanti.
- **Non aggiunge funzionalità di gioco.** Nessuna informazione, meccanica o vantaggio che non sia già visibile al giocatore tramite l'interfaccia normale di Extremelot. È solo un modo diverso di *guardare* dati che il giocatore ha già davanti.
- **Non intercetta né salva nulla lato server.** Non esiste un backend. Tutto gira client-side, nel browser del singolo giocatore, dentro la sua sessione. Nessun dato transita o si ferma su un server terzo gestito da questo progetto.
- **Non cambia l'input dei giocatori.** Non altera form, comandi, invio messaggi o qualunque altra interazione che il giocatore ha con lot.

## Come funziona (in breve)

Uno userscript (Tampermonkey/Violentmonkey — funziona su Chrome, Firefox, Edge, Safari, Opera) si attiva sulle pagine di chat di Extremelot già aperte dal giocatore nel proprio browser, con la propria sessione. Da lì:

- legge il testo della chat (live o salvata) già presente nella pagina
- arricchisce la visualizzazione recuperando, con richieste same-origin nella stessa sessione del giocatore (nessuna credenziale gestita da questo progetto), dati già pubblici per quel giocatore su lot: scheda dei personaggi citati in chat, mappa del luogo
- disegna una scena con mappa e modellini al posto — o accanto — al testo grezzo

## Installazione

1. **Installa un userscript manager.** [Tampermonkey](https://www.tampermonkey.net) (consigliato — Chrome, Firefox, Edge, Safari, Opera) o in alternativa Violentmonkey. Cercalo nello store estensioni del tuo browser oppure vai sul sito ufficiale e installalo come una normale estensione.
2. **Installa lo script.** Con l'estensione installata, apri questo link: [`src/lot-chat-viewer.user.js`](https://raw.githubusercontent.com/vitocmpl/lot-chat-viewer/main/src/lot-chat-viewer.user.js). Tampermonkey lo riconosce automaticamente e apre una schermata di installazione — clicca **Install/Installa**.
3. **Solo su Chrome/Edge recenti: un passaggio in più.** Da qualche versione, questi browser richiedono un permesso esplicito perché un'estensione come Tampermonkey possa eseguire script all'interno delle pagine (Manifest V3). Se dopo l'installazione lo script non sembra attivarsi, questa è la causa più probabile:
   - Vai su `chrome://extensions` (su Edge: `edge://extensions`)
   - Attiva l'interruttore **"Modalità sviluppatore" / "Developer mode"** in alto a destra nella pagina
   - Sulla card di Tampermonkey dovrebbe comparire un nuovo interruttore **"Allow User Scripts" / "Consenti script utente"** — attivalo
   - Ricarica la pagina di lot su cui vuoi usare lo script

   *(Firefox e Safari non hanno questa limitazione, il passaggio 3 non serve.)*
4. **Verifica che funzioni.** Entra in una chat qualsiasi in gioco (locazione con altri PG, o anche da solo). In alto a destra dovresti vedere un banner *"lot-chat-viewer by Alderick — clicca per mostrare/nascondere"* — conferma che lo script gira correttamente sulla pagina.

Aggiornamenti successivi dello script verranno rilevati automaticamente da Tampermonkey (grazie a `@updateURL`), senza bisogno di reinstallare a mano.

## Come usarlo — chat live (uso principale)

1. **Entra in una chat** in gioco, come faresti normalmente.
2. Lo script si attiva da solo, sostituendo l'area messaggi con la scena (mappa a sinistra, timeline a destra) — toolbar e barra di scrittura restano dove sono, invariate.
3. La scena si aggiorna da sola quando arrivano nuovi messaggi (segue sempre l'ultimo, come uno scroll che si autoaggiorna). Zoom e posizione sulla mappa scelti a mano restano quelli anche dopo un aggiornamento.
4. Il banner in alto a destra mostra/nasconde la scena in qualsiasi momento, tornando al testo originale della chat live di lot — utile anche solo per scrivere più comodamente restando sulla vista di lot, la scena riprende da dove era rimasta al prossimo "mostra".

## Come usarlo — replay di una chat salvata

1. **Prima di tutto, portati sulla mappa di lot nella locazione della chat che vuoi rileggere.** È necessario perché lo script recupera l'immagine e la griglia della mappa dalla pagina mappa reale del luogo in cui il tuo PG si trova *ora* — non da dove si trovava quando quella chat fu giocata. Se il PG è altrove, lo script non trova nessuna mappa da mostrare.
2. Apri la toolbar in basso e clicca l'icona **"Registro chat"** (il libro). Si apre una modale con l'elenco.
3. Clicca la chat che vuoi rileggere: si apre una **nuova finestra** con il testo grezzo di quella sessione.
4. Su quella nuova finestra, lo script si attiva da solo, sostituendo il testo grezzo con la scena. Se non parte da solo, ricarica la pagina.
5. Il banner in alto a destra mostra/nasconde la scena in qualsiasi momento, tornando al testo originale della chat.

Nota: la mappa mostra solo l'immagine e la griglia del luogo — i movimenti dei personaggi che vedi nella scena vengono ricostruiti dalle coordinate scritte nella chat stessa (tag `[G4]` ecc.), non da una posizione live sulla mappa reale.

### Non vedi il banner? Troubleshooting

1. Apri la console del browser (F12 → tab **Console**) sulla pagina di lot e cerca righe che iniziano con `[lot-chat-viewer]`.
2. **Nessuna riga, nessun errore** → lo script non si sta eseguendo affatto sulla pagina. Controlla, in ordine:
   - il passaggio 3 sopra (Allow User Scripts) su Chrome/Edge — causa più comune
   - che l'interruttore generale di Tampermonkey (icona dell'estensione in barra) sia ON, non in pausa
   - nella dashboard di Tampermonkey (Installed userscripts), che "lot-chat-viewer" sia abilitato
   - che tu sia effettivamente su una pagina di chat (live o replay di una chat salvata) — lo script non si attiva altrove
3. **La riga c'è, dice "banner agganciato a BODY", ma non lo vedi comunque** → probabile conflitto CSS con la pagina; apri una issue nel repo con uno screenshot.

## Stato

Chat **live**, uso principale:

- Sostituisce solo l'area messaggi, toolbar/barra di scrittura sempre intatte e funzionanti
- Scena aggiornata in automatico ai nuovi messaggi, anche mentre la scena è nascosta e si sta guardando la vista originale di lot
- Messaggi azione (`+`) spezzati in fumetti azione/parlato come i normali, ma con i due significati scambiati (fuori parentesi è l'azione, dentro è il parlato) — bordo del fumetto evidenziato col colore reale con cui lot mostra quel messaggio (es. rosso per un master)
- Messaggi di dichiarazione oggetti ("Certifica Possesso in Gioco") attribuiti correttamente al PG, mostrati come blocco unico
- Gestione di testo con `«»`/`<>`/ecc. annidati o spaiati (frequenti nelle formule di incantesimo) senza corrompere la suddivisione in fumetti
- Il proprio nome PG viene evidenziato quando compare nelle battute altrui, come fa lot nativamente in chat — così si nota subito chi ci ha citato. Il nome viene letto una sola volta all'avvio da `b_all.asp` (stessa pagina della toolbar principale); se non riesce a determinarlo l'evidenziazione resta semplicemente disattivata, senza impatto sul resto
- La vista non avanza più da sola quando arriva un nuovo messaggio (nemmeno se si stava leggendo quello che, nel frattempo, è appena diventato il penultimo): resta ferma sulla card aperta finché non si clicca la pillola "torna al live" (col conteggio dei nuovi messaggi arrivati nel frattempo) o non si risale a mano con ▶. Solo al primo caricamento della scena si parte dall'ultimo messaggio disponibile in quel momento
- **Sperimentale, euristica non solida:** lot non ha un'azione esplicita per "togliere" un PG dalla griglia della mappa quando lascia il luogo — solo una convenzione informale fra giocatori, un separatore (`//`, `/`, `\\`, `\`) a fine dell'ultima battuta prima di uscire. Se lo riconosciamo, il modellino di quel PG resta visibile ma in dissolvenza sull'ultima azione, e sparisce del tutto dalle battute successive
- Token piazzati dal Fato sulla mappa-quest di lot (segnalini che non passano mai da un messaggio in chat, quindi altrimenti invisibili a questo strumento): mostrati con lo stesso stile esatto del client reale (cerchio colorato + anello al posto dello stemma, nome in corsivo) a zoom basso, sagoma fantasma a zoom modellino. Letti solo in live, solo nei tre momenti in cui si è sull'ultimo messaggio (si atterra lì con un click, si preme "torna al live", o arriva un nuovo messaggio mentre già lì) — mai un polling continuo

Replay di una chat salvata:

- Mappa del luogo con griglia, pan (trascinamento) e zoom (rotellina, verso il cursore), righello lettere/numeri, coordinata sotto il cursore
- Personaggi come stemma compatto (zoom basso) o modellino intero a layer corpo/vestito (zoom alto), con ventaglio automatico quando più PG condividono una cella, PG che sta parlando evidenziato (cella colorata, e sul modellino intero anche freccia + glow)
- Se non c'è una scheda da cui ricostruire il modellino (parlante non riconosciuto, es. un drago in mutaforma) ma il messaggio porta comunque una coordinata e un'icona razza, il token compare comunque sulla mappa: icona razza reale a zoom basso, sagoma "fantasma" semitrasparente e pulsante a zoom alto (stessa silhouette generica per ogni caso, draghi compresi)
- Timeline dei messaggi navigabile (◀▶ o click su una battuta), testo diviso in fumetti azione/parlato, tag modali colorati (posizione/status/arcani/png/fato/missione)
- Click su un personaggio: popup con ritratto (zoomabile), descrizione fisica, e collegamento a un secondo popup con indossati / con sé / equip bellico (icone cliccabili verso il certificato reale dell'oggetto)
- Luoghi senza mappa disponibile (es. Covo): scena solo testo/fumetti con la nostra grafica, senza riquadro mappa/griglia/token

### Tipi di messaggio (rispetto a tutti quelli gestiti da `chat_taverne.js`)

Gestiti, con parlante riconosciuto e resa dedicata (live e replay):

- **Normale** — fumetti azione/parlato standard
- **Azione** (`+`) — stessi fumetti dei normali, ma coi due significati scambiati (fuori parentesi è l'azione, dentro è il parlato) — bordo evidenziato col colore reale con cui lot mostra quel messaggio (es. rosso per un master)
- **Dichiarazione oggetti** ("Certifica Possesso in Gioco") — blocco unico, oggetti come link cliccabili ai certificati reali
- **Tiro di dadi** (`6`) — blocco unico squadrato (stile azione, non stondato come il parlato), icona d20 reale di lot + risultato in evidenza ("Tiro di dadi: X su Y") invece del testo grezzo, bordo dorato
- **Skill** (`S`) — blocco unico squadrato, etichetta "Skill" ed evidenziato col colore reale con cui lot mostra quel preciso messaggio
- **Sussurro** (`@`) — blocco unico con bordo tratteggiato ed etichetta ("sussurra a ...") a marcarlo come effimero/privato rispetto ai messaggi pubblici
- **Fato/destino** (`Z`) — non ha un PG dietro, è il mondo di gioco stesso a parlare: stessa sintassi azione/parlato del tipo `+` (narrazione fuori, parlato dentro «»/<>/ecc.), spezzato in fumetti come un'azione ma col bordo (spesso) dello stesso bgcolor reale con cui lot colora la riga del Fato in chat, icona dedicata (l'anello di lot) al posto dello stemma, niente coordinata/posizione sulla mappa per design. In chat_salvate compare incollato nel flusso senza un proprio timestamp: riconosciuto e staccato come blocco a sé prima di finire impastato nel messaggio del giocatore precedente. Variante **Fato Estemporaneo**: stesso Fato ma generato dal motore AI di lot invece che scritto a mano dal master, riconosciuto dall'`<img alt="AI">` dentro lo stesso box — mostrato col nome "Fato Estemporaneo" e la stessa icona del Fato normale, con la piccola icona AI reale di lot sovrapposta e sfasata sopra, tutto il resto invariato
- **Desiderio al Pozzo dei Desideri** — caso specifico di quella locazione: non è il PG a "parlare", è il Pozzo a riportarne il desiderio — pseudo-parlante fisso ("Pozzo dei Desideri", niente coordinata/posizione sulla mappa per design, come Fato/Immagine), nome del PG e desiderio dentro un unico fumetto stondato. In chat live la riga automatica ("Al Pozzo dei Desideri NICK : 'desiderio'") non ha alcuna icona/link di parlante nel markup, a differenza di ogni altro messaggio azione (`+`) — riconosciuta ed estratti nick e desiderio invece di ricadere su "Sistema". In replay lo stesso desiderio ha già un link avatar reale, nessun caso speciale necessario lì
- **Immagine** (`I`) — nessun PG dietro come il Fato, mostrata come thumbnail (proporzioni originali garantite) cliccabile e zoomabile nello stesso lightbox del ritratto della scheda PG, al posto di un fumetto di testo; stessa gestione dello split senza timestamp proprio in chat_salvate; ogni Immagine mantiene la propria miniatura anche quando ce ne sono più di una nella stessa chat (Fato/Immagine sono esclusi dal roster PG, che altrimenti le collasserebbe tutte su una sola)

Non ancora gestiti — visibili in timeline ma senza parlante riconosciuto ("Sistema") né stile dedicato, nessun esempio reale sotto mano per implementarli:

- **Moderazione** (`M`)
- **Admin/azione speciale** (`A`)

Non ancora presente:

- Animazione di movimento dei personaggi da una cella all'altra (oggi lo spostamento è istantaneo)

Vedi le issue del repo per lo stato di avanzamento dettagliato.

## Licenza

MIT — vedi [LICENSE](LICENSE).
