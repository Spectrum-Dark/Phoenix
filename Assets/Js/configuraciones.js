/**
 * ╔══════════════════════════════════════════════════════════════╗
 *  PHOENIX — configuraciones.js (v3)
 *  Módulo: Configuraciones completo y funcional
 *  - Tema oscuro/claro (aplicado al DOM en tiempo real)
 *  - Idioma, formato de fecha, zona horaria → persisten en Firebase
 *  - Sistema: nombre, logo, modo mantenimiento
 *  - Administradores: lista desde Firebase
 *  - Logs del sistema: actividad real-time desde /actividad/
 *  - Seguridad: dispositivos, accesos, cierre de sesiones
 *  - Notificaciones y Privacidad
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { Database } from './firebase.js';
import {
  ref, get, set, update, onValue,
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
  showConfirmButton: false, timer: 3200, timerProgressBar: true,
  background: '#1C2028', color: '#E8ECF2',
});

/* ──────────────────────────────────────────────────────────
   CONSTANTES
────────────────────────────────────────────────────────── */
const CONFIG_DEFAULTS = {
  tema: 'dark',
  idioma: 'es',
  fechaFormato: 'DD/MM/YYYY',
  timezone: 'America/Managua',
  notifNuevoCliente: true,
  notifVencimientos: true,
  notifSistema: true,
  notifAlertas: true,
  notifNegocio: false,
  mostrarTel: false,
  mostrarActividad: true,
  twoFA: false,
  loginAlert: true,
  seg2fa: false,
  geoAlert: true,
  modoMantenimiento: false,
  sysNombre: 'Phoenix Admin',
  sysDesc: 'Panel administrativo',
  sysLogo: '',
};

/* ──────────────────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────────────────── */
function getAdminEmail() {
  try { return JSON.parse(localStorage.getItem('Admin')) || null; } catch { return null; }
}

function getConfigRef(email) {
  const key = email.replace(/[.#$[\]]/g, '_');
  return ref(Database, `Configuraciones/${key}`);
}

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _setVal(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }
function _setChk(id, val)  { const el = document.getElementById(id); if (el) el.checked = Boolean(val); }

function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Publica la config globalmente para que otros módulos la lean */
function _publishConfig(config) {
  window.PhoenixConfig = { ...config };
  window.dispatchEvent(new CustomEvent('phoenix:config-updated', { detail: config }));
}

/* ──────────────────────────────────────────────────────────
   ENTRY POINT
────────────────────────────────────────────────────────── */
export async function initConfiguraciones() {
  const email = getAdminEmail();
  if (!email) return;

  /* 1. Cargar config desde Firebase, con fallback a localStorage */
  let config = { ...CONFIG_DEFAULTS };
  try {
    const snap = await get(getConfigRef(email));
    if (snap.exists()) config = { ...CONFIG_DEFAULTS, ...snap.val() };
  } catch {
    const local = localStorage.getItem('PhoenixConfig');
    if (local) { try { config = { ...CONFIG_DEFAULTS, ...JSON.parse(local) }; } catch {} }
  }

  /* 2. Aplicar y publicar */
  _applyConfig(config);
  _publishConfig(config);

  /* 3. Bind de todos los paneles */
  _bindPanelNav();
  _bindCuentaEvents(email);
  _bindPreferenciasEvents(email, config);
  _bindNotificacionesEvents(email);
  _bindSistemaEvents(email, config);
  _bindSeguridadEvents(email);
  _bindPrivacidadEvents(email);
  _bindTogglesAutoSave(email);

  /* 4. Render de paneles que necesitan datos externos */
  _renderDevices();
  _renderAdmins();
  _renderLogs();
  _renderAccessLog();
  _loadSistemaStats();
}

/* ──────────────────────────────────────────────────────────
   APLICAR CONFIG A LA UI
────────────────────────────────────────────────────────── */
function _applyConfig(config) {
  /* Tema */
  aplicarTema(config.tema, false);

  /* Selects */
  _setVal('conf-idioma',   config.idioma       || 'es');
  _setVal('conf-fecha',    config.fechaFormato  || 'DD/MM/YYYY');
  _setVal('conf-timezone', config.timezone      || 'America/Managua');
  _updateFechaPreview(config.fechaFormato);

  /* Toggles de notificaciones y privacidad */
  _setChk('toggle-notif-nuevocliente', config.notifNuevoCliente);
  _setChk('toggle-notif-vencimientos', config.notifVencimientos);
  _setChk('toggle-notif-sistema',  config.notifSistema);
  _setChk('toggle-notif-alertas',  config.notifAlertas);
  _setChk('toggle-notif-negocio',  config.notifNegocio);
  _setChk('toggle-mostrar-tel',    config.mostrarTel);
  _setChk('toggle-mostrar-actividad', config.mostrarActividad);
  _setChk('toggle-2fa',            config.twoFA);
  _setChk('toggle-login-alert',    config.loginAlert);
  _setChk('toggle-seg-2fa',        config.seg2fa);
  _setChk('toggle-seg-geoalert',   config.geoAlert);
  _setChk('toggle-mantenimiento',  config.modoMantenimiento);

  /* Sistema */
  _setVal('conf-sys-nombre', config.sysNombre || '');
  _setVal('conf-sys-logo',   config.sysLogo   || '');
  _setVal('conf-sys-desc',   config.sysDesc   || '');
}

/* ──────────────────────────────────────────────────────────
   GUARDAR EN FIREBASE + LOCALSTORAGE
────────────────────────────────────────────────────────── */
export async function guardarConfiguracion(email, updates) {
  await update(getConfigRef(email), updates);
  const current = JSON.parse(localStorage.getItem('PhoenixConfig') || '{}');
  const merged  = { ...current, ...updates };
  localStorage.setItem('PhoenixConfig', JSON.stringify(merged));
  _publishConfig(merged);
}

/* ──────────────────────────────────────────────────────────
   TEMA VISUAL — Aplicación real en el DOM
────────────────────────────────────────────────────────── */
export function aplicarTema(tema, showToast = true) {
  const htmlEl = document.documentElement;
  const bodyEl = document.body;

  if (tema === 'light') {
    bodyEl.classList.add('theme-light');
    htmlEl.setAttribute('data-theme', 'light');
  } else if (tema === 'dark') {
    bodyEl.classList.remove('theme-light');
    htmlEl.setAttribute('data-theme', 'dark');
  } else if (tema === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      bodyEl.classList.remove('theme-light');
      htmlEl.setAttribute('data-theme', 'dark');
    } else {
      bodyEl.classList.add('theme-light');
      htmlEl.setAttribute('data-theme', 'light');
    }
  }

  localStorage.setItem('PhoenixTheme', tema);

  /* Actualizar UI de las tarjetas de selección */
  document.querySelectorAll('.config-theme-card').forEach(card => {
    const input = card.querySelector('input[type="radio"]');
    if (input) {
      card.classList.toggle('selected', input.value === tema);
      input.checked = (input.value === tema);
    }
  });

  /* Actualizar label de vista previa */
  const labels = { dark: '🌙 Modo oscuro activo', light: '☀️ Modo claro activo', auto: '🔄 Automático (según el SO)' };
  _setText('theme-preview-label', labels[tema] || '');

  if (showToast) {
    PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: labels[tema] || 'Tema actualizado' });
  }
}

