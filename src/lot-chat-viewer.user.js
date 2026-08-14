// ==UserScript==
// @name         lot-chat-viewer
// @namespace    https://github.com/vitocmpl/lot-chat-viewer
// @version      0.0.2
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
  banner.textContent = 'lot-chat-viewer attivo (v0.0.1 — hello world)';
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
  // (stesso formato "HH:MM Speaker [tag] testo" già mappato in lot-poc-3d)

  // TODO: fetch same-origin verso pagina scheda PG / mappa quando serve
  // arricchire un personaggio o un luogo citato in chat, con cache per
  // singola sessione/chat (i dati di un PG possono cambiare tra una
  // giocata e l'altra, non vanno tenuti in cache a lungo termine)

  // TODO: rendering scena (mappa + modellini) al posto/accanto al testo
})();
