/**
 * ╔════════════════════════════════════════════════════════════════╗
 *  PHOENIX — app.js
 *  Responsabilidades:
 *    - Navegación SPA (switchView)
 *    - Carga de vistas HTML externas (fetch)
 *    - Inicialización de módulos (clientes, servicios, perfil, config)
 *    - Dashboard inteligente con datos reales de Firebase (initDashboard)
 *    - Topbar: fecha, título
 *    - Perfil del sidebar
 * ╚════════════════════════════════════════════════════════════════╝
 */

import { initClientes } from './clientes.js';
import { initServicios } from './servicios.js';
import { initPerfil }    from './perfil.js';
import { initConfiguraciones } from './configuraciones.js';
import { Database } from './firebase.js';
import {
  ref, get, onValue,
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

/* ──────────────────────────────────────────────────────────
   NAVEGACIÓN SPA
────────────────────────────────────────────────────────── */

const views    = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const topbarTitle = document.getElementById('topbar-title');

const viewTitles = {
  'view-inicio':    'Inicio',
  'view-clientes':  'Registrar Cliente',
  'view-servicios': 'Servicios',
  'view-perfil':    'Mi Perfil',
  'view-ajustes':   'Configuraciones',
};

// Mapa de URLs de las vistas
const viewUrls = {
  'view-clientes':  './clientes.html',
  'view-servicios': './servicios.html',
  'view-perfil':    './perfil.html',
  'view-ajustes':   './configuraciones.html',
};

// Selectores del wrapper dentro de cada HTML
const viewWrappers = {
  'view-clientes':  '.clientes-wrapper',
  'view-servicios': '.servicios-wrapper',
  'view-perfil':    '.perfil-wrapper',
  'view-ajustes':   '.config-wrapper',
};

async function switchView(viewId) {
  views.forEach(v => v.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));

  const target = document.getElementById(viewId);

  if (target && viewUrls[viewId] && !target.hasAttribute('data-loaded')) {
    try {
      target.innerHTML = `
        <div style="padding:60px;text-align:center;color:var(--text-muted);">
          <i class="bi bi-hourglass-split" style="font-size:2rem;"></i>
          <p style="margin-top:12px;font-size:.9rem;">Cargando vista...</p>
        </div>`;

      const resp = await fetch(viewUrls[viewId]);
      if (resp.ok) {
        const html = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const sel = viewWrappers[viewId];
        const wrapper = (sel ? doc.querySelector(sel) : null) || doc.body;

        target.innerHTML = '';
        target.appendChild(wrapper);
        target.setAttribute('data-loaded', 'true');

        if (viewId === 'view-clientes')  initClientes();
        if (viewId === 'view-servicios') initServicios();
        if (viewId === 'view-perfil')    initPerfil();
        if (viewId === 'view-ajustes')   initConfiguraciones();
      } else {
        target.innerHTML = '<div style="padding:40px;text-align:center;color:var(--red);">Error al cargar la vista</div>';
      }
    } catch (err) {
      console.error('switchView error:', err);
      target.innerHTML = '<div style="padding:40px;text-align:center;color:var(--red);">Error al cargar la vista</div>';
    }
  }

  if (target) target.classList.add('active');

  const navMatch = document.querySelector(`.nav-item[data-view="${viewId}"]`);
  if (navMatch) navMatch.classList.add('active');

  if (topbarTitle) topbarTitle.textContent = viewTitles[viewId] || 'Phoenix';
}

/* Bind nav items */
navItems.forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    switchView(item.dataset.view);
  });
});

/* Accesos rápidos del dashboard */
document.querySelectorAll('.quick-card[data-view]').forEach(card => {
  card.addEventListener('click', () => switchView(card.dataset.view));
  card.addEventListener('keydown', e => { if (e.key === 'Enter') switchView(card.dataset.view); });
});

/* Stat cards clickables del dashboard */
document.querySelectorAll('.stat-card-clickable[data-view]').forEach(card => {
  card.addEventListener('click', () => switchView(card.dataset.view));
});