/* ──────────────────────────────────────────────────────────
   FORMATO DE FECHA — Vista previa en tiempo real
────────────────────────────────────────────────────────── */
export function aplicarFormatoFecha(formato) {
  window.PhoenixConfig = window.PhoenixConfig || {};
  window.PhoenixConfig.fechaFormato = formato;
  _updateFechaPreview(formato);
}

function _updateFechaPreview(formato) {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  let preview = '';
  if (formato === 'DD/MM/YYYY')  preview = `${d}/${m}/${y}`;
  else if (formato === 'MM/DD/YYYY') preview = `${m}/${d}/${y}`;
  else preview = `${y}-${m}-${d}`;
  _setText('fecha-preview', `Vista previa: ${preview}`);
}

/* ──────────────────────────────────────────────────────────
   ZONA HORARIA
────────────────────────────────────────────────────────── */
export function aplicarZonaHoraria(tz) {
  window.PhoenixConfig = window.PhoenixConfig || {};
  window.PhoenixConfig.timezone = tz;
}

/* ──────────────────────────────────────────────────────────
   SISTEMA i18n — Traducciones + Motor de reemplazo DOM
────────────────────────────────────────────────────────── */
const TRANSLATIONS = {
  es: {
    /* -- NAV / SIDEBAR -- */
    nav_inicio:        'Inicio',
    nav_clientes:      'Registrar Cliente',
    nav_servicios:     'Servicios',
    nav_perfil:        'Mi Perfil',
    nav_ajustes:       'Configuraciones',
    /* -- DASHBOARD -- */
    dash_bienvenido:   'Bienvenido',
    dash_resumen:      'Resumen del negocio',
    dash_clientes:     'Clientes activos',
    dash_servicios:    'Total servicios',
    dash_nuevos:       'Nuevos este mes',
    dash_actividad:    'Actividad reciente',
    dash_top:          'Top negocios',
    dash_admins:       'Admins conectados',
    dash_recordatorios:'Recordatorios',
    /* -- CLIENTES -- */
    cli_titulo:        'Registrar Cliente',
    cli_nombre:        'Nombre completo',
    cli_numero:        'Número de teléfono',
    cli_negocio:       'Nombre del negocio',
    cli_direccion:     'Dirección',
    cli_token:         'Token de acceso',
    cli_guardar:       'Guardar cliente',
    cli_lista:         'Lista de clientes',
    cli_activos:       'Activos',
    cli_inactivos:     'Inactivos',
    cli_mant:          'Mantenimiento',
    /* -- SERVICIOS -- */
    sv_titulo:         'Servicios',
    sv_estado:         'Estado',
    sv_vence:          'Vence',
    sv_renovar:        'Renovar',
    sv_activar:        'Activar',
    sv_desactivar:     'Desactivar',
    /* -- PERFIL -- */
    pf_titulo:         'Mi Perfil',
    pf_nombre:         'Nombre completo',
    pf_nickname:       'Usuario / Nickname',
    pf_email:          'Correo electrónico',
    pf_telefono:       'Teléfono',
    pf_guardar:        'Guardar cambios',
    pf_cancelar:       'Cancelar',
    pf_rol:            'Rol y Nivel de Acceso',
    pf_sistema:        'Información del Sistema',
    pf_stats:          'Estadísticas',
    pf_actividad:      'Actividad Reciente',
    /* -- CONFIGURACIONES -- */
    cfg_cuenta:        'Cuenta',
    cfg_preferencias:  'Preferencias',
    cfg_notificaciones:'Notificaciones',
    cfg_sistema:       'Sistema',
    cfg_admins:        'Administradores',
    cfg_logs:          'Logs',
    cfg_seguridad:     'Seguridad',
    cfg_privacidad:    'Privacidad',
    cfg_tema:          'Tema visual',
    cfg_idioma:        'Idioma',
    cfg_fecha:         'Formato de fecha',
    cfg_timezone:      'Zona horaria',
    cfg_guardar:       'Guardar preferencias',
    cfg_password:      'Cambiar contraseña',
    cfg_logout:        'Cerrar sesión',
    /* -- GENERAL -- */
    btn_guardar:       'Guardar',
    btn_cancelar:      'Cancelar',
    btn_editar:        'Editar',
    btn_eliminar:      'Eliminar',
    btn_activar:       'Activar',
    btn_desactivar:    'Desactivar',
    cargando:          'Cargando…',
    sin_datos:         'Sin datos',
  },
  en: {
    nav_inicio:        'Home',
    nav_clientes:      'Register Client',
    nav_servicios:     'Services',
    nav_perfil:        'My Profile',
    nav_ajustes:       'Settings',
    dash_bienvenido:   'Welcome',
    dash_resumen:      'Business summary',
    dash_clientes:     'Active clients',
    dash_servicios:    'Total services',
    dash_nuevos:       'New this month',
    dash_actividad:    'Recent activity',
    dash_top:          'Top businesses',
    dash_admins:       'Online admins',
    dash_recordatorios:'Reminders',
    cli_titulo:        'Register Client',
    cli_nombre:        'Full name',
    cli_numero:        'Phone number',
    cli_negocio:       'Business name',
    cli_direccion:     'Address',
    cli_token:         'Access token',
    cli_guardar:       'Save client',
    cli_lista:         'Client list',
    cli_activos:       'Active',
    cli_inactivos:     'Inactive',
    cli_mant:          'Maintenance',
    sv_titulo:         'Services',
    sv_estado:         'Status',
    sv_vence:          'Expires',
    sv_renovar:        'Renew',
    sv_activar:        'Activate',
    sv_desactivar:     'Deactivate',
    pf_titulo:         'My Profile',
    pf_nombre:         'Full name',
    pf_nickname:       'Username / Nickname',
    pf_email:          'Email address',
    pf_telefono:       'Phone',
    pf_guardar:        'Save changes',
    pf_cancelar:       'Cancel',
    pf_rol:            'Role & Access Level',
    pf_sistema:        'System Information',
    pf_stats:          'Statistics',
    pf_actividad:      'Recent Activity',
    cfg_cuenta:        'Account',
    cfg_preferencias:  'Preferences',
    cfg_notificaciones:'Notifications',
    cfg_sistema:       'System',
    cfg_admins:        'Administrators',
    cfg_logs:          'Logs',
    cfg_seguridad:     'Security',
    cfg_privacidad:    'Privacy',
    cfg_tema:          'Visual theme',
    cfg_idioma:        'Language',
    cfg_fecha:         'Date format',
    cfg_timezone:      'Timezone',
    cfg_guardar:       'Save preferences',
    cfg_password:      'Change password',
    cfg_logout:        'Sign out',
    btn_guardar:       'Save',
    btn_cancelar:      'Cancel',
    btn_editar:        'Edit',
    btn_eliminar:      'Delete',
    btn_activar:       'Activate',
    btn_desactivar:    'Deactivate',
    cargando:          'Loading…',
    sin_datos:         'No data',
  },
  pt: {
    nav_inicio:        'Início',
    nav_clientes:      'Registrar Cliente',
    nav_servicios:     'Serviços',
    nav_perfil:        'Meu Perfil',
    nav_ajustes:       'Configurações',
    dash_bienvenido:   'Bem-vindo',
    dash_resumen:      'Resumo do negócio',
    dash_clientes:     'Clientes ativos',
    dash_servicios:    'Total de serviços',
    dash_nuevos:       'Novos este mês',
    dash_actividad:    'Atividade recente',
    dash_top:          'Top negócios',
    dash_admins:       'Admins online',
    dash_recordatorios:'Lembretes',
    cli_titulo:        'Registrar Cliente',
    cli_nombre:        'Nome completo',
    cli_numero:        'Número de telefone',
    cli_negocio:       'Nome do negócio',
    cli_direccion:     'Endereço',
    cli_token:         'Token de acesso',
    cli_guardar:       'Salvar cliente',
    cli_lista:         'Lista de clientes',
    cli_activos:       'Ativos',
    cli_inactivos:     'Inativos',
    cli_mant:          'Manutenção',
    sv_titulo:         'Serviços',
    sv_estado:         'Estado',
    sv_vence:          'Vence',
    sv_renovar:        'Renovar',
    sv_activar:        'Ativar',
    sv_desactivar:     'Desativar',
    pf_titulo:         'Meu Perfil',
    pf_nombre:         'Nome completo',
    pf_nickname:       'Usuário / Apelido',
    pf_email:          'E-mail',
    pf_telefono:       'Telefone',
    pf_guardar:        'Salvar alterações',
    pf_cancelar:       'Cancelar',
    pf_rol:            'Função e Nível de Acesso',
    pf_sistema:        'Informações do Sistema',
    pf_stats:          'Estatísticas',
    pf_actividad:      'Atividade Recente',
    cfg_cuenta:        'Conta',
    cfg_preferencias:  'Preferências',
    cfg_notificaciones:'Notificações',
    cfg_sistema:       'Sistema',
    cfg_admins:        'Administradores',
    cfg_logs:          'Registros',
    cfg_seguridad:     'Segurança',
    cfg_privacidad:    'Privacidade',
    cfg_tema:          'Tema visual',
    cfg_idioma:        'Idioma',
    cfg_fecha:         'Formato de data',
    cfg_timezone:      'Fuso horário',
    cfg_guardar:       'Salvar preferências',
    cfg_password:      'Alterar senha',
    cfg_logout:        'Sair',
    btn_guardar:       'Salvar',
    btn_cancelar:      'Cancelar',
    btn_editar:        'Editar',
    btn_eliminar:      'Excluir',
    btn_activar:       'Ativar',
    btn_desactivar:    'Desativar',
    cargando:          'Carregando…',
    sin_datos:         'Sem dados',
  },
};

