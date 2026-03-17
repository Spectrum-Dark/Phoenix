(function () {
  const adminRaw = localStorage.getItem('Admin');

  if (!adminRaw) {
    // Si NO hay sesión, redirigir inmediatamente
    window.location.replace('../index.html');
    return;
  }

  // Si HAY sesión, quitar el "velo"
  document.documentElement.style.visibility = 'visible';
  const style = document.createElement('style');
  style.innerHTML = 'body { visibility: visible !important; opacity: 1 !important; }';
  document.head.appendChild(style);

  /* ────────────────────────────────────────────
     Emitir evento de login para que app.js
     lo capture y registre en Firebase.
     Se usa window.dispatchEvent porque auth.js
     corre como <script> clásico (no ES module).
  ──────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    let email = '';
    try { email = JSON.parse(adminRaw) || ''; } catch { email = adminRaw || ''; }

    // Lanzar evento que app.js escucha una vez que Firebase esté listo
    window.dispatchEvent(new CustomEvent('phoenix:login', {
      detail: { email, timestamp: new Date().toISOString() },
    }));

    // ── Botón Cerrar sesión ──
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async (e) => {
        e.preventDefault();

        // Notificar a app.js para que marque el admin como offline
        window.dispatchEvent(new CustomEvent('phoenix:logout', {
          detail: { email, timestamp: new Date().toISOString() },
        }));

        // Pequeña pausa para que Firebase procese el evento antes de redirigir
        await new Promise(r => setTimeout(r, 350));
        localStorage.removeItem('Admin');
        window.location.replace('../index.html');
      });
    }
  });
})();