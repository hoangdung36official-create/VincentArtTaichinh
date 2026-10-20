let installRequest = null;
const installButtons = [...document.querySelectorAll('.pwa-install')];
const guide = document.querySelector('#pwaGuide');
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function updateInstallButtons() {
  installButtons.forEach(button => { button.hidden = isInstalled(); });
  if (isInstalled()) guide.hidden = true;
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installRequest = event;
  updateInstallButtons();
});

window.addEventListener('appinstalled', () => {
  installRequest = null;
  installButtons.forEach(button => { button.hidden = true; });
  guide.hidden = true;
});

installButtons.forEach(button => button.addEventListener('click', async () => {
  if (installRequest) {
    const request = installRequest;
    installRequest = null;
    await request.prompt();
    const choice = await request.userChoice;
    if (choice?.outcome === 'accepted') {
      guide.hidden = true;
      return;
    }
  }
  guide.hidden = false;
  guide.querySelector('button').focus();
}));

guide.querySelector('button').addEventListener('click', () => { guide.hidden = true; });
updateInstallButtons();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(error => {
    console.warn('PWA service worker registration failed:', error);
  });
}