/**
 * Motor i18n: Escanea todo el DOM en busca de data-i18n="clave"
 * y reemplaza el textContent/placeholder/title con la traducción.
 * También actualiza data-i18n-placeholder y data-i18n-title.
 * @param {string} idioma - 'es' | 'en' | 'pt'
 */
export function aplicarIdioma(idioma) {
  const lang = TRANSLATIONS[idioma] || TRANSLATIONS.es;

  /* textContent */
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (lang[key] !== undefined) el.textContent = lang[key];
  });

  /* placeholder */
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (lang[key] !== undefined) el.placeholder = lang[key];
  });

  /* title */
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (lang[key] !== undefined) el.title = lang[key];
  });

  /* aria-label */
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.dataset.i18nAria;
    if (lang[key] !== undefined) el.setAttribute('aria-label', lang[key]);
  });

  /* Actualizar atributo lang del html para accesibilidad */
  document.documentElement.lang = idioma;

  /* Guardar en estado global */
  window.APP_CONFIG = window.APP_CONFIG || {};
  window.APP_CONFIG.idioma = idioma;
  window.APP_CONFIG._translations = lang;

  /* Disparar evento para que módulos dinámicos puedan reaccionar */
  window.dispatchEvent(new CustomEvent('phoenix:idioma-changed', { detail: { idioma, lang } }));
}

