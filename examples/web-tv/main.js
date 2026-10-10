// Minimal Fooly TV screen. Runs in any browser engine: Tizen, webOS, Android TV WebView, Fire TV.
// Key: ?pk=pk_... in the URL, or paste it below. Get one at https://fooly.bhdit.com/dashboard/
import { Fooly } from './fooly.js';
import qrcode from './qrcode.js';   // qrcode-generator by Kazuhiko Arase, MIT (see THIRD_PARTY.md)

const PUBLISHABLE_KEY = new URLSearchParams(location.search).get('pk') || 'pk_your_key_here';
const $ = (id) => document.getElementById(id);

function drawQrCode(canvas, text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), scale = 8, quiet = 2;
  canvas.width = canvas.height = (n + quiet * 2) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
}

async function run() {
  const fooly = new Fooly({ publishableKey: PUBLISHABLE_KEY, apiBase: 'https://fooly.bhdit.com/api' });
  for (;;) {                                   // every failure is recovered the same way: a new session
    try {
      const session = await fooly.createSession({
        fields: [
          { name: 'username', label: 'Username', autocomplete: 'username' },
          { name: 'password', label: 'Password', type: 'password' },
        ],
      });
      drawQrCode($('qr'), session.url);
      $('status').textContent = 'Scan with your phone';
      $('code').textContent = session.code;
      $('hint').textContent = `or go to ${new URL(session.codeUrl).host} and enter the code`;

      const { username, password } = await session.wait();
      $('status').textContent = `Signed in as ${username}`;
      $('code').textContent = ''; $('hint').textContent = '';
      $('result').textContent = `Password received (${password.length} characters). Never log it.`;
      return;
    } catch (err) {
      if (err.code === 'invalid_key') { $('status').textContent = 'Set your publishable key (?pk=pk_…)'; return; }
      $('status').textContent = err.code === 'expired' ? 'Code expired, making a new one…' : `Trying again (${err.code})…`;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
run();