/* ──────────────────────────────────────────────────────────
   TOPBAR — Fecha y hora
────────────────────────────────────────────────────────── */
function updateTopbarDate() {
  const el = document.getElementById('topbar-date');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
updateTopbarDate();

/* ──────────────────────────────────────────────────────────
   PERFIL DE USUARIO — Sidebar
────────────────────────────────────────────────────────── */
function loadUserProfile() {
  const adminEmail = JSON.parse(localStorage.getItem('Admin'));
  if (!adminEmail) return;

  const avatarDisplay = document.querySelector('.avatar');
  const nameDisplay   = document.querySelector('.avatar-name');
  const welcomeTitle  = document.querySelector('.view-title');

  const userPart = adminEmail.split('@')[0];
  let initials = '';
  if (userPart.includes('.')) {
    const p = userPart.split('.');
    initials = (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  } else if (userPart.includes('_')) {
    const p = userPart.split('_');
    initials = (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  } else {
    initials = userPart.substring(0, 2).toUpperCase();
  }

  if (avatarDisplay) avatarDisplay.textContent = initials;
  if (nameDisplay)   nameDisplay.textContent   = adminEmail;

  if (welcomeTitle) {
    const displayName = userPart.split(/[._]/)[0];
    const formatted   = displayName.charAt(0).toUpperCase() + displayName.slice(1);
    welcomeTitle.textContent = `¡Bienvenido, ${formatted}! 👋`;

    const sub = document.getElementById('dash-subtitle');
    if (sub) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
      sub.textContent = `${greeting}. Aquí tienes el resumen del negocio.`;
    }
  }
}
loadUserProfile();

/* ──────────────────────────────────────────────────────────
   HELPERS DOM
────────────────────────────────────────────────────────── */
const setText = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
};

function animateCount(el, target, duration = 900) {
  if (!el) return;
  const start = 0;
  const startTime = performance.now();
  const tick = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(start + (target - start) * ease);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setBarWidth(id, pct, delay = 0) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.min(pct, 100)}%`;
  }, delay + 100);
}

/* ──────────────────────────────────────────────────────────
   DASHBOARD — Inicialización principal
────────────────────────────────────────────────────────── */
export async function initDashboard() {
  _listenClientes();
  _loadConfiguracion();
  _loadActividad();
  _setSystemStatus();

  const btnRefresh = document.getElementById('btn-refresh-activity');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      const list = document.getElementById('dash-activity-list');
      if (list) list.innerHTML = '<div class="dash-loading"><i class="bi bi-hourglass-split"></i> Actualizando...</div>';
      _loadActividad();
    });
  }
}

/* ──────────────────────────────────────────────────────────
   CLIENTES — Firebase real-time listener
   Ruta: /Clientes/{pushId} → { Nombre, Numero, Negocio, Direccion, Estado, Token, timestamp }
────────────────────────────────────────────────────────── */
function _listenClientes() {
  const clientesRef = ref(Database, 'Clientes');

  onValue(clientesRef, (snap) => {
    const data = snap.exists() ? snap.val() : {};
    const all  = Object.values(data);
    const total = all.length;

    // Contar por estado
    let activos = 0, mant = 0, inact = 0;
    const now   = new Date();
    let nuevosMes = 0;

    // Map negocio → frecuencia para top negocios
    const negocioMap = {};

    all.forEach(c => {
      const estado = (c.Estado || '').toLowerCase();
      if      (estado === 'activo')         activos++;
      else if (estado === 'mantenimiento')  mant++;
      else if (estado === 'inactivo')       inact++;

      // Clientes registrados este mes
      if (c.timestamp) {
        const d = new Date(c.timestamp);
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
          nuevosMes++;
        }
      }

      // Top negocios
      const neg = c.Negocio || c.negocio || 'Sin nombre';
      negocioMap[neg] = (negocioMap[neg] || 0) + 1;
    });

    // ── Actualizar stat cards ──
    const elTotal = document.getElementById('dash-clientes-total');
    if (elTotal) animateCount(elTotal, activos);

    // Trend
    const trend = document.getElementById('dash-clientes-trend');
    if (trend) {
      trend.textContent = activos > 0 ? `${activos} activos` : '';
      trend.className = 'stat-card-trend green';
    }

    // Stat: total servicios = total registros
    const elServ = document.getElementById('dash-servicios-total');
    if (elServ) animateCount(elServ, total);

    const trendS = document.getElementById('dash-servicios-trend');
    if (trendS) {
      trendS.textContent = `${total} registros`;
      trendS.className = 'stat-card-trend blue';
    }

    // ── Distribución de estados ──
    const elActivos = document.getElementById('dash-count-activos');
    if (elActivos) animateCount(elActivos, activos);
    const elMant  = document.getElementById('dash-count-mant');
    if (elMant)  animateCount(elMant, mant);
    const elInact = document.getElementById('dash-count-inact');
    if (elInact) animateCount(elInact, inact);

    // Barras de progreso
    const base = total || 1;
    setBarWidth('dash-bar-activos', (activos / base) * 100, 0);
    setBarWidth('dash-bar-mant',    (mant    / base) * 100, 150);
    setBarWidth('dash-bar-inact',   (inact   / base) * 100, 300);

    // ── Nuevos este mes ──
    const elNuevos = document.getElementById('dash-nuevos-mes');
    if (elNuevos) animateCount(elNuevos, nuevosMes, 700);
    const badge = document.getElementById('dash-nuevos-mes-badge');
    if (badge) badge.textContent = `+${nuevosMes}`;

    // ── Total registros en sistema ──
    setText('sys-total-records', `${total} clientes`);

    // ── Top negocios ──
    _renderTopNegocios(negocioMap);

    // ── Recordatorios ──
    _renderRecordatorios(activos, mant, inact, nuevosMes, total);

  }, (err) => {
    console.error('Dashboard: error leyendo Clientes', err);
    _setOfflineStatus();
  });
}

/* ──────────────────────────────────────────────────────────
   CONFIGURACIÓN DEL NEGOCIO
   Ruta: /Configuraciones/{key} → { estadoNegocio, nombreNegocio }
────────────────────────────────────────────────────────── */
async function _loadConfiguracion() {
  const adminEmail = JSON.parse(localStorage.getItem('Admin'));
  if (!adminEmail) return;

  const key = adminEmail.replace(/[.#$[\]]/g, '_');

  try {
    // Buscar en /Configuraciones/{key}
    const configSnap = await get(ref(Database, `Configuraciones/${key}`));
    const config = configSnap.exists() ? configSnap.val() : {};

    // Buscar nombre en /Perfiles/{key}
    const perfilSnap = await get(ref(Database, `Perfiles/${key}`));
    const perfil = perfilSnap.exists() ? perfilSnap.val() : {};

    // Nombre del negocio: buscar en /Administradores
    const admSnap = await get(ref(Database, 'Administradores'));
    let adminData = {};
    if (admSnap.exists()) {
      const admins = admSnap.val();
      for (const v of Object.values(admins)) {
        if (v.Email === adminEmail) { adminData = v; break; }
      }
    }

    // Nombre del negocio
    const negocioNombre = config.nombreNegocio
                        || perfil.nombre
                        || adminData.Negocio
                        || adminEmail.split('@')[0];
    setText('dash-negocio-nombre', negocioNombre);

    // Estado del negocio
    const estado = (config.estadoNegocio || 'activo').toLowerCase();
    const estadoLabels = {
      'activo':        'Activo',
      'mantenimiento': 'Mantenimiento',
      'cerrado':       'Cerrado',
    };
    const estadoIcons = {
      'activo':        'bi-check-circle-fill',
      'mantenimiento': 'bi-tools',
      'cerrado':       'bi-x-circle-fill',
    };

    setText('dash-estado-val', estadoLabels[estado] || 'Activo');

    const iconEl    = document.getElementById('dash-estado-icon');
    const iconChild = document.getElementById('dash-estado-ico');
    if (iconEl) {
      iconEl.className = 'stat-card-icon';
      iconEl.classList.add(estado === 'activo' ? 'activo' : estado === 'mantenimiento' ? 'mant' : 'cerrado');
    }
    if (iconChild) {
      iconChild.className = `bi ${estadoIcons[estado] || 'bi-check-circle-fill'}`;
    }

  } catch (err) {
    console.warn('Dashboard: no se pudo cargar configuración:', err);
    setText('dash-negocio-nombre', 'Mi negocio');
    setText('dash-estado-val', 'Activo');
  }
}

/* ──────────────────────────────────────────────────────────
   ACTIVIDAD RECIENTE
   Lee desde /Perfiles/{key}/actividad
────────────────────────────────────────────────────────── */
async function _loadActividad() {
  const adminEmail = JSON.parse(localStorage.getItem('Admin'));
  if (!adminEmail) return;

  const key = adminEmail.replace(/[.#$[\]]/g, '_');

  try {
    const snap = await get(ref(Database, `Perfiles/${key}/actividad`));
    const actividad = snap.exists() ? snap.val() : [];

    const container = document.getElementById('dash-activity-list');
    if (!container) return;

    // También añadimos eventos genéricos del sistema
    const systemEvents = [
      { desc: 'Sesión iniciada en Phoenix', time: 'Ahora mismo',   color: 'green' },
      { desc: 'Dashboard cargado correctamente', time: 'Hace 1 s', color: 'blue'  },
    ];

    const merged = [...(Array.isArray(actividad) ? actividad : []), ...systemEvents].slice(0, 8);

    if (merged.length === 0) {
      container.innerHTML = '<div class="dash-loading"><i class="bi bi-inbox"></i> Sin actividad reciente</div>';
      return;
    }

    container.innerHTML = merged.map(a => `
      <div class="dash-activity-item">
        <span class="dash-activity-dot ${a.color || 'green'}"></span>
        <div class="dash-activity-info">
          <div class="dash-activity-desc">${_escHtml(a.desc)}</div>
          <div class="dash-activity-time">${_escHtml(a.time || '')}</div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.warn('Dashboard: no se pudo cargar actividad:', err);
    const container = document.getElementById('dash-activity-list');
    if (container) {
      container.innerHTML = '<div class="dash-loading"><i class="bi bi-inbox"></i> Sin actividad</div>';
    }
  }
}

