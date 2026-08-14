// ==UserScript==
// @name         lot-chat-viewer
// @namespace    https://github.com/vitocmpl/lot-chat-viewer
// @version      0.0.3
// @description  Visualizzatore non ufficiale (sola lettura) della chat di Extremelot come scena/mappa con modellini
// @match        https://www.extremelot.eu/proc/chat/chat_salvate*.asp*
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

  // Versione "hello world": conferma solo che lo script è installato e si
  // attiva sulla pagina giusta, senza toccare il contenuto della pagina.
  // Log sempre presente (visibile anche se la pagina è un frameset e il
  // banner visivo non trova un <body> dove agganciarsi): apri la console
  // DevTools (F12) e cerca "[lot-chat-viewer]" per verificare in ogni caso
  // che lo script sia effettivamente eseguito su questo frame/pagina.
  console.log('[lot-chat-viewer] script eseguito su', window.location.href,
    'top frame?', window.top === window);

  const banner = document.createElement('div');
  banner.textContent = 'lot-chat-viewer attivo (v0.0.3 — probe same-origin)';
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

  // TODO: parsing del transcript chat salvata già presente nella pagina
  // (DOM di .lot-chat, non il formato a riga singola del vecchio POC)

  // TODO: rendering scena (mappa + modellini) al posto/accanto al testo

  // --- Probe: verifica che il fetch same-origin verso altri endpoint di
  // lot funzioni con la sessione del giocatore già loggata in pagina,
  // prima di costruire il parsing vero sopra questi dati. Sola lettura:
  // GET soltanto, nessun dato inviato oltre l'ID PG già pubblico in chat.
  const PROBE_PG = 'Alderick';
  const PROBE_ENDPOINTS = [
    { label: 'scheda PG (sx.asp)', url: `https://www.extremelot.eu/proc/schedaPG/sx.asp?ID=${PROBE_PG}` },
    { label: 'modellino/vestiti (ARMInew26.asp)', url: `https://www.extremelot.eu/proc/ARMInew26.asp?ID=${PROBE_PG}&scheda=` },
  ];

  PROBE_ENDPOINTS.forEach(({ label, url }) => {
    fetch(url, { credentials: 'same-origin' })
      .then((res) => {
        console.log(`[lot-chat-viewer] probe "${label}" →`, res.status, res.url);
        return res.text();
      })
      .then((text) => {
        console.log(`[lot-chat-viewer] probe "${label}" primi 500 char:\n`, text.slice(0, 500));
      })
      .catch((err) => {
        console.error(`[lot-chat-viewer] probe "${label}" fallita:`, err);
      });
  });
})();
