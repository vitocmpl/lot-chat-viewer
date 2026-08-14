// ==UserScript==
// @name         lot-chat-viewer
// @namespace    https://github.com/vitocmpl/lot-chat-viewer
// @version      0.0.33
// @description  Visualizzatore non ufficiale (sola lettura) della chat di Extremelot come scena/mappa con modellini
// @match        https://www.extremelot.eu/proc/chat/chat_salvate*.asp*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/vitocmpl/lot-chat-viewer/feature/first-working-prototype/src/lot-chat-viewer.user.js
// @downloadURL  https://raw.githubusercontent.com/vitocmpl/lot-chat-viewer/feature/first-working-prototype/src/lot-chat-viewer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Sola lettura: questo script legge il DOM/le risposte già ricevute dal
  // browser del giocatore nella sua sessione. Non invia comandi al gioco,
  // non altera form o input, non salva/inoltra nulla verso server terzi.

  console.log('[lot-chat-viewer] script eseguito su', window.location.href,
    'top frame?', window.top === window);

  // Riferimento al pannello scena, assegnato quando renderTimeline lo crea
  // (arriva dopo i fetch, non subito): il banner lo usa come interruttore
  // acceso/spento, quindi deve tollerare il caso "non ancora pronto".
  let scenePanel = null;

  const banner = document.createElement('div');
  banner.textContent = 'lot-chat-viewer — clicca per mostrare/nascondere';
  banner.title = 'Mostra/nascondi la scena';
  banner.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'z-index:2147483647',
    'background:#222', 'color:#0f0', 'font:12px monospace', 'cursor:pointer',
    'padding:6px 10px', 'border-radius:4px', 'opacity:0.85',
  ].join(';');
  banner.addEventListener('click', () => {
    if (!scenePanel) return;
    const willShow = scenePanel.style.display === 'none';
    scenePanel.style.display = willShow ? '' : 'none';
    // Acceso: nasconde il testo grezzo della chat sotto (sostituito dalla
    // scena) e il footer della pagina. Spento: li rimostra entrambi,
    // nascondendo solo la scena.
    const originalChat = document.querySelector('.lot-chat');
    if (originalChat) originalChat.style.display = willShow ? 'none' : '';
    const footer = document.querySelector('.lot-footer');
    if (footer) footer.style.display = willShow ? 'none' : '';
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
    // Ritratto scelto dal giocatore (zoomabile nella modale del POC): è la
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
      armi: armi.filter((a) => a.nome), // scarta gli slot vuoti (senza TITLE)
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

  function isGreyTimestampFont(node) {
    return node.nodeType === 1 && node.tagName === 'FONT'
      && (node.getAttribute('color') || '').toUpperCase() === '#606060'
      && /\d{2}:\d{2}/.test(node.textContent);
  }

  // Ordine di visualizzazione dei tag modali, identico al client reale.
  const TAG_KIND_ORDER = { F: 0, M: 1, L: 2, S: 3, A: 4, P: 5 };

  // Tag MEDICO ({~MED:...} nel client reale, chat_taverne.js): sempre
  // l'ultimo tra i tag modali, un'icona con tooltip nativo invece di un
  // badge colorato come gli altri sei. URL confermato via scraping live
  // (usato identico in lot-poc-3d). Nessun esempio di chat_salvate.asp
  // con un tag MED sotto mano per confermare il nome classe CSS in
  // QUESTO renderer (diverso da chat_taverne.asp): si prova sia uno span
  // con lo stesso pattern msg-tag-{kind} degli altri cinque, sia un'img
  // già puntata a tagmedico.png — nessuno dei due rompe nulla se assente.
  const MED_ICON_URL = 'https://www.extremelot.eu/lotnew/img/tagmedico.png';

  // Spezza una stringa reale nelle sue "pagine" alternate: azione (dentro
  // «» <> () {} []) e parlato/narrazione (il resto), nell'ordine in cui
  // compaiono nel testo. I tag [...] di metadato (coordinate/tag modali)
  // sono già stati rimossi dal parser della chat prima di questa funzione,
  // quindi qui [...] intercetta solo eventuali parentesi quadre rimaste
  // dentro al corpo del testo stesso.
  function splitSegments(text) {
    const re = /«[^»]*»|<[^>]*>|\([^)]*\)|\{[^}]*\}|\[[^\]]*\]/g;
    const pages = [];
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) {
        const plain = text.slice(last, m.index).trim();
        if (plain) pages.push({ type: 'speech', content: plain });
      }
      const inner = m[0].slice(1, -1).trim();
      if (inner) pages.push({ type: 'action', content: inner });
      last = re.lastIndex;
    }
    if (last < text.length) {
      const tail = text.slice(last).trim();
      if (tail) pages.push({ type: 'speech', content: tail });
    }
    return pages.length ? pages : [{ type: 'speech', content: text.trim() }];
  }

  function speakerFromBlock(wrap) {
    const avatarLink = wrap.querySelector('a[href*="avatar.asp?id="]');
    if (!avatarLink) return null;
    const m = avatarLink.getAttribute('href').match(/id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function parseBlock(timeFont, restNodes, baseDoc) {
    const timeMatch = timeFont.textContent.match(/(\d{2}:\d{2})/);
    const time = timeMatch ? timeMatch[1] : null;

    const wrap = baseDoc.createElement('div');
    wrap.appendChild(timeFont.cloneNode(true));
    restNodes.forEach((n) => wrap.appendChild(n.cloneNode(true)));

    const speaker = speakerFromBlock(wrap);

    const razzaImg = wrap.querySelector('img[src*="/razze/"]');
    const razzaIcon = razzaImg ? razzaImg.getAttribute('src') : null;
    const stemmaImg = wrap.querySelector('img[src*="/stemmi/"]');
    const censoUrl = stemmaImg ? stemmaImg.getAttribute('src') : null;

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
    wrap.querySelectorAll('font[color="#606060"]').forEach((el) => el.remove());
    let testo = wrap.textContent.replace(/\s+/g, ' ').trim();
    if (speaker && testo.startsWith(speaker)) {
      testo = testo.slice(speaker.length).replace(/^\s*-?\s+/, '');
    }

    if (!time || !speaker) return null; // blocco non riconosciuto (es. separatori/note di sistema)

    return { time, speaker, razzaIcon, censoUrl, coordRaw, posLabel, tags, med, testo };
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
    Array.from(chatEl.childNodes).forEach((node) => {
      if (isGreyTimestampFont(node)) {
        if (currentTimeFont) {
          const parsed = parseBlock(currentTimeFont, currentRest, doc);
          if (parsed) messages.push(parsed);
        }
        currentTimeFont = node;
        currentRest = [];
      } else if (currentTimeFont) {
        currentRest.push(node);
      }
    });
    if (currentTimeFont) {
      const parsed = parseBlock(currentTimeFont, currentRest, doc);
      if (parsed) messages.push(parsed);
    }

    return { locationName, dateLabel, messages };
  }

  const chatParsed = parseChatSalvata(document);
  console.log('[lot-chat-viewer] chat parsata:', chatParsed.locationName, chatParsed.dateLabel,
    '—', chatParsed.messages.length, 'messaggi');
  const roster = Array.from(new Set(chatParsed.messages.map((m) => m.speaker)));
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

  // --- Rendering: mappa + token compatti (stemma + nome), stessa formula
  // di ancoraggio cella-centro e stessa dimensione icona già validate in
  // lot-poc-3d (min(cellW,cellH)*0.75) — qui solo la versione "token
  // compatto", senza pan/zoom/modellino intero: primo prototipo statico.
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

  // Ordine "chi è salito in cima più di recente": ogni volta che un PG
  // parla, si sposta in fondo all'array (= più recente). Simulato sull'
  // intera chat fino alla fine, stessa logica di lot-poc-3d (lì costruito
  // in tempo reale scorrendo la timeline; qui in un colpo solo perché non
  // abbiamo ancora una timeline — il risultato finale è identico).
  // Colore di identità per PG, derivato dall'hash del nome (nessuna scelta
  // manuale) — usato solo per il marcatore della cella attiva per ora.
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

  // A..Z poi AA, AB... — stessa formula di lot-poc-3d/chat_mappa_quest.asp
  // (drawLabels), inversa di colIndexFromLetters usata per mostrare la
  // coordinata corrente nella card espansa.
  function colLetter(index) {
    let letter = String.fromCharCode(65 + (index % 26));
    if (index >= 26) letter = String.fromCharCode(65 + Math.floor(index / 26) - 1) + letter;
    return letter;
  }

  function raceIconUrl(razza, sesso) {
    if (!razza) return null;
    return 'https://www.extremelot.eu/lotnew/img/razze/' + razza.toUpperCase() + (sesso === 'Femmina' ? 'F' : 'M') + '.gif';
  }

  // Avatar della card: censo reale (stemma) se disponibile, altrimenti
  // iniziale del nome su sfondo colore-identità.
  function fillAvatar(el, pg) {
    el.innerHTML = '';
    if (pg.censoUrl) {
      el.style.background = 'transparent';
      const img = document.createElement('img');
      img.src = pg.censoUrl;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
      el.appendChild(img);
    } else {
      el.style.background = pgAccentColor(pg.nome);
      el.textContent = pg.nome.charAt(0);
    }
  }

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
  function renderTimeline(chatParsed, pgRecords, mappa) {
    if (!mappa.mapUrl) {
      console.warn('[lot-chat-viewer] niente mapUrl, salto il rendering scena');
      return;
    }
    const existing = document.getElementById('lot-chat-viewer-scene');
    if (existing) existing.remove();
    if (!chatParsed.messages.length) {
      console.warn('[lot-chat-viewer] nessun messaggio parsato, salto la timeline');
      return;
    }

    let index = 0; // parte dal primo messaggio della chat

    // Layout a schermo intero, due colonne (mappa | timeline), stessi
    // colori/spaziature/bordi di lot-poc-3d (variabili :root del POC,
    // .stage-frame + .sidebar) — senza la toolbar in alto: qui la chat è
    // già quella aperta nella pagina, non c'è nulla da selezionare.
    const COLOR_BG = '#120f0c';
    const COLOR_SURFACE = '#1c1610';
    const COLOR_SURFACE2 = '#281f16';
    const COLOR_LINE = '#3a2c1e';
    const COLOR_EMBER = '#d9803f';
    const COLOR_EMBER_DIM = '#8a5227';
    const COLOR_GOLD = '#d9b86a';
    const COLOR_TEXT = '#ece3d6';
    const COLOR_TEXT_DIM = '#a89a89';

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
    ].join(';');

    const stageFrame = document.createElement('div');
    stageFrame.style.cssText = [
      'flex:1', 'min-width:0', 'min-height:0', 'display:flex', 'align-items:stretch', 'gap:12px',
      `background:${COLOR_SURFACE}`, `border:1px solid ${COLOR_LINE}`, 'border-radius:14px', 'padding:12px',
    ].join(';');
    panel.appendChild(stageFrame);

    // ---------- viewport mappa: pan/zoom quadrato come nel POC ----------
    // .stage-viewport-wrap (centra) > .stage-viewport (quadrato, pannabile/
    // zoomabile) > .stage-zoom (transform pan+scale) > .stage-plane
    // (dimensione nativa mappa+margine) > .map-inner (mappa/griglia/token,
    // tutto in coordinate NATIVE — è il transform CSS sull'antenato a
    // adattarlo al riquadro, non un ridimensionamento a monte come nella
    // prima versione statica). Costruito UNA VOLTA (non ad ogni draw()):
    // solo tokenLayer/activeCell vengono aggiornati passo per passo.
    const LABEL_MARGIN_LEFT = 18, LABEL_MARGIN_TOP = 16;
    const ZOOM_MIN = 0.5, ZOOM_MAX = 4;
    const nativeCellW = mappa.mapWidth / mappa.cols;
    const nativeCellH = mappa.mapHeight / mappa.rows;
    const view = { zoom: 1, panX: 0, panY: 0 };
    let fitScale = 1;
    let lastActiveCoordLabel = null;

    const stageWrap = document.createElement('div');
    stageWrap.style.cssText = 'flex:1 1 0;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;';
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
        cell.style.cssText = [
          'position:absolute', `left:${c * nativeCellW}px`, `top:${r * nativeCellH}px`,
          `width:${nativeCellW}px`, `height:${nativeCellH}px`,
          'border-left:1px dashed rgba(0,0,0,0.55)', 'border-top:1px dashed rgba(0,0,0,0.55)',
        ].join(';');
        cellsFrag.appendChild(cell);
      }
    }
    gridCells.appendChild(cellsFrag);
    mapInner.appendChild(gridCells);

    const activeCellEl = document.createElement('div');
    activeCellEl.style.cssText = 'position:absolute;display:none;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.35);';
    mapInner.appendChild(activeCellEl);

    const hoverCellEl = document.createElement('div');
    hoverCellEl.style.cssText = [
      'position:absolute', 'display:none', 'pointer-events:none',
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

    function updateFitScale() {
      const rect = viewport.getBoundingClientRect();
      fitScale = rect.width > 0 ? (rect.width / (mappa.mapWidth + LABEL_MARGIN_LEFT)) : 1;
    }

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

    function applyView() {
      const scale = (fitScale || 1) * view.zoom;
      stageZoom.style.transform = `translate(${view.panX}px,${view.panY}px) scale(${scale})`;
      zoomReadout.textContent = Math.round(view.zoom * 100) + '%';
      // Contro-scala il token compatto (75% della cella nativa) rispetto al
      // solo fitScale, non allo zoom interattivo — stesso principio del
      // POC (--token-icon-scale): a zoom 100% il badge rende alla
      // dimensione "vera" indipendentemente da quanto la mappa si è dovuta
      // rimpicciolire per stare nel riquadro quadrato.
      tokenLayer.style.setProperty('--token-icon-scale', fitScale ? (1 / fitScale) : 1);
      renderRuler();
    }

    function resetView() {
      view.zoom = 1; view.panX = 0; view.panY = 0;
      applyView();
    }
    resetViewBtn.addEventListener('click', resetView);
    window.addEventListener('resize', () => { updateFitScale(); applyView(); });

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
    // resta la stessa per tutta la sessione di replay, come nel POC
    // (buildRosterDom una volta sola, poi solo placeTokenDom/refreshStacks
    // per ogni passo di timeline).
    // Pan automatico verso il PG attivo, se non è già lì — anima invece di
    // scattare di colpo. Solo token compatto qui (nessun modellino intero
    // ancora): è già centrato per intero sulla cella, nessun aggiustamento
    // extra di offset verticale necessario (il POC lo aggiunge solo per il
    // modellino intero, dove i piedi sono ancorati al fondo della cella).
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
    function centerOnActiveToken(pos) {
      if (!pos) return;
      const mRect = mapInner.getBoundingClientRect();
      if (!mRect.width || !mRect.height) return;
      const scaleX = mRect.width / mappa.mapWidth, scaleY = mRect.height / mappa.mapHeight;
      const screenX = mRect.left + (pos.col + 0.5) * nativeCellW * scaleX;
      const screenY = mRect.top + (pos.row + 0.5) * nativeCellH * scaleY;
      const vRect = viewport.getBoundingClientRect();
      const centerX = vRect.left + vRect.width / 2, centerY = vRect.top + vRect.height / 2;
      animatePanTo(view.panX + (centerX - screenX), view.panY + (centerY - screenY), 420);
    }

    function updateTokens(messages, pgRecords) {
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
      centerOnActiveToken(activePos);

      const iconSize = Math.min(nativeCellW, nativeCellH) * 0.75;
      const placed = pgRecords
        .map((pg) => ({ pg, pos: positions[pg.nome] }))
        .filter(({ pos }) => pos && pos.col >= 0 && pos.col < mappa.cols && pos.row >= 0 && pos.row < mappa.rows);

      const groups = {};
      placed.forEach((p) => {
        const key = p.pos.col + ',' + p.pos.row;
        (groups[key] = groups[key] || []).push(p);
      });

      const maxFan = Math.min(nativeCellW, nativeCellH) * 0.42;

      Object.keys(groups).forEach((key) => {
        const group = groups[key];
        if (group.length < 2) return;
        group.sort((a, b) => stackOrder.indexOf(a.pg.nome) - stackOrder.indexOf(b.pg.nome));
        group.forEach((p, i) => {
          const offset = Math.min(i * 5, maxFan);
          p.fanX = offset;
          p.fanY = offset;
          p.zIndex = 100 + i;
        });

        const first = group[0].pos;
        const countBadge = document.createElement('div');
        countBadge.style.cssText = [
          'position:absolute', 'pointer-events:none', 'z-index:10000',
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

      placed.forEach(({ pg, pos, fanX, fanY, zIndex }) => {
        const isActive = pg.nome === activeSpeaker;

        const token = document.createElement('div');
        token.style.cssText = [
          'position:absolute', `left:${(pos.col + 0.5) * nativeCellW + (fanX || 0)}px`, `top:${(pos.row + 0.5) * nativeCellH + (fanY || 0)}px`,
          'width:0', 'height:0', `z-index:${isActive ? 9999 : (zIndex || 10)}`,
        ].join(';');

        // "badge" centra sull'ancora E contro-scala il fitScale in un solo
        // transform — il figlio "label" (assoluto sotto, vedi sotto) eredita
        // la stessa scala essendo dentro badge, coprendo così anche il suo
        // equivalente --icon-label-scale nel POC senza doverlo applicare
        // separatamente (stesso valore in entrambi i casi nel POC).
        const badge = document.createElement('div');
        badge.style.cssText = [
          'position:absolute', 'left:0', 'top:0',
          'transform:translate(-50%,-50%) scale(var(--token-icon-scale,1))',
          `width:${iconSize}px`, `height:${iconSize}px`,
        ].join(';');

        const art = document.createElement('div');
        art.style.cssText = [
          'position:absolute', 'inset:0', 'border:2px solid #F8E9AA', 'border-radius:4px',
          'background:rgba(0,0,0,0.6)', 'overflow:hidden', 'box-shadow:0 0 6px rgba(248,233,170,0.4)',
          'display:flex', 'align-items:center', 'justify-content:center',
        ].join(';');
        if (pg.censoUrl) {
          const img = document.createElement('img');
          img.src = pg.censoUrl;
          img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
          art.appendChild(img);
        } else {
          art.textContent = pg.nome.charAt(0).toUpperCase();
          art.style.color = '#F8E9AA';
        }

        const label = document.createElement('div');
        label.textContent = pg.nome;
        label.style.cssText = [
          'position:absolute', 'top:100%', 'left:50%', 'transform:translateX(-50%)', 'margin-top:1px',
          'font-size:9px', 'color:#F8E9AA', 'text-shadow:0 0 4px #000,0 0 8px #000', 'white-space:nowrap',
        ].join(';');

        badge.appendChild(art);
        badge.appendChild(label);
        token.appendChild(badge);
        tokenLayer.appendChild(token);
      });
    }

    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px;';
    stageFrame.appendChild(sidebar);

    // Header fisso in cima (non scrolla) — stato "N PG in scena · M battute
    // caricate" a sinistra, navigazione ◀ N di M · orario ▶ a destra,
    // stessa posizione/contenuto di .sidebar-header nel POC (lì sopra la
    // lista messaggi, qui sopra il riquadro del messaggio corrente).
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
    controls.appendChild(prevBtn);
    controls.appendChild(counter);
    controls.appendChild(nextBtn);
    sidebarHeader.appendChild(controls);

    const sidebarList = document.createElement('div');
    sidebarList.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px;';
    sidebar.appendChild(sidebarList);

    // Card espansa del messaggio attivo (quello mostrato sulla mappa in
    // questo momento della timeline) — il testo resta grezzo per ora, la
    // suddivisione in fumetti «azione»/parlato (splitSegments nel POC) è
    // il prossimo step separato.
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
    // anche quando due dello stesso tipo si susseguono.
    function buildSpeechBubbles(text) {
      const bubbles = document.createElement('div');
      const slots = splitSegments(text).map((p) => {
        const slot = document.createElement('div');
        slot.style.cssText = 'margin-bottom:6px;overflow:hidden;' + (p.type === 'speech' ? 'padding-left:23px;' : 'padding-right:23px;');
        const bubble = document.createElement('div');
        bubble.style.cssText = [
          `background:${COLOR_SURFACE}`, `color:${COLOR_TEXT}`, `border:1.5px solid ${COLOR_LINE}`,
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
      avatar.style.cssText = 'width:20px;height:20px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:800;font-size:10px;color:#fff8ec;';
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
        header.appendChild(raceIcon);
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
      time.textContent = msg.time;
      time.style.cssText = `font-size:10.5px;font-weight:600;color:${COLOR_TEXT_DIM};font-variant-numeric:tabular-nums;`;
      header.appendChild(time);

      card.appendChild(header);

      if (!activePos) {
        const gapNote = document.createElement('div');
        gapNote.textContent = 'Nessuna coordinata nei suoi messaggi finora: non è ancora visibile sulla mappa.';
        gapNote.style.cssText = `font-size:10.5px;color:${COLOR_EMBER};font-style:italic;`;
        card.appendChild(gapNote);
      }

      card.appendChild(buildSpeechBubbles(msg.testo));

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
      avatar.style.cssText = 'width:20px;height:20px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:800;font-size:10px;color:#fff8ec;';
      fillAvatar(avatar, pg);
      row.appendChild(avatar);

      const cbody = document.createElement('div');
      cbody.style.cssText = 'min-width:0;flex:1;';
      const nm = document.createElement('div');
      nm.textContent = pg.nome;
      nm.style.cssText = `font-size:11px;font-weight:700;color:${COLOR_TEXT};`;
      const pv = document.createElement('div');
      pv.textContent = splitSegments(msg.testo).map((p) => p.content).join(' ');
      pv.style.cssText = `font-size:10.5px;color:${COLOR_TEXT_DIM};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      cbody.appendChild(nm);
      cbody.appendChild(pv);
      row.appendChild(cbody);

      const time = document.createElement('div');
      time.textContent = msg.time;
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
      // le righe compatte no — stessa scelta del POC.
      const positionsNow = lastKnownPositions(messages);

      sidebarList.innerHTML = '';
      chatParsed.messages.forEach((msg, i) => {
        const pg = pgRecords.find((p) => p.nome === msg.speaker);
        if (!pg) return;
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

    // Va inserito subito dopo .lot-chat (non in coda al body): resta così
    // nel punto naturale del layout, sotto title/subtitle che restano
    // visibili sopra invariati. .lot-chat va nascosto PRIMA di misurare
    // la posizione del pannello, altrimenti il suo testo (ancora
    // visibile) spingerebbe il pannello più in basso di dove deve stare.
    const originalChat = document.querySelector('.lot-chat');
    if (originalChat) originalChat.style.display = 'none';
    const footer = document.querySelector('.lot-footer');
    if (footer) footer.style.display = 'none';

    if (originalChat && originalChat.parentNode) {
      originalChat.parentNode.insertBefore(panel, originalChat.nextSibling);
    } else {
      document.body.appendChild(panel);
    }

    // Riempie lo spazio verticale rimasto fino in fondo alla finestra
    // (non tutta la finestra: title/subtitle sopra occupano la loro
    // fascia) — misurato dopo l'inserimento, quando la posizione reale è
    // nota.
    const top = panel.getBoundingClientRect().top;
    panel.style.height = Math.max(200, window.innerHeight - top - 16) + 'px';

    // Dopo l'inserimento: serve il layout reale (getBoundingClientRect) per
    // calcolare fitScale e la geometria del righello.
    updateFitScale();
    applyView();
    draw();
    scenePanel = panel; // il banner in alto lo usa come interruttore mostra/nascondi

    console.log('[lot-chat-viewer] timeline pronta:', chatParsed.messages.length, 'messaggi');
  }

  const chatDerivedRoster = buildChatDerivedRoster(chatParsed.messages);
  Promise.all([
    Promise.all(roster.map((nome) => fetchPGData(nome).then((fetched) => buildPGRecord(nome, chatDerivedRoster, fetched)))),
    fetchMappa(),
  ])
    .then(([pgRecords, mappa]) => {
      console.log('[lot-chat-viewer] PG risolti (chat + fetch, merge applicato):', JSON.stringify(pgRecords, null, 2));
      console.log('[lot-chat-viewer] mappa:', JSON.stringify(mappa, null, 2));
      renderTimeline(chatParsed, pgRecords, mappa);
    })
    .catch((err) => {
      console.error('[lot-chat-viewer] errore nella risoluzione scena:', err);
    });
})();
