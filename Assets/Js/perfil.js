/**
 * ╔══════════════════════════════════════════════════════════════╗
 *  PHOENIX — perfil.js (v3 — SaaS Profile Panel)
 *  Módulo: Mi Perfil
 *  Responsabilidades:
 *    - Cargar datos del usuario desde Firebase / localStorage
 *    - Actualizar perfil (nombre, teléfono, nickname)
 *    - Subir y previsualizar imagen de perfil
 *    - Secciones: Rol/Acceso, Sistema, Estadísticas, Actividad
 *    - Preferencias rápidas (tema, notificaciones)
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { Database } from './firebase.js';
import {
  ref, get, update, onValue,
  query, orderByChild, limitToLast,
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

/* ──────────────────────────────────────────────────────────
   SWAL — Tema Phoenix
────────────────────────────────────────────────────────── */
const Phoenix = Swal.mixin({
  background: '#1C2028', color: '#E8ECF2',
  confirmButtonColor: '#17D7A0', cancelButtonColor: '#2A3040',
});

const PhoenixToast = Swal.mixin({
  toast: true, position: 'top-end',
  showConfirmButton: false, timer: 3500, timerProgressBar: true,
  background: '#1C2028', color: '#E8ECF2',
});

/* ──────────────────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────────────────── */
function getAdminEmail() {
  try { return JSON.parse(localStorage.getItem('Admin')) || null; } catch { return null; }
}

