/**
 * ╔══════════════════════════════════════════════════════════╗
 *  PHOENIX — perfil.js
 *  Módulo: Mi Perfil
 *  Responsabilidades:
 *    - Cargar datos del usuario desde Firebase / localStorage
 *    - Actualizar perfil (nombre, teléfono, descripción, nickname)
 *    - Subir y previsualizar imagen de perfil
 *    - Manejo de seguridad (cambiar contraseña, sesiones)
 *    - Actividad reciente y estadísticas
 * ╚══════════════════════════════════════════════════════════╝
 */

import { Database } from './firebase.js';
import {
  ref,
  get,
  set,
  update,
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

/* ──────────────────────────────────────────────────────────
   CONSTANTES Y HELPERS
────────────────────────────────────────────────────────── */

// Mixin de SweetAlert2 con tema Phoenix (igual que main.js / app.js)
const Phoenix = Swal.mixin({
  background: '#1C2028',
  color: '#E8ECF2',
  confirmButtonColor: '#17D7A0',
  cancelButtonColor: '#2A3040',
  customClass: {
    popup: 'phoenix-popup',
    confirmButton: 'phoenix-btn-confirm',
    cancelButton: 'phoenix-btn-cancel',
  },
});

const PhoenixToast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3500,
  timerProgressBar: true,
  background: '#1C2028',
  color: '#E8ECF2',
  customClass: { popup: 'phoenix-toast', timerProgressBar: 'phoenix-progress' },
});

/** Obtiene el email del administrador desde localStorage */
function getAdminEmail() {
  try {
    return JSON.parse(localStorage.getItem('Admin')) || null;
  } catch {
    return null;
  }
}

