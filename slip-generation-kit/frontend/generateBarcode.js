// generateBarcode.js
//
// Renders a Code-128 barcode directly in the browser using bwip-js (canvas API)
// and returns a data URL — no backend HTTP call required.
//
// Drop-in replacement for the original HTTP-based version: same signature,
// same return type, works offline and inside Shopify embedded apps where
// internal backend routes may not be browser-accessible.
//
// Install:  npm i bwip-js

import bwipjs from 'bwip-js';

/**
 * Render a Code-128 barcode and return a PNG data URL.
 *
 * @param {string|number} text        The string to encode.
 * @param {boolean}       [includeText=true]  Render human-readable text under the bars.
 * @returns {Promise<string>}         A PNG data URL (`data:image/png;base64,…`).
 */
export async function generateBarcode(text, includeText = true) {
  const canvas = document.createElement('canvas');
  try {
    bwipjs.toCanvas(canvas, {
      bcid: 'code128',
      text: String(text),
      scale: 3,
      height: 10,
      includetext: includeText,
      textxalign: 'center',
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('generateBarcode failed:', err);
    throw err;
  }
}