function emailToInitials(email) {
  if (!email) return '??';
  const p = email.split('@')[0];
  if (p.includes('.')) { const a = p.split('.'); return (a[0][0] + (a[1]?.[0] || '')).toUpperCase(); }
  if (p.includes('_')) { const a = p.split('_'); return (a[0][0] + (a[1]?.[0] || '')).toUpperCase(); }
  return p.substring(0, 2).toUpperCase();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getPerfilRef(email) {
  const key = email.replace(/[.#$[\]]/g, '_');
  return ref(Database, `Perfiles/${key}`);
}

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _setVal(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }

/* ──────────────────────────────────────────────────────────
   ENTRY POINT
────────────────────────────────────────────────────────── */
export async function initPerfil() {
  const email = getAdminEmail();
  if (!email) return;

  let perfilData = {};
  try {
    const snap = await get(getPerfilRef(email));
    if (snap.exists()) perfilData = snap.val();
  } catch (err) {
    console.warn('perfil.js: no se pudo cargar Firebase', err);
  }

  _renderPerfil(email, perfilData);
  _bindAvatarUpload(email, perfilData);
  _bindFormGuardar(email, perfilData);
  _bindFormCancelar(email, perfilData);
  _bindLogout();
  _bindPreferences();
  _bindRefreshActivity();
  _loadStats(email);
  _loadActivity();
}

/* ──────────────────────────────────────────────────────────
   RENDER — Popula toda la UI
────────────────────────────────────────────────────────── */
function _renderPerfil(email, data) {
  const nombre    = data.nombre    || email.split('@')[0];
  const initials  = emailToInitials(email);
  const emailKey  = email.replace(/[.#$[\]]/g, '_');

  /* Sidebar */
  _setText('pf-sidebar-name',  data.nombre || nombre);
  _setText('pf-sidebar-email', email);
  _setInitials(initials, data.avatarBase64 || null);

  /* Sidebar KPIs */
  _setText('pf-kpi-acciones', data.accionesCount || '0');
  _setText('pf-kpi-registro', formatDate(data.fechaRegistro));

  /* Formulario personal */
  _setVal('perfil-nombre',    data.nombre   || '');
  _setVal('perfil-nickname',  data.nickname || '');
  _setVal('perfil-email',     email);
  _setVal('perfil-telefono',  data.telefono || '');

  /* Sección Rol y Acceso */
  const rol = data.rol || 'Administrador';
  _setText('pf-rol-tipo',     rol);
  _setText('pf-rol-permisos', data.permisos || 'Acceso total al sistema');
  _setText('pf-rol-nivel',    data.nivel    || 'Nivel 1 — Propietario');

  /* Sección Sistema */
  _setText('pf-sys-id',      `#${emailKey.substring(0, 12).toUpperCase()}`);
  _setText('pf-sys-registro', formatDate(data.fechaRegistro));
  _setText('pf-sys-sesion',   formatDateTime(data.ultimoLogin) || 'Ahora');

  const ua      = navigator.userAgent;
  const mobile  = /Mobi|Android/i.test(ua);
  const browser = ua.includes('Edg') ? 'Edge'
    : ua.includes('Chrome')  ? 'Chrome'
    : ua.includes('Firefox') ? 'Firefox'
    : ua.includes('Safari')  ? 'Safari' : 'Navegador';
  _setText('pf-sys-device',  mobile ? 'Dispositivo móvil' : 'Escritorio / Laptop');
  _setText('pf-sys-browser', browser);

  /* Timestamp de última sesión en Firebase */
  _logLastLogin(email);
}

function _setInitials(initials, base64) {
  const span = document.getElementById('pf-avatar-initials');
  const img  = document.getElementById('pf-avatar-img');
  if (!span || !img) return;
  if (base64) {
    img.src = base64; img.style.display = 'block'; span.style.display = 'none';
  } else {
    img.style.display = 'none'; span.style.display = 'block'; span.textContent = initials;
  }
}

/* ──────────────────────────────────────────────────────────
   AVATAR UPLOAD
────────────────────────────────────────────────────────── */
function _bindAvatarUpload(email, perfilData) {
  const input = document.getElementById('input-avatar');
  if (!input) return;

  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      PhoenixToast.fire({ icon: 'error', iconColor: '#eb5757', title: 'Solo se permiten imágenes' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      PhoenixToast.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Imagen máximo 2 MB' });
      return;
    }
    const reader = new FileReader();
    reader.onload = async ev => {
      const base64 = ev.target.result;
      _setInitials(emailToInitials(email), base64);
      try {
        await update(getPerfilRef(email), { avatarBase64: base64 });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Foto de perfil actualizada' });
        await _logActivity(email, 'Foto de perfil actualizada');
      } catch {
        PhoenixToast.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar la imagen' });
      }
    };
    reader.readAsDataURL(file);
  });
}

/* ──────────────────────────────────────────────────────────
   FORMULARIO — Guardar
────────────────────────────────────────────────────────── */
function _bindFormGuardar(email, perfilData) {
  const btn = document.getElementById('btn-perfil-guardar');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const nombre    = document.getElementById('perfil-nombre')?.value.trim();
    const nickname  = document.getElementById('perfil-nickname')?.value.trim();
    const telefono  = document.getElementById('perfil-telefono')?.value.trim();

    if (!nombre) {
      Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'El nombre es requerido' });
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';

    try {
      const snap = await get(getPerfilRef(email));
      const prev = snap.exists() ? snap.val() : {};
      const updates = {
        nombre, nickname, telefono,
        ultimaActualizacion: new Date().toISOString(),
        accionesCount: (prev.accionesCount || 0) + 1,
      };
      if (!prev.fechaRegistro) updates.fechaRegistro = new Date().toISOString();

      await update(getPerfilRef(email), updates);

      _setText('pf-sidebar-name',  nombre);
      _setText('pf-kpi-acciones',  updates.accionesCount);
      _setText('pf-stat-acciones', updates.accionesCount);
      _setText('pf-stat-total',    updates.accionesCount);

      await _logActivity(email, `Perfil actualizado — ${nombre}`, 'blue');
      PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Perfil guardado correctamente' });
    } catch (err) {
      console.error('perfil.js:', err);
      Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar el perfil' });
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar cambios';
    }
  });
}

/* ──────────────────────────────────────────────────────────
   FORMULARIO — Cancelar
────────────────────────────────────────────────────────── */
function _bindFormCancelar(email, perfilData) {
  const btn = document.getElementById('btn-perfil-cancelar');
  if (!btn) return;
  btn.addEventListener('click', () => {
    _setVal('perfil-nombre',   perfilData.nombre   || '');
    _setVal('perfil-nickname', perfilData.nickname || '');
    _setVal('perfil-telefono', perfilData.telefono || '');
    PhoenixToast.fire({ icon: 'info', iconColor: '#516BEB', title: 'Cambios descartados' });
  });
}

/* ──────────────────────────────────────────────────────────
   LOGOUT
────────────────────────────────────────────────────────── */
function _bindLogout() {
  const btn = document.getElementById('perfil-logout-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const res = await Phoenix.fire({
      icon: 'question', title: '¿Cerrar sesión?',
      text: 'Se cerrará tu sesión activa.',
      showCancelButton: true,
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar',
    });
    if (res.isConfirmed) {
      localStorage.removeItem('Admin');
      window.location.replace('../index.html');
    }
  });
}

/* ──────────────────────────────────────────────────────────
   PREFERENCIAS RÁPIDAS
────────────────────────────────────────────────────────── */
function _bindPreferences() {
  /* Tema oscuro (sólo toggle visual; el sistema ya es oscuro por defecto) */
  const darkToggle = document.getElementById('pref-dark-mode');
  if (darkToggle) {
    darkToggle.checked = localStorage.getItem('pref-dark') !== 'false';
    darkToggle.addEventListener('change', () => {
      localStorage.setItem('pref-dark', darkToggle.checked ? 'true' : 'false');
      PhoenixToast.fire({
        icon: 'info',
        iconColor: '#516BEB',
        title: darkToggle.checked ? 'Tema oscuro activado' : 'Tema claro (próximamente)',
      });
    });
  }

  /* Notificaciones */
  const notifToggle = document.getElementById('pref-notifs');
  if (notifToggle) {
    notifToggle.checked = localStorage.getItem('pref-notifs') !== 'false';
    notifToggle.addEventListener('change', () => {
      localStorage.setItem('pref-notifs', notifToggle.checked ? 'true' : 'false');
      PhoenixToast.fire({
        icon: 'info',
        iconColor: '#516BEB',
        title: notifToggle.checked ? 'Notificaciones activadas' : 'Notificaciones desactivadas',
      });
    });
  }
}

