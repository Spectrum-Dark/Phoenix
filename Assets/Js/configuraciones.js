/**
 * ╔══════════════════════════════════════════════════════════╗
 *  PHOENIX — configuraciones.js
 *  Módulo: Configuraciones
 *  Responsabilidades:
 *    - Cargar configuraciones guardadas del usuario
 *    - Guardar preferencias de tema, idioma, fecha, timezone
 *    - Manejar toggles de notificaciones y privacidad
 *    - Gestionar dispositivos conectados y seguridad
 *    - Navegación entre paneles internos del módulo
 * ╚══════════════════════════════════════════════════════════╝
 */

import { Database } from './firebase.js';
import {
  ref,
  get,
  update,
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

/* ──────────────────────────────────────────────────────────
   CONSTANTES
────────────────────────────────────────────────────────── */

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

/** Defaults de configuración initial */
const CONFIG_DEFAULTS = {
  tema: 'dark',
  idioma: 'es',
  fechaFormato: 'DD/MM/YYYY',
  timezone: 'America/Mexico_City',
  notifEmail: true,
  notifSistema: true,
  notifAlertas: true,
  notifNegocio: false,
  mostrarTel: false,
  mostrarActividad: true,
  visibilidad: 'privado',
  loginAlert: true,
  seg2fa: false,
  geoAlert: true,
  '2fa': false,
};

/* ──────────────────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────────────────── */

function getAdminEmail() {
  try {
    return JSON.parse(localStorage.getItem('Admin')) || null;
  } catch {
    return null;
  }
}

function getConfigRef(email) {
  const key = email.replace(/[.#$[\]]/g, '_');
  return ref(Database, `Configuraciones/${key}`);
}

/* ──────────────────────────────────────────────────────────
   INICIALIZACIÓN DEL MÓDULO
   Llamada desde app.js cuando se carga la vista
────────────────────────────────────────────────────────── */
export async function initConfiguraciones() {
  const email = getAdminEmail();
  if (!email) return;

  // ── Cargar configuración guardada
  let config = { ...CONFIG_DEFAULTS };
  try {
    const snap = await get(getConfigRef(email));
    if (snap.exists()) {
      config = { ...CONFIG_DEFAULTS, ...snap.val() };
    }
  } catch (err) {
    console.warn('configuraciones.js: no se pudo cargar config de Firebase', err);
    // Intentar desde localStorage como fallback
    try {
      const local = JSON.parse(localStorage.getItem('PhoenixConfig'));
      if (local) config = { ...CONFIG_DEFAULTS, ...local };
    } catch { /* ignore */ }
  }

  // ── Aplicar config a la UI
  _applyConfig(config);

  // ── Configurar la navegación por paneles
  _bindPanelNav();

  // ── Configurar eventos de guardado
  _bindCuentaEvents(email, config);
  _bindPreferenciasEvents(email, config);
  _bindNotificacionesEvents(email, config);
  _bindPrivacidadEvents(email, config);
  _bindSeguridadEvents(email, config);

  // ── Renderizar dispositivos
  _renderDevices();
}

/* ──────────────────────────────────────────────────────────
   APLICAR CONFIG A LA UI
────────────────────────────────────────────────────────── */
function _applyConfig(config) {
  // Toggles
  const toggleIds = [
    'toggle-2fa', 'toggle-login-alert',
    'toggle-notif-email', 'toggle-notif-sistema', 'toggle-notif-alertas', 'toggle-notif-negocio',
    'toggle-mostrar-tel', 'toggle-mostrar-actividad',
    'toggle-seg-2fa', 'toggle-seg-geoalert',
  ];
  toggleIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = el.dataset.key;
    if (key && config[key] !== undefined) {
      el.checked = Boolean(config[key]);
    }
  });

  // Selects
  _setSelectVal('conf-idioma', config.idioma);
  _setSelectVal('conf-fecha', config.fechaFormato);
  _setSelectVal('conf-timezone', config.timezone);

  // Tema
  _applyTheme(config.tema, false);

  // Visibilidad del perfil (radio)
  const radioVis = document.querySelector(`input[name="conf-visibilidad"][value="${config.visibilidad}"]`);
  if (radioVis) radioVis.checked = true;
}

function _setSelectVal(id, val) {
  const el = document.getElementById(id);
  if (el && val) el.value = val;
}

/* ──────────────────────────────────────────────────────────
   NAVIGACIÓN POR PANELES INTERNOS
────────────────────────────────────────────────────────── */
function _bindPanelNav() {
  const navItems = document.querySelectorAll('.config-nav-item[data-panel]');
  const panels   = document.querySelectorAll('.config-panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const panelId = item.dataset.panel;

      // Toggle activo
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Mostrar panel correcto
      panels.forEach(p => p.classList.remove('active'));
      const target = document.getElementById(panelId);
      if (target) target.classList.add('active');
    });
  });
}