/** Convierte un email en siglas para el avatar */
function emailToInitials(email) {
  if (!email) return '??';
  const userPart = email.split('@')[0];
  if (userPart.includes('.')) {
    const p = userPart.split('.');
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  if (userPart.includes('_')) {
    const p = userPart.split('_');
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  return userPart.substring(0, 2).toUpperCase();
}

/** Formatea una fecha ISO a formato legible */
function formatDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/* ──────────────────────────────────────────────────────────
   REFERENCIA FIREBASE
────────────────────────────────────────────────────────── */

/** Devuelve la ref de Firebase para el perfil del admin actual */
function getPerfilRef(email) {
  // Sanitizamos el email para usarlo como clave (Firebase no acepta . en keys)
  const key = email.replace(/[.#$[\]]/g, '_');
  return ref(Database, `Perfiles/${key}`);
}

/* ──────────────────────────────────────────────────────────
   INICIALIZACIÓN DEL MÓDULO
   Llamada desde app.js cuando se carga la vista
────────────────────────────────────────────────────────── */
export async function initPerfil() {
  const email = getAdminEmail();
  if (!email) return; // auth.js redirigiría, pero por seguridad

  // ── Cargar datos desde Firebase
  let perfilData = {};
  try {
    const snap = await get(getPerfilRef(email));
    if (snap.exists()) {
      perfilData = snap.val();
    }
  } catch (err) {
    console.warn('perfil.js: no se pudieron cargar datos de Firebase', err);
  }

  // ── Actualizar la UI con los datos obtenidos
  _renderPerfil(email, perfilData);

  // ── Configurar eventos del módulo
  _bindAvatarUpload(email, perfilData);
  _bindFormGuardar(email);
  _bindFormCancelar(email, perfilData);
  _bindPasswordChange(email);
  _bindSesionesToggle();
  _bindLogout();
}

/* ──────────────────────────────────────────────────────────
   RENDER — llena la UI con los datos del perfil
────────────────────────────────────────────────────────── */
function _renderPerfil(email, data) {
  const nombre = data.nombre || email.split('@')[0];
  const initials = emailToInitials(email);

  // ── Sidebar
  _setText('sidebar-name', data.nombre || nombre);
  _setText('sidebar-email', email);

  // ── Avatar
  _setInitials(initials, data.avatarBase64 || null);

  // ── Estadísticas mini sidebar
  _setText('mini-registro', formatDate(data.fechaRegistro));
  _setText('mini-sesion', 'Ahora');
  _setText('mini-acciones', data.accionesCount || 0);

  // ── Formulario
  _setVal('perfil-nombre', data.nombre || '');
  _setVal('perfil-nickname', data.nickname || '');
  _setVal('perfil-email', email);
  _setVal('perfil-telefono', data.telefono || '');
  _setVal('perfil-descripcion', data.descripcion || '');

  // ── Estadísticas grandes
  _setText('stat-fecha', formatDate(data.fechaRegistro || new Date().toISOString()));
  _setText('stat-acciones', data.accionesCount || 0);
  _setText('stat-sesion', 'Ahora');

  // ── Actividad reciente
  _renderActivity(data.actividad || []);

  // ── Sesiones
  _renderSessions();
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function _setInitials(initials, base64) {
  const span = document.getElementById('perfil-avatar-initials');
  const img  = document.getElementById('perfil-avatar-img');
  if (!span || !img) return;

  if (base64) {
    img.src = base64;
    img.style.display = 'block';
    span.style.display = 'none';
  } else {
    img.style.display = 'none';
    span.style.display = 'block';
    span.textContent = initials;
  }
}

/* ──────────────────────────────────────────────────────────
   ACTIVIDAD RECIENTE
────────────────────────────────────────────────────────── */
function _renderActivity(actividadArr) {
  const container = document.getElementById('perfil-activity-list');
  if (!container) return;

  // Actividades genéricas si no hay datos reales
  const defaultActivity = [
    { desc: 'Inicio de sesión en el panel', time: 'Ahora mismo', color: 'green' },
    { desc: 'Perfil accedido y cargado', time: 'Hace 1 min', color: 'blue' },
  ];

  const items = actividadArr.length > 0 ? actividadArr : defaultActivity;

  container.innerHTML = items.slice(0, 6).map(act => `
    <div class="perfil-activity-item">
      <span class="perfil-activity-dot ${act.color || 'green'}"></span>
      <div class="perfil-activity-info">
        <div class="perfil-activity-desc">${act.desc}</div>
        <div class="perfil-activity-time">${act.time}</div>
      </div>
    </div>
  `).join('');
}

/* ──────────────────────────────────────────────────────────
   SESIONES ACTIVAS (renderizado)
────────────────────────────────────────────────────────── */
function _renderSessions() {
  const container = document.getElementById('perfil-sessions-list');
  if (!container) return;

  // Detectamos info básica del navegador actual
  const ua = navigator.userAgent;
  const isMobile = /Mobi|Android/i.test(ua);
  const device = isMobile ? 'Dispositivo móvil' : 'Computadora de escritorio';
  const browser = ua.includes('Chrome') ? 'Chrome' :
                  ua.includes('Firefox') ? 'Firefox' :
                  ua.includes('Safari') ? 'Safari' : 'Navegador';

  container.innerHTML = `
    <div class="perfil-session-item">
      <div class="perfil-session-icon">
        <i class="bi bi-${isMobile ? 'phone-fill' : 'display'}"></i>
      </div>
      <div class="perfil-session-info">
        <div class="perfil-session-device">${device} — ${browser}</div>
        <div class="perfil-session-meta">Sesión activa · Iniciada ahora</div>
      </div>
      <span class="perfil-session-badge active">Activa</span>
    </div>
  `;
}

/* ──────────────────────────────────────────────────────────
   AVATAR — Subida y previsualización
────────────────────────────────────────────────────────── */
function _bindAvatarUpload(email, perfilData) {
  const input = document.getElementById('input-avatar');
  if (!input) return;

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validación: tipo y tamaño (max 2 MB)
    if (!file.type.startsWith('image/')) {
      PhoenixToast.fire({ icon: 'error', iconColor: '#eb5757', title: 'Solo se permiten imágenes' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      PhoenixToast.fire({ icon: 'warning', iconColor: '#F0A500', title: 'La imagen debe ser menor a 2 MB' });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;

      // Previsualización inmediata
      _setInitials(emailToInitials(email), base64);

      // Guardar en Firebase
      try {
        await update(getPerfilRef(email), { avatarBase64: base64 });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Foto de perfil actualizada' });
        _logActivity(email, 'Foto de perfil actualizada');
      } catch (err) {
        console.error('perfil.js: error guardando avatar', err);
        PhoenixToast.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar la imagen' });
      }
    };
    reader.readAsDataURL(file);
  });
}

/* ──────────────────────────────────────────────────────────
   FORMULARIO — Guardar cambios
────────────────────────────────────────────────────────── */
function _bindFormGuardar(email) {
  const btn = document.getElementById('btn-perfil-guardar');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const nombre      = document.getElementById('perfil-nombre')?.value.trim();
    const nickname    = document.getElementById('perfil-nickname')?.value.trim();
    const telefono    = document.getElementById('perfil-telefono')?.value.trim();
    const descripcion = document.getElementById('perfil-descripcion')?.value.trim();

    if (!nombre) {
      Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'El nombre es requerido', confirmButtonText: 'Ok' });
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';

    try {
      const updates = {
        nombre,
        nickname,
        telefono,
        descripcion,
        ultimaActualizacion: new Date().toISOString(),
      };

      // Si es la primera vez, registramos la fecha
      const snap = await get(getPerfilRef(email));
      if (!snap.exists() || !snap.val().fechaRegistro) {
        updates.fechaRegistro = new Date().toISOString();
        updates.accionesCount = 1;
      } else {
        updates.accionesCount = (snap.val().accionesCount || 0) + 1;
      }

      await update(getPerfilRef(email), updates);

      // Actualizar sidebar
      _setText('sidebar-name', nombre);
      _setText('mini-acciones', updates.accionesCount);
      _setText('stat-acciones', updates.accionesCount);

      await _logActivity(email, `Perfil actualizado — ${nombre}`);

      PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Perfil actualizado correctamente' });
    } catch (err) {
      console.error('perfil.js: error guardando perfil', err);
      Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar', text: 'No se pudo guardar el perfil. Inténtalo de nuevo.' });
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar cambios';
    }
  });
}

/* ──────────────────────────────────────────────────────────
   FORMULARIO — Cancelar (restaura valores originales)
────────────────────────────────────────────────────────── */
function _bindFormCancelar(email, perfilData) {
  const btn = document.getElementById('btn-perfil-cancelar');
  if (!btn) return;

  btn.addEventListener('click', () => {
    _setVal('perfil-nombre', perfilData.nombre || '');
    _setVal('perfil-nickname', perfilData.nickname || '');
    _setVal('perfil-telefono', perfilData.telefono || '');
    _setVal('perfil-descripcion', perfilData.descripcion || '');
    PhoenixToast.fire({ icon: 'info', iconColor: '#516BEB', title: 'Cambios descartados' });
  });
}

/* ──────────────────────────────────────────────────────────
   SEGURIDAD — Cambiar contraseña
────────────────────────────────────────────────────────── */
function _bindPasswordChange(email) {
  const btn = document.getElementById('btn-cambiar-password');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const { value: formValues } = await Phoenix.fire({
      title: 'Cambiar contraseña',
      html: `
        <div style="display:flex;flex-direction:column;gap:10px;text-align:left;">
          <label style="font-size:0.8rem;color:var(--text-muted);">CONTRASEÑA ACTUAL</label>
          <input id="swal-pass-actual" type="password" class="swal2-input"
            placeholder="••••••••" style="background:#21262F;border:1px solid #2A3040;color:#E8ECF2;" />
          <label style="font-size:0.8rem;color:var(--text-muted);">NUEVA CONTRASEÑA</label>
          <input id="swal-pass-nueva" type="password" class="swal2-input"
            placeholder="••••••••" style="background:#21262F;border:1px solid #2A3040;color:#E8ECF2;" />
          <label style="font-size:0.8rem;color:var(--text-muted);">CONFIRMAR NUEVA CONTRASEÑA</label>
          <input id="swal-pass-confirm" type="password" class="swal2-input"
            placeholder="••••••••" style="background:#21262F;border:1px solid #2A3040;color:#E8ECF2;" />
        </div>
      `,
      confirmButtonText: 'Actualizar',
      cancelButtonText: 'Cancelar',
      showCancelButton: true,
      preConfirm: () => ({
        actual:  document.getElementById('swal-pass-actual').value,
        nueva:   document.getElementById('swal-pass-nueva').value,
        confirm: document.getElementById('swal-pass-confirm').value,
      }),
    });

    if (!formValues) return;
    const { actual, nueva, confirm } = formValues;

    if (!actual || !nueva) {
      Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Campos incompletos' });
      return;
    }
    if (nueva !== confirm) {
      Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Las contraseñas no coinciden' });
      return;
    }
    if (nueva.length < 6) {
      Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Mínimo 6 caracteres' });
      return;
    }

    // Verificar contraseña actual desde Firebase
    try {
      // Buscamos el admin por email en la ruta de administradores
      const adminRef = ref(Database, 'Administradores');
      const snap = await get(adminRef);
      if (!snap.exists()) return;

      const admins = snap.val();
      let adminKey = null;
      for (const [key, val] of Object.entries(admins)) {
        if (val.Email === email) { adminKey = key; break; }
      }

      if (!adminKey) {
        Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'No se encontró la cuenta' });
        return;
      }

      const adminData = admins[adminKey];
      if (adminData.Password !== actual) {
        Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Contraseña actual incorrecta' });
        return;
      }

      // Actualizar contraseña
      await set(ref(Database, `Administradores/${adminKey}/Password`), nueva);
      await _logActivity(email, 'Contraseña actualizada');

      PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Contraseña actualizada correctamente' });
    } catch (err) {
      console.error('perfil.js: error cambiando contraseña', err);
      Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al actualizar la contraseña' });
    }
  });
}

