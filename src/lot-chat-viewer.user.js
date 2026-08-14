// ==UserScript==
// @name         lot-chat-viewer
// @namespace    https://github.com/vitocmpl/lot-chat-viewer
// @version      0.0.15
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

  const banner = document.createElement('div');
  banner.textContent = 'lot-chat-viewer attivo (v0.0.15 — primo rendering scena)';
  banner.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'z-index:2147483647',
    'background:#222', 'color:#0f0', 'font:12px monospace',
    'padding:6px 10px', 'border-radius:4px', 'opacity:0.85',
  ].join(';');

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

    // Testo: tutto il blocco meno timestamp/link-avatar/immagini/tag,
    // poi si toglie l'eventuale prefisso "Nome  " o "Nome  - " quando il
    // nome è incollato dentro il testo invece di essere un nodo a parte.
    wrap.querySelectorAll('span.msg-pos-tag, span.msg-tag-pos, img, a[href*="avatar.asp"]').forEach((el) => el.remove());
    wrap.querySelectorAll('font[color="#606060"]').forEach((el) => el.remove());
    let testo = wrap.textContent.replace(/\s+/g, ' ').trim();
    if (speaker && testo.startsWith(speaker)) {
      testo = testo.slice(speaker.length).replace(/^\s*-?\s+/, '');
    }

    if (!time || !speaker) return null; // blocco non riconosciuto (es. separatori/note di sistema)

    return { time, speaker, razzaIcon, censoUrl, coordRaw, posLabel, testo };
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

  function renderScene(chatParsed, pgRecords, mappa) {
    if (!mappa.mapUrl) {
      console.warn('[lot-chat-viewer] niente mapUrl, salto il rendering scena');
      return;
    }
    const existing = document.getElementById('lot-chat-viewer-scene');
    if (existing) existing.remove();

    const maxW = Math.min(window.innerWidth * 0.55, 700);
    const maxH = Math.min(window.innerHeight * 0.8, 700);
    const ratio = Math.min(maxW / mappa.mapWidth, maxH / mappa.mapHeight, 1);
    const dispW = Math.floor(mappa.mapWidth * ratio);
    const dispH = Math.floor(mappa.mapHeight * ratio);
    const cellW = dispW / mappa.cols;
    const cellH = dispH / mappa.rows;
    const iconSize = Math.min(cellW, cellH) * 0.75;

    const panel = document.createElement('div');
    panel.id = 'lot-chat-viewer-scene';
    panel.style.cssText = [
      'position:fixed', 'top:56px', 'right:8px', 'z-index:2147483646',
      'background:#111', 'border:1px solid #444', 'border-radius:6px',
      'padding:8px', 'box-shadow:0 4px 16px rgba(0,0,0,.5)',
      'font-family:Verdana,Arial', 'color:#eee',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = [chatParsed.locationName, chatParsed.dateLabel].filter(Boolean).join(' — ');
    title.style.cssText = 'font-size:12px;font-weight:bold;margin-bottom:6px;text-align:center;';
    panel.appendChild(title);

    const stage = document.createElement('div');
    stage.style.cssText = `position:relative;width:${dispW}px;height:${dispH}px;overflow:hidden;border-radius:4px;`;
    const mapImgEl = document.createElement('img');
    mapImgEl.src = mappa.mapUrl;
    mapImgEl.style.cssText = 'width:100%;height:100%;display:block;object-fit:fill;';
    stage.appendChild(mapImgEl);

    const positions = lastKnownPositions(chatParsed.messages);
    pgRecords.forEach((pg) => {
      const pos = positions[pg.nome];
      if (!pos || pos.col < 0 || pos.col >= mappa.cols || pos.row < 0 || pos.row >= mappa.rows) return;

      const token = document.createElement('div');
      token.style.cssText = [
        'position:absolute', `left:${(pos.col + 0.5) * cellW}px`, `top:${(pos.row + 0.5) * cellH}px`,
        'transform:translate(-50%,-50%)', 'display:flex', 'flex-direction:column', 'align-items:center',
      ].join(';');

      const badge = document.createElement('div');
      badge.style.cssText = [
        `width:${iconSize}px`, `height:${iconSize}px`, 'border:2px solid #F8E9AA', 'border-radius:4px',
        'background:rgba(0,0,0,0.6)', 'overflow:hidden', 'box-shadow:0 0 6px rgba(248,233,170,0.4)',
        'display:flex', 'align-items:center', 'justify-content:center',
      ].join(';');
      if (pg.censoUrl) {
        const img = document.createElement('img');
        img.src = pg.censoUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
        badge.appendChild(img);
      } else {
        badge.textContent = pg.nome.charAt(0).toUpperCase();
        badge.style.color = '#F8E9AA';
      }

      const label = document.createElement('div');
      label.textContent = pg.nome;
      label.style.cssText = 'font-size:9px;color:#F8E9AA;text-shadow:0 0 4px #000;margin-top:1px;white-space:nowrap;';

      token.appendChild(badge);
      token.appendChild(label);
      stage.appendChild(token);
    });

    panel.appendChild(stage);
    document.body.appendChild(panel);
    console.log('[lot-chat-viewer] scena renderizzata:', Object.keys(positions).length, 'PG posizionati su', pgRecords.length);
  }

  const chatDerivedRoster = buildChatDerivedRoster(chatParsed.messages);
  Promise.all([
    Promise.all(roster.map((nome) => fetchPGData(nome).then((fetched) => buildPGRecord(nome, chatDerivedRoster, fetched)))),
    fetchMappa(),
  ])
    .then(([pgRecords, mappa]) => {
      console.log('[lot-chat-viewer] PG risolti (chat + fetch, merge applicato):', JSON.stringify(pgRecords, null, 2));
      console.log('[lot-chat-viewer] mappa:', JSON.stringify(mappa, null, 2));
      renderScene(chatParsed, pgRecords, mappa);
    })
    .catch((err) => {
      console.error('[lot-chat-viewer] errore nella risoluzione scena:', err);
    });
})();
