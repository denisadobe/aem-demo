// add delayed functionality here

// Pega o nonce de um script que já tem (ex: o próprio scripts.js)
const nonce = document.querySelector('script[nonce]')?.nonce;

const script = document.createElement('script');
script.src = 'https://assets.adobedtm.com/5654ca6d2da4/3ea4c71500b4/launch-321c5d9825fd-development.min.js';
script.async = true;
if (nonce) script.nonce = nonce;
document.head.appendChild(script);