/* ──────────────────────────────────────────────────────────
   ESTADÍSTICAS — Clientes + Actividad total
────────────────────────────────────────────────────────── */
async function _loadStats(email) {
  /* Conteo de clientes */
  try {
    const snap = await get(ref(Database, 'Clientes'));
    const total = snap.exists() ? Object.keys(snap.val()).length : 0;
    _setText('pf-stat-clientes', total);
    _setText('pf-stat-servicios', total); // Misma base: cada cliente tiene un servicio
    _setText('pf-kpi-clientes',   total);
  } catch { /* silencioso */ }

  /* Conteo de actividad total */
  try {
    const snap = await get(ref(Database, 'actividad'));
    const total = snap.exists() ? Object.keys(snap.val()).length : 0;
    _setText('pf-stat-total',    total);
    _setText('pf-stat-acciones', total);
    _setText('pf-kpi-acciones',  total);
  } catch { /* silencioso */ }
}

/* ──────────────────────────────────────────────────────────
   ACTIVIDAD — Real-time desde /actividad/ (compartido con Dashboard)
────────────────────────────────────────────────────────── */
function _loadActivity() {
  const container = document.getElementById('perfil-activity-list');
  if (!container) return;

  const q = query(
    ref(Database, 'actividad'),
    orderByChild('timestamp'),
    limitToLast(10),
  );

  onValue(q, snap => {
    if (!snap.exists()) {
      container.innerHTML = '<div class="pf-activity-empty"><i class="bi bi-inbox"></i> Sin actividad registrada.</div>';
      return;
    }

    const items = [];
    snap.forEach(child => items.unshift({ ...child.val(), _key: child.key }));

    const iconMap = {
      login:        { icon: 'bi-box-arrow-in-right', color: 'green' },
      logout:       { icon: 'bi-box-arrow-right',    color: 'red' },
      nuevo_cliente:{ icon: 'bi-person-plus-fill',   color: 'green' },
      eliminar_cliente:{ icon: 'bi-person-x-fill',   color: 'red' },
      actualizacion:{ icon: 'bi-pencil-fill',         color: 'blue' },
      activacion:   { icon: 'bi-check-circle-fill',   color: 'green' },
      desactivacion:{ icon: 'bi-x-circle-fill',       color: 'red' },
      renovacion:   { icon: 'bi-arrow-repeat',        color: 'green' },
      default:      { icon: 'bi-activity',            color: 'blue' },
    };

    container.innerHTML = items.map(ev => {
      const { icon, color } = iconMap[ev.tipo] || iconMap.default;
      const ts = ev.timestamp
        ? new Date(ev.timestamp).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : (ev.time || '—');
      return `
        <div class="pf-activity-item">
          <span class="pf-activity-dot ${ev.color || color}"></span>
          <div class="pf-activity-info">
            <div class="pf-activity-desc"><i class="bi ${icon}" style="margin-right:5px;font-size:0.8rem;"></i>${_esc(ev.desc || ev.tipo || 'Evento')}</div>
            <div class="pf-activity-time">${ts}</div>
          </div>
        </div>`;
    }).join('');
  });
}

/* ──────────────────────────────────────────────────────────
   REFRESH BUTTON — Actividad
────────────────────────────────────────────────────────── */
function _bindRefreshActivity() {
  const btn = document.getElementById('pf-btn-refresh-activity');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const icon = btn.querySelector('i');
    if (icon) { icon.style.transition = 'transform .4s'; icon.style.transform = 'rotate(360deg)'; }
    setTimeout(() => { if (icon) icon.style.transform = 'rotate(0deg)'; }, 450);
    const container = document.getElementById('perfil-activity-list');
    if (container) container.innerHTML = '<div class="pf-activity-loading"><i class="bi bi-hourglass-split pf-spin"></i> Actualizando…</div>';
    _loadActivity();
  });
}

/* ──────────────────────────────────────────────────────────
   LOG LAST LOGIN — Registra timestamp de sesión
────────────────────────────────────────────────────────── */
async function _logLastLogin(email) {
  try {
    const now = new Date().toISOString();
    await update(getPerfilRef(email), { ultimoLogin: now });
    _setText('pf-sys-sesion', 'Ahora — ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
  } catch { /* silencioso */ }
}

/* ──────────────────────────────────────────────────────────
   LOG ACTIVITY — Escribe en /actividad/ (ruta compartida)
────────────────────────────────────────────────────────── */
async function _logActivity(email, desc, color = 'green') {
  try {
    const { push: firebasePush } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');
    await firebasePush(ref(Database, 'actividad'), {
      tipo:      'actualizacion',
      desc,
      color,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('perfil.js: no se pudo registrar actividad', err);
  }
}

/* ──────────────────────────────────────────────────────────
   HELPER — Escape
────────────────────────────────────────────────────────── */
function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
