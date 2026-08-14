// ==UserScript==
// @name         lot-chat-viewer
// @namespace    https://github.com/<your-username>/lot-chat-viewer
// @version      0.0.1
// @description  Visualizzatore non ufficiale (sola lettura) della chat di Extremelot come scena/mappa con modellini
// @match        https://www.extremelot.eu/proc/chat/chat_salvate*.asp*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/<your-username>/lot-chat-viewer/main/src/lot-chat-viewer.user.js
// @downloadURL  https://raw.githubusercontent.com/<your-username>/lot-chat-viewer/main/src/lot-chat-viewer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Sola lettura: questo script legge il DOM/le risposte già ricevute dal
  // browser del giocatore nella sua sessione. Non invia comandi al gioco,
  // non altera form o input, non salva/inoltra nulla verso server terzi.

  // TODO: parsing del transcript chat salvata già presente nella pagina
  // (stesso formato "HH:MM Speaker [tag] testo" già mappato in lot-poc-3d)

  // TODO: fetch same-origin verso pagina scheda PG / mappa quando serve
  // arricchire un personaggio o un luogo citato in chat, con cache per
  // singola sessione/chat (i dati di un PG possono cambiare tra una
  // giocata e l'altra, non vanno tenuti in cache a lungo termine)

  // TODO: rendering scena (mappa + modellini) al posto/accanto al testo
})();