/* ──────────────────────────────────────────────────────────
   TOP NEGOCIOS (con más clientes registrados)
────────────────────────────────────────────────────────── */
function _renderTopNegocios(negocioMap) {
  const container = document.getElementById('dash-top-servicios');
  if (!container) return;

  const sorted = Object.entries(negocioMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="dash-loading"><i class="bi bi-shop"></i> Sin negocios registrados</div>';
    return;
  }

  const medals = [
    { cls: 'gold',   label: '1' },
    { cls: 'silver', label: '2' },
    { cls: 'bronze', label: '3' },
  ];

  container.innerHTML = sorted.map(([nombre, count], i) => {
    const medal = medals[i] || { cls: 'bronze', label: String(i + 1) };
    return `
      <div class="dash-top-item">
        <span class="dash-top-rank ${medal.cls}">${medal.label}</span>
        <span class="dash-top-name" title="${_escHtml(nombre)}">${_escHtml(nombre)}</span>
        <span class="dash-top-meta">${count} cliente${count !== 1 ? 's' : ''}</span>
      </div>
    `;
  }).join('');
}

/* ──────────────────────────────────────────────────────────
   ESTADO DEL SISTEMA
────────────────────────────────────────────────────────── */
function _setSystemStatus() {
  const lastUpdate = document.getElementById('sys-lastupdate');
  if (lastUpdate) {
    lastUpdate.textContent = new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit',
    });
  }

  // Test de conectividad Firebase haciendo una lectura simple
  get(ref(Database, '.info/connected'))
    .then(() => {
      _setBadge('sys-firebase', 'Conectado', 'dash-badge-online');
      _setBadge('sys-sync',     'Al día',    'dash-badge-online');
    })
    .catch(() => {
      _setBadge('sys-firebase', 'Sin conexión', 'dash-badge-error');
      _setBadge('sys-sync',     'Pendiente',    'dash-badge-warning');
    });
}