/* ──────────────────────────────────────────────────────────
   NAVEGACIÓN ENTRE PANELES
────────────────────────────────────────────────────────── */
function _bindPanelNav() {
  const navItems = document.querySelectorAll('.config-nav-item[data-panel]');
  const panels   = document.querySelectorAll('.config-panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      const target = document.getElementById(item.dataset.panel);
      if (target) target.classList.add('active');
    });
  });
}

/* ──────────────────────────────────────────────────────────
   TOGGLES AUTO-GUARDADO (todos los toggles con data-key)
────────────────────────────────────────────────────────── */
function _bindTogglesAutoSave(email) {
  document.querySelectorAll('.config-toggle input[data-key]').forEach(el => {
    el.addEventListener('change', async () => {
      const key = el.dataset.key;
      try {
        await guardarConfiguracion(email, { [key]: el.checked });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: el.checked ? 'Activado' : 'Desactivado' });
      } catch {
        el.checked = !el.checked;
        PhoenixToast.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al guardar' });
      }
    });
  });
}

/* ──────────────────────────────────────────────────────────
   PANEL: CUENTA
────────────────────────────────────────────────────────── */
function _bindCuentaEvents(email) {
  /* Cambiar contraseña */
  const btnPass = document.getElementById('btn-guardar-password');
  if (btnPass) {
    btnPass.addEventListener('click', async () => {
      const actual  = document.getElementById('conf-pass-actual')?.value;
      const nueva   = document.getElementById('conf-pass-nueva')?.value;
      const confirm = document.getElementById('conf-pass-confirm')?.value;
      if (!actual || !nueva) { Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Completa todos los campos' }); return; }
      if (nueva !== confirm)  { Phoenix.fire({ icon: 'error',   iconColor: '#FF4D4D', title: 'Las contraseñas no coinciden' }); return; }
      if (nueva.length < 6)  { Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Mínimo 6 caracteres' }); return; }

      btnPass.disabled = true; btnPass.innerHTML = '<i class="bi bi-hourglass-split"></i> Verificando…';
      try {
        const snap = await get(ref(Database, 'Administradores'));
        if (!snap.exists()) throw new Error('Sin admins');
        const admins = snap.val();
        let key = null;
        for (const [k, v] of Object.entries(admins)) { if (v.Email === email) { key = k; break; } }
        if (!key || admins[key].Password !== actual) { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Contraseña actual incorrecta' }); return; }
        await set(ref(Database, `Administradores/${key}/Password`), nueva);
        ['conf-pass-actual','conf-pass-nueva','conf-pass-confirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Contraseña actualizada' });
      } catch (err) {
        if (!err.message?.includes('incorrecta')) Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al actualizar' });
      } finally { btnPass.disabled = false; btnPass.innerHTML = '<i class="bi bi-shield-check-fill"></i> Actualizar contraseña'; }
    });
  }

  /* Actualizar correo */
  const btnEmail = document.getElementById('btn-guardar-email');
  if (btnEmail) {
    btnEmail.addEventListener('click', async () => {
      const nuevoEmail = document.getElementById('conf-email-nuevo')?.value.trim();
      const passConf   = document.getElementById('conf-email-pass')?.value;
      if (!nuevoEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoEmail)) { Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Correo inválido' }); return; }
      if (!passConf) { Phoenix.fire({ icon: 'warning', iconColor: '#F0A500', title: 'Ingresa tu contraseña actual' }); return; }

      btnEmail.disabled = true; btnEmail.innerHTML = '<i class="bi bi-hourglass-split"></i> Verificando…';
      try {
        const snap = await get(ref(Database, 'Administradores'));
        const admins = snap.val(); let k = null;
        for (const [key, v] of Object.entries(admins)) { if (v.Email === email) { k = key; break; } }
        if (!k || admins[k].Password !== passConf) { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Contraseña incorrecta' }); return; }
        await update(ref(Database, `Administradores/${k}`), { Email: nuevoEmail });
        localStorage.setItem('Admin', JSON.stringify(nuevoEmail));
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Correo actualizado. Recargando…' });
        setTimeout(() => location.reload(), 1800);
      } catch { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al actualizar correo' }); }
      finally { btnEmail.disabled = false; btnEmail.innerHTML = '<i class="bi bi-envelope-check-fill"></i> Actualizar correo'; }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   PANEL: PREFERENCIAS
────────────────────────────────────────────────────────── */
function _bindPreferenciasEvents(email, config) {
  /* Tema — cambia inmediatamente y guarda */
  document.querySelectorAll('input[name="conf-theme"]').forEach(radio => {
    radio.addEventListener('change', async e => {
      aplicarTema(e.target.value, true);
      try { await guardarConfiguracion(email, { tema: e.target.value }); }
      catch { console.warn('No se pudo guardar tema en Firebase'); }
    });
  });

  /* Formato de fecha — preview en tiempo real */
  document.getElementById('conf-fecha')?.addEventListener('change', e => {
    aplicarFormatoFecha(e.target.value);
  });

  /* Guardar idioma + fecha + timezone */
  const btnRegion = document.getElementById('btn-guardar-region');
  if (btnRegion) {
    btnRegion.addEventListener('click', async () => {
      const idioma       = document.getElementById('conf-idioma')?.value;
      const fechaFormato = document.getElementById('conf-fecha')?.value;
      const timezone     = document.getElementById('conf-timezone')?.value;

      btnRegion.disabled = true; btnRegion.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';
      try {
        await guardarConfiguracion(email, { idioma, fechaFormato, timezone });
        aplicarIdioma(idioma);
        aplicarZonaHoraria(timezone);
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Preferencias guardadas' });
      } catch { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al guardar preferencias' }); }
      finally { btnRegion.disabled = false; btnRegion.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar preferencias'; }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   PANEL: NOTIFICACIONES
────────────────────────────────────────────────────────── */
function _bindNotificacionesEvents(email) {
  const btn = document.getElementById('btn-guardar-notifs');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const keys = ['notifNuevoCliente','notifVencimientos','notifSistema','notifAlertas','notifNegocio'];
    const ids  = ['toggle-notif-nuevocliente','toggle-notif-vencimientos','toggle-notif-sistema','toggle-notif-alertas','toggle-notif-negocio'];
    const updates = {};
    keys.forEach((k,i) => { const el = document.getElementById(ids[i]); if (el) updates[k] = el.checked; });

    btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';
    try {
      await guardarConfiguracion(email, updates);
      PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Notificaciones actualizadas' });
    } catch { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al guardar notificaciones' }); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar notificaciones'; }
  });
}

/* ──────────────────────────────────────────────────────────
   PANEL: SISTEMA
────────────────────────────────────────────────────────── */
function _bindSistemaEvents(email, config) {
  /* Guardar datos del sistema */
  const btnSist = document.getElementById('btn-guardar-sistema');
  if (btnSist) {
    btnSist.addEventListener('click', async () => {
      const sysNombre = document.getElementById('conf-sys-nombre')?.value.trim();
      const sysLogo   = document.getElementById('conf-sys-logo')?.value.trim();
      const sysDesc   = document.getElementById('conf-sys-desc')?.value.trim();

      btnSist.disabled = true; btnSist.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';
      try {
        await guardarConfiguracion(email, { sysNombre, sysLogo, sysDesc });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Configuración del sistema guardada' });
      } catch { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al guardar' }); }
      finally { btnSist.disabled = false; btnSist.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar datos del sistema'; }
    });
  }

  /* Guardar mantenimiento (toggle ya es auto-save, pero guardamos la fecha) */
  const btnMaint = document.getElementById('btn-guardar-maint');
  if (btnMaint) {
    btnMaint.addEventListener('click', async () => {
      const modoMantenimiento = document.getElementById('toggle-mantenimiento')?.checked;
      const mantenimientoFecha = document.getElementById('conf-maint-fecha')?.value;
      btnMaint.disabled = true; btnMaint.innerHTML = '<i class="bi bi-hourglass-split"></i> Aplicando…';
      try {
        await guardarConfiguracion(email, { modoMantenimiento, mantenimientoFecha });
        /* Escribir también a un nodo global para que otros módulos lo lean */
        await set(ref(Database, 'Sistema/modoMantenimiento'), modoMantenimiento);
        PhoenixToast.fire({ icon: modoMantenimiento ? 'warning' : 'success', iconColor: modoMantenimiento ? '#FFB800' : '#17D7A0', title: modoMantenimiento ? 'Modo mantenimiento ACTIVADO' : 'Modo mantenimiento desactivado' });
      } catch { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al aplicar mantenimiento' }); }
      finally { btnMaint.disabled = false; btnMaint.innerHTML = '<i class="bi bi-floppy2-fill"></i> Aplicar configuración'; }
    });
  }

  /* Reload button */
  document.getElementById('btn-reload-admins')?.addEventListener('click', _renderAdmins);
  document.getElementById('btn-reload-logs')?.addEventListener('click', _renderLogs);
}

/* ──────────────────────────────────────────────────────────
   PANEL: SEGURIDAD
────────────────────────────────────────────────────────── */
function _bindSeguridadEvents(email) {
  const btn = document.getElementById('btn-cerrar-todas-sesiones');
  if (btn) {
    btn.addEventListener('click', async () => {
      const res = await Phoenix.fire({
        icon: 'warning', iconColor: '#F0A500',
        title: '¿Cerrar todas las sesiones?',
        text: 'Se cerrará la sesión en todos los dispositivos.',
        showCancelButton: true,
        confirmButtonText: 'Sí, cerrar todo', cancelButtonText: 'Cancelar',
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
   PANEL: PRIVACIDAD
────────────────────────────────────────────────────────── */
function _bindPrivacidadEvents(email) {
  const btnPriv = document.getElementById('btn-guardar-privacidad');
  if (btnPriv) {
    btnPriv.addEventListener('click', async () => {
      const mostrarTel       = document.getElementById('toggle-mostrar-tel')?.checked;
      const mostrarActividad = document.getElementById('toggle-mostrar-actividad')?.checked;
      btnPriv.disabled = true; btnPriv.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';
      try {
        await guardarConfiguracion(email, { mostrarTel, mostrarActividad });
        PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Privacidad actualizada' });
      } catch { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al guardar' }); }
      finally { btnPriv.disabled = false; btnPriv.innerHTML = '<i class="bi bi-floppy2-fill"></i> Guardar privacidad'; }
    });
  }

  const btnBorrar = document.getElementById('btn-borrar-datos');
  if (btnBorrar) {
    btnBorrar.addEventListener('click', async () => {
      const res = await Phoenix.fire({
        icon: 'warning', iconColor: '#F0A500',
        title: '¿Limpiar historial de actividad?',
        text: 'Se borrarán todos los logs del nodo /actividad. Esta acción es irreversible.',
        showCancelButton: true, confirmButtonText: 'Sí, borrar', cancelButtonText: 'Cancelar',
      });
      if (res.isConfirmed) {
        try {
          await set(ref(Database, 'actividad'), null);
          PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Historial borrado' });
          _renderLogs();
        } catch { Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al borrar los datos' }); }
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   ADMINISTRADORES — Cargar desde Firebase
────────────────────────────────────────────────────────── */
async function _renderAdmins() {
  const container = document.getElementById('config-admins-list');
  if (!container) return;
  container.innerHTML = '<div class="config-loading"><i class="bi bi-hourglass-split config-spin"></i> Cargando administradores…</div>';

  try {
    const snap = await get(ref(Database, 'Administradores'));
    if (!snap.exists()) {
      container.innerHTML = '<div class="config-loading">Sin administradores registrados.</div>';
      return;
    }

    const admins = snap.val();
    let count = 0;
    container.innerHTML = Object.entries(admins).map(([key, admin]) => {
      count++;
      const nombre = admin.Nombre || admin.nombre || admin.Email?.split('@')[0] || 'Admin';
      const email  = admin.Email  || '—';
      const rol    = admin.Rol    || (key === Object.keys(admins)[0] ? 'Propietario' : 'Administrador');
      const estado = admin.Estado || 'activo';
      const ini    = nombre.substring(0, 2).toUpperCase();
      return `
        <div class="config-admin-item">
          <div class="config-admin-avatar">${_esc(ini)}</div>
          <div class="config-admin-info">
            <div class="config-admin-name">${_esc(nombre)}</div>
            <div class="config-admin-email">${_esc(email)}</div>
          </div>
          <span class="config-admin-role ${rol === 'Propietario' ? 'owner' : 'admin'}">
            <i class="bi bi-${rol === 'Propietario' ? 'shield-fill-check' : 'person-badge-fill'}"></i>
            ${_esc(rol)}
          </span>
          <span class="config-admin-status ${estado === 'activo' ? 'active' : 'inactive'}">
            <i class="bi bi-circle-fill" style="font-size:.5rem;"></i>
            ${estado === 'activo' ? 'Activo' : 'Inactivo'}
          </span>
        </div>`;
    }).join('');
    _setText('sys-total-admins', count);
  } catch {
    container.innerHTML = '<div class="config-loading">Error al cargar los administradores.</div>';
  }
}

/* ──────────────────────────────────────────────────────────
   LOGS — Real-time desde /actividad/
────────────────────────────────────────────────────────── */
let _logsUnsubscribe = null;
function _renderLogs() {
  const container  = document.getElementById('config-logs-list');
  const searchEl   = document.getElementById('logs-search');
  const filterEl   = document.getElementById('logs-filter-tipo');
  if (!container) return;

  if (_logsUnsubscribe) { _logsUnsubscribe(); _logsUnsubscribe = null; }

  container.innerHTML = '<div class="config-loading"><i class="bi bi-hourglass-split config-spin"></i> Cargando logs…</div>';

  const q = query(ref(Database, 'actividad'), orderByChild('timestamp'), limitToLast(50));

  _logsUnsubscribe = onValue(q, snap => {
    if (!snap.exists()) {
      container.innerHTML = '<div class="config-loading"><i class="bi bi-inbox"></i> Sin logs registrados.</div>';
      _setText('sys-total-actividad', '0');
      return;
    }

    const items = [];
    snap.forEach(child => items.unshift({ ...child.val(), _key: child.key }));
    _setText('sys-total-actividad', items.length);

    const colorMap = {
      login: 'green', logout: 'red', nuevo_cliente: 'green', eliminar_cliente: 'red',
      actualizacion: 'blue', activacion: 'green', desactivacion: 'red',
      renovacion: 'green', default: 'blue',
    };

    function _renderFiltered() {
      const sq  = (searchEl?.value || '').toLowerCase();
      const ft  = filterEl?.value  || '';
      const filtered = items.filter(ev => {
        if (ft && ev.tipo !== ft) return false;
        if (sq && !(`${ev.desc || ''} ${ev.tipo || ''}`.toLowerCase().includes(sq))) return false;
        return true;
      });

      if (!filtered.length) {
        container.innerHTML = '<div class="config-loading"><i class="bi bi-search"></i> Sin resultados.</div>';
        return;
      }

      container.innerHTML = filtered.map(ev => {
        const color = ev.color || colorMap[ev.tipo] || 'blue';
        const ts    = ev.timestamp
          ? new Date(ev.timestamp).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
          : (ev.time || '—');
        return `
          <div class="config-log-item">
            <span class="config-log-dot ${color}"></span>
            <div class="config-log-info">
              <div class="config-log-desc">${_esc(ev.desc || ev.tipo || 'Evento')}</div>
              <div class="config-log-time">${ts}</div>
            </div>
          </div>`;
      }).join('');
    }

    _renderFiltered();
    searchEl?.removeEventListener('input', _renderFiltered);
    filterEl?.removeEventListener('change', _renderFiltered);
    searchEl?.addEventListener('input', _renderFiltered);
    filterEl?.addEventListener('change', _renderFiltered);
  });
}

/* ──────────────────────────────────────────────────────────
   ACCESOS — Historial de login desde Firebase
────────────────────────────────────────────────────────── */
function _renderAccessLog() {
  const container = document.getElementById('config-access-log');
  if (!container) return;

  const q = query(
    ref(Database, 'actividad'),
    orderByChild('tipo'),
    limitToLast(5),
  );

  onValue(q, snap => {
    if (!snap.exists()) {
      container.innerHTML = '<div class="config-loading">Sin accesos registrados.</div>';
      return;
    }

    const logins = [];
    snap.forEach(child => {
      const v = child.val();
      if (v.tipo === 'login') logins.unshift(v);
    });

    if (!logins.length) {
      container.innerHTML = '<div class="config-access-item"><i class="bi bi-info-circle"></i> Sin logins registrados aún.</div>';
      return;
    }

    container.innerHTML = logins.slice(0, 5).map(l => {
      const ts = l.timestamp ? new Date(l.timestamp).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      return `<div class="config-access-item"><i class="bi bi-box-arrow-in-right"></i> <span>${_esc(l.desc || 'Login')} · ${ts}</span></div>`;
    }).join('');
  });
}

/* ──────────────────────────────────────────────────────────
   DISPOSITIVOS
────────────────────────────────────────────────────────── */
function _renderDevices() {
  const container = document.getElementById('config-devices-list');
  if (!container) return;
  const ua     = navigator.userAgent;
  const mobile = /Mobi|Android/i.test(ua);
  const device = mobile ? 'Dispositivo móvil' : 'Escritorio';
  const browser = ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Navegador';
  const platform = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Linux') ? 'Linux' : ua.includes('Android') ? 'Android' : 'SO';

  container.innerHTML = `
    <div class="config-device-item">
      <div class="config-device-icon"><i class="bi bi-${mobile ? 'phone-fill' : 'display'}"></i></div>
      <div class="config-device-info">
        <div class="config-device-name">${device} — ${browser}</div>
        <div class="config-device-meta">${platform} · Sesión activa · Iniciada ahora</div>
      </div>
      <span class="config-device-badge current"><i class="bi bi-circle-fill" style="font-size:.4rem;"></i> Este dispositivo</span>
    </div>`;
}

/* ──────────────────────────────────────────────────────────
   SISTEMA STATS — Conteos desde Firebase
────────────────────────────────────────────────────────── */
async function _loadSistemaStats() {
  try {
    const snap = await get(ref(Database, 'Clientes'));
    _setText('sys-total-clientes', snap.exists() ? Object.keys(snap.val()).length : '0');
  } catch {}
  try {
    const snap = await get(ref(Database, 'Administradores'));
    _setText('sys-total-admins', snap.exists() ? Object.keys(snap.val()).length : '0');
  } catch {}
  try {
    const snap = await get(ref(Database, 'actividad'));
    _setText('sys-total-actividad', snap.exists() ? Object.keys(snap.val()).length : '0');
  } catch {}
}

/* ──────────────────────────────────────────────────────────
   CARGAR CONFIG AL INICIAR SESIÓN (llamar desde auth/app.js)
────────────────────────────────────────────────────────── */
export async function cargarConfiguraciones(email) {
  let config = { ...CONFIG_DEFAULTS };
  try {
    const snap = await get(getConfigRef(email));
    if (snap.exists()) config = { ...CONFIG_DEFAULTS, ...snap.val() };
  } catch {
    const local = localStorage.getItem('PhoenixConfig');
    if (local) { try { config = { ...CONFIG_DEFAULTS, ...JSON.parse(local) }; } catch {} }
  }
  aplicarTema(config.tema, false);
  _publishConfig(config);
  return config;
}