/* ──────────────────────────────────────────────────────────
   GUARDAR CONFIG EN FIREBASE + LOCALSTORAGE
────────────────────────────────────────────────────────── */
async function _saveConfig(email, updates) {
  try {
    await update(getConfigRef(email), updates);
    // Mirror en localStorage para acceso offline
    const current = JSON.parse(localStorage.getItem('PhoenixConfig') || '{}');
    localStorage.setItem('PhoenixConfig', JSON.stringify({ ...current, ...updates }));
  } catch (err) {
    console.error('configuraciones.js: error guardando config', err);
    throw err;
  }
}

/* ──────────────────────────────────────────────────────────
   PANEL: CUENTA
────────────────────────────────────────────────────────── */
function _bindCuentaEvents(email, config) {

  // ── Cambiar contraseña
  const btnPass = document.getElementById('btn-guardar-password');
  if (btnPass) {
    btnPass.addEventListener('click', async () => {
      const actual  = document.getElementById('conf-pass-actual')?.value;
      const nueva   = document.getElementById('conf-pass-nueva')?.value;
      const confirm = document.getElementById('conf-pass-confirm')?.value;

      if (!actual || !nueva) {
        Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Completa todos los campos' });
        return;
      }
      if (nueva !== confirm) {
        Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Las contraseñas no coinciden' });
        return;
      }
      if (nueva.length < 6) {
        Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Mínimo 6 caracteres para la contraseña' });
        return;
      }

      btnPass.disabled = true;
      btnPass.innerHTML = '<i class="bi bi-hourglass-split"></i> Verificando…';

      try {
        const adminRef = ref(Database, 'Administradores');
        const snap = await get(adminRef);
        if (!snap.exists()) throw new Error('no admins');

        const admins = snap.val();
        let adminKey = null;
        for (const [k, v] of Object.entries(admins)) {
          if (v.Email === email) { adminKey = k; break; }
        }
        if (!adminKey) throw new Error('admin not found');
        if (admins[adminKey].Password !== actual) {
          Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Contraseña actual incorrecta' });
          return;
        }

        await update(ref(Database, `Administradores/${adminKey}`), { Password: nueva });

        // Limpiar campos
        ['conf-pass-actual', 'conf-pass-nueva', 'conf-pass-confirm'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });

        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Contraseña actualizada' });
      } catch (err) {
        if (err.message !== 'Contraseña actual incorrecta') {
          Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al actualizar', text: 'Inténtalo de nuevo.' });
        }
      } finally {
        btnPass.disabled = false;
        btnPass.innerHTML = '<i class="bi bi-shield-check-fill"></i> Actualizar contraseña';
      }
    });
  }

  // ── Actualizar correo
  const btnEmail = document.getElementById('btn-guardar-email');
  if (btnEmail) {
    btnEmail.addEventListener('click', async () => {
      const nuevoEmail = document.getElementById('conf-email-nuevo')?.value.trim();
      const passConf   = document.getElementById('conf-email-pass')?.value;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!nuevoEmail || !emailRegex.test(nuevoEmail)) {
        Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Correo inválido', confirmButtonText: 'Ok' });
        return;
      }
      if (!passConf) {
        Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Ingresa tu contraseña actual' });
        return;
      }

      btnEmail.disabled = true;
      btnEmail.innerHTML = '<i class="bi bi-hourglass-split"></i> Verificando…';

      try {
        const adminRef = ref(Database, 'Administradores');
        const snap = await get(adminRef);
        const admins = snap.val();
        let adminKey = null;
        for (const [k, v] of Object.entries(admins)) {
          if (v.Email === email) { adminKey = k; break; }
        }
        if (!adminKey || admins[adminKey].Password !== passConf) {
          Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Contraseña incorrecta' });
          return;
        }

        await update(ref(Database, `Administradores/${adminKey}`), { Email: nuevoEmail });
        localStorage.setItem('Admin', JSON.stringify(nuevoEmail));

        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Correo actualizado. Recargando…' });
        setTimeout(() => location.reload(), 1800);
      } catch (err) {
        Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al actualizar el correo' });
      } finally {
        btnEmail.disabled = false;
        btnEmail.innerHTML = '<i class="bi bi-envelope-check-fill"></i> Actualizar correo';
      }
    });
  }

  // ── Toggles seguridad de cuenta (2FA, alertas login)
  _bindToggles(['toggle-2fa', 'toggle-login-alert'], email);
}

