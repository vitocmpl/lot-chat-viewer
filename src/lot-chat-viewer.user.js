// ==UserScript==
// @name         lot-chat-viewer
// @namespace    https://github.com/vitocmpl/lot-chat-viewer
// @version      0.0.9
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
  banner.textContent = 'lot-chat-viewer attivo (v0.0.9 — parser chat)';
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
    };
  }

  // --- Parser: pagina aspetto/modellino (proc/ARMInew26.asp?ID=...) ---
  // I layer del modellino sono, in ordine di apparizione nel DOM (che
  // coincide con l'ordine z-index reale): sfondo, piedi, corpo base,
  // vestito, eventuali accessori. La tabella armi ha 12 slot fissi
  // (label in td.slot-header, immagine+nome in td.slot-img successivo).
  function parseAspetto(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const layers = Array.from(doc.querySelectorAll('.avatar-inner img'))
      .map((img) => abs(img.getAttribute('src'), baseUrl));
    const cornice = doc.querySelector('.container img[src*="cornice"]');
    const descFisica = doc.querySelector('.scroll-desc');
    const razzaLabel = doc.querySelector('.scroll-razza');
    const descArmi = doc.querySelector('.armi-desc-box');

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
        link: link ? link.getAttribute('onclick') || abs(link.getAttribute('href'), baseUrl) : null,
      });
    });

    return {
      razza: razzaLabel ? razzaLabel.textContent.trim() : null,
      descrizioneFisica: descFisica ? descFisica.textContent.trim() : null,
      layers,
      cornice: cornice ? abs(cornice.getAttribute('src'), baseUrl) : null,
      armi: armi.filter((a) => a.nome), // scarta gli slot vuoti (senza TITLE)
      descrizioneArmi: descArmi ? descArmi.textContent.replace(/\s+/g, ' ').trim() : null,
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

  // --- Probe: verifica che il fetch same-origin funzioni e che i parser
  // producano dati sensati, prima di collegare tutto al rendering. Sola
  // lettura: GET soltanto, nessun dato inviato oltre l'ID PG già pubblico.
  const PROBE_PG = 'Alderick';
  const PROBE_ENDPOINTS = [
    { label: 'scheda', url: `https://www.extremelot.eu/proc/schedaPG/sx.asp?ID=${PROBE_PG}`, parse: parseSchedaPG },
    { label: 'aspetto', url: `https://www.extremelot.eu/proc/ARMInew26.asp?ID=${PROBE_PG}&scheda=`, parse: parseAspetto },
  ];

  PROBE_ENDPOINTS.forEach(({ label, url, parse }) => {
    fetch(url, { credentials: 'same-origin' })
      .then((res) => res.text().then((html) => ({ html, baseUrl: res.url })))
      .then(({ html, baseUrl }) => {
        console.log(`[lot-chat-viewer] parsed "${label}" per ${PROBE_PG}:`, parse(html, baseUrl));
      })
      .catch((err) => {
        console.error(`[lot-chat-viewer] probe "${label}" fallita:`, err);
      });
  });
})();