/* ──────────────────────────────────────────────────────────
   SESIONES — Toggle del panel
────────────────────────────────────────────────────────── */
function _bindSesionesToggle() {
  const btnVer = document.getElementById('btn-ver-sesiones');
  const panel  = document.getElementById('perfil-sesiones-panel');
  if (!btnVer || !panel) return;

  btnVer.addEventListener('click', () => {
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    btnVer.innerHTML = visible
      ? '<i class="bi bi-eye"></i> Ver'
      : '<i class="bi bi-eye-slash"></i> Ocultar';
  });

  // Botón cerrar sesiones
  const btnCerrar = document.getElementById('btn-cerrar-sesiones');
  if (btnCerrar) {
    btnCerrar.addEventListener('click', async () => {
      const res = await Phoenix.fire({
        icon: 'warning',
        iconColor: '#F0A500',
        title: '¿Cerrar todas las sesiones?',
        text: 'Se cerrará la sesión en todos los dispositivos.',
        showCancelButton: true,
        confirmButtonText: 'Sí, cerrar',
        cancelButtonText: 'Cancelar',
      });
      if (res.isConfirmed) {
        localStorage.removeItem('Admin');
        window.location.replace('../index.html');
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   LOGOUT RÁPIDO desde la tarjeta de perfil
────────────────────────────────────────────────────────── */
function _bindLogout() {
  const btn = document.getElementById('perfil-logout-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const res = await Phoenix.fire({
      icon: 'question',
      title: '¿Cerrar sesión?',
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
   HELPER — Registrar actividad en Firebase
────────────────────────────────────────────────────────── */
async function _logActivity(email, desc) {
  try {
    const snap = await get(getPerfilRef(email));
    const data = snap.exists() ? snap.val() : {};
    const actividad = Array.isArray(data.actividad) ? data.actividad : [];

    actividad.unshift({
      desc,
      time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: 'green',
    });

    // Mantenemos solo las últimas 10
    if (actividad.length > 10) actividad.length = 10;

    await update(getPerfilRef(email), { actividad });
  } catch (err) {
    console.warn('perfil.js: no se pudo registrar actividad', err);
  }
}
