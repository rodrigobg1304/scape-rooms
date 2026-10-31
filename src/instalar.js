// Instalación como app: registra el service worker y muestra el botón "Instalar".
// Android/escritorio: usa el aviso nativo del navegador.
// iPhone/iPad: Safari no tiene aviso; el botón explica cómo añadirla a la pantalla de inicio.

const enStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).pathname).catch(() => {});
  });
}

if (!enStandalone()) {
  const estilo = document.createElement('style');
  estilo.textContent = `
    #instalar { position: fixed; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); z-index: 40;
      font: 600 .85rem/1 ui-monospace, "IBM Plex Mono", monospace; text-transform: uppercase; letter-spacing: .08em;
      min-height: 44px; padding: 0 16px; border: 1.5px solid #d2a54b; background: #d2a54b; color: #1c1711;
      box-shadow: 0 8px 24px rgba(0,0,0,.45); cursor: pointer; }
    #instalar[hidden] { display: none; }
    #instalar-hoja { position: fixed; inset: 0; z-index: 60; display: grid; place-items: end center; padding: 16px;
      background: rgba(0,0,0,.55); }
    #instalar-hoja[hidden] { display: none; }
    #instalar-hoja div { max-width: 380px; width: 100%; background: #1c1711; color: #f2e6c9; border: 2px solid #d2a54b;
      padding: 18px 18px 16px; font: 400 1rem/1.5 Georgia, serif; }
    #instalar-hoja b { font: 600 .8rem ui-monospace, monospace; text-transform: uppercase; letter-spacing: .1em; color: #d2a54b; }
    #instalar-hoja ol { padding-left: 20px; margin: 10px 0 14px; }
    #instalar-hoja button { font: 600 .85rem ui-monospace, monospace; text-transform: uppercase; min-height: 44px; padding: 0 16px;
      border: 1.5px solid #d2a54b; background: transparent; color: #f2e6c9; cursor: pointer; }`;
  document.head.appendChild(estilo);

  const boton = document.createElement('button');
  boton.id = 'instalar';
  boton.type = 'button';
  boton.hidden = true;
  boton.textContent = 'Instalar app';
  document.body.appendChild(boton);

  const hoja = document.createElement('div');
  hoja.id = 'instalar-hoja';
  hoja.hidden = true;
  hoja.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="ih-t">
      <b id="ih-t">Añadir a inicio</b>
      <ol>
        <li>Pulsa el botón <strong>Compartir</strong> de Safari (el cuadrado con la flecha).</li>
        <li>Elige <strong>Añadir a pantalla de inicio</strong>.</li>
        <li>Confirma con <strong>Añadir</strong>.</li>
      </ol>
      <button type="button" id="ih-cerrar">Entendido</button></div>`;
  document.body.appendChild(hoja);
  hoja.querySelector('#ih-cerrar').addEventListener('click', () => { hoja.hidden = true; });
  hoja.addEventListener('click', e => { if (e.target === hoja) hoja.hidden = true; });

  let avisoNativo = null;
  if (esIOS()) {
    boton.hidden = false;
    boton.addEventListener('click', () => { hoja.hidden = false; });
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    avisoNativo = e;
    boton.hidden = false;
  });
  boton.addEventListener('click', async () => {
    if (!avisoNativo) return;
    avisoNativo.prompt();
    await avisoNativo.userChoice.catch(() => {});
    avisoNativo = null;
    boton.hidden = true;
  });
  window.addEventListener('appinstalled', () => { boton.hidden = true; });
}