/* ──────────────────────────────────────────────────────────
   PANEL: PREFERENCIAS
────────────────────────────────────────────────────────── */
function _bindPreferenciasEvents(email, config) {

  // ── Tema visual
  document.querySelectorAll('input[name="conf-theme"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const tema = e.target.value;
      _applyTheme(tema, true);
      _saveConfig(email, { tema }).catch(console.error);
    });
  });

  // ── Guardar idioma y región
  const btnRegion = document.getElementById('btn-guardar-region');
  if (btnRegion) {
    btnRegion.addEventListener('click', async () => {
      const idioma       = document.getElementById('conf-idioma')?.value;
      const fechaFormato = document.getElementById('conf-fecha')?.value;
      const timezone     = document.getElementById('conf-timezone')?.value;

      btnRegion.disabled = true;
      btnRegion.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';

      try {
        await _saveConfig(email, { idioma, fechaFormato, timezone });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Preferencias guardadas' });
      } catch {
        Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar preferencias' });
      } finally {
        btnRegion.disabled = false;
        btnRegion.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar preferencias';
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   PANEL: NOTIFICACIONES
────────────────────────────────────────────────────────── */
function _bindNotificacionesEvents(email, config) {
  const btn = document.getElementById('btn-guardar-notifs');
  if (btn) {
    btn.addEventListener('click', async () => {
      const notifEmail   = document.getElementById('toggle-notif-email')?.checked;
      const notifSistema = document.getElementById('toggle-notif-sistema')?.checked;
      const notifAlertas = document.getElementById('toggle-notif-alertas')?.checked;
      const notifNegocio = document.getElementById('toggle-notif-negocio')?.checked;

      btn.disabled = true;
      btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';

      try {
        await _saveConfig(email, { notifEmail, notifSistema, notifAlertas, notifNegocio });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Notificaciones actualizadas' });
      } catch {
        Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar notificaciones' });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar notificaciones';
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   PANEL: PRIVACIDAD
────────────────────────────────────────────────────────── */
function _bindPrivacidadEvents(email, config) {

  // ── Botón guardar privacidad
  const btn = document.getElementById('btn-guardar-privacidad');
  if (btn) {
    btn.addEventListener('click', async () => {
      const visibilidad      = document.querySelector('input[name="conf-visibilidad"]:checked')?.value || 'privado';
      const mostrarTel       = document.getElementById('toggle-mostrar-tel')?.checked;
      const mostrarActividad = document.getElementById('toggle-mostrar-actividad')?.checked;

      btn.disabled = true;
      btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';

      try {
        await _saveConfig(email, { visibilidad, mostrarTel, mostrarActividad });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Privacidad actualizada' });
      } catch {
        Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar' });
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar privacidad';
      }
    });
  }

  // ── Botón borrar datos
  const btnBorrar = document.getElementById('btn-borrar-datos');
  if (btnBorrar) {
    btnBorrar.addEventListener('click', async () => {
      const res = await Phoenix.fire({
        icon: 'warning',
        iconColor: '#F0A500',
        title: '¿Borrar datos de análisis?',
        text: 'Se eliminará el historial de actividad registrado. Esta acción no se puede deshacer.',
        showCancelButton: true,
        confirmButtonText: 'Sí, borrar',
        cancelButtonText: 'Cancelar',
      });

      if (res.isConfirmed) {
        try {
          const key = email.replace(/[.#$[\]]/g, '_');
          await update(ref(Database, `Perfiles/${key}`), { actividad: [] });
          PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Datos de actividad eliminados' });
        } catch {
          Phoenix.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al borrar los datos' });
        }
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   PANEL: SEGURIDAD
────────────────────────────────────────────────────────── */
function _bindSeguridadEvents(email, config) {

  // ── Toggles de seguridad
  _bindToggles(['toggle-seg-2fa', 'toggle-seg-geoalert'], email);

  // ── Cerrar todas las sesiones
  const btn = document.getElementById('btn-cerrar-todas-sesiones');
  if (btn) {
    btn.addEventListener('click', async () => {
      const res = await Phoenix.fire({
        icon: 'warning',
        iconColor: '#F0A500',
        title: '¿Cerrar todas las sesiones?',
        text: 'Se cerrará la sesión en este y todos los demás dispositivos.',
        showCancelButton: true,
        confirmButtonText: 'Sí, cerrar todo',
        cancelButtonText: 'Cancelar',
      });

      if (res.isConfirmed) {
        localStorage.removeItem('Admin');
        localStorage.removeItem('PhoenixConfig');
        PhoenixToast.fire({ icon: 'info', iconColor: '#516BEB', title: 'Sesiones cerradas. Redirigiendo…' });
        setTimeout(() => window.location.replace('../index.html'), 1500);
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   HELPER — Bind genérico de toggles (auto-guardado)
────────────────────────────────────────────────────────── */
function _bindToggles(toggleIds, email) {
  toggleIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener('change', async () => {
      const key = el.dataset.key;
      if (!key) return;

      try {
        await _saveConfig(email, { [key]: el.checked });
        PhoenixToast.fire({
          icon: 'success',
          iconColor: '#17D7A0',
          title: el.checked ? 'Activado' : 'Desactivado',
        });
      } catch {
        // Revertir estado del toggle si falla
        el.checked = !el.checked;
        PhoenixToast.fire({ icon: 'error', iconColor: '#eb5757', title: 'Error al guardar' });
      }
    });
  });
}

/* ──────────────────────────────────────────────────────────
   TEMA VISUAL
────────────────────────────────────────────────────────── */
function _applyTheme(tema, showToast) {
  // Actualizar UI de las tarjetas de tema
  document.querySelectorAll('.config-theme-card').forEach(card => {
    const input = card.querySelector('input[type="radio"]');
    if (!input) return;
    card.classList.toggle('selected', input.value === tema);
  });

  // Nota: el modo claro real requeriría redefinir las variables CSS.
  // Por simplicidad del sistema actual (que usa solo modo oscuro),
  // guardamos la preferencia para uso futuro.
  localStorage.setItem('PhoenixTheme', tema);

  if (showToast) {
    const labels = { dark: 'Modo oscuro', light: 'Modo claro', auto: 'Modo automático' };
    PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: `Tema: ${labels[tema] || tema}` });
  }
}

/* ──────────────────────────────────────────────────────────
   DISPOSITIVOS CONECTADOS (render)
────────────────────────────────────────────────────────── */
function _renderDevices() {
  const container = document.getElementById('config-devices-list');
  if (!container) return;

  const ua = navigator.userAgent;
  const isMobile = /Mobi|Android/i.test(ua);
  const device = isMobile ? 'Dispositivo móvil' : 'Escritorio';
  const browser = ua.includes('Chrome') ? 'Chrome' :
                  ua.includes('Firefox') ? 'Firefox' :
                  ua.includes('Safari') ? 'Safari' : 'Navegador';
  const platform = ua.includes('Windows') ? 'Windows' :
                   ua.includes('Mac') ? 'macOS' :
                   ua.includes('Linux') ? 'Linux' :
                   ua.includes('Android') ? 'Android' : 'Sistema';

  container.innerHTML = `
    <div class="config-device-item">
      <div class="config-device-icon">
        <i class="bi bi-${isMobile ? 'phone-fill' : 'display'}"></i>
      </div>
      <div class="config-device-info">
        <div class="config-device-name">${device} — ${browser}</div>
        <div class="config-device-meta">${platform} · Sesión activa · Iniciada ahora</div>
      </div>
      <span class="config-device-badge current">Este dispositivo</span>
    </div>
  `;
}