function _setOfflineStatus() {
  _setBadge('sys-firebase', 'Sin conexión', 'dash-badge-error');
  _setBadge('sys-sync',     'Pendiente',    'dash-badge-warning');
}

function _setBadge(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `dash-sys-badge ${cls}`;
}

/* ──────────────────────────────────────────────────────────
   RECORDATORIOS inteligentes basados en datos reales
────────────────────────────────────────────────────────── */
function _renderRecordatorios(activos, mant, inact, nuevosMes, total) {
  const container = document.getElementById('dash-reminders-list');
  if (!container) return;

  const reminders = [];

  if (total === 0) {
    reminders.push({ type: 'info', icon: 'bi-info-circle-fill', title: 'Sin clientes', text: 'Registra tu primer cliente para comenzar.' });
  }
  if (nuevosMes > 0) {
    reminders.push({ type: 'success', icon: 'bi-person-plus-fill', title: `+${nuevosMes} cliente${nuevosMes > 1 ? 's' : ''} este mes`, text: 'Tu negocio está creciendo este mes.' });
  }
  if (mant > 0) {
    reminders.push({ type: 'warning', icon: 'bi-tools', title: `${mant} en mantenimiento`, text: 'Revisa los clientes en modo mantenimiento.' });
  }
  if (inact > 0) {
    reminders.push({ type: 'warning', icon: 'bi-exclamation-circle-fill', title: `${inact} inactivo${inact > 1 ? 's' : ''}`, text: 'Considera retomar contacto con clientes inactivos.' });
  }
  if (activos > 0 && mant === 0 && inact === 0) {
    reminders.push({ type: 'success', icon: 'bi-check-circle-fill', title: 'Todo en orden', text: `${activos} cliente${activos > 1 ? 's' : ''} activo${activos > 1 ? 's' : ''} sin incidencias.` });
  }

  // Máximo 3 recordatorios
  const list = reminders.slice(0, 3);

  if (list.length === 0) {
    container.innerHTML = '<div class="dash-loading"><i class="bi bi-check-circle"></i> Sin recordatorios</div>';
    return;
  }

  container.innerHTML = list.map(r => `
    <div class="dash-reminder-item ${r.type}">
      <i class="bi ${r.icon} dash-reminder-icon"></i>
      <div class="dash-reminder-text">
        <strong>${_escHtml(r.title)}</strong>
        ${_escHtml(r.text)}
      </div>
    </div>
  `).join('');
}

/* ──────────────────────────────────────────────────────────
   HELPER — Sanitizar HTML
────────────────────────────────────────────────────────── */
function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ──────────────────────────────────────────────────────────
   ARRANQUE — Inicia el dashboard al cargar la página
────────────────────────────────────────────────────────── */
initDashboard();
