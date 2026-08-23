// ==UserScript==
// @name         lot-chat-viewer
// @namespace    https://github.com/vitocmpl/lot-chat-viewer
// @version      0.0.88
// @description  Visualizzatore non ufficiale (sola lettura) della chat di Extremelot come scena/mappa con modellini
// @match        https://www.extremelot.eu/proc/chat/chat_salvate03.asp*
// @match        https://www.extremelot.eu/proc/chat/chat_taverne*.asp*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/vitocmpl/lot-chat-viewer/main/src/lot-chat-viewer.user.js
// @downloadURL  https://raw.githubusercontent.com/vitocmpl/lot-chat-viewer/main/src/lot-chat-viewer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Sola lettura: questo script legge il DOM/le risposte già ricevute dal
  // browser del giocatore nella sua sessione. Non invia comandi al gioco,
  // non altera form o input, non salva/inoltra nulla verso server terzi.

  // @keyframes non è esprimibile via style inline: serve un vero <style>,
  // iniettato una sola volta. Nome univoco per non collidere con eventuali
  // keyframes della pagina ospite.
  const arrowStyle = document.createElement('style');
  arrowStyle.textContent = `
    @keyframes lotChatViewerArrowBounce {
      0%, 100% { transform: translateX(-50%) translateY(0); }
      50% { transform: translateX(-50%) translateY(4px); }
    }
  `;
  document.head.appendChild(arrowStyle);

  console.log('[lot-chat-viewer] script eseguito su', window.location.href,
    'top frame?', window.top === window);

  // Due sorgenti di chat, due DOM completamente diversi: chat_salvate.asp è
  // un transcript statico (.lot-chat), chat_taverne.asp è la chat live con
  // messaggi già impaginati da ChatTaverne.renderMessage() dentro
  // #chat-messages e un pannello di input/toolbar che qui NON va toccato
  // (sola lettura anche qui: si sostituisce solo l'area messaggi, mai
  // #chat-toolbar/#chat-input-bar).
  const isLive = !!document.getElementById('chat-messages');

  // Ricostruisce la scena da zero invece di limitarsi a un display:none/''.
  // Riprovato più volte a "patchare" un semplice mostra/nascondi (ricalcolo
  // di altezza/fitScale alla riaccensione): restava comunque disallineato
  // in modi diversi ogni volta. Rimuovere e ricostruire elimina la classe
  // intera di bug da misure stantie — renderTimeline si toglie già da sola
  // di mezzo l'istanza precedente (vedi "existing" all'inizio), quindi è
  // sicura da richiamare più volte. Nessun nuovo fetch: chatParsed/
  // pgRecords/mappa restano gli stessi, assegnata una volta risolti.
  let sceneVisible = true;
  let rebuildScene = null;
  // Aggiornata da renderTimeline ad ogni ricostruzione — un solo listener
  // Esc a livello di documento (sotto), non uno nuovo ogni volta che il
  // toggle mostra/nascondi ricrea la scena.
  let closeAllModals = () => {};
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  const banner = document.createElement('div');
  banner.textContent = 'lot-chat-viewer by Alderick — clicca per mostrare/nascondere';
  banner.title = 'Mostra/nascondi la scena';
  banner.style.cssText = [
    `position:fixed`, `top:${isLive ? '-2px' : '8px'}`, 'right:8px', 'z-index:2147483647',
    'background:#222', 'color:#0f0', 'font:12px monospace', 'cursor:pointer',
    'padding:6px 10px', 'border-radius:4px', 'opacity:0.85',
  ].join(';');
  banner.addEventListener('click', () => {
    if (sceneVisible) {
      const existing = document.getElementById('lot-chat-viewer-scene');
      if (existing) existing.remove();
      const originalChat = isLive ? document.getElementById('chat-messages') : document.querySelector('.lot-chat');
      if (originalChat) originalChat.style.display = '';
      if (!isLive) {
        const footer = document.querySelector('.lot-footer');
        if (footer) footer.style.display = '';
      }
      sceneVisible = false;
    } else if (rebuildScene) {
      rebuildScene();
      sceneVisible = true;
    }
  });

  const mount = document.body || document.documentElement;
  if (mount) {
    mount.appendChild(banner);
    console.log('[lot-chat-viewer] banner agganciato a', mount.tagName);
  } else {
    console.warn('[lot-chat-viewer] nessun body/documentElement disponibile, banner non mostrato');
  }

  // TODO: rendering scena (mappa + modellini) al posto/accanto al testo

  // DOMParser produce un documento il cui base URL è quello dello script
  // (la pagina di chat), non quello della risposta fetchata: risolvere un
  // <img src="../lotnew/..."> tramite la proprietà .src darebbe un URL
  // sbagliato (relativo a /proc/chat/ invece che alla pagina scaricata).
  // Va sempre letto l'attributo grezzo e risolto a mano con new URL(..).
  function abs(rawUrl, baseUrl) {
    if (!rawUrl) return null;
    try {
      return new URL(rawUrl, baseUrl).href;
    } catch (e) {
      return rawUrl;
    }
  }

  // makeNewWindow(...) negli onclick apre sempre il certificato dell'oggetto
  // come primo argomento; per gli oggetti indossati porta anche id/nome PG e
  // un'azione ("TOGLI"/"METTI") che serve solo per disindossare/indossare
  // sul proprio PG — irrilevante qui, siamo sola lettura. Si tiene solo
  // l'URL del certificato.
  function extractCertUrl(onclick) {
    if (!onclick) return null;
    const m = onclick.match(/makeNewWindow\(\s*["']([^"']+)["']/);
    return m ? m[1] : null;
  }

  // --- Parser: pagina scheda PG (proc/schedaPG/sx.asp?ID=...) ---------
  // Tabella a coppie label/valore: td.titoli_pergamena seguito da
  // td.testi_pergamena nella stessa riga. Alcune righe hanno due coppie
  // (Razza/Sesso, Forza/Mente, Destrezza/Esperienza, Carisma/Ex-Esper.).
  function parseSchedaPG(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const campi = {};
    doc.querySelectorAll('tr').forEach((row) => {
      const celle = Array.from(row.children);
      celle.forEach((cell, i) => {
        if (cell.classList.contains('titoli_pergamena')) {
          const label = cell.textContent.replace(/\s+/g, ' ').trim();
          const valueCell = celle[i + 1];
          if (label && valueCell) {
            campi[label] = valueCell.textContent.replace(/\s+/g, ' ').trim();
          }
        }
      });
    });

    const censoImg = doc.querySelector('img[src*="/stemmi/"]');
    // Ritratto scelto dal giocatore (zoomabile nel popup scheda): è la
    // prima immagine della pagina, dentro la cella con lo sfondo a
    // cornice — spesso ospitata su un dominio esterno (altervista, ecc.),
    // innocuo perché la usiamo solo come src di <img>, non con fetch().
    const ritrattoImg = doc.querySelector('td[background*="cornice400"] img');

    return {
      nome: campi['Nome'] || null,
      casata: campi['Casata'] || null,
      razza: campi['Razza'] || null,
      sesso: campi['Sesso'] || null,
      forza: campi['Forza'] || null,
      mente: campi['Mente'] || null,
      destrezza: campi['Destrezza'] || null,
      esperienza: campi['Esperienza'] || null,
      carisma: campi['Carisma'] || null,
      araldica: campi['Araldica'] || null,
      mestiere: campi['Mestiere'] || null,
      gilda: campi['Gilda'] || null,
      clan: campi['Clan'] || null,
      censoUrl: censoImg ? abs(censoImg.getAttribute('src'), baseUrl) : null,
      ritrattoUrl: ritrattoImg ? abs(ritrattoImg.getAttribute('src'), baseUrl) : null,
    };
  }

  // Gli oggetti dentro .panel-indossati / .panel-conse sono <img> diretti
  // (dentro un <a>), non la card ".item-box" definita nel CSS — quella
  // classe non è usata in questo pannello (probabilmente pensata per
  // un'altra vista). Il nome è nell'attributo title, nel formato
  // "Categoria - Nome" (es. "Monili - Collana"); coincide con i nomi già
  // visti in descrizioneArmi.
  function parseIndossatiConSe(container, baseUrl) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('img')).map((img) => {
      const title = img.getAttribute('title') || '';
      const dashIdx = title.indexOf(' - ');
      const categoria = dashIdx >= 0 ? title.slice(0, dashIdx).trim() : null;
      const nome = dashIdx >= 0 ? title.slice(dashIdx + 3).trim() : (title.trim() || null);
      return {
        categoria,
        nome,
        immagine: abs(img.getAttribute('src'), baseUrl),
        link: extractCertUrl(img.getAttribute('onclick')),
      };
    });
  }

  // --- Parser: pagina aspetto/modellino (proc/ARMInew26.asp?ID=...) ---
  // I layer del modellino sono, in ordine di apparizione nel DOM (che
  // coincide con l'ordine z-index reale): sfondo, piedi, corpo base,
  // vestito, eventuali accessori. Sfondo e piedi non servono per la
  // scena (sono decorativi della card aspetto, non parte del PG) — si
  // tiene solo da /figures/razze/ in poi. La cornice della card non
  // serve nemmeno lei, stesso motivo. La tabella armi ha 12 slot fissi
  // (label in td.slot-header, immagine+nome in td.slot-img successivo).
  function parseAspetto(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const allLayers = Array.from(doc.querySelectorAll('.avatar-inner img'))
      .map((img) => abs(img.getAttribute('src'), baseUrl));
    const razzaIdx = allLayers.findIndex((l) => l.includes('/figures/razze/'));
    const layers = razzaIdx >= 0 ? allLayers.slice(razzaIdx) : allLayers;

    const descFisica = doc.querySelector('.scroll-desc');
    const razzaLabel = doc.querySelector('.scroll-razza');
    const descArmi = doc.querySelector('.armi-desc-box');
    const indossati = parseIndossatiConSe(doc.querySelector('.panel-indossati'), baseUrl);
    const conSe = parseIndossatiConSe(doc.querySelector('.panel-conse'), baseUrl);

    const armi = [];
    doc.querySelectorAll('td.slot-header').forEach((header) => {
      const slotCell = header.nextElementSibling;
      // Le celle si alternano header/img a coppie all'interno di ogni riga,
      // ma header e img corrispondenti sono in righe consecutive nello
      // stesso indice di colonna, non fratelli diretti: si recupera per
      // posizione (stessa colonna, riga successiva) invece che per sibling.
      const headerRow = header.parentElement;
      const imgRow = headerRow.nextElementSibling;
      if (!imgRow) return;
      const idx = Array.from(headerRow.children).indexOf(header);
      const imgCell = imgRow.children[idx];
      if (!imgCell) return;
      const img = imgCell.querySelector('img');
      const link = imgCell.querySelector('a');
      armi.push({
        slot: header.textContent.trim(),
        nome: img ? (img.title || null) : null,
        immagine: img ? abs(img.getAttribute('src'), baseUrl) : null,
        link: link ? extractCertUrl(link.getAttribute('onclick')) || abs(link.getAttribute('href'), baseUrl) : null,
      });
    });

    return {
      razza: razzaLabel ? razzaLabel.textContent.trim() : null,
      descrizioneFisica: descFisica ? descFisica.textContent.trim() : null,
      layers,
      armi, // tutti e 12 gli slot, anche vuoti (nome:null) — servono al modale equip a mostrare la griglia completa
      descrizioneArmi: descArmi ? descArmi.textContent.replace(/\s+/g, ' ').trim() : null,
      indossati,
      conSe,
    };
  }

  // --- Parser: transcript della chat salvata (DOM di .lot-chat) -------
  // La pagina NON incapsula ogni messaggio in un contenitore dedicato: i
  // nodi sono un flusso piatto di FONT/A/IMG/SPAN/testo dentro .lot-chat.
  // L'unico punto di ancoraggio affidabile è il font grigio del timestamp
  // (#606060) che apre ogni messaggio: si raggruppano i nodi successivi
  // fino al prossimo timestamp per ottenere un "blocco" per messaggio.
  //
  // Per il parlante non ci si affida al testo (il nome a volte è un
  // elemento separato, a volte è incollato dentro il testo con 2-3 spazi
  // o " - " come separatore, a seconda del tipo di messaggio): si usa
  // invece il link '../avatar.asp?id=NOME', sempre presente nel blocco
  // sia nel caso venga messo dentro il timestamp sia come nodo fratello.
  // I tag di posizione (es. "[ingresso->carro]") sono codificati due volte
  // nella sorgente di lot (&amp;gt; invece di &gt;): dopo che il DOM li
  // decodifica una volta, restano entità letterali tipo "&gt;" nel testo.
  // Un secondo passaggio via textarea le risolve alla forma finale.
  function decodeEntitiesOnce(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
  }

  // Cammina i nodi di un elemento (già ripulito da chrome/tag/img) e ne
  // ricava una sequenza piatta di testo/link, nell'ordine in cui compaiono
  // — usata per i messaggi "Certifica Possesso in Gioco" (msgType 'equip'),
  // dove ogni oggetto dichiarato è un <a href target="new"> reale verso il
  // certificato: leggerne solo il textContent (come per ogni altro
  // messaggio) perderebbe quei link, lasciando solo i nomi come testo
  // piatto. Nodi diversi da testo/<a> (es. <b>/<small>, wrapper di stile
  // senza significato proprio) vengono attraversati in trasparenza, non
  // prodotti come run a sé.
  function extractRichRuns(containerEl) {
    const runs = [];
    function walk(node) {
      if (node.nodeType === 3) {
        if (node.textContent) runs.push({ type: 'text', value: node.textContent });
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'A') {
        const text = node.textContent;
        if (text) runs.push({ type: 'link', text, href: node.getAttribute('href') });
        return;
      }
      Array.from(node.childNodes).forEach(walk);
    }
    Array.from(containerEl.childNodes).forEach(walk);
    return runs;
  }

  // Il nome resta incollato dentro il primo run di testo (nessun nodo
  // dedicato lo isola nei messaggi 'equip') — stesso taglio già fatto su
  // "testo" altrove, qui applicato al primo run invece che a una stringa.
  function stripSpeakerPrefixFromRuns(runs, speaker) {
    if (!speaker || !runs.length || runs[0].type !== 'text') return runs;
    const idx = runs[0].value.indexOf(speaker);
    if (idx === -1 || idx > 5) return runs;
    const rest = runs[0].value.slice(idx + speaker.length).replace(/^\s*-?\s+/, '');
    const out = runs.slice(1);
    if (rest) out.unshift({ type: 'text', value: rest });
    return out;
  }

  function isGreyTimestampFont(node) {
    return node.nodeType === 1 && node.tagName === 'FONT'
      && (node.getAttribute('color') || '').toUpperCase() === '#606060'
      && /\d{2}:\d{2}/.test(node.textContent);
  }

  // Fato e Immagine (chat_salvate): a differenza di ogni altro tipo di
  // messaggio, qui NON hanno un proprio <font color="#606060"> di
  // timestamp che li isoli come blocco — compaiono incollati DENTRO il
  // flusso piatto subito dopo il messaggio del giocatore precedente,
  // prima del prossimo timestamp reale (visto in un esempio reale dove
  // Fato segue la battuta di un PG senza alcun orario proprio). Vanno
  // quindi riconosciuti e staccati come blocchi a sé PRIMA di finire
  // impastati nel testo del messaggio del PG a cui sono solo
  // "attaccati" nel markup — non hanno un vero orario, a differenza di
  // tutto il resto.
  function findFatoTd(node) {
    if (!node || node.nodeType !== 1 || !node.querySelectorAll) return null;
    const tds = node.tagName === 'TD' ? [node] : Array.from(node.querySelectorAll('td[bgcolor]'));
    return tds.find((td) => (td.getAttribute('bgcolor') || '').toUpperCase() === '#502020') || null;
  }
  function findImmagineImg(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.tagName === 'CENTER') return node.querySelector('img');
    return null;
  }

  // Ordine di visualizzazione dei tag modali, identico al client reale.
  const TAG_KIND_ORDER = { F: 0, M: 1, L: 2, S: 3, A: 4, P: 5 };

  // Tag MEDICO ({~MED:...} nel client reale, chat_taverne.js): sempre
  // l'ultimo tra i tag modali, un'icona con tooltip nativo invece di un
  // badge colorato come gli altri sei. URL confermato via scraping live.
  // Nessun esempio di chat_salvate.asp con un tag MED sotto mano per
  // confermare il nome classe CSS in
  // QUESTO renderer (diverso da chat_taverne.asp): si prova sia uno span
  // con lo stesso pattern msg-tag-{kind} degli altri cinque, sia un'img
  // già puntata a tagmedico.png — nessuno dei due rompe nulla se assente.
  const MED_ICON_URL = 'https://www.extremelot.eu/lotnew/img/tagmedico.png';

  // Icona d20 reale di lot, usata dal client per i tiri di dado — stesso
  // sistema del MED_ICON_URL sopra, un'icona presa da lot invece di
  // inventarne una nostra.
  const DICE_ICON_URL = 'https://www.extremelot.eu/proc/magioninew/dadi/d20.png';

  // Fato: non ha un vero PG dietro (è il mondo di gioco stesso a parlare,
  // niente stemma/censo reale nel markup — vedi msg-fato-box più sotto).
  // Usiamo comunque un'icona reale di lot al posto dello stemma, per dargli
  // un'identità visiva riconoscibile invece del solito placeholder
  // "iniziale del nome": va nel campo censoUrl del messaggio, così
  // fillAvatar() la mostra esattamente come farebbe con uno stemma vero.
  const FATO_ICON_URL = 'https://www.extremelot.eu/lotnew/img/THEring40x30.gif';

  // Riconosce un tiro di dadi dal testo generato da lot, uguale sia in live
  // (msg-dado, ma il parlante si legge già dal solito link icona razza,
  // niente bisogno di un branch dedicato come per il sussurro) sia in
  // replay (nessuna classe/tabella dedicata, stesso testo piatto) — un solo
  // pattern testuale invece di duplicare la detection nei due parser.
  const DICE_ROLL_RE = /ha tirato i dadi col risultato di\s*(\d+)\s*su\s*(\d+)/i;

  // Uso di skill: lot antepone sempre questo prefisso letterale al testo di
  // narrazione, sia in live che in replay — a differenza del dado, il nick
  // del PG compare DENTRO la frase (es. "Il corpo del Vampiro Alderick
  // diviene..."), spesso ben oltre i 40 caratteri usati altrove come soglia
  // euristica per "è un prefisso, toglilo": va rilevato PRIMA di quello
  // strip generico, altrimenti lo spezza a metà frase.
  const SKILL_PREFIX_RE = /^\[SKILL\]\s*/i;

  // Spezza una stringa reale nelle sue "pagine" alternate: dentro «» <> ()
  // {} [] e fuori, nell'ordine in cui compaiono nel testo. I tag [...] di
  // metadato (coordinate/tag modali) sono già stati rimossi dal parser
  // della chat prima di questa funzione, quindi qui [...] intercetta solo
  // eventuali parentesi quadre rimaste dentro al corpo del testo stesso.
  //
  // Quale dei due sia "azione" e quale "parlato" dipende dal tipo di
  // messaggio, non è fisso: nei messaggi normali (tipo 'N') il testo fuori
  // parentesi è il parlato e dentro è l'azione/descrizione; nei messaggi
  // '+' (azione, chat live) è l'esatto contrario — il client scrive lì
  // l'azione/narrazione in chiaro e il parlato dentro «»/<>. `invert`
  // scambia i due significati senza duplicare la logica di parsing.
  //
  // Scansione a pila, non una singola regex non-greedy: i testi di gioco
  // (soprattutto le formule di incantesimo) usano «» sia per le citazioni
  // di gioco sia per il discorso diretto nello stesso messaggio, spesso
  // riaprendone uno nuovo prima che il precedente si chiuda — con
  // `«[^»]*»` (esclude solo » dal contenuto, non «) il primo « "adottava"
  // tutto fino alla » più lontana invece che alla sua vera coppia,
  // lasciando bolle spaiate con un solo "»" e testo troncato a metà. Qui un
  // « annidato apre un nuovo livello; si richiude nel buffer del livello
  // sopra (delimitatori compresi, nessun carattere perso) solo quando non è
  // il più esterno — un solo fumetto per il livello più esterno, come
  // prima. Delimitatori rimasti aperti a fine testo (spaiati, capita nel
  // testo libero dei giocatori) restano comunque visibili come testo
  // semplice invece di far sparire tutto quel che segue.
  function splitSegments(text, invert) {
    const CLOSE_OF = { '«': '»', '<': '>', '(': ')', '{': '}', '[': ']' };
    const outsideType = invert ? 'action' : 'speech';
    const insideType = invert ? 'speech' : 'action';
    const pages = [];
    let outside = '';
    const stack = []; // { open, close, buf }
    const flushOutside = () => {
      const plain = outside.trim();
      if (plain) pages.push({ type: outsideType, content: plain });
      outside = '';
    };
    for (const ch of text) {
      if (stack.length && ch === stack[stack.length - 1].close) {
        const frame = stack.pop();
        if (stack.length === 0) {
          const inner = frame.buf.trim();
          if (inner) pages.push({ type: insideType, content: inner });
        } else {
          stack[stack.length - 1].buf += frame.open + frame.buf + ch;
        }
        continue;
      }
      const close = CLOSE_OF[ch];
      if (close) {
        if (stack.length === 0) flushOutside();
        stack.push({ open: ch, close, buf: '' });
        continue;
      }
      if (stack.length) stack[stack.length - 1].buf += ch;
      else outside += ch;
    }
    // Delimitatore rimasto aperto (spaiato, es. un « dimenticato a fine
    // battuta): l'intento del giocatore era comunque "questo è azione", non
    // "questo è tornato ad essere parlato" — si tratta come se si fosse
    // chiuso lì, un solo fumetto invece di ributtarlo fuori come testo
    // semplice (che gli darebbe lo stile/tipo sbagliato).
    while (stack.length > 1) {
      const inner = stack.pop();
      stack[stack.length - 1].buf += inner.open + inner.buf;
    }
    if (stack.length) {
      const last = stack.pop();
      const inner = last.buf.trim();
      if (inner) pages.push({ type: insideType, content: inner });
    }
    flushOutside();
    return pages.length ? pages : [{ type: outsideType, content: text.trim() }];
  }

  // Un nick PG reale non contiene mai spazi/virgolette/parentesi angolari:
  // il taglio va oltre il solito '&' perché lot genera, SOLO per lo
  // speaker delle skill in replay, un href malformato — un <img> annidato
  // per errore dentro il valore dell'attributo invece che come figlio
  // dell'<a> (es. href="../avatar.asp?id=Alderick target=result><IMG
  // SRC=...") — che senza questo taglio extra fa leggere come nick
  // "Alderick target=result><IMG SRC=" invece del solo "Alderick".
  function speakerFromBlock(wrap) {
    const avatarLink = wrap.querySelector('a[href*="avatar.asp?id="]');
    if (!avatarLink) return null;
    const m = avatarLink.getAttribute('href').match(/id=([^&\s<>"']+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Etichetta di fallback quando non c'è alcun link avatar (un vero PG dei
  // draghi non lo espone mai, di proposito: nessun modo di risalire al
  // giocatore reale dietro la mutaforma) — se l'icona razza del messaggio è
  // comunque quella dei draghi, meglio un'etichetta specifica di quel
  // generico "Sistema" condiviso con dado/moderazione/sussurro, anche se
  // resta comunque un nome inventato, non il vero nome del drago.
  function fallbackSpeakerLabel(razzaIcon) {
    return razzaIcon && /\/razze\/draghi/i.test(razzaIcon) ? 'Drago' : 'Sistema';
  }

  // Stile "del messaggio" nel renderer di chat_salvate: qui non ci sono
  // span con CSS inline come in chat_taverne, ma <FONT COLOR="..."> vecchio
  // stile che avvolge nick+testo interi (un solo font per messaggio, oltre
  // a quello del timestamp — quest'ultimo va escluso). Il timestamp NON si
  // riconosce dal suo colore (#606060): alcuni messaggi — es. un drago in
  // mutaforma — usano lo stesso grigio anche per il proprio font di
  // contenuto, un font DIVERSO ma dello stesso colore. Va escluso per
  // identità del nodo (il clone di timeFont passato da parseBlock), non
  // per valore — altrimenti si perdono colore/grassetto proprio sui
  // messaggi che più ne avrebbero bisogno per distinguersi da un vero
  // messaggio di sistema. Il grassetto è un <b> dentro quel font, non un
  // font-weight calcolato: basta verificarne la presenza. L'attributo
  // color è già una stringa hex letterale (nessuna CSS var() da risolvere
  // qui), leggibile anche da un nodo clonato scollegato — a differenza di
  // resolveMsgStyle (chat live) non serve leggerlo dall'originale ancora
  // agganciato al documento.
  function resolveSalvataMsgStyle(wrap, timeFontClone) {
    const colorFont = Array.from(wrap.querySelectorAll('font[color]')).find((f) => f !== timeFontClone);
    if (!colorFont) return { color: null, bold: false };
    return { color: colorFont.getAttribute('color'), bold: !!colorFont.querySelector('b') };
  }

  function parseBlock(timeFont, restNodes, baseDoc) {
    const timeMatch = timeFont.textContent.match(/(\d{2}:\d{2})/);
    const time = timeMatch ? timeMatch[1] : null;

    const wrap = baseDoc.createElement('div');
    const timeFontClone = timeFont.cloneNode(true);
    wrap.appendChild(timeFontClone);
    restNodes.forEach((n) => wrap.appendChild(n.cloneNode(true)));

    // Sussurro (chat salvata): unico tipo di messaggio renderizzato come
    // <table> invece del solito flusso di <font>/<span> — niente link
    // avatar.asp (il path generico sotto lo tratterebbe come parlante non
    // riconosciuto, "Sistema"), il parlante si legge dal <b> in grassetto
    // della prima riga ("NICK sussurra a  DESTINATARIO"), il testo dalla
    // seconda riga. Nessun altro esempio reale di variante sotto mano (es.
    // il lato "tu sussurri a qualcuno"): se il markup differisse ricadrebbe
    // sul path generico invece di un buco silenzioso.
    const sussurroTable = wrap.querySelector('table');
    if (sussurroTable && /\bsussurra a\b/i.test(sussurroTable.textContent)) {
      const rows = Array.from(sussurroTable.querySelectorAll('tr'));
      const headerRow = rows[0] || null;
      const bodyRow = rows[1] || null;
      const boldEl = headerRow ? headerRow.querySelector('b') : null;
      const speaker = boldEl ? decodeEntitiesOnce(boldEl.textContent).trim() : null;
      const headerText = headerRow ? decodeEntitiesOnce(headerRow.textContent).replace(/\s+/g, ' ').trim() : '';
      const targetMatch = headerText.match(/sussurra a\s+(.+)$/i);
      const target = targetMatch ? targetMatch[1].trim() : null;
      const testo = bodyRow ? decodeEntitiesOnce(bodyRow.textContent).replace(/\s+/g, ' ').trim() : '';
      if (!time && !testo) return null;
      return {
        time, speaker: speaker || fallbackSpeakerLabel(null), razzaIcon: null, razzaLink: null, censoUrl: null,
        coordRaw: null, posLabel: null, tags: [], med: null, testo,
        equipRuns: null, unsupportedType: !speaker, msgType: 'sussurro',
        sussurroLabel: target ? `sussurra a ${target}` : 'sussurro',
        msgColor: null, msgBold: false,
      };
    }

    const msgStyle = resolveSalvataMsgStyle(wrap, timeFontClone);
    let speaker = speakerFromBlock(wrap);

    const razzaImg = wrap.querySelector('img[src*="/razze/"]');
    const razzaIcon = razzaImg ? razzaImg.getAttribute('src') : null;
    // Link reale che lot mette sull'icona razza (avatar.asp?id=NICK) — un
    // drago non ce l'ha (icona senza <a>, coerente con niente speaker).
    const razzaLinkEl = razzaImg ? razzaImg.closest('a') : null;
    const razzaLink = razzaLinkEl ? razzaLinkEl.getAttribute('href') : null;
    const stemmaImg = wrap.querySelector('img[src*="/stemmi/"]');
    const censoUrl = stemmaImg ? stemmaImg.getAttribute('src') : null;

    // Segnale giusto per il tipo, trovato confrontando esempi reali (non il
    // grassetto, sempre presente sul nick anche nei messaggi normali): lo
    // stemma (censoUrl) compare SOLO nei messaggi normali ('N') — stessa
    // regola del client live, dove renderStemma() viene chiamato solo per
    // 'N' e mai per '+'/'S'/'6'. Un drago (nessuna icona speaker, nessuno
    // stemma) ricade quindi correttamente su 'azione', non 'normale'. La
    // dichiarazione oggetti ("Certifica Possesso") resta riconoscibile
    // dagli stessi link con target="new" già usati in parseTavernaMsgEl —
    // presenti però solo se il PG ha almeno un oggetto certificato. Un PG
    // "vuoto" (niente indosso, niente con sé) genera lo stesso messaggio ma
    // senza alcun link: il testo fisso "- Al suo arrivo," fa da secondo
    // segnale (vedi stesso fix in parseTavernaMsgEl).
    const isEquipDeclaration = !!wrap.querySelector('a[target="new"]')
      || /-\s*Al suo arrivo,/.test(wrap.textContent);
    let msgType = isEquipDeclaration ? 'equip' : (censoUrl ? 'normale' : 'azione');
    // Nessun link avatar per questo tipo di messaggio (vedi sopra): il nome
    // è comunque il primo token del testo ("NICK  - Al suo arrivo, ...").
    if (!speaker && isEquipDeclaration) {
      const raw = wrap.textContent.replace(/\s+/g, ' ').trim();
      const withoutTime = time ? raw.replace(/^\d{2}:\d{2}\s*/, '') : raw;
      const m = withoutTime.match(/^(.+?)\s+-\s+/);
      if (m) speaker = m[1].trim();
    }

    const coordSpan = wrap.querySelector('span.msg-pos-tag');
    const coordRaw = coordSpan ? decodeEntitiesOnce(coordSpan.textContent).replace(/[[\]]/g, '').trim() : null;
    const labelSpan = wrap.querySelector('span.msg-tag-pos');
    const posLabel = labelSpan ? decodeEntitiesOnce(labelSpan.textContent).replace(/[[\]]/g, '').trim() : null;

    // Tag modali (POSIZIONE/STATUS/ARCANI/PNG/FATO/MISSIONE), stessa
    // classe CSS del client reale — msg-pos-tag è un'altra cosa (la
    // coordinata di griglia [G4], già presa sopra come coordRaw, non un
    // tag modale). Ordine di visualizzazione fisso, come nel client reale.
    const tags = [];
    if (posLabel) tags.push({ kind: 'L', label: posLabel });
    [['S', 'msg-tag-status'], ['A', 'msg-tag-arcani'], ['P', 'msg-tag-png'], ['F', 'msg-tag-fato'], ['M', 'msg-tag-missione']]
      .forEach(([kind, cls]) => {
        wrap.querySelectorAll('span.' + cls).forEach((el) => {
          const label = decodeEntitiesOnce(el.textContent).replace(/[[\]]/g, '').trim();
          if (label) tags.push({ kind, label });
        });
      });
    tags.sort((a, b) => TAG_KIND_ORDER[a.kind] - TAG_KIND_ORDER[b.kind]);

    // Tag MEDICO: vedi nota su MED_ICON_URL più sopra sul perché si
    // provano due forme possibili — va estratto PRIMA della rimozione
    // generica di <img> qui sotto, altrimenti l'eventuale icona sarebbe
    // già sparita quando proviamo a leggerne il tooltip.
    let med = null;
    const medSpan = wrap.querySelector('span.msg-tag-med');
    if (medSpan) {
      med = decodeEntitiesOnce(medSpan.textContent).replace(/[[\]]/g, '').trim() || null;
    } else {
      const medImg = wrap.querySelector('img[src*="tagmedico"]');
      if (medImg) med = medImg.getAttribute('title') || medImg.getAttribute('alt') || 'Medico';
    }

    // Testo: tutto il blocco meno timestamp/link-avatar/immagini/tag,
    // poi si toglie l'eventuale prefisso "Nome  " o "Nome  - " quando il
    // nome è incollato dentro il testo invece di essere un nodo a parte.
    wrap.querySelectorAll(
      'span.msg-pos-tag, span.msg-tag-pos, span.msg-tag-status, span.msg-tag-arcani, span.msg-tag-png, span.msg-tag-fato, span.msg-tag-missione, span.msg-tag-med, img, a[href*="avatar.asp"]'
    ).forEach((el) => el.remove());
    // Rimuove SOLO il font del timestamp (per identità, stesso motivo di
    // resolveSalvataMsgStyle sopra) — non "tutti i font grigi": un
    // messaggio come quello di un drago in mutaforma ha il proprio font di
    // contenuto anch'esso colorato #606060, e un filtro per colore lo
    // cancellava insieme al timestamp lasciando il testo vuoto.
    timeFontClone.remove();
    // Per 'equip' (certifica oggetti): estratta PRIMA di appiattire a testo
    // — a quel punto wrap contiene solo testo + i veri <a target="new">
    // verso i certificati, niente altro chrome. Il primo run è sempre il
    // nome (nessun nodo separato lo isola da qui), tolto sotto come per il
    // prefisso testuale di "testo".
    const equipRuns = msgType === 'equip' ? stripSpeakerPrefixFromRuns(extractRichRuns(wrap), speaker) : null;
    let testo = wrap.textContent.replace(/\s+/g, ' ').trim();
    if (speaker && testo.startsWith(speaker)) {
      testo = testo.slice(speaker.length).replace(/^\s*-?\s+/, '');
    }

    // Skill: qui il testo inizia già con "[SKILL]" (il nick, se presente,
    // è dentro la narrazione, non un prefisso — testo.startsWith(speaker)
    // sopra non scatta comunque su questo caso), quindi basta riconoscere
    // il prefisso e toglierlo.
    if (SKILL_PREFIX_RE.test(testo)) {
      msgType = 'skill';
      testo = testo.replace(SKILL_PREFIX_RE, '');
    }

    // Tiro di dadi: nessuna classe/tabella dedicata qui (a differenza del
    // sussurro), solo lo stesso testo generato da lot già visto in live —
    // il parlante si legge già dal solito link avatar.asp, come un
    // messaggio 'azione' qualunque finché non lo si riconosce qui.
    let diceRoll = null;
    let diceMax = null;
    const diceMatch = testo.match(DICE_ROLL_RE);
    if (diceMatch) {
      msgType = 'dado';
      diceRoll = parseInt(diceMatch[1], 10);
      diceMax = parseInt(diceMatch[2], 10);
    }

    // Non si scarta mai un blocco con un minimo di contenuto solo perché
    // non riconosciamo il parlante (es. messaggi di sistema/sussurro/
    // moderazione — nessun esempio reale sotto mano per sapere come sono
    // fatti): meglio una card "grezza" in timeline che un buco silenzioso
    // nella chat per chi la sta testando. Un blocco davvero vuoto (nessun
    // orario, nessun testo residuo — separatori interni della pagina) resta
    // scartato.
    if (!time && !testo) return null;
    const unsupportedType = !speaker;

    return {
      time, speaker: speaker || fallbackSpeakerLabel(razzaIcon), razzaIcon, razzaLink, censoUrl, coordRaw, posLabel, tags, med, testo,
      equipRuns, unsupportedType, msgType, msgColor: msgStyle.color, msgBold: msgStyle.bold, diceRoll, diceMax,
    };
  }

  function parseChatSalvata(doc) {
    const titleEl = doc.querySelector('.lot-title');
    let locationName = null;
    if (titleEl) {
      const clone = titleEl.cloneNode(true);
      const closeLink = clone.querySelector('.lot-close');
      if (closeLink) closeLink.remove();
      locationName = clone.textContent.trim();
    }
    const dateLabel = doc.querySelector('.lot-subtitle') ? doc.querySelector('.lot-subtitle').textContent.trim() : null;

    const chatEl = doc.querySelector('.lot-chat');
    if (!chatEl) return { locationName, dateLabel, messages: [] };

    const messages = [];
    let currentTimeFont = null;
    let currentRest = [];
    // Chiude il blocco eventualmente aperto (parlante con timestamp) prima
    // di passare a qualcos'altro — condiviso tra il normale avvicendarsi
    // dei timestamp e l'interruzione forzata da un nodo Fato/Immagine.
    function flushCurrent() {
      if (!currentTimeFont) return;
      const parsed = parseBlock(currentTimeFont, currentRest, doc);
      if (parsed) messages.push(parsed);
      currentTimeFont = null;
      currentRest = [];
    }
    Array.from(chatEl.childNodes).forEach((node) => {
      if (isGreyTimestampFont(node)) {
        flushCurrent();
        currentTimeFont = node;
        currentRest = [];
        return;
      }
      const fatoTd = findFatoTd(node);
      if (fatoTd) {
        flushCurrent();
        const testo = decodeEntitiesOnce(fatoTd.textContent).replace(/\s+/g, ' ').trim();
        if (testo) {
          messages.push({
            time: null, speaker: 'Fato', razzaIcon: null, razzaLink: null, censoUrl: FATO_ICON_URL,
            coordRaw: null, posLabel: null, tags: [], med: null, testo,
            equipRuns: null, unsupportedType: false, msgType: 'fato', imageUrl: null,
            msgColor: null, msgBold: false,
          });
        }
        return;
      }
      const immagineImg = findImmagineImg(node);
      if (immagineImg) {
        flushCurrent();
        const imageUrl = immagineImg.getAttribute('src');
        if (imageUrl) {
          messages.push({
            // censoUrl = imageUrl: stesso trucco usato per l'anello del
            // Fato, così fillAvatar() mostra da sé una miniatura
            // dell'immagine come icona in timeline (compatta ed
            // espansa), senza duplicare quella logica qui.
            time: null, speaker: 'Immagine', razzaIcon: null, razzaLink: null, censoUrl: imageUrl,
            coordRaw: null, posLabel: null, tags: [], med: null, testo: '',
            equipRuns: null, unsupportedType: false, msgType: 'immagine', imageUrl,
            msgColor: null, msgBold: false,
          });
        }
        return;
      }
      if (currentTimeFont) currentRest.push(node);
    });
    flushCurrent();

    return { locationName, dateLabel, messages };
  }

  // --- Parser: chat live (proc/chat/chat_taverne.asp, #chat-messages) ---
  // Qui il client reale (chat_taverne.js, ChatTaverne.renderMessage) ha già
  // impaginato ogni messaggio come un <div class="chat-msg" id="msg-ID">
  // discreto — niente flusso piatto da riraggruppare come in chat_salvate,
  // un blocco = un elemento. Il parlante NON si legge da un link
  // avatar.asp (quello è solo nel renderer delle chat salvate): qui l'icona
  // razza (img.msg-razza) è avvolta in un <a href="javascript:...
  // ARMInew26.asp?ID=NICK...">, presente per i tipi N/+/S/6 (non per
  // moderazione/admin/immagine/fato/sussurro/PNG drago, che restano senza
  // parlante riconosciuto — stesso trattamento "unsupportedType" già usato
  // per i blocchi non riconosciuti in chat_salvate, non un buco silenzioso).
  // I nomi delle classi tag modali (msg-tag-pos/status/arcani/png/fato/
  // missione, msg-pos-tag) coincidono con quelli già gestiti in parseBlock:
  // stesso client, stesso set di tag, TAG_KIND_ORDER/decodeEntitiesOnce
  // riusati as-is.
  function speakerFromTavernaBlock(el) {
    const link = el.querySelector('a[href*="ARMInew26.asp"]');
    if (!link) return null;
    // Stesso taglio extra (spazi/parentesi angolari) di speakerFromBlock —
    // qui non si è ancora visto un href malformato analogo, ma è la
    // stessa identica classe di rischio (nick mai contenente questi
    // caratteri), meglio prevenirlo che scoprirlo alla prossima skill.
    const m = link.getAttribute('href').match(/ID=([^&\s<>"']+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Stile "del messaggio" così come lo mostra lot: per i tipi '+'/'S'/'6'
  // il client avvolge tutto (nick+testo) in un unico <span style="color:
  // ...">, spesso personalizzato (es. rosso per i master) — è quello lo
  // span da leggere, non il nick. Il tipo 'N' non ha un colore proprio per
  // il corpo del messaggio (solo il nick ce l'ha): in quel caso si prende
  // il colore ereditato di default della pagina. getComputedStyle risolve
  // già le CSS var() (--testo-msg ecc.) al valore rgb() reale corrente —
  // ma solo su un nodo ancora agganciato al documento, mai su un clone
  // scollegato: va chiamato PRIMA di clonare l'elemento in parseTavernaMsgEl.
  // bold: font-weight ereditato dallo stesso span (es. .msg-azione è
  // bold via CSS di classe, non inline — getComputedStyle lo risolve lo
  // stesso perché il nodo è ancora nel documento).
  function resolveMsgStyle(el) {
    const bodySpan = Array.from(el.children).find((c) => (
      c.tagName === 'SPAN' && c.style && c.style.color
      && !c.classList.contains('msg-ora') && !c.classList.contains('msg-nick')
    ));
    const cs = getComputedStyle(bodySpan || el);
    return { color: cs.color || null, bold: parseInt(cs.fontWeight, 10) >= 700 };
  }

  function parseTavernaMsgEl(el) {
    const msgStyle = resolveMsgStyle(el);
    const wrap = el.cloneNode(true);

    // Sussurro (chat live): struttura dedicata (.msg-sussurro), separata dal
    // flusso normale perché è effimero e visibile solo a chi lo manda e chi
    // lo riceve — niente span.msg-ora (nessun orario riportato) né link
    // ARMInew26 sul nick, il parlante si legge dall'onclick del client
    // (ChatTaverne.startSussurro('NICK') sul suo .msg-nick). L'unico esempio
    // osservato è il lato ricezione ("NICK si avvicina e Vi sussurra:"): se
    // lot rendesse il lato invio ("stai sussurrando a...") con un markup
    // diverso, ricadrebbe sul path generico sotto (unsupportedType,
    // "Sistema") invece di un buco silenzioso.
    if (el.classList.contains('msg-sussurro')) {
      const nickEl = wrap.querySelector('.msg-sussurro-header .msg-nick');
      const onclickAttr = nickEl ? (nickEl.getAttribute('onclick') || '') : '';
      const speakerMatch = onclickAttr.match(/startSussurro\('([^']+)'\)/);
      const speaker = speakerMatch ? speakerMatch[1] : null;
      const headerSpans = Array.from(wrap.querySelectorAll('.msg-sussurro-header > span'));
      const noteSpan = headerSpans.find((s) => !s.classList.contains('msg-nick'));
      const sussurroLabel = noteSpan ? decodeEntitiesOnce(noteSpan.textContent).replace(/:\s*$/, '').trim() : null;
      const bodyEl = wrap.querySelector('.msg-sussurro-body');
      const testo = bodyEl ? decodeEntitiesOnce(bodyEl.textContent).replace(/\s+/g, ' ').trim() : '';
      if (!speaker && !testo) return null;
      return {
        time: null, speaker: speaker || fallbackSpeakerLabel(null), razzaIcon: null, razzaLink: null, censoUrl: null,
        coordRaw: null, posLabel: null, tags: [], med: null, testo,
        equipRuns: null, unsupportedType: !speaker, msgType: 'sussurro', sussurroLabel,
        msgColor: null, msgBold: false,
      };
    }

    // Fato/destino (chat live): struttura dedicata (.msg-fato-box), testo
    // nudo senza nick/orario/icona razza/stemma — non è un PG a parlare ma
    // il mondo di gioco stesso (il "master dei giochi", come lo definisce
    // Vito), quindi niente "parlante non riconosciuto" (unsupportedType
    // resta false: è così di design, non un buco del parser). speaker
    // fisso 'Fato', censoUrl fisso su FATO_ICON_URL per dargli comunque
    // un'icona in timeline. Nessun esempio di replay (chat_salvate) sotto
    // mano: solo il lato live è gestito qui.
    const fatoBox = wrap.querySelector('.msg-fato-box');
    if (fatoBox) {
      const testo = decodeEntitiesOnce(fatoBox.textContent).replace(/\s+/g, ' ').trim();
      if (!testo) return null;
      return {
        time: null, speaker: 'Fato', razzaIcon: null, razzaLink: null, censoUrl: FATO_ICON_URL,
        coordRaw: null, posLabel: null, tags: [], med: null, testo,
        equipRuns: null, unsupportedType: false, msgType: 'fato', imageUrl: null,
        msgColor: null, msgBold: false,
      };
    }

    // Immagine (chat live): struttura dedicata (.msg-immagine), stesso
    // markup nudo (<center><img></center>) visto anche nel flusso piatto
    // di chat_salvate — nessun PG dietro, come per il Fato: un'illustrazione
    // che lot mostra al centro della chat, non una battuta.
    if (el.classList.contains('msg-immagine')) {
      const img = wrap.querySelector('img');
      const imageUrl = img ? img.getAttribute('src') : null;
      if (!imageUrl) return null;
      // censoUrl = imageUrl: stesso trucco usato per l'anello del Fato,
      // così fillAvatar() mostra da sé una miniatura dell'immagine come
      // icona in timeline (compatta ed espansa).
      return {
        time: null, speaker: 'Immagine', razzaIcon: null, razzaLink: null, censoUrl: imageUrl,
        coordRaw: null, posLabel: null, tags: [], med: null, testo: '',
        equipRuns: null, unsupportedType: false, msgType: 'immagine', imageUrl,
        msgColor: null, msgBold: false,
      };
    }

    // "Certifica oggetti in gioco": stringa automatica generata dal comando
    // dedicato, tipo '+' ma senza icona razza (msg.razza è vuoto lato
    // server per questi messaggi, quindi niente speaker via link ARMInew26)
    // e con link ai certificati reali (target="new", univoco per questo
    // tipo di messaggio) SOLO se il PG ha almeno un oggetto certificato — un
    // PG "vuoto" (niente indosso, niente con sé) genera lo stesso messaggio
    // ma senza alcun link, quindi il testo fisso "- Al suo arrivo," fa da
    // secondo segnale, altrimenti il messaggio ricade su 'azione' e il
    // parlante resta irriconosciuto ("Sistema"). Niente icona razza non
    // vuol dire niente parlante: il nome è comunque il primo token del
    // testo ("NICK  - Al suo arrivo, ha indosso, ..."), recuperato più
    // sotto come fallback quando speakerFromTavernaBlock non trova nulla.
    const isEquipDeclaration = !!wrap.querySelector('a[target="new"]')
      || /-\s*Al suo arrivo,/.test(wrap.textContent);

    const oraEl = wrap.querySelector('span.msg-ora');
    const timeMatch = oraEl ? oraEl.textContent.match(/(\d{2}:\d{2})/) : null;
    const time = timeMatch ? timeMatch[1] : null;

    // 'equip' (dichiarazione oggetti): un elenco fitto di nomi separati da
    // virgole, spezzarlo con la stessa regex azione/parlato non avrebbe
    // senso (non c'è alcuna azione/parlato lì dentro) — un blocco unico.
    // 'azione' (tipo '+'): si spezza come 'N' ma con i significati
    // invertiti (vedi buildSpeechBubbles). 'normale' ('N' e chat salvate):
    // comportamento invariato.
    let msgType = isEquipDeclaration ? 'equip' : (el.classList.contains('msg-azione') ? 'azione' : 'normale');

    let speaker = speakerFromTavernaBlock(wrap);
    if (!speaker && isEquipDeclaration) {
      const raw = wrap.textContent.replace(/\s+/g, ' ').trim();
      const withoutTime = time ? raw.replace(/^\d{2}:\d{2}\s*/, '') : raw;
      const m = withoutTime.match(/^(.+?)\s+-\s+/);
      if (m) speaker = m[1].trim();
    }

    const razzaImg = wrap.querySelector('img.msg-razza');
    const razzaIcon = razzaImg ? razzaImg.getAttribute('src') : null;
    // Link reale che lot mette sull'icona razza (javascript:void(window.
    // open('../ARMInew26.asp?ID=NICK...'))) — un drago non ce l'ha (icona
    // senza <a>, coerente con niente speaker).
    const razzaLinkEl = razzaImg ? razzaImg.closest('a') : null;
    const razzaLink = razzaLinkEl ? razzaLinkEl.getAttribute('href') : null;
    const stemmaImg = wrap.querySelector('img.msg-stemma');
    const censoUrl = stemmaImg ? stemmaImg.getAttribute('src') : null;

    const coordSpan = wrap.querySelector('span.msg-pos-tag');
    const coordRaw = coordSpan ? decodeEntitiesOnce(coordSpan.textContent).replace(/[[\]]/g, '').trim() : null;
    const labelSpan = wrap.querySelector('span.msg-tag-pos');
    const posLabel = labelSpan ? decodeEntitiesOnce(labelSpan.textContent).replace(/[[\]]/g, '').trim() : null;

    const tags = [];
    if (posLabel) tags.push({ kind: 'L', label: posLabel });
    [['S', 'msg-tag-status'], ['A', 'msg-tag-arcani'], ['P', 'msg-tag-png'], ['F', 'msg-tag-fato'], ['M', 'msg-tag-missione']]
      .forEach(([kind, cls]) => {
        wrap.querySelectorAll('span.' + cls).forEach((tEl) => {
          const label = decodeEntitiesOnce(tEl.textContent).replace(/[[\]]/g, '').trim();
          if (label) tags.push({ kind, label });
        });
      });
    tags.sort((a, b) => TAG_KIND_ORDER[a.kind] - TAG_KIND_ORDER[b.kind]);

    // Tag MEDICO: qui il client renderizza direttamente un'icona
    // (tagmedico.png), mai uno span msg-tag-med — va letto PRIMA di
    // rimuovere le img qui sotto.
    let med = null;
    const medImg = wrap.querySelector('img[src*="tagmedico"]');
    if (medImg) med = medImg.getAttribute('title') || medImg.getAttribute('alt') || 'Medico';

    wrap.querySelectorAll(
      'span.msg-ora, span.msg-nick, span.msg-pos-tag, span.msg-tag-pos, span.msg-tag-status, span.msg-tag-arcani, span.msg-tag-png, span.msg-tag-fato, span.msg-tag-missione, img'
    ).forEach((n) => n.remove());
    // Per 'equip' (certifica oggetti): estratta PRIMA di appiattire a testo
    // — a quel punto wrap contiene solo testo + i veri <a target="new">
    // verso i certificati, niente altro chrome.
    const equipRuns = msgType === 'equip' ? stripSpeakerPrefixFromRuns(extractRichRuns(wrap), speaker) : null;
    let testo = wrap.textContent.replace(/\s+/g, ' ').trim();

    // Desiderio al Pozzo dei Desideri: riga automatica generata da quella
    // locazione quando un PG esprime un desiderio ("Al Pozzo dei Desideri
    // NICK : 'desiderio'"). Non è il PG a "parlare" qui (non ha scelto lui
    // il fumetto), è il Pozzo a riportare il desiderio — stesso principio
    // del Fato: pseudo-parlante fisso, niente coordinata/posizione sulla
    // mappa per design, il nome del PG resta dentro al testo invece che
    // nell'header. In live questa riga non ha alcuna icona/link di
    // parlante nel markup (a differenza di ogni altro '+'): senza questo
    // riconoscimento dedicato ricadrebbe su "Sistema" col nome del PG
    // scambiato per parlante. In replay lo stesso desiderio ha invece un
    // link avatar reale (nessun caso speciale necessario lì, resta un
    // messaggio "azione" normale attribuito al PG che l'ha espresso).
    // Specifico di questa locazione: se ricompare altrove con un prefisso
    // diverso, va esteso.
    if (!speaker && msgType === 'azione') {
      const wishMatch = testo.match(/^Al Pozzo dei Desideri\s+(.+?)\s*:\s*'(.*)'\s*$/);
      if (wishMatch) {
        const wishPg = wishMatch[1].trim();
        const wishText = wishMatch[2].trim();
        return {
          time, speaker: 'Pozzo dei Desideri', razzaIcon: null, razzaLink: null, censoUrl: null,
          coordRaw: null, posLabel: null, tags: [], med: null, testo: `${wishPg}: '${wishText}'`,
          equipRuns: null, unsupportedType: false, msgType: 'desiderio', imageUrl: null,
          msgColor: null, msgBold: false,
        };
      }
    }

    // Skill (msg-skill): il nick del PG compare DENTRO la narrazione (es.
    // "Il corpo del Vampiro Alderick diviene..."), non come prefisso — lo
    // strip generico sotto (pensato per azione/dado, dove il nick precede
    // davvero il testo) lo troverebbe comunque entro i 40 caratteri e
    // spezzerebbe la frase a metà. Va riconosciuto ORA, prima dello strip,
    // per poterlo saltare.
    const isSkillMsg = SKILL_PREFIX_RE.test(testo);
    // Per azione/dado il nick (con eventuale "carica" davanti) resta
    // incollato dentro il testo — .msg-nick esiste solo per i messaggi
    // normali (già rimosso sopra). Se conosciamo il parlante dal link
    // dell'icona razza, si toglie tutto fino alla fine del suo nome.
    if (speaker && !isSkillMsg) {
      const idx = testo.indexOf(speaker);
      if (idx !== -1 && idx < 40) {
        testo = testo.slice(idx + speaker.length).replace(/^\s*-?\s+/, '');
      }
    }
    if (isSkillMsg) {
      msgType = 'skill';
      testo = testo.replace(SKILL_PREFIX_RE, '');
    }

    // Tiro di dadi (msg-dado in live, nessuna classe dedicata in replay):
    // il parlante si legge già dal solito link icona razza, come un
    // messaggio 'normale' — solo il testo generato da lot lo distingue,
    // dopo aver tolto il nome che lo precede qui sopra.
    let diceRoll = null;
    let diceMax = null;
    const diceMatch = testo.match(DICE_ROLL_RE);
    if (diceMatch) {
      msgType = 'dado';
      diceRoll = parseInt(diceMatch[1], 10);
      diceMax = parseInt(diceMatch[2], 10);
    }

    if (!time && !testo) return null;
    const unsupportedType = !speaker;

    return {
      time, speaker: speaker || fallbackSpeakerLabel(razzaIcon), razzaIcon, razzaLink, censoUrl, coordRaw, posLabel, tags, med, testo,
      equipRuns, unsupportedType, msgType, msgColor: msgStyle.color, msgBold: msgStyle.bold, diceRoll, diceMax,
    };
  }

  function parseChatTaverna(container) {
    const messages = Array.from(container.querySelectorAll(':scope > .chat-msg'))
      .map((el) => parseTavernaMsgEl(el))
      .filter(Boolean);
    return {
      locationName: (window.CONFIG && window.CONFIG.loc) || null,
      dateLabel: 'Chat live',
      messages,
    };
  }

  const chatParsed = isLive ? parseChatTaverna(document.getElementById('chat-messages')) : parseChatSalvata(document);
  console.log('[lot-chat-viewer] chat parsata:', chatParsed.locationName, chatParsed.dateLabel,
    '—', chatParsed.messages.length, 'messaggi');
  // I messaggi con parlante non riconosciuto (unsupportedType, vedi
  // parseBlock) restano nella timeline con un'etichetta placeholder, ma
  // non sono un vero PG: niente fetch scheda/aspetto per loro. Stesso
  // discorso per Fato/Immagine/desiderio al Pozzo: "speaker" lì è un nome
  // fisso condiviso da messaggi diversi (ogni Fato/Immagine/desiderio è un
  // contenuto a sé, non un vero PG), quindi vanno esclusi dal roster —
  // altrimenti buildPGRecord ne costruirebbe UN SOLO record condiviso
  // (censoUrl del primo trovato in buildChatDerivedRoster), che tutti i
  // messaggi di quel tipo si ritroverebbero addosso al posto della propria
  // immagine reale, oltre a fare un fetch inutile di scheda/aspetto per un
  // nome PG che non esiste.
  const roster = Array.from(new Set(
    chatParsed.messages
      .filter((m) => !m.unsupportedType && m.msgType !== 'fato' && m.msgType !== 'immagine' && m.msgType !== 'desiderio')
      .map((m) => m.speaker)
  ));
  console.log('[lot-chat-viewer] roster:', JSON.stringify(roster, null, 2));
  console.log('[lot-chat-viewer] primi 8 messaggi:', JSON.stringify(chatParsed.messages.slice(0, 8), null, 2));

  // --- Risoluzione PG: per ogni parlante del roster, fetch scheda+aspetto
  // UNA SOLA VOLTA (cache in memoria, valida per tutta questa sessione di
  // replay — i dati non cambiano mentre si legge una chat già giocata).
  // Sola lettura: GET soltanto, nessun dato inviato oltre il nome PG già
  // pubblico in chat.
  //
  // Regola di precedenza: razza/sesso/censo letti dalla chat stessa
  // (icona razza + stemma inline nei messaggi) VINCONO su quelli fetchati
  // da sx.asp, perché la chat è la fotografia del momento della giocata
  // mentre il fetch restituisce lo stato di oggi del personaggio (può
  // essere cambiato nel frattempo). Il resto (forza/mente/destrezza,
  // aspetto/modellino) non ha un equivalente nella chat, quindi resta
  // sempre quello fetchato live.
  function parseRazzaIconFilename(url) {
    if (!url) return { razza: null, sesso: null };
    const file = url.split('/').pop() || '';
    const m = file.match(/^([A-Z]*)([MF])\.gif$/i);
    if (!m) return { razza: null, sesso: null };
    return {
      razza: m[1] ? m[1].toUpperCase() : null,
      sesso: m[2].toUpperCase() === 'M' ? 'Maschio' : 'Femmina',
    };
  }

  function buildChatDerivedRoster(messages) {
    const info = {};
    messages.forEach((m) => {
      if (!info[m.speaker]) info[m.speaker] = {};
      if (m.razzaIcon && !info[m.speaker].razzaIcon) info[m.speaker].razzaIcon = m.razzaIcon;
      if (m.censoUrl && !info[m.speaker].censoUrl) info[m.speaker].censoUrl = m.censoUrl;
    });
    Object.keys(info).forEach((speaker) => {
      Object.assign(info[speaker], parseRazzaIconFilename(info[speaker].razzaIcon));
    });
    return info;
  }

  const pgFetchCache = new Map(); // nome -> Promise<{ scheda, aspetto }>

  function fetchPGData(nome) {
    if (pgFetchCache.has(nome)) return pgFetchCache.get(nome);
    const id = encodeURIComponent(nome);
    const promise = Promise.all([
      fetch(`https://www.extremelot.eu/proc/schedaPG/sx.asp?ID=${id}`, { credentials: 'same-origin' })
        .then((res) => res.text().then((html) => parseSchedaPG(html, res.url))),
      fetch(`https://www.extremelot.eu/proc/ARMInew26.asp?ID=${id}&scheda=`, { credentials: 'same-origin' })
        .then((res) => res.text().then((html) => parseAspetto(html, res.url))),
    ]).then(([scheda, aspetto]) => ({ scheda, aspetto }));
    pgFetchCache.set(nome, promise);
    return promise;
  }

  function buildPGRecord(nome, chatDerived, fetched) {
    const cd = chatDerived[nome] || {};
    return {
      nome,
      razza: cd.razza || fetched.scheda.razza,
      sesso: cd.sesso || fetched.scheda.sesso,
      censoUrl: cd.censoUrl || fetched.scheda.censoUrl,
      ritrattoUrl: fetched.scheda.ritrattoUrl,
      forza: fetched.scheda.forza,
      mente: fetched.scheda.mente,
      destrezza: fetched.scheda.destrezza,
      aspetto: fetched.aspetto,
    };
  }

  // --- Parser: pagina mappa/quest (proc/chat/chat_mappa_quest.asp) ----
  // Ci interessano solo immagine e geometria della griglia, NON le
  // posizioni live dei PG (non combaciano col replay): le coordinate del
  // replay vengono dai tag [G4] già estratti dalla chat. Assunzione da
  // documentare nel README: per vedere il replay di un luogo, prima si
  // porta il proprio PG lì su lot (altrimenti questa pagina non ha nulla
  // da mostrare per quel luogo).
  function parseMappaQuest(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imgEl = doc.querySelector('#mapImage');
    const locNameEl = doc.querySelector('.loc-name');
    return {
      mapUrl: imgEl ? abs(imgEl.getAttribute('src'), baseUrl) : null,
      locationName: locNameEl ? locNameEl.textContent.trim() : null,
    };
  }

  // Le dimensioni naturali di un'immagine sono leggibili anche cross-
  // origin (qui l'host della mappa è extremelot.eu senza "www", diverso
  // dal resto): solo la lettura dei pixel via <canvas> richiederebbe
  // same-origin, non le dimensioni.
  function loadImageSize(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('immagine mappa non caricabile: ' + url));
      img.src = url;
    });
  }

  function fetchMappa() {
    const url = 'https://www.extremelot.eu/proc/chat/chat_mappa_quest.asp?mode=accadimenti';
    return fetch(url, { credentials: 'same-origin' })
      .then((res) => res.text().then((html) => parseMappaQuest(html, res.url)))
      .then((mappa) => {
        if (!mappa.mapUrl) return mappa;
        return loadImageSize(mappa.mapUrl).then((size) => {
          const CELL = 40; // costante fissa dello strumento mappa reale di lot
          return Object.assign({}, mappa, {
            mapWidth: size.width,
            mapHeight: size.height,
            cellSize: CELL,
            cols: Math.max(1, Math.floor(size.width / CELL)),
            rows: Math.max(1, Math.floor(size.height / CELL)),
          });
        });
      });
  }

  // --- Rendering: mappa + token, coordinate di griglia -----------------
  function colIndexFromLetters(letters) {
    if (letters.length === 1) return letters.charCodeAt(0) - 65;
    return (letters.charCodeAt(0) - 64) * 26 + (letters.charCodeAt(1) - 65);
  }

  function parseCoord(raw) {
    if (!raw) return null;
    const m = raw.match(/^([A-Za-z]+)(\d+)$/);
    if (!m) return null;
    return { col: colIndexFromLetters(m[1].toUpperCase()), row: parseInt(m[2], 10) - 1 };
  }

  // Ultima posizione nota per PG: l'ultimo messaggio con un tag coordinata
  // valido, nell'ordine della chat — coerente con "cosa si vedrebbe aprendo
  // la mappa alla fine di questa sessione di replay".
  function lastKnownPositions(messages) {
    const pos = {};
    messages.forEach((m) => {
      const c = parseCoord(m.coordRaw);
      if (c) pos[m.speaker] = c;
    });
    return pos;
  }

  // Colore di identità per PG, derivato dall'hash del nome (nessuna scelta
  // manuale) — usato per il marcatore della cella attiva e per il glow/
  // freccia del modellino intero.
  function hashInt(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  function pgHue(nome) {
    return hashInt(nome) % 360;
  }
  function pgAccentColor(nome) {
    return `hsl(${pgHue(nome)} 62% 52%)`;
  }

  // A..Z poi AA, AB... — stessa formula dello strumento mappa reale di lot
  // (drawLabels in chat_mappa_quest.asp), inversa di colIndexFromLetters
  // usata per mostrare la coordinata corrente nella card espansa.
  function colLetter(index) {
    let letter = String.fromCharCode(65 + (index % 26));
    if (index >= 26) letter = String.fromCharCode(65 + Math.floor(index / 26) - 1) + letter;
    return letter;
  }

  // Stesso filter che lot applica a .msg-stemma in modalità notte (default
  // del client) — un doppio drop-shadow color oro, non un box-shadow: va
  // sull'<img> stesso, non su un contenitore, altrimenti seguirebbe il
  // riquadro invece del profilo trasparente dello stemma.
  const STEMMA_FILTER = 'drop-shadow(0 0 3px #F8E9AA) drop-shadow(0 0 1px #F8E9AA)';

  function raceIconUrl(razza, sesso) {
    if (!razza) return null;
    return 'https://www.extremelot.eu/lotnew/img/razze/' + razza.toUpperCase() + (sesso === 'Femmina' ? 'F' : 'M') + '.gif';
  }

  // Avatar della card: censo reale (stemma) se disponibile; altrimenti,
  // per un parlante non riconosciuto (msg.unsupportedType — es. un drago:
  // niente link avatar nel DOM, lot nasconde apposta il vero PG dietro la
  // mutaforma, non risalibile), l'icona razza del messaggio stesso se
  // presente (pg.iconUrl, vedi placeholder in draw()) invece di un badge
  // muto; solo come ultima risorsa l'iniziale del nome su sfondo colore.
  function fillAvatar(el, pg) {
    el.innerHTML = '';
    if (pg.censoUrl) {
      el.style.background = 'transparent';
      const img = document.createElement('img');
      img.src = pg.censoUrl;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = `width:100%;height:100%;object-fit:contain;filter:${STEMMA_FILTER};`;
      el.appendChild(img);
    } else if (pg.iconUrl) {
      el.style.background = pgAccentColor(pg.nome);
      const img = document.createElement('img');
      img.src = pg.iconUrl;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'width:70%;height:70%;object-fit:contain;';
      el.appendChild(img);
    } else if (pg.iconUrl) {
      el.style.background = pgAccentColor(pg.nome);
      const img = document.createElement('img');
      img.src = pg.iconUrl;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'width:70%;height:70%;object-fit:contain;';
      el.appendChild(img);
    } else {
      el.style.background = pgAccentColor(pg.nome);
      el.textContent = pg.nome.charAt(0);
    }
  }

  // Ordine "chi è salito in cima più di recente": ogni volta che un PG
  // parla, si sposta in fondo all'array (= più recente) — usato per
  // ordinare il ventaglio dei token quando più PG condividono una cella.
  function buildStackOrder(messages) {
    const order = [];
    messages.forEach((m) => {
      if (!m.speaker) return;
      const idx = order.indexOf(m.speaker);
      if (idx !== -1) order.splice(idx, 1);
      order.push(m.speaker);
    });
    return order;
  }

  // --- Timeline: naviga i messaggi uno alla volta, ricostruendo lo stage
  // sul sottoinsieme messages[0..indice] a ogni passo (posizioni + stack
  // riflettono sempre "cosa si vedrebbe a quel punto della giocata").
  function renderTimeline(chatParsed, pgRecords, mappa, opts) {
    opts = opts || {};
    const mode = opts.mode || 'replay'; // 'replay' (chat_salvate) | 'live' (chat_taverne)
    // Non tutti i luoghi hanno una mappa disponibile (es. Covo): niente
    // early-return in quel caso, la scena si costruisce comunque, solo
    // senza il riquadro mappa/griglia/token (vedi hasMap più sotto) — solo
    // testo/fumetti con la nostra grafica, come per il resto della chat.
    const hasMap = !!mappa.mapUrl;
    const existing = document.getElementById('lot-chat-viewer-scene');
    if (existing) existing.remove();
    if (!chatParsed.messages.length) {
      console.warn('[lot-chat-viewer] nessun messaggio parsato, salto la timeline');
      return;
    }

    // In live segue sempre l'ultimo messaggio arrivato (come uno scroll di
    // chat che si autoaggiorna); in replay parte dal primo, l'utente naviga
    // a mano con ◀▶.
    let index = mode === 'live' ? chatParsed.messages.length - 1 : 0;

    // Layout a schermo intero, due colonne (mappa | timeline) — senza una
    // toolbar di selezione in alto: qui la chat è già quella aperta nella
    // pagina, non c'è nulla da scegliere. Palette propria del viewer, fissa
    // per entrambe le modalità (replay e live) — provato a inseguire i
    // colori/sfondo reali di lot, resa peggiore: si torna alla nostra.
    const COLOR_BG = '#120f0c';
    const COLOR_SURFACE = '#1c1610';
    const COLOR_SURFACE2 = '#281f16';
    const COLOR_LINE = '#3a2c1e';
    const COLOR_EMBER = '#d9803f';
    const COLOR_EMBER_DIM = '#8a5227';
    const COLOR_GOLD = '#d9b86a';
    const COLOR_TEXT = '#ece3d6';
    const COLOR_TEXT_DIM = '#a89a89';
    // Solo per i sussurri: un accento diverso dalla palette ember/gold del
    // resto (bordo tratteggiato + questo colore), per farli riconoscere a
    // colpo d'occhio come "diversi" — effimeri, visibili solo a mittente e
    // destinatario, non un vero messaggio pubblico in chat.
    const COLOR_WHISPER = '#8a6fa8';
    // Fato: lo stesso bgcolor reale (#502020, un rosso mattone scuro) con
    // cui lot colora la riga del messaggio Fato nella chat originale, non
    // un accento inventato — coerenza diretta con l'originale invece che
    // col tag modale F (colore diverso, usato altrove per il badge).
    const COLOR_FATO = '#502020';

    // In-flow (non fixed): va esattamente al posto di .lot-chat, non
    // sopra a tutta la pagina — un overlay fixed a schermo intero
    // coprirebbe anche .lot-title/.lot-subtitle, che devono restare
    // visibili sopra invece di finire nascosti dietro il nostro pannello.
    const panel = document.createElement('div');
    panel.id = 'lot-chat-viewer-scene';
    panel.style.cssText = [
      'box-sizing:border-box', `background:${COLOR_BG}`, `color:${COLOR_TEXT}`,
      'font-family:-apple-system,"Segoe UI",system-ui,sans-serif',
      'padding:14px', 'display:flex', 'overflow:hidden',
      // In live il pannello prende il posto di #chat-messages dentro il
      // flex column di #chat-container (che già gestisce toolbar/input
      // sotto): basta flex:1, niente calcolo manuale dell'altezza.
      mode === 'live' ? 'flex:1 1 auto;min-height:0;min-width:0;' : '',
    ].join(';');

    const stageFrame = document.createElement('div');
    stageFrame.style.cssText = [
      'flex:1', 'min-width:0', 'min-height:0', 'display:flex', 'align-items:stretch', 'gap:12px',
      `background:${COLOR_SURFACE}`, `border:1px solid ${COLOR_LINE}`, 'border-radius:14px', 'padding:12px',
    ].join(';');
    panel.appendChild(stageFrame);

    // ---------- lightbox ritratto + popup scheda + modale equip ---------
    // Tre overlay condivisi (un solo esemplare, riempiti via JS al click),
    // figli di "panel" (non di stageZoom/stagePlane, che hanno un
    // transform: un discendente position:fixed di un antenato con
    // transform si ancorerebbe a quello invece che alla viewport reale) —
    // rimossi automaticamente col resto quando la scena viene ricostruita.
    const avatarLightbox = document.createElement('div');
    avatarLightbox.style.cssText = [
      'display:none', 'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:rgba(0,0,0,0.85)', 'align-items:center', 'justify-content:center',
      'flex-direction:column', 'gap:10px', 'cursor:zoom-out',
    ].join(';');
    const avatarLightboxImg = document.createElement('img');
    avatarLightboxImg.style.cssText = `max-width:90vw;max-height:85vh;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.6);border:1px solid ${COLOR_LINE};box-sizing:border-box;`;
    const avatarLightboxName = document.createElement('div');
    avatarLightboxName.style.cssText = `font-weight:800;font-size:13px;letter-spacing:.03em;text-transform:uppercase;color:${COLOR_GOLD};`;
    avatarLightbox.appendChild(avatarLightboxImg);
    avatarLightbox.appendChild(avatarLightboxName);
    function openAvatarLightbox(url, name) {
      avatarLightboxImg.src = url;
      avatarLightboxName.textContent = name;
      avatarLightbox.style.display = 'flex';
    }
    function closeAvatarLightbox() {
      avatarLightbox.style.display = 'none';
      avatarLightboxImg.src = '';
    }
    avatarLightbox.addEventListener('click', closeAvatarLightbox);
    panel.appendChild(avatarLightbox);

    function buildPopupShell(closeFn) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = [
        'position:relative', 'width:min(420px,92vw)', 'max-height:85vh', 'overflow-y:auto',
        `background:${COLOR_SURFACE2}`, `border:1.5px solid ${COLOR_LINE}`, 'border-radius:14px',
        'padding:16px', 'box-shadow:0 10px 40px rgba(0,0,0,0.6)', 'box-sizing:border-box',
      ].join(';');
      box.addEventListener('click', (e) => e.stopPropagation());
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '×';
      closeBtn.style.cssText = `position:absolute;top:8px;right:10px;appearance:none;border:none;background:none;color:${COLOR_TEXT_DIM};font-size:20px;line-height:1;cursor:pointer;`;
      box.appendChild(closeBtn);
      overlay.appendChild(box);
      closeBtn.addEventListener('click', closeFn);
      overlay.addEventListener('click', closeFn);
      panel.appendChild(overlay);
      return { overlay, box };
    }

    // --- popup scheda: ritratto + descrizione fisica + link "Indosso" ---
    const schedaShell = buildPopupShell(() => closeSchedaPopup());
    const schedaPopupHeader = document.createElement('div');
    schedaPopupHeader.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-right:20px;';
    const schedaPopupAvatar = document.createElement('img');
    schedaPopupAvatar.style.cssText = `width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid ${COLOR_LINE};flex:0 0 auto;box-sizing:border-box;`;
    const schedaPopupName = document.createElement('div');
    schedaPopupName.style.cssText = `font-weight:800;font-size:14px;text-transform:uppercase;letter-spacing:.03em;color:${COLOR_GOLD};`;
    schedaPopupHeader.appendChild(schedaPopupAvatar);
    schedaPopupHeader.appendChild(schedaPopupName);
    const schedaPopupDescr = document.createElement('div');
    schedaPopupDescr.style.cssText = `font-size:12.5px;line-height:1.55;color:${COLOR_TEXT};`;
    const schedaPopupToggle = document.createElement('button');
    schedaPopupToggle.type = 'button';
    schedaPopupToggle.textContent = '▾ Indosso';
    schedaPopupToggle.style.cssText = `display:none;appearance:none;margin-top:12px;background:none;border:none;color:${COLOR_EMBER};font-size:12px;font-weight:700;cursor:pointer;padding:0;`;
    schedaShell.box.appendChild(schedaPopupHeader);
    schedaShell.box.appendChild(schedaPopupDescr);
    schedaShell.box.appendChild(schedaPopupToggle);

    function closeSchedaPopup() {
      schedaShell.overlay.style.display = 'none';
    }

    function openSchedaPopup(pg) {
      schedaPopupName.textContent = pg.nome;
      const avatarUrl = pg.ritrattoUrl || pg.censoUrl || '';
      schedaPopupAvatar.src = avatarUrl;
      schedaPopupAvatar.style.display = avatarUrl ? 'block' : 'none';
      schedaPopupAvatar.style.cursor = pg.ritrattoUrl ? 'zoom-in' : 'default';
      // Filter solo quando è davvero lo stemma a fare da avatar (nessun
      // ritratto caricato) — su una foto reale lot non applica alcun glow.
      schedaPopupAvatar.style.filter = (!pg.ritrattoUrl && pg.censoUrl) ? STEMMA_FILTER : '';
      schedaPopupAvatar.onclick = pg.ritrattoUrl
        ? () => { closeSchedaPopup(); openAvatarLightbox(pg.ritrattoUrl, pg.nome); }
        : null;
      schedaPopupDescr.textContent = (pg.aspetto && pg.aspetto.descrizioneFisica) || 'Nessuna descrizione fisica disponibile per questo PG.';

      const indossati = (pg.aspetto && pg.aspetto.indossati) || [];
      const conSe = (pg.aspetto && pg.aspetto.conSe) || [];
      const armi = (pg.aspetto && pg.aspetto.armi) || [];
      const hasEquipData = indossati.length > 0 || conSe.length > 0 || armi.some((a) => a.nome);
      schedaPopupToggle.style.display = hasEquipData ? 'block' : 'none';
      schedaPopupToggle.onclick = hasEquipData ? () => { closeSchedaPopup(); openEquipModal(pg); } : null;

      schedaShell.overlay.style.display = 'flex';
    }

    // --- modale equip: indossati / con sé / equip bellico -------------
    const equipShell = buildPopupShell(() => closeEquipModal());
    const equipModalHeader = document.createElement('div');
    equipModalHeader.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-right:20px;';
    const equipModalBack = document.createElement('button');
    equipModalBack.type = 'button';
    equipModalBack.textContent = '←';
    equipModalBack.style.cssText = `appearance:none;border:none;background:none;flex:0 0 auto;color:${COLOR_TEXT_DIM};font-size:18px;line-height:1;cursor:pointer;padding:0;`;
    const equipModalName = document.createElement('div');
    equipModalName.style.cssText = `font-weight:800;font-size:14px;text-transform:uppercase;letter-spacing:.03em;color:${COLOR_GOLD};`;
    equipModalHeader.appendChild(equipModalBack);
    equipModalHeader.appendChild(equipModalName);
    const equipModalBody = document.createElement('div');
    equipShell.box.appendChild(equipModalHeader);
    equipShell.box.appendChild(equipModalBody);

    function closeEquipModal() {
      equipShell.overlay.style.display = 'none';
    }

    // Esc chiude qualunque popup/modale sia aperto (listener Esc unico a
    // livello di IIFE, vedi in cima allo script — qui aggiorniamo solo a
    // cosa punta, per non accumulare un nuovo document-level listener ad
    // ogni ricostruzione della scena col toggle mostra/nascondi).
    closeAllModals = () => {
      closeAvatarLightbox();
      closeSchedaPopup();
      closeEquipModal();
    };

    // Griglia di icone cliccabili — click apre il certificato reale in una
    // nuova scheda, stessa idea di makeNewWindow() nel client.
    function buildEquipGrid(items, opts) {
      opts = opts || {};
      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
      if (!items || !items.length) {
        const empty = document.createElement('div');
        empty.textContent = opts.emptyText || 'Vuoto';
        empty.style.cssText = `font-size:11px;color:${COLOR_TEXT_DIM};font-style:italic;`;
        grid.appendChild(empty);
        return grid;
      }
      items.forEach((it) => {
        if (!it.title && opts.showEmptySlots && !it.icon) return; // slot senza icona: salta
        const slot = document.createElement('div');
        slot.style.cssText = [
          'width:38px', 'height:38px', 'border-radius:5px', `border:1px solid ${COLOR_LINE}`,
          `background:${COLOR_SURFACE}`, 'overflow:hidden', 'flex:0 0 auto', 'box-sizing:border-box',
          it.cert ? 'cursor:pointer;' : '',
        ].join(';');
        if (it.icon) {
          const img = document.createElement('img');
          img.src = it.icon;
          img.alt = '';
          img.draggable = false;
          img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
          slot.appendChild(img);
        }
        slot.title = opts.showEmptySlots ? (it.slot + (it.title ? ': ' + it.title : ' (vuoto)')) : (it.title || '');
        if (it.cert) slot.addEventListener('click', () => window.open(it.cert, '_blank'));
        grid.appendChild(slot);
      });
      return grid;
    }

    function buildEquipSection(title, items, opts) {
      const section = document.createElement('div');
      section.style.cssText = 'margin-top:12px;';
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = `font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR_TEXT_DIM};margin-bottom:6px;`;
      section.appendChild(h);
      section.appendChild(buildEquipGrid(items, opts));
      return section;
    }

    function openEquipModal(pg) {
      equipModalName.textContent = pg.nome + ' — Indosso';
      equipModalBody.innerHTML = '';
      const indossati = ((pg.aspetto && pg.aspetto.indossati) || []).map((it) => ({ icon: it.immagine, title: it.nome, cert: it.link }));
      const conSe = ((pg.aspetto && pg.aspetto.conSe) || []).map((it) => ({ icon: it.immagine, title: it.nome, cert: it.link }));
      const armi = ((pg.aspetto && pg.aspetto.armi) || []).map((it) => ({ icon: it.immagine, title: it.nome, cert: it.link, slot: it.slot }));
      equipModalBody.appendChild(buildEquipSection('Indossati', indossati, { emptyText: 'Nessun oggetto indossato' }));
      equipModalBody.appendChild(buildEquipSection('Con sé', conSe, { emptyText: 'Nessun oggetto con sé' }));
      equipModalBody.appendChild(buildEquipSection('Equip bellico', armi, { showEmptySlots: true }));

      // Paragrafo descrittivo di ARMInew26.asp ("Questo quanto si osserva
      // di NOME, tiene..."), già estratto in parseAspetto.
      const descrizioneArmi = pg.aspetto && pg.aspetto.descrizioneArmi;
      if (descrizioneArmi) {
        const descSection = document.createElement('div');
        descSection.style.cssText = 'margin-top:12px;';
        const descTitle = document.createElement('div');
        descTitle.textContent = 'Descrizione';
        descTitle.style.cssText = `font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR_TEXT_DIM};margin-bottom:6px;`;
        const descText = document.createElement('div');
        descText.textContent = descrizioneArmi;
        descText.style.cssText = `font-size:12.5px;line-height:1.55;color:${COLOR_TEXT};`;
        descSection.appendChild(descTitle);
        descSection.appendChild(descText);
        equipModalBody.appendChild(descSection);
      }

      equipModalBack.onclick = () => { closeEquipModal(); openSchedaPopup(pg); };
      equipShell.overlay.style.display = 'flex';
    }

    // updateFitScale/applyView/updateTokens sono richiamate anche da
    // layoutPanel()/draw() più sotto, fuori da questo blocco — pre-
    // dichiarate qui come no-op, diventano le funzioni vere qui sotto solo
    // se c'è una mappa da costruire (hasMap).
    let updateFitScale = () => {};
    let applyView = () => {};
    let updateTokens = () => {};
    // Riferimento allo stageWrap (assegnato dentro il blocco hasMap qui
    // sotto) e stato mostra/nascondi mappa: opts.mapVisible, se passato
    // dal chiamante (live), è lo stesso oggetto persistito tra un rebuild
    // e l'altro — stessa filosofia di opts.view più sopra.
    let stageWrap = null;
    const mapVisibleRef = opts.mapVisible || { value: true };

    if (hasMap) {
    // ---------- viewport mappa: pan/zoom in un riquadro quadrato --------
    // wrapper (centra) > viewport (quadrato, pannabile/zoomabile) > zoom
    // (transform pan+scale) > plane (dimensione nativa mappa+margine) >
    // inner (mappa/griglia/token, tutto in coordinate NATIVE — è il
    // transform CSS sull'antenato ad adattarlo al riquadro). Costruito UNA
    // VOLTA (non ad ogni draw()): solo tokenLayer/activeCell vengono
    // aggiornati passo per passo.
    const LABEL_MARGIN_LEFT = 18, LABEL_MARGIN_TOP = 16;
    const ZOOM_MIN = 0.5;
    // "una cella = tutta la mappa" deve restare raggiungibile: il max si
    // adatta al numero di celle sul lato più lungo, non un valore fisso.
    const ZOOM_MAX = Math.max(mappa.cols, mappa.rows) * 1.1;
    // Sotto questa soglia il modellino intero non si apprezzerebbe comunque
    // (troppo piccolo) e sconfina più facilmente dalla cella: si passa al
    // token compatto stile "stemma", come lo strumento mappa reale.
    const ICON_ZOOM_THRESHOLD = 2.2;
    let lastCompact = null;
    const nativeCellW = mappa.mapWidth / mappa.cols;
    const nativeCellH = mappa.mapHeight / mappa.rows;
    // In live la scena si ricostruisce da zero ad ogni nuovo messaggio (vedi
    // fondo file): senza uno stato esterno, zoom/pan tornerebbero a 100%
    // centrato ogni volta che qualcuno parla. Chi chiama passa lo stesso
    // oggetto ad ogni rebuild — si muta quello invece di crearne uno nuovo.
    const view = opts.view || { zoom: 1, panX: 0, panY: 0 };
    let fitScale = 1;
    let lastActiveCoordLabel = null;

    stageWrap = document.createElement('div');
    stageWrap.style.cssText = 'flex:1 1 0;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;';
    if (!mapVisibleRef.value) stageWrap.style.display = 'none';
    stageFrame.appendChild(stageWrap);

    const viewport = document.createElement('div');
    viewport.style.cssText = [
      'width:auto', 'height:auto', 'max-width:100%', 'max-height:100%', 'aspect-ratio:1 / 1',
      'overflow:hidden', 'border-radius:8px', 'background:#111', 'position:relative',
      'display:flex', 'align-items:center', 'justify-content:center', 'user-select:none',
      'cursor:grab', 'touch-action:none',
    ].join(';');
    stageWrap.appendChild(viewport);

    const stageZoom = document.createElement('div');
    stageZoom.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
    viewport.appendChild(stageZoom);

    const stagePlane = document.createElement('div');
    stagePlane.style.cssText = [
      'position:relative', 'flex:0 0 auto', 'transform-origin:center center',
      `width:${mappa.mapWidth + LABEL_MARGIN_LEFT}px`, `height:${mappa.mapHeight + LABEL_MARGIN_TOP}px`,
    ].join(';');
    stageZoom.appendChild(stagePlane);

    const mapInner = document.createElement('div');
    mapInner.style.cssText = `position:absolute;left:${LABEL_MARGIN_LEFT}px;top:${LABEL_MARGIN_TOP}px;width:${mappa.mapWidth}px;height:${mappa.mapHeight}px;`;
    stagePlane.appendChild(mapInner);

    const mapImgEl = document.createElement('img');
    mapImgEl.src = mappa.mapUrl;
    mapImgEl.alt = '';
    mapImgEl.draggable = false;
    mapImgEl.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;user-select:none;';
    mapInner.appendChild(mapImgEl);

    // Griglia: linee tratteggiate solo top/left per cella (affiancate
    // ricompongono un reticolo unico senza doppiare le linee), stesso
    // stile dello strumento mappa reale.
    const gridCells = document.createElement('div');
    gridCells.style.cssText = 'position:absolute;inset:0;';
    const cellsFrag = document.createDocumentFragment();
    for (let r = 0; r < mappa.rows; r++) {
      for (let c = 0; c < mappa.cols; c++) {
        const cell = document.createElement('div');
        // box-sizing:border-box su tutto ciò che ha bordo + dimensione
        // esplicita: senza, il bordo si sommerebbe alla larghezza
        // dichiarata e l'errore si accumulerebbe colonna dopo colonna,
        // disallineando la griglia dall'immagine mappa (che invece non ha
        // bordi propri).
        cell.style.cssText = [
          'position:absolute', 'box-sizing:border-box', `left:${c * nativeCellW}px`, `top:${r * nativeCellH}px`,
          `width:${nativeCellW}px`, `height:${nativeCellH}px`,
          'border-left:1px dashed rgba(0,0,0,0.55)', 'border-top:1px dashed rgba(0,0,0,0.55)',
        ].join(';');
        cellsFrag.appendChild(cell);
      }
    }
    gridCells.appendChild(cellsFrag);
    mapInner.appendChild(gridCells);

    const activeCellEl = document.createElement('div');
    activeCellEl.style.cssText = 'position:absolute;box-sizing:border-box;display:none;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.35);';
    mapInner.appendChild(activeCellEl);

    const hoverCellEl = document.createElement('div');
    hoverCellEl.style.cssText = [
      'position:absolute', 'box-sizing:border-box', 'display:none', 'pointer-events:none',
      'background:rgba(248,233,170,0.12)', 'border:1.5px solid rgba(248,233,170,0.65)',
      'box-shadow:inset 0 0 0 1px rgba(0,0,0,0.35)',
    ].join(';');
    mapInner.appendChild(hoverCellEl);

    const tokenLayer = document.createElement('div');
    tokenLayer.style.cssText = 'position:absolute;inset:0;';
    mapInner.appendChild(tokenLayer);

    // Righello fisso (fuori da stageZoom: non deve pannare/zoomare col
    // resto), ricalcolato ad ogni pan/zoom in renderRuler().
    const rulerCol = document.createElement('div');
    rulerCol.style.cssText = [
      'position:absolute', 'top:0', 'left:0', 'right:0', 'height:18px', 'z-index:15',
      'background:#111', 'border-bottom:1px solid rgba(248,233,170,0.15)', 'overflow:hidden', 'pointer-events:none',
    ].join(';');
    viewport.appendChild(rulerCol);
    const rulerRow = document.createElement('div');
    rulerRow.style.cssText = [
      'position:absolute', 'top:0', 'left:0', 'bottom:0', 'width:20px', 'z-index:15',
      'background:#111', 'border-right:1px solid rgba(248,233,170,0.15)', 'overflow:hidden', 'pointer-events:none',
    ].join(';');
    viewport.appendChild(rulerRow);

    const zoomOverlay = document.createElement('div');
    zoomOverlay.style.cssText = [
      'position:absolute', 'top:28px', 'left:26px', 'z-index:20', 'display:flex', 'align-items:center', 'gap:7px',
      'background:rgba(0,0,0,0.78)', 'border:1px solid rgba(248,233,170,0.3)', 'border-radius:6px', 'padding:4px 8px',
    ].join(';');
    const zoomReadout = document.createElement('span');
    zoomReadout.textContent = '100%';
    zoomReadout.style.cssText = [
      'font-family:ui-monospace,Consolas,monospace', 'font-size:12px', 'font-weight:bold', 'color:#F8E9AA',
      'text-shadow:0 0 4px #000,0 0 8px #000', 'font-variant-numeric:tabular-nums', 'min-width:34px', 'text-align:center',
    ].join(';');
    const resetViewBtn = document.createElement('button');
    resetViewBtn.type = 'button';
    resetViewBtn.textContent = '⟲';
    resetViewBtn.title = 'Torna a zoom 100% centrato';
    resetViewBtn.style.cssText = [
      'appearance:none', 'border:1px solid rgba(248,233,170,0.35)', 'background:rgba(248,233,170,0.08)',
      'color:#F8E9AA', 'border-radius:4px', 'padding:2px 7px', 'font-size:13px', 'line-height:1.4', 'cursor:pointer',
    ].join(';');
    zoomOverlay.appendChild(zoomReadout);
    zoomOverlay.appendChild(resetViewBtn);
    viewport.appendChild(zoomOverlay);

    const hoverCoordEl = document.createElement('div');
    hoverCoordEl.textContent = '—';
    hoverCoordEl.style.cssText = [
      'position:absolute', 'top:28px', 'right:16px', 'z-index:20',
      'font-family:Verdana,sans-serif', 'font-size:12px', 'font-weight:bold', 'color:#F8E9AA',
      'background:rgba(0,0,0,0.78)', 'border:1px solid rgba(248,233,170,0.3)', 'text-shadow:0 0 4px #000,0 0 8px #000',
      'border-radius:6px', 'padding:4px 10px', 'pointer-events:none', 'min-width:34px', 'text-align:center',
    ].join(';');
    viewport.appendChild(hoverCoordEl);

    updateFitScale = function() {
      const rect = viewport.getBoundingClientRect();
      fitScale = rect.width > 0 ? (rect.width / (mappa.mapWidth + LABEL_MARGIN_LEFT)) : 1;
    };

    function renderRuler() {
      rulerCol.innerHTML = '';
      rulerRow.innerHTML = '';
      const mRect = mapInner.getBoundingClientRect();
      const vRect = viewport.getBoundingClientRect();
      if (!mRect.width || !mRect.height) return;
      const scaleX = mRect.width / mappa.mapWidth, scaleY = mRect.height / mappa.mapHeight;
      for (let c = 0; c < mappa.cols; c++) {
        const screenX = mRect.left + (c + 0.5) * nativeCellW * scaleX;
        if (screenX < vRect.left - 10 || screenX > vRect.right + 10) continue;
        const lbl = document.createElement('div');
        lbl.style.cssText = `position:absolute;font-family:Verdana,sans-serif;font-size:11px;color:#888;left:${screenX - vRect.left}px;top:2px;transform:translateX(-50%);`;
        lbl.textContent = colLetter(c);
        rulerCol.appendChild(lbl);
      }
      for (let r = 0; r < mappa.rows; r++) {
        const screenY = mRect.top + (r + 0.5) * nativeCellH * scaleY;
        if (screenY < vRect.top - 10 || screenY > vRect.bottom + 10) continue;
        const lbl2 = document.createElement('div');
        lbl2.style.cssText = `position:absolute;font-family:Verdana,sans-serif;font-size:11px;color:#888;top:${screenY - vRect.top}px;left:3px;transform:translateY(-50%);`;
        lbl2.textContent = String(r + 1);
        rulerRow.appendChild(lbl2);
      }
    }

    applyView = function() {
      const scale = (fitScale || 1) * view.zoom;
      stageZoom.style.transform = `translate(${view.panX}px,${view.panY}px) scale(${scale})`;
      zoomReadout.textContent = Math.round(view.zoom * 100) + '%';
      // Contro-scala il token compatto (75% della cella nativa) rispetto al
      // solo fitScale, non allo zoom interattivo: a zoom 100% badge e nome
      // rendono alla dimensione "vera" indipendentemente da quanto la
      // mappa si è dovuta rimpicciolire per stare nel riquadro quadrato.
      tokenLayer.style.setProperty('--token-icon-scale', fitScale ? (1 / fitScale) : 1);
      tokenLayer.style.setProperty('--icon-label-scale', fitScale ? (1 / fitScale) : 1);
      // Nome sotto il modellino intero: congelato alla dimensione che ha
      // già, a schermo, appena prima dello switch token→modellino (zoom =
      // ICON_ZOOM_THRESHOLD) — oltre quel punto non continua a crescere
      // con lo zoom insieme al resto scalato da stageZoom.
      tokenLayer.style.setProperty('--label-scale', view.zoom > 0 ? (ICON_ZOOM_THRESHOLD / view.zoom) : 1);
      renderRuler();

      // Sotto la soglia: token compatto stile stemma. Sopra: modellino
      // intero a layer. Il cambio di modalità richiede di ricostruire i
      // token (le due rese sono strutturalmente diverse: qui non teniamo
      // entrambe sempre nel DOM con un semplice display:none/flex) — ma
      // solo quando si attraversa davvero la soglia, non ad ogni tick di
      // zoom.
      const compact = view.zoom < ICON_ZOOM_THRESHOLD;
      if (compact !== lastCompact) {
        lastCompact = compact;
        if (typeof updateTokens === 'function') {
          updateTokens(chatParsed.messages.slice(0, index + 1), pgRecords, { recenter: false });
        }
      }
    };

    function resetView() {
      view.zoom = 1; view.panX = 0; view.panY = 0;
      applyView();
    }
    resetViewBtn.addEventListener('click', resetView);
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - (rect.left + rect.width / 2);
      const my = e.clientY - (rect.top + rect.height / 2);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
      const ratio = newZoom / view.zoom;
      view.panX = mx - (mx - view.panX) * ratio;
      view.panY = my - (my - view.panY) * ratio;
      view.zoom = newZoom;
      applyView();
    }, { passive: false });

    const drag = { active: false, moved: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0, pointerId: null };
    viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag.active = true; drag.moved = false;
      drag.startX = e.clientX; drag.startY = e.clientY;
      drag.startPanX = view.panX; drag.startPanY = view.panY;
      drag.pointerId = e.pointerId;
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        drag.moved = true;
        viewport.setPointerCapture(e.pointerId);
        viewport.style.cursor = 'grabbing';
      }
      if (drag.moved) {
        view.panX = drag.startPanX + dx;
        view.panY = drag.startPanY + dy;
        applyView();
      }
    });
    function endDrag(e) {
      if (!drag.active) return;
      try { viewport.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      drag.active = false;
      viewport.style.cursor = 'grab';
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    function cellFromClientPoint(clientX, clientY) {
      const rect = mapInner.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const localX = (clientX - rect.left) / (rect.width / mappa.mapWidth);
      const localY = (clientY - rect.top) / (rect.height / mappa.mapHeight);
      const col = Math.floor(localX / nativeCellW);
      const row = Math.floor(localY / nativeCellH);
      if (col < 0 || col >= mappa.cols || row < 0 || row >= mappa.rows) return null;
      return { col, row };
    }
    function showHoverCell(cell) {
      if (!cell) { hoverCellEl.style.display = 'none'; return; }
      hoverCellEl.style.left = (cell.col * nativeCellW) + 'px';
      hoverCellEl.style.top = (cell.row * nativeCellH) + 'px';
      hoverCellEl.style.width = nativeCellW + 'px';
      hoverCellEl.style.height = nativeCellH + 'px';
      hoverCellEl.style.display = 'block';
    }
    let isHoveringMap = false;
    function activeCoordLabel() {
      return lastActiveCoordLabel || '—';
    }
    function refreshIdleCoord() {
      if (!isHoveringMap) hoverCoordEl.textContent = activeCoordLabel();
    }
    viewport.addEventListener('mousemove', (e) => {
      isHoveringMap = true;
      const cell = cellFromClientPoint(e.clientX, e.clientY);
      hoverCoordEl.textContent = cell ? (colLetter(cell.col) + (cell.row + 1)) : activeCoordLabel();
      showHoverCell(cell);
    });
    viewport.addEventListener('mouseleave', () => {
      isHoveringMap = false;
      hoverCoordEl.textContent = activeCoordLabel();
      showHoverCell(null);
    });

    // Aggiorna SOLO token/cella attiva sul sottoinsieme di messaggi fino
    // all'indice corrente — la struttura mappa/griglia/righello sopra
    // resta la stessa per tutta la sessione di replay, costruita una sola
    // volta all'apertura della chat.
    // Pan automatico verso il PG attivo, se non è già lì — anima invece di
    // scattare di colpo (vedi anche l'offset verticale extra per il
    // modellino intero dentro centerOnActiveToken più sotto).
    let panAnimId = null;
    function animatePanTo(targetPanX, targetPanY, duration) {
      if (panAnimId) cancelAnimationFrame(panAnimId);
      const startX = view.panX, startY = view.panY;
      let startT = null;
      function step(ts) {
        if (startT === null) startT = ts;
        const p = Math.min(1, (ts - startT) / duration);
        const ease = 1 - Math.pow(1 - p, 3);
        view.panX = startX + (targetPanX - startX) * ease;
        view.panY = startY + (targetPanY - startY) * ease;
        applyView();
        panAnimId = (p < 1) ? requestAnimationFrame(step) : null;
      }
      panAnimId = requestAnimationFrame(step);
    }
    function centerOnActiveToken(pos, spriteEl) {
      if (!pos) return;
      const mRect = mapInner.getBoundingClientRect();
      if (!mRect.width || !mRect.height) return;
      const scaleX = mRect.width / mappa.mapWidth, scaleY = mRect.height / mappa.mapHeight;
      const screenX = mRect.left + (pos.col + 0.5) * nativeCellW * scaleX;
      let screenY = mRect.top + (pos.row + 0.5) * nativeCellH * scaleY;
      // Il modellino intero ha i piedi ancorati al centro cella: a zoom
      // molto alto il corpo renderizzato è più alto di mezzo viewport,
      // quindi centrare sul centro cella lascia la testa fuori
      // dall'inquadratura. Si sposta il punto di mira in su di metà
      // dell'altezza a schermo dello sprite — solo modellino intero, il
      // token compatto è già centrato per intero e non ne soffre.
      if (spriteEl) {
        const spriteRect = spriteEl.getBoundingClientRect();
        if (spriteRect.height) screenY -= spriteRect.height / 2;
      }
      const vRect = viewport.getBoundingClientRect();
      const centerX = vRect.left + vRect.width / 2, centerY = vRect.top + vRect.height / 2;
      animatePanTo(view.panX + (centerX - screenX), view.panY + (centerY - screenY), 420);
    }

    // Token compatto stile "stemma": icona bordata + nome sotto, larghezza
    // fissa 46px condivisa col modellino intero (stesso .token-frame).
    function buildCompactIcon(pg, iconSize) {
      const icon = document.createElement('div');
      icon.style.cssText = 'display:flex;align-items:center;justify-content:center;width:46px;position:relative;';

      const iconBadge = document.createElement('div');
      iconBadge.style.cssText = [
        // Niente overflow:hidden qui: clipperebbe anche il drop-shadow dello
        // stemma (vedi STEMMA_FILTER), riducendolo a un bordo secco invece
        // del glow sfumato che ha in lot. L'immagine si arrotonda da sé
        // (stesso border-radius) per restare pulita senza contenitore.
        'box-sizing:border-box', `width:${iconSize}px`, `height:${iconSize}px`, 'border-radius:4px', 'flex:0 0 auto',
        'border:2px solid #F8E9AA', 'background:rgba(0,0,0,0.6)', 'box-shadow:0 0 6px rgba(248,233,170,0.4)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-family:Verdana,sans-serif', 'font-weight:bold', 'color:#F8E9AA',
        'transform:scale(var(--token-icon-scale,1))',
      ].join(';');
      if (pg.censoUrl) {
        const img = document.createElement('img');
        img.src = pg.censoUrl;
        img.alt = '';
        img.draggable = false;
        img.style.cssText = `width:100%;height:100%;object-fit:contain;border-radius:4px;filter:${STEMMA_FILTER};`;
        iconBadge.appendChild(img);
      } else {
        iconBadge.textContent = pg.nome.charAt(0).toUpperCase();
      }

      const iconLabel = document.createElement('div');
      iconLabel.textContent = pg.nome;
      iconLabel.style.cssText = [
        'position:absolute', 'top:100%', 'left:50%', 'margin-top:1px',
        'transform:translateX(-50%) scale(var(--icon-label-scale,1))', 'transform-origin:top center',
        'font-family:Verdana,sans-serif', 'font-size:9px', 'color:#F8E9AA',
        'text-shadow:0 0 4px #000,0 0 8px #000', 'white-space:nowrap',
      ].join(';');

      icon.appendChild(iconBadge);
      icon.appendChild(iconLabel);
      return icon;
    }

    // Modellino intero: layer sovrapposti (corpo, vestito, eventuali
    // accessori — pg.aspetto.layers è già nell'ordine di stacking corretto),
    // ombra ellittica ai piedi, nome sotto ancorato al fondo dello sprite.
    function buildFullSprite(pg, isActive) {
      const counter = document.createElement('div');
      counter.style.cssText = 'position:relative;width:100%;transform-origin:bottom center;';

      const sprite = document.createElement('div');
      sprite.style.cssText = 'position:relative;width:23px;height:41px;margin:0 auto;';
      // Glow colorato (identità del PG) solo sul modellino che sta
      // parlando — sul token compatto è già dentro un riquadro bordato di
      // suo, il glow lì sarebbe ridondante (vedi la cella evidenziata).
      if (isActive) sprite.style.filter = `drop-shadow(0 0 5px ${pgAccentColor(pg.nome)})`;
      ((pg.aspetto && pg.aspetto.layers) || []).forEach((url) => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;filter:drop-shadow(0 3px 3px rgba(0,0,0,0.6));';
        // Alcuni layer (accessori tipo "manette") su lot puntano a
        // un'immagine 404 — su lot stesso è ininfluente (semplicemente non
        // si vede nulla), ma senza questa gestione qui compare l'icona di
        // immagine non trovata del browser sopra il modellino.
        img.addEventListener('error', () => img.remove());
        sprite.appendChild(img);
      });
      const shadow = document.createElement('div');
      shadow.style.cssText = [
        'position:absolute', 'bottom:-2px', 'left:50%', 'transform:translateX(-50%)',
        'width:24px', 'height:7px', 'background:radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 72%)',
      ].join(';');
      sprite.appendChild(shadow);
      counter.appendChild(sprite);

      const nametag = document.createElement('div');
      nametag.textContent = pg.nome;
      nametag.style.cssText = [
        'position:absolute', 'top:100%', 'left:50%', 'margin-top:1px',
        'transform:translateX(-50%) scale(var(--label-scale,1))', 'transform-origin:top center',
        'font-family:Verdana,sans-serif', 'font-size:9px', 'color:#F8E9AA',
        'text-shadow:0 0 4px #000,0 0 8px #000', 'white-space:nowrap', 'pointer-events:none',
      ].join(';');
      counter.appendChild(nametag);
      return { counter, sprite };
    }

    // Freccia rimbalzante sopra la testa del PG attivo, solo modellino
    // intero — colore identità del PG, animazione definita in arrowStyle
    // (iniettato una volta sola in cima allo script).
    function buildArrow(pg) {
      const arrow = document.createElement('div');
      arrow.textContent = '▼';
      arrow.style.cssText = [
        'position:absolute', 'left:50%', 'top:-16px', 'transform:translateX(-50%)',
        'font-size:15px', 'line-height:1', 'pointer-events:none', 'z-index:11',
        `color:${pgAccentColor(pg.nome)}`, 'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7))',
        'animation:lotChatViewerArrowBounce 1s ease-in-out infinite',
      ].join(';');
      return arrow;
    }

    updateTokens = function(messages, pgRecords, opts) {
      const recenter = !opts || opts.recenter !== false;
      const compact = view.zoom < ICON_ZOOM_THRESHOLD;
      tokenLayer.innerHTML = '';
      const positions = lastKnownPositions(messages);
      const stackOrder = buildStackOrder(messages);
      const activeSpeaker = messages.length ? messages[messages.length - 1].speaker : null;

      const activePos = activeSpeaker ? positions[activeSpeaker] : null;
      if (activePos && activePos.col >= 0 && activePos.col < mappa.cols && activePos.row >= 0 && activePos.row < mappa.rows) {
        const accent = `hsl(${pgHue(activeSpeaker)} 62% 52%)`;
        activeCellEl.style.left = (activePos.col * nativeCellW) + 'px';
        activeCellEl.style.top = (activePos.row * nativeCellH) + 'px';
        activeCellEl.style.width = nativeCellW + 'px';
        activeCellEl.style.height = nativeCellH + 'px';
        activeCellEl.style.border = `2px solid ${accent}`;
        activeCellEl.style.background = `color-mix(in srgb, ${accent} 20%, transparent)`;
        activeCellEl.style.display = 'block';
        lastActiveCoordLabel = colLetter(activePos.col) + (activePos.row + 1);
      } else {
        activeCellEl.style.display = 'none';
        lastActiveCoordLabel = null;
      }
      refreshIdleCoord();

      const iconSize = Math.min(nativeCellW, nativeCellH) * 0.75;
      const placed = pgRecords
        .map((pg) => ({ pg, pos: positions[pg.nome] }))
        .filter(({ pos }) => pos && pos.col >= 0 && pos.col < mappa.cols && pos.row >= 0 && pos.row < mappa.rows);

      // Gruppi per cella, in ordine di roster stabile (NON stackOrder): sia
      // il badge-count sia la disposizione a righe del modellino intero
      // dipendono solo da chi è in quella cella, mai da chi sta parlando
      // in questo istante — altrimenti l'intero ventaglio si "rimescola"
      // ad ogni battuta anche senza alcun movimento reale dei PG.
      const groups = {};
      placed.forEach((p) => {
        const key = p.pos.col + ',' + p.pos.row;
        (groups[key] = groups[key] || []).push(p);
      });

      const maxX = nativeCellW * 0.42, maxY = nativeCellH * 0.42;
      const fanX = {}, fanY = {};
      placed.forEach((p) => { fanX[p.pg.nome] = 0; fanY[p.pg.nome] = 0; });

      if (compact) {
        // Token compatto: ventaglio diagonale, ordinato dal meno al più
        // recentemente attivo (stackOrder) — chi sta parlando ora sale in
        // cima alla pila. Badge numerico nell'angolo alto a destra della
        // cella, sostituisce del tutto i token quando sono 2+.
        Object.keys(groups).forEach((key) => {
          const group = groups[key];
          if (group.length < 2) return;
          const ordered = group.slice().sort((a, b) => stackOrder.indexOf(a.pg.nome) - stackOrder.indexOf(b.pg.nome));
          ordered.forEach((p, i) => {
            fanX[p.pg.nome] += i * 5;
            fanY[p.pg.nome] += i * 5;
          });

          const first = group[0].pos;
          const countBadge = document.createElement('div');
          countBadge.style.cssText = [
            'position:absolute', 'box-sizing:border-box', 'pointer-events:none', 'z-index:10000',
            `left:${(first.col + 1) * nativeCellW - 10}px`, `top:${first.row * nativeCellH + 2}px`,
            'min-width:16px', 'height:16px', 'padding:0 3px',
            'background:#a00000', 'color:#fff', 'border:1px solid #F8E9AA', 'border-radius:8px',
            'font-family:Verdana,sans-serif', 'font-size:9px', 'font-weight:bold',
            'display:flex', 'align-items:center', 'justify-content:center', 'box-shadow:0 0 4px rgba(0,0,0,0.6)',
          ].join(';');
          countBadge.textContent = String(group.length);
          countBadge.title = 'Qui presenti (' + group.length + '): ' + group.map((p) => p.pg.nome).join(', ');
          tokenLayer.appendChild(countBadge);
        });
      } else {
        // Modellino intero: nessun collasso in badge, tutti i PG sulla
        // stessa cella restano visibili distribuiti su più righe. Righe:
        // 1 fino a 3 PG, 2 fino a 6, 3 da 7 in su, offset verticali fissi
        // (tarati per uno sprite alto ~1 cella, non ricavati da maxY).
        const ROW_Y = { 1: [0], 2: [-11, 11], 3: [-15, 0, 15] };
        Object.keys(groups).forEach((key) => {
          const ids = groups[key];
          if (ids.length < 2) return;
          const rowCount = ids.length <= 3 ? 1 : (ids.length <= 6 ? 2 : 3);
          const base = Math.floor(ids.length / rowCount), extra = ids.length % rowCount;
          const spacing = ids.length > 2 ? 26 : 20;
          let idx = 0;
          for (let r = 0; r < rowCount; r++) {
            const rowSize = base + (r < extra ? 1 : 0);
            const rowIds = ids.slice(idx, idx + rowSize);
            idx += rowSize;
            const midCol = (rowIds.length - 1) / 2;
            const rowOffsetX = (r - (rowCount - 1) / 2) * 9;
            let rowSpacing = spacing;
            if (midCol > 0) rowSpacing = Math.min(spacing, (maxX - Math.abs(rowOffsetX)) / midCol);
            rowIds.forEach((p, i) => {
              fanX[p.pg.nome] += (i - midCol) * rowSpacing + rowOffsetX;
              fanY[p.pg.nome] += ROW_Y[rowCount][r];
            });
          }
        });
      }

      placed.forEach((p) => {
        p.fanX = Math.max(-maxX, Math.min(maxX, fanX[p.pg.nome]));
        p.fanY = Math.max(-maxY, Math.min(maxY, fanY[p.pg.nome]));
      });

      let activeSpriteEl = null;
      placed.forEach(({ pg, pos, fanX: fx, fanY: fy }) => {
        const isActive = pg.nome === activeSpeaker;

        const token = document.createElement('div');
        token.style.cssText = [
          'position:absolute', `left:${(pos.col + 0.5) * nativeCellW + (fx || 0)}px`, `top:${(pos.row + 0.5) * nativeCellH + (fy || 0)}px`,
          'width:0', 'height:0', `z-index:${isActive ? 9999 : (100 + pos.row)}`,
        ].join(';');

        // "frame" fa l'ancoraggio: -50% orizzontale sempre (centrato sulla
        // cella), verticale dipende dalla modalità — -50% per il token
        // compatto (icona centrata per intero), -100% per il
        // modellino intero (piedi ancorati al centro cella, il corpo sale
        // sopra). La percentuale si risolve sull'altezza reale del
        // contenuto (icona o sprite), qualunque essa sia. pointer-events
        // disattivati sul frame (46px, più largo dello sprite/icona):
        // altrimenti la sua hitbox invisibile ruberebbe i click ai PG
        // vicini nella stessa cella — riattivati solo sull'elemento
        // visibile dentro (icona o sprite), il click bubbla comunque fino
        // a qui dove sta il listener.
        const frame = document.createElement('div');
        const anchorY = compact ? '-50%' : '-100%';
        frame.style.cssText = `position:absolute;left:0;top:0;width:46px;transform:translate(-50%, ${anchorY});pointer-events:none;cursor:pointer;`;

        if (compact) {
          const icon = buildCompactIcon(pg, iconSize);
          icon.style.pointerEvents = 'auto';
          frame.appendChild(icon);
        } else {
          const built = buildFullSprite(pg, isActive);
          built.sprite.style.pointerEvents = 'auto';
          frame.appendChild(built.counter);
          if (isActive) activeSpriteEl = built.sprite;
        }

        // Freccia rimbalzante + glow: solo sul modellino intero del PG
        // attivo (sul token compatto basta la cella evidenziata, vedi
        // sopra — la freccia lì sarebbe ridondante).
        if (!compact && isActive) frame.appendChild(buildArrow(pg));

        frame.addEventListener('click', () => openSchedaPopup(pg));

        token.appendChild(frame);
        tokenLayer.appendChild(token);
      });

      if (recenter) centerOnActiveToken(activePos, compact ? null : activeSpriteEl);
    };
    } // fine if (hasMap)

    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px;';
    stageFrame.appendChild(sidebar);

    // Header fisso in cima (non scrolla con la lista sotto) — stato "N PG
    // in scena · M battute caricate" a sinistra, navigazione ◀ N di M ·
    // orario ▶ a destra.
    const sidebarHeader = document.createElement('div');
    sidebarHeader.style.cssText = [
      'flex:0 0 auto', 'display:flex', 'flex-direction:row', 'align-items:center',
      'justify-content:space-between', 'gap:10px', 'padding-bottom:10px', `border-bottom:1px solid ${COLOR_LINE}`,
    ].join(';');
    sidebar.appendChild(sidebarHeader);

    const loadStatus = document.createElement('span');
    loadStatus.style.cssText = [
      `font-size:11px`, `color:${COLOR_TEXT_DIM}`, 'font-style:italic',
      'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
    ].join(';');
    loadStatus.textContent = pgRecords.length + ' PG in scena · ' + chatParsed.messages.length + ' battute caricate';
    sidebarHeader.appendChild(loadStatus);

    const controls = document.createElement('div');
    controls.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;';
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀';
    prevBtn.title = 'Messaggio precedente';
    const counter = document.createElement('span');
    counter.style.cssText = `font-size:11.5px;font-family:ui-monospace,Consolas,monospace;color:${COLOR_TEXT_DIM};`;
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '▶';
    nextBtn.title = 'Messaggio successivo';
    [prevBtn, nextBtn].forEach((btn) => {
      btn.style.cssText = [
        'appearance:none', `border:1px solid ${COLOR_LINE}`, `background:${COLOR_BG}`, 'color:#d9803f',
        'width:28px', 'height:28px', 'border-radius:50%', 'cursor:pointer', 'font-size:13px',
      ].join(';');
    });
    // Toggle mostra/nascondi mappa: solo nei luoghi che ne hanno una
    // (hasMap) — altrove la chat è già a schermo intero, niente da
    // nascondere. A mappa nascosta la sidebar (flex:1 1 0, unica figlia
    // rimasta di stageFrame) si espande da sola a tutta larghezza, niente
    // calcolo manuale. Nel gruppo "controls" (a destra, con ◀▶) invece che
    // in sidebarHeader: quest'ultima è a due soli blocchi (space-between),
    // un terzo figlio spezzerebbe quel layout.
    if (hasMap) {
      const toggleMapBtn = document.createElement('button');
      toggleMapBtn.textContent = mapVisibleRef.value ? 'Nascondi mappa' : 'Mostra mappa';
      toggleMapBtn.title = 'Mostra/nascondi la mappa';
      toggleMapBtn.style.cssText = [
        'appearance:none', `border:1px solid ${COLOR_LINE}`, `background:${COLOR_BG}`, `color:${COLOR_TEXT_DIM}`,
        'padding:5px 10px', 'border-radius:14px', 'cursor:pointer', 'font-size:11px', 'white-space:nowrap',
      ].join(';');
      toggleMapBtn.addEventListener('click', () => {
        mapVisibleRef.value = !mapVisibleRef.value;
        stageWrap.style.display = mapVisibleRef.value ? 'flex' : 'none';
        toggleMapBtn.textContent = mapVisibleRef.value ? 'Nascondi mappa' : 'Mostra mappa';
      });
      controls.appendChild(toggleMapBtn);
    }
    controls.appendChild(prevBtn);
    controls.appendChild(counter);
    controls.appendChild(nextBtn);
    sidebarHeader.appendChild(controls);

    const sidebarList = document.createElement('div');
    sidebarList.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px;';
    sidebar.appendChild(sidebarList);

    // Card espansa del messaggio attivo (quello mostrato sulla mappa in
    // questo momento della timeline).
    // Stessa coppia colore/sfondo del client reale in dark mode per
    // ciascuna categoria di tag modale.
    const TAG_COLORS = {
      L: { color: '#f0f0f0', background: '#666666' },
      S: { color: '#d0e8ff', background: '#2a4a7c' },
      A: { color: '#e0d0ff', background: '#4a2a7c' },
      P: { color: '#c0f0c0', background: '#2a5530' },
      F: { color: '#f0d0e0', background: '#802050' },
      M: { color: '#ffd0d0', background: '#cc3333' },
    };

    // Segmenti «azione»/parlato impilati in verticale,
    // ognuno nel proprio fumetto (bordo tondo per il parlato, squadrato +
    // corsivo per l'azione), leggero rientro laterale per distinguerli
    // anche quando due dello stesso tipo si susseguono. Palette sempre
    // quella del viewer (COLOR_SURFACE/COLOR_TEXT), non quella del
    // messaggio originale su lot.
    //
    // I messaggi di tipo '+' (chat live, msg.msgType === 'azione') si
    // spezzano allo stesso modo dei normali ('N'), ma con i due significati
    // scambiati: fuori parentesi è l'azione/narrazione (il client la scrive
    // in chiaro), dentro «»/<>/ecc. è il parlato — esatto opposto di 'N',
    // dove fuori è il parlato e dentro l'azione. Le chat salvate non
    // impostano msgType (undefined): invert resta false, comportamento
    // invariato.
    //
    // borderColor/borderBold (msg.msgColor/msg.msgBold, sempre — replay e
    // live): non tocchiamo più sfondo/testo del fumetto (resa peggiore, si
    // torna alla palette del viewer), ma il bordo sì, sempre col colore
    // reale con cui lot mostra quel preciso messaggio — rosso di un master
    // compreso — invece del neutro COLOR_LINE fisso. Un bordo più spesso
    // quando lot lo mostra in grassetto (es. .msg-azione in live, <b> in
    // replay): stesso "richiamo" allo stile originale, ma solo sul bordo —
    // meno invasivo di copiare anche sfondo/font, resta leggibile.
    //
    // singleBlock (msg.msgType === 'equip'): dichiarazione oggetti, un
    // elenco di nomi senza alcuna azione/parlato al suo interno — un unico
    // blocco, niente split. richRuns (msg.equipRuns), se presente: gli
    // oggetti dichiarati sono link reali verso i certificati (stesso
    // meccanismo della card "Indosso" già cliccabile) — resi come <a>
    // veri invece di testo piatto, `text` resta il fallback se assente.
    //
    // squared (equip/dado/skill): sono descrizione/narrazione/notifica di
    // sistema, mai dialogo — stesso bordo squadrato+corsivo dei fumetti
    // "azione" nello split normale (border-radius:3px), non quello
    // stondato "parlato" (border-radius:14px). dashed (sussurro) resta un
    // caso a parte: tratteggiato, non squadrato (è comunque testo diretto
    // di un PG, non una descrizione di sistema).
    function buildSpeechBubbles(text, invert, borderColor, borderBold, singleBlock, richRuns, dashed, squared) {
      const bubbles = document.createElement('div');
      const border = borderColor || COLOR_LINE;
      const borderWidth = borderBold ? '3px' : '1.5px';
      if (singleBlock) {
        const bubble = document.createElement('div');
        bubble.style.cssText = [
          `background:${COLOR_SURFACE}`, `color:${COLOR_TEXT}`,
          `border:${borderWidth} ${dashed ? 'dashed' : 'solid'} ${border}`,
          'padding:7px 11px', 'font-size:12.5px', 'line-height:1.5', 'user-select:text',
          `border-radius:${squared ? '3px' : '10px'}`,
          (dashed || squared) ? 'font-style:italic;' : '',
        ].join(';');
        if (richRuns && richRuns.length) {
          richRuns.forEach((run) => {
            if (run.type === 'link') {
              const a = document.createElement('a');
              a.href = run.href;
              a.target = 'new';
              a.rel = 'noopener';
              a.textContent = run.text;
              a.style.cssText = `color:${COLOR_EMBER};text-decoration:underline;`;
              bubble.appendChild(a);
            } else if (run.type === 'icon') {
              const icon = document.createElement('img');
              icon.src = run.src;
              icon.alt = run.alt || '';
              icon.draggable = false;
              icon.style.cssText = 'width:16px;height:16px;vertical-align:-3px;margin-right:6px;';
              bubble.appendChild(icon);
            } else {
              bubble.appendChild(document.createTextNode(run.value));
            }
          });
        } else {
          bubble.textContent = text;
        }
        bubbles.appendChild(bubble);
        return bubbles;
      }
      const slots = splitSegments(text, invert).map((p) => {
        const slot = document.createElement('div');
        slot.style.cssText = 'margin-bottom:6px;overflow:hidden;' + (p.type === 'speech' ? 'padding-left:23px;' : 'padding-right:23px;');
        const bubble = document.createElement('div');
        bubble.style.cssText = [
          `background:${COLOR_SURFACE}`, `color:${COLOR_TEXT}`, `border:${borderWidth} solid ${border}`,
          'padding:7px 11px', 'font-size:12.5px', 'line-height:1.5', 'user-select:text',
          p.type === 'speech' ? 'border-radius:14px;' : 'border-radius:3px;font-style:italic;',
        ].join(';');
        bubble.textContent = p.content;
        slot.appendChild(bubble);
        bubbles.appendChild(slot);
        return slot;
      });
      if (slots.length) slots[slots.length - 1].style.marginBottom = '0';
      return bubbles;
    }

    function buildExpandedCard(pg, msg, activePos) {
      const card = document.createElement('div');
      card.style.cssText = [
        `background:${COLOR_SURFACE2}`, `color:${COLOR_TEXT}`, `border:1.5px solid ${COLOR_LINE}`, 'border-radius:14px',
        `box-shadow:inset 4px 0 0 0 ${pgAccentColor(pg.nome)}`,
        'padding:11px 13px', 'display:flex', 'flex-direction:column', 'gap:8px',
      ].join(';');

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:9px;flex-wrap:wrap;';

      const avatar = document.createElement('div');
      // Niente overflow:hidden: clipperebbe il drop-shadow dello stemma
      // (STEMMA_FILTER) a un bordo secco — il quadrato non ha border-radius
      // quindi non serve comunque a "pulire" gli angoli dell'immagine.
      avatar.style.cssText = 'width:20px;height:20px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px;color:#fff8ec;';
      fillAvatar(avatar, pg);
      header.appendChild(avatar);

      const name = document.createElement('div');
      name.textContent = pg.nome;
      name.style.cssText = `font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:${COLOR_GOLD};flex:1;`;
      header.appendChild(name);

      const raceUrl = raceIconUrl(pg.razza, pg.sesso);
      if (raceUrl) {
        const raceIcon = document.createElement('img');
        raceIcon.src = raceUrl;
        raceIcon.alt = '';
        raceIcon.draggable = false;
        raceIcon.style.cssText = 'width:10px;height:10px;flex:0 0 auto;';
        // Link reale che lot mette sulla sua icona razza in questo preciso
        // messaggio (scheda PG in live, avatar.asp in replay) — un drago
        // non ce l'ha, l'icona resta senza link in quel caso. In live è un
        // URI javascript: (chiama window.open() da sé, come fa lot stesso)
        // — target="_blank" lì apre una scheda vuota invece di eseguirlo,
        // va messo solo sugli href http(s) veri come quello di replay.
        if (msg.razzaLink) {
          const raceLink = document.createElement('a');
          raceLink.href = msg.razzaLink;
          if (!/^javascript:/i.test(msg.razzaLink)) {
            raceLink.target = '_blank';
            raceLink.rel = 'noopener';
          }
          raceLink.style.cssText = 'flex:0 0 auto;line-height:0;';
          raceLink.appendChild(raceIcon);
          header.appendChild(raceLink);
        } else {
          header.appendChild(raceIcon);
        }
      }

      // Tag modali prima della coordinata di griglia: stesso ordine del
      // client reale (i tag modali precedono sempre la coordinata mappa
      // nel testo composto).
      (msg.tags || []).forEach((tag) => {
        const colors = TAG_COLORS[tag.kind] || TAG_COLORS.L;
        const tagEl = document.createElement('div');
        tagEl.textContent = tag.label;
        tagEl.title = tag.label;
        tagEl.style.cssText = [
          'font-size:11px', 'font-weight:700', 'border-radius:6px', 'padding:2px 8px',
          'max-width:130px', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
          `color:${colors.color}`, `background:${colors.background}`,
        ].join(';');
        header.appendChild(tagEl);
      });

      // Tag MEDICO: sempre l'ultimo tra i tag modali, icona con tooltip
      // nativo invece di un badge colorato — nessun testo a schermo.
      if (msg.med) {
        const medIcon = document.createElement('img');
        medIcon.src = MED_ICON_URL;
        medIcon.alt = 'Medico';
        medIcon.title = msg.med;
        medIcon.style.cssText = 'width:15px;height:15px;flex:0 0 auto;cursor:help;';
        header.appendChild(medIcon);
      }

      if (activePos) {
        const coord = document.createElement('div');
        coord.textContent = colLetter(activePos.col) + (activePos.row + 1);
        coord.title = 'Posizione corrente sulla griglia';
        coord.style.cssText = 'font-family:ui-monospace,Consolas,monospace;font-size:11px;font-weight:800;color:#f0d080;background:#803030;border-radius:6px;padding:2px 8px;';
        header.appendChild(coord);
      }

      const time = document.createElement('div');
      time.textContent = msg.time || '';
      time.style.cssText = `font-size:10.5px;font-weight:600;color:${COLOR_TEXT_DIM};font-variant-numeric:tabular-nums;`;
      header.appendChild(time);

      card.appendChild(header);

      // Il Fato, l'Immagine e il desiderio al Pozzo non sono mai "in attesa
      // di una coordinata" come un PG appena arrivato: per design non ne
      // avranno mai una (non sono token sulla mappa), quindi niente nota
      // "non ancora visibile".
      if (hasMap && !activePos && msg.msgType !== 'fato' && msg.msgType !== 'immagine' && msg.msgType !== 'desiderio') {
        const gapNote = document.createElement('div');
        gapNote.textContent = 'Nessuna coordinata nei suoi messaggi finora: non è ancora visibile sulla mappa.';
        gapNote.style.cssText = `font-size:10.5px;color:${COLOR_EMBER};font-style:italic;`;
        card.appendChild(gapNote);
      }
      if (msg.unsupportedType) {
        // Un drago è "non riconosciuto" solo nel senso che lot non espone
        // mai il giocatore reale dietro la mutaforma (per design, non un
        // limite del parser) — nota diversa da quella generica di sistema,
        // che invece è un vero parlante non identificato.
        const isDrago = fallbackSpeakerLabel(msg.razzaIcon) === 'Drago';
        const typeNote = document.createElement('div');
        typeNote.textContent = isDrago
          ? 'Drago: lot non espone il giocatore reale dietro la mutaforma — nessun PG collegabile.'
          : 'Messaggio con parlante non riconosciuto (es. sistema) — visualizzazione standard.';
        typeNote.style.cssText = `font-size:10.5px;color:${COLOR_EMBER};font-style:italic;`;
        card.appendChild(typeNote);
      }

      // Bordo colorato solo su azione/equip: sui messaggi 'N' c'è sempre un
      // colore disponibile (quello del nick, es. Vivia rosso anche nei suoi
      // messaggi normali) ma applicarlo lì renderebbe TUTTO evidenziato,
      // l'opposto del "richiamo leggero, solo sui messaggi che spiccano già
      // su lot" che era la richiesta originale.
      const isStyledType = msg.msgType === 'azione' || msg.msgType === 'equip' || msg.msgType === 'skill';
      const isWhisper = msg.msgType === 'sussurro';
      const isDice = msg.msgType === 'dado';
      const isSkill = msg.msgType === 'skill';
      const isFato = msg.msgType === 'fato';
      const isImmagine = msg.msgType === 'immagine';
      const isDesiderio = msg.msgType === 'desiderio';
      if (isWhisper && msg.sussurroLabel) {
        const whisperLabel = document.createElement('div');
        whisperLabel.textContent = msg.sussurroLabel;
        whisperLabel.style.cssText = `font-size:10.5px;font-style:italic;color:${COLOR_WHISPER};`;
        card.appendChild(whisperLabel);
      }
      // Skill: pubblico come il dado, ma senza un'icona propria fornita —
      // un'etichetta "Skill" col colore reale con cui lot mostra il
      // messaggio (varia per skill, non fisso come il dado) basta a
      // distinguerlo dalla narrazione normale, blocco unico invece di
      // spezzarlo in azione/parlato (è sempre descrizione, mai dialogo).
      if (isSkill) {
        const skillLabel = document.createElement('div');
        skillLabel.textContent = 'Skill';
        skillLabel.style.cssText = `font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${msg.msgColor || COLOR_GOLD};`;
        card.appendChild(skillLabel);
      }
      // Fato: nessuna etichetta dedicata qui — il nome "Fato" è già nel
      // header della card (pg.nome), ripeterlo sotto sarebbe ridondante.
      // Immagine: niente fumetto di testo (msg.testo è vuoto per questo
      // tipo), lot mostra l'illustrazione stessa al centro della chat — qui
      // una thumbnail più piccola, zoomabile nello stesso lightbox già
      // usato per il ritratto della scheda PG (openAvatarLightbox), invece
      // di forzarla intera nel box parlato/azione o duplicare l'overlay.
      if (isImmagine && msg.imageUrl) {
        // Box a dimensione fissa + object-fit:contain sull'<img> (stesso
        // schema già usato per gli avatar censo/stemma): con solo
        // max-width/max-height sull'<img> stesso, un qualunque CSS globale
        // di lot che imponga una width alle immagini (pagine vecchio stile,
        // spesso a tabelle) la stiracchierebbe fuori rapporto — qui invece
        // width/height 100% del box fisso + contain garantisce le
        // proporzioni originali indipendentemente dallo stile della pagina.
        const thumbBox = document.createElement('div');
        thumbBox.style.cssText = `width:220px;max-width:100%;height:160px;border-radius:8px;border:1.5px solid ${COLOR_LINE};overflow:hidden;cursor:zoom-in;background:${COLOR_SURFACE};`;
        const thumb = document.createElement('img');
        thumb.src = msg.imageUrl;
        thumb.alt = '';
        thumb.draggable = false;
        thumb.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
        thumbBox.appendChild(thumb);
        thumbBox.addEventListener('click', () => openAvatarLightbox(msg.imageUrl, 'Immagine'));
        card.appendChild(thumbBox);
      } else {
        // Dado: icona d20 reale di lot + risultato in evidenza invece del
        // testo grezzo di lot ("ha tirato i dadi col risultato di X su Y") —
        // pubblico (a differenza del sussurro, niente da nascondere), un
        // bordo dorato pieno basta a farlo notare nella timeline.
        // Fato: stessa sintassi del tipo '+' (narrazione fuori, parlato
        // dentro «»/<>/ecc.) — niente più blocco unico, si spezza in
        // fumetti azione/parlato come un'azione normale, con lo stesso
        // bordo (spesso) del bgcolor reale con cui lot colora la riga del
        // Fato nella chat originale (COLOR_FATO = #502020).
        // Desiderio al Pozzo: blocco unico stondato (come un parlato
        // normale, non squadrato/corsivo come le altre descrizioni di
        // sistema) — il nome del PG e il desiderio sono già dentro
        // msg.testo ("NICK: 'desiderio'"), niente bordo/peso dedicati.
        card.appendChild(buildSpeechBubbles(
          msg.testo,
          msg.msgType === 'azione' || isFato,
          isWhisper ? COLOR_WHISPER : (isDice ? COLOR_GOLD : (isFato ? COLOR_FATO : (isStyledType ? msg.msgColor : null))),
          isDice || isFato ? true : (isStyledType ? msg.msgBold : false),
          msg.msgType === 'equip' || isWhisper || isDice || isSkill || isDesiderio,
          isDice ? [
            { type: 'icon', src: DICE_ICON_URL, alt: 'd20' },
            { type: 'text', value: `Tiro di dadi: ${msg.diceRoll} su ${msg.diceMax}` },
          ] : msg.equipRuns,
          isWhisper,
          isDice || isSkill || msg.msgType === 'equip'
        ));
      }

      return card;
    }

    // Riga compatta nello stream: click apre esattamente questo messaggio.
    function buildCompactCard(pg, msg, idx) {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = [
        'appearance:none', 'display:flex', 'align-items:center', 'gap:8px', 'text-align:left', 'width:100%',
        'padding:7px 9px', 'border-radius:10px', `background:${COLOR_SURFACE2}`, `border:1px solid ${COLOR_LINE}`,
        'cursor:pointer', 'color:inherit', 'font:inherit',
      ].join(';');
      row.addEventListener('mouseenter', () => { row.style.borderColor = COLOR_EMBER_DIM; });
      row.addEventListener('mouseleave', () => { row.style.borderColor = COLOR_LINE; });

      const avatar = document.createElement('div');
      // Niente overflow:hidden: clipperebbe il drop-shadow dello stemma
      // (STEMMA_FILTER) a un bordo secco — il quadrato non ha border-radius
      // quindi non serve comunque a "pulire" gli angoli dell'immagine.
      avatar.style.cssText = 'width:20px;height:20px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px;color:#fff8ec;';
      fillAvatar(avatar, pg);
      row.appendChild(avatar);

      const cbody = document.createElement('div');
      cbody.style.cssText = 'min-width:0;flex:1;';
      const nm = document.createElement('div');
      nm.textContent = pg.nome;
      nm.style.cssText = `font-size:11px;font-weight:700;color:${COLOR_TEXT};`;
      const isWhisperPreview = msg.msgType === 'sussurro';
      const isDicePreview = msg.msgType === 'dado';
      const isSkillPreview = msg.msgType === 'skill';
      const isImmaginePreview = msg.msgType === 'immagine';
      const pv = document.createElement('div');
      const preview = splitSegments(msg.testo).map((p) => p.content).join(' ');
      // Fato: niente prefisso "Fato: " né colore/peso dedicati — il nome
      // "Fato" è già la riga sopra (nm, pg.nome), qui basta il formato
      // standard come per un PG qualunque. COLOR_FATO (#502020, un rosso
      // mattone scuro) è pensato per un bordo su sfondo chiaro, non per il
      // testo su questo sfondo scuro: illeggibile se usato qui.
      pv.textContent = isWhisperPreview ? `${msg.sussurroLabel || 'sussurro'}: ${preview}`
        : isDicePreview ? `Tiro di dadi: ${msg.diceRoll} su ${msg.diceMax}`
        : isSkillPreview ? `Skill: ${preview}`
        : isImmaginePreview ? 'Immagine'
        : preview;
      pv.style.cssText = `font-size:10.5px;color:${isWhisperPreview ? COLOR_WHISPER : isDicePreview ? COLOR_GOLD : isSkillPreview ? (msg.msgColor || COLOR_GOLD) : COLOR_TEXT_DIM};font-style:${isWhisperPreview || isImmaginePreview ? 'italic' : 'normal'};font-weight:${isDicePreview || isSkillPreview ? '700' : '400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      cbody.appendChild(nm);
      cbody.appendChild(pv);
      row.appendChild(cbody);

      const time = document.createElement('div');
      time.textContent = msg.time || '';
      time.style.cssText = `font-size:10px;color:${COLOR_TEXT_DIM};font-variant-numeric:tabular-nums;flex:0 0 auto;`;
      row.appendChild(time);

      row.addEventListener('click', () => { index = idx; draw(); });
      return row;
    }

    function draw() {
      const messages = chatParsed.messages.slice(0, index + 1);
      updateTokens(messages, pgRecords);

      // Posizioni note "fino ad ora" nella timeline (stesso sottoinsieme
      // usato per la mappa): solo la card espansa mostra la coordinata,
      // le righe compatte no.
      const positionsNow = lastKnownPositions(messages);

      sidebarList.innerHTML = '';
      chatParsed.messages.forEach((msg, i) => {
        // Placeholder minimo se il parlante non è un PG risolto (tipo
        // messaggio non riconosciuto, o un fetch scheda/aspetto fallito):
        // meglio una card degradata che farla sparire dalla timeline.
        const pg = pgRecords.find((p) => p.nome === msg.speaker) || {
          nome: msg.speaker, razza: null, sesso: null, censoUrl: msg.censoUrl || null, ritrattoUrl: null, aspetto: null,
          iconUrl: msg.razzaIcon || null,
        };
        sidebarList.appendChild(
          i === index ? buildExpandedCard(pg, msg, positionsNow[msg.speaker]) : buildCompactCard(pg, msg, i)
        );
      });
      const activeEl = sidebarList.children[index];
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });

      counter.textContent = (index + 1) + ' di ' + chatParsed.messages.length + ' · ' + chatParsed.messages[index].time;
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= chatParsed.messages.length - 1;
    }

    prevBtn.addEventListener('click', () => { if (index > 0) { index -= 1; draw(); } });
    nextBtn.addEventListener('click', () => { if (index < chatParsed.messages.length - 1) { index += 1; draw(); } });

    // Va inserito subito dopo l'area messaggi originale (non in coda al
    // body): in replay resta così nel punto naturale del layout, sotto
    // title/subtitle che restano visibili sopra invariati; in live prende
    // il posto di #chat-messages dentro #chat-container, lasciando
    // toolbar/input sotto intatti e funzionanti (sola lettura: qui non si
    // tocca in alcun modo l'input del giocatore). L'originale va nascosto
    // PRIMA di misurare la posizione del pannello, altrimenti il suo testo
    // (ancora visibile) spingerebbe il pannello più in basso di dove deve
    // stare.
    const originalChat = mode === 'live' ? document.getElementById('chat-messages') : document.querySelector('.lot-chat');
    if (originalChat) originalChat.style.display = 'none';
    if (mode !== 'live') {
      const footer = document.querySelector('.lot-footer');
      if (footer) footer.style.display = 'none';
    }

    if (originalChat && originalChat.parentNode) {
      originalChat.parentNode.insertBefore(panel, originalChat.nextSibling);
    } else {
      document.body.appendChild(panel);
    }

    // In live il pannello è già dimensionato dal flex:1 del suo contenitore
    // (#chat-container), niente calcolo manuale — solo ricalcolo di
    // fitScale/righello sul layout reale. In replay riempie lo spazio
    // verticale rimasto fino in fondo alla finestra (title/subtitle sopra
    // occupano la loro fascia) — richiamata sia ora sia ogni volta che il
    // banner riaccende la scena (vedi refreshSceneLayout più sopra).
    function layoutPanel() {
      if (mode !== 'live') {
        const top = panel.getBoundingClientRect().top;
        panel.style.height = Math.max(200, window.innerHeight - top - 16) + 'px';
      }
      updateFitScale();
      applyView();
    }
    // Ricalcola anche senza mappa (updateFitScale/applyView sono no-op in
    // quel caso, ma layoutPanel rifà comunque l'altezza del pannello in
    // replay) — es. popup chat_salvate portato a schermo intero.
    window.addEventListener('resize', () => { layoutPanel(); });
    layoutPanel();
    draw();
    sceneVisible = true;

    console.log('[lot-chat-viewer] timeline pronta:', chatParsed.messages.length, 'messaggi');
  }

  if (!isLive) {
    // --- Replay: un solo parse, un solo fetch, la chat non cambia più. ---
    const chatDerivedRoster = buildChatDerivedRoster(chatParsed.messages);
    Promise.all([
      Promise.all(roster.map((nome) => fetchPGData(nome).then((fetched) => buildPGRecord(nome, chatDerivedRoster, fetched)))),
      fetchMappa(),
    ])
      .then(([pgRecords, mappa]) => {
        console.log('[lot-chat-viewer] PG risolti (chat + fetch, merge applicato):', JSON.stringify(pgRecords, null, 2));
        console.log('[lot-chat-viewer] mappa:', JSON.stringify(mappa, null, 2));
        rebuildScene = () => renderTimeline(chatParsed, pgRecords, mappa);
        rebuildScene();
      })
      .catch((err) => {
        console.error('[lot-chat-viewer] errore nella risoluzione scena:', err);
      });
  } else {
    // --- Live: #chat-messages riceve nuovi <div class="chat-msg"> dal
    // polling di chat_taverne.js. Si osserva il container con un
    // MutationObserver (nessun polling proprio, sola lettura di DOM che
    // arriva comunque per conto suo) e ad ogni raffica di nuovi messaggi si
    // ri-parsa TUTTO il container e si ricostruisce la scena da zero —
    // stessa filosofia "rebuild, mai patch" già in uso per il toggle
    // mostra/nascondi (vedi commento in cima al file). zoom/pan sono
    // sopravvissuti al rebuild tramite liveView (vedi opts.view in
    // renderTimeline); la mappa, una volta risolta, non cambia più nel
    // corso della sessione (stesso presupposto del replay: il luogo è
    // quello dove si trova il PG ora) e non viene rifetchata ad ogni
    // messaggio.
    const liveContainer = document.getElementById('chat-messages');
    const liveView = { zoom: 1, panX: 0, panY: 0 };
    const liveMapVisible = { value: true };
    let liveMappa = null;
    let liveDebounce = null;

    function resolveAndRenderLive() {
      const parsed = parseChatTaverna(liveContainer);
      if (!parsed.messages.length) return;
      const chatDerivedRoster = buildChatDerivedRoster(parsed.messages);
      // Stessa esclusione Fato/Immagine/desiderio del roster iniziale più
      // sopra — vedi commento lì per il perché.
      const liveRoster = Array.from(new Set(
        parsed.messages
          .filter((m) => !m.unsupportedType && m.msgType !== 'fato' && m.msgType !== 'immagine' && m.msgType !== 'desiderio')
          .map((m) => m.speaker)
      ));
      Promise.all([
        Promise.all(liveRoster.map((nome) => fetchPGData(nome).then((fetched) => buildPGRecord(nome, chatDerivedRoster, fetched)))),
        liveMappa ? Promise.resolve(liveMappa) : fetchMappa(),
      ])
        .then(([pgRecords, mappa]) => {
          liveMappa = mappa;
          // rebuildScene va sempre riassegnata ai dati appena risolti, anche
          // a scena nascosta (banner spento, utente sulla vista originale
          // di lot): altrimenti il banner "mostra" richiamerebbe la
          // versione ferma all'ultimo momento in cui era visibile, perdendo
          // tutti i messaggi arrivati nel frattempo. Si evita solo di
          // toccare il DOM adesso se non è comunque visibile.
          rebuildScene = () => renderTimeline(parsed, pgRecords, mappa, { mode: 'live', view: liveView, mapVisible: liveMapVisible });
          if (sceneVisible) rebuildScene();
        })
        .catch((err) => {
          console.error('[lot-chat-viewer] errore nella risoluzione scena live:', err);
        });
    }

    resolveAndRenderLive();

    // Debounce: chat_taverne.js può iniettare più <div class="chat-msg"> in
    // un solo batch di polling — un rebuild per nodo sarebbe sia inutile
    // sia visivamente a scatti. Gira sempre, anche a scena nascosta (vedi
    // sopra): a scena spenta si aggiornano solo i dati, non il DOM.
    const observer = new MutationObserver((mutations) => {
      const hasNewMsg = mutations.some((m) => m.addedNodes.length > 0);
      if (!hasNewMsg) return;
      if (liveDebounce) clearTimeout(liveDebounce);
      liveDebounce = setTimeout(() => {
        liveDebounce = null;
        resolveAndRenderLive();
      }, 400);
    });
    observer.observe(liveContainer, { childList: true });
  }
})();
