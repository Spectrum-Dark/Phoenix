/**
 * ╔════════════════════════════════════════════════════════════════╗
 *  PHOENIX — clientes.js (v3 — Read-Only Monitor)
 *  Módulo: Visualización de Clientes
 *
 *  - Firebase real-time listener (onValue) → tabla en vivo
 *  - Búsqueda en tiempo real (ID / nombre / teléfono / negocio)
 *  - Filtro por estado + Ordenamiento
 *  - Mini-stats en tiempo real
 *  - Formulario de registro (alta de nuevos clientes)
 *  - SIN edición inline, SIN modal de edición, SIN eliminación
 * ╚════════════════════════════════════════════════════════════════╝
 */

import {
  guardarCliente,
  tokenExiste,
  escucharClientes,
} from './firebase.js';

/* ──────────────────────────────────────────────────────────
   SWAL — tema Phoenix
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
   ESTADO INTERNO
────────────────────────────────────────────────────────── */
let _todosLosClientes = [];   // caché de todos los clientes (de Firebase)
let _unsubscribe      = null; // función para cancelar el listener Firebase

/* ──────────────────────────────────────────────────────────
   ENTRY POINT — llamado desde app.js
────────────────────────────────────────────────────────── */
export function initClientes() {
  _initToggleForm();
  _initTokenGenerator();
  _initFormRegistro();
  _initBusqueda();
  _initOrdenYFiltro();
  _initRefreshBtn();
  _startListenerFirebase();
}

/* ──────────────────────────────────────────────────────────
   TOGGLE FORMULARIO (mostrar / ocultar)
────────────────────────────────────────────────────────── */
function _initToggleForm() {
  const btnAbrir  = document.getElementById('btn-toggle-form');
  const btnCerrar = document.getElementById('btn-close-form');
  const btnCancel = document.getElementById('btn-cancelar');
  const formCont  = document.getElementById('form-container');
  if (!formCont) return;

  const open  = () => { formCont.style.display = 'block'; formCont.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const close = () => { formCont.style.display = 'none'; limpiarFormulario(); };

  btnAbrir?.addEventListener('click', open);
  btnCerrar?.addEventListener('click', close);
  btnCancel?.addEventListener('click', close);
}

/* ──────────────────────────────────────────────────────────
   GENERADOR DE TOKEN
────────────────────────────────────────────────────────── */
function _initTokenGenerator() {
  const btn   = document.getElementById('btn-generar-token');
  const input = document.getElementById('servicio-token');
  if (!btn || !input) return;

  btn.addEventListener('click', () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = 'PHNX-';
    for (let i = 0; i < 3; i++) {
      let seg = '';
      for (let j = 0; j < 4; j++) seg += chars[Math.floor(Math.random() * chars.length)];
      token += seg + (i < 2 ? '-' : '');
    }
    input.style.opacity = '0';
    setTimeout(() => { input.value = token; input.style.transition = 'opacity .3s'; input.style.opacity = '1'; }, 150);
  });
}

/* ──────────────────────────────────────────────────────────
   FORMULARIO DE REGISTRO
────────────────────────────────────────────────────────── */
function _initFormRegistro() {
  const form = document.getElementById('form-registro-cliente');
  if (!form) return;

  form._abortCtrl?.abort();
  const ctrl = new AbortController();
  form._abortCtrl = ctrl;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const btnGuardar = document.getElementById('btn-guardar');

    const datos = {
      nombre:    _val('cliente-nombre'),
      numero:    _val('cliente-numero'),
      negocio:   _val('negocio-nombre'),
      direccion: _val('negocio-direccion'),
      token:     _val('servicio-token'),
    };

    limpiarErrores();
    const errores = validarFormulario(datos);
    if (errores.length) { mostrarErrores(errores); return; }

    _setBtnEstado(btnGuardar, 'loading');

    try {
      const duplicado = await tokenExiste(datos.token);
      if (duplicado) {
        _setBtnEstado(btnGuardar, 'idle');
        mostrarErrores([{ campo: 'servicio-token', msg: 'Token ya en uso. Genera uno nuevo.' }]);
        return;
      }

      await guardarCliente({
        Nombre: datos.nombre, Numero: datos.numero,
        Negocio: datos.negocio, Direccion: datos.direccion, Token: datos.token,
      });

      _setBtnEstado(btnGuardar, 'success');
      limpiarFormulario();
      setTimeout(() => {
        document.getElementById('form-container').style.display = 'none';
        _setBtnEstado(btnGuardar, 'idle');
      }, 1800);

      PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: `"${datos.nombre}" registrado` });

    } catch (err) {
      console.error('clientes.js: error guardando:', err);
      _setBtnEstado(btnGuardar, 'idle');
      Phoenix.fire({
        icon: 'error', iconColor: '#eb5757',
        title: 'Error al guardar',
        text: 'No se pudo guardar el cliente. Verifica tu conexión.',
        confirmButtonText: 'Reintentar', showCancelButton: true, cancelButtonText: 'Cancelar',
      }).then(r => { if (r.isConfirmed) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    }
  }, { signal: ctrl.signal });
}

/* ──────────────────────────────────────────────────────────
   FIREBASE — Listener en tiempo real
────────────────────────────────────────────────────────── */
function _startListenerFirebase() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _renderEstado('loading');

  _unsubscribe = escucharClientes((clientes) => {
    _todosLosClientes = clientes;
    _actualizarStats(clientes);
    renderClientes();
  });
}

/* ──────────────────────────────────────────────────────────
   RENDER DE TABLA — filtro + orden sobre _todosLosClientes
────────────────────────────────────────────────────────── */
export function renderClientes() {
  const tbody = document.getElementById('cl-tbody');
  if (!tbody) return;

  const query  = (_val('cl-search') || '').toLowerCase();
  const estado = _val('cl-filter-estado') || '';
  const orden  = document.getElementById('cl-sort')?.value || 'id-asc';

  let lista = _todosLosClientes.filter(c => {
    if (estado && (c.Estado || 'activo').toLowerCase() !== estado) return false;
    if (query) {
      const charId  = c.cliente_id ? `#${c.cliente_id}` : '';
      const haystack = [charId, c.Nombre, c.Numero, c.Negocio, c.Direccion, c.Token]
        .join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  lista = _ordenar(lista, orden);

  if (lista.length === 0) {
    _renderEstado(query || estado ? 'no-results' : 'empty');
    _setResultCount(0, _todosLosClientes.length);
    return;
  }

  tbody.innerHTML = lista.map(c => _crearFila(c)).join('');
  _setResultCount(lista.length, _todosLosClientes.length);
}

/* ── Ordenar ── */
function _ordenar(lista, orden) {
  return [...lista].sort((a, b) => {
    switch (orden) {
      case 'id-asc':      return (a.cliente_id || 0) - (b.cliente_id || 0);
      case 'id-desc':     return (b.cliente_id || 0) - (a.cliente_id || 0);
      case 'nombre-asc':  return (a.Nombre || '').localeCompare(b.Nombre || '');
      case 'fecha-desc':  return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
      case 'estado-asc':  return (a.Estado || '').localeCompare(b.Estado || '');
      default: return 0;
    }
  });
}

/* ── Estados: vacío / sin resultados / cargando ── */
function _renderEstado(tipo) {
  const tbody = document.getElementById('cl-tbody');
  if (!tbody) return;
  const msgs = {
    loading:      '<i class="bi bi-hourglass-split cl-spin"></i> Conectando con Firebase…',
    empty:        '<i class="bi bi-inbox" style="font-size:2rem;display:block;margin-bottom:8px;"></i>No hay clientes registrados todavía.<br><small>Usa el botón <strong>Nuevo Cliente</strong> para comenzar.</small>',
    'no-results': '<i class="bi bi-search"></i> Sin resultados para esta búsqueda.',
  };
  tbody.innerHTML = `<tr><td colspan="5" class="cl-empty-state">${msgs[tipo] || ''}</td></tr>`;
}

/* ── Fila de cliente (solo lectura) ── */
function _crearFila(c) {
  const customId = c.cliente_id !== undefined ? `#${c.cliente_id}` : '—';
  const nombre   = _esc(c.Nombre    || '—');
  const numero   = _esc(c.Numero    || '—');
  const negocio  = _esc(c.Negocio   || '—');
  const dir      = _esc(c.Direccion || '—');
  const token    = _esc(c.Token     || '—');
  const estado   = (c.Estado || 'activo').toLowerCase();

  const fecha = c.timestamp
    ? new Date(c.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  let clst = 'activo'; let icon = 'bi-check-circle-fill'; let lbl = 'Activo'; let avatarCls = '';
  if (estado === 'mantenimiento') { clst = 'mantenimiento'; icon = 'bi-tools';         lbl = 'Mantenimiento'; avatarCls = 'maint'; }
  else if (estado === 'inactivo') { clst = 'inactivo';      icon = 'bi-x-circle-fill'; lbl = 'Inactivo';      avatarCls = 'inact'; }

  const ini = nombre.length >= 2 ? nombre.substring(0, 2).toUpperCase() : nombre.toUpperCase();

  return `
    <tr data-id="${_esc(c.id)}">
      <td data-label="ID">
        <span class="cl-id-badge">${customId}</span>
      </td>
      <td data-label="Cliente">
        <div class="cl-td-user">
          <div class="cl-avatar ${avatarCls}">${ini}</div>
          <div class="cl-user-data">
            <span class="cl-user-name">${nombre}</span>
            <span class="cl-user-biz">${negocio}</span>
          </div>
        </div>
      </td>
      <td data-label="Contacto">
        <div class="cl-contact-info">
          <span class="cl-phone"><i class="bi bi-telephone"></i> ${numero}</span>
          <span class="cl-address" title="${dir}"><i class="bi bi-geo-alt"></i> ${dir}</span>
        </div>
      </td>
      <td data-label="Suscripción">
        <div class="cl-sub-info">
          <span class="cl-token-badge"><i class="bi bi-key"></i> ${token}</span>
          <span class="cl-date"><i class="bi bi-calendar3"></i> ${fecha}</span>
        </div>
      </td>
      <td data-label="Estado">
        <span class="cl-status ${clst}"><i class="bi ${icon}"></i> ${lbl}</span>
      </td>
    </tr>`;
}

/* ──────────────────────────────────────────────────────────
   BÚSQUEDA EN TIEMPO REAL
────────────────────────────────────────────────────────── */
export function buscarClientes(query) {
  const input = document.getElementById('cl-search');
  if (input) input.value = query;
  renderClientes();
}

function _initBusqueda() {
  const input = document.getElementById('cl-search');
  const clear = document.getElementById('cl-search-clear');

  input?.addEventListener('input', () => {
    if (clear) clear.style.display = input.value ? 'flex' : 'none';
    renderClientes();
  });

  clear?.addEventListener('click', () => {
    if (input) input.value = '';
    if (clear) clear.style.display = 'none';
    renderClientes();
  });
}

/* ──────────────────────────────────────────────────────────
   FILTRO DE ESTADO + ORDENAMIENTO
────────────────────────────────────────────────────────── */
function _initOrdenYFiltro() {
  document.getElementById('cl-filter-estado')?.addEventListener('change', renderClientes);
  document.getElementById('cl-sort')?.addEventListener('change', renderClientes);
}

/* ──────────────────────────────────────────────────────────
   BOTÓN REFRESH MANUAL
────────────────────────────────────────────────────────── */
function _initRefreshBtn() {
  document.getElementById('cl-btn-refresh')?.addEventListener('click', () => {
    const icon = document.querySelector('#cl-btn-refresh i');
    if (icon) { icon.style.transition = 'transform .4s'; icon.style.transform = 'rotate(360deg)'; }
    setTimeout(() => { if (icon) icon.style.transform = 'rotate(0deg)'; }, 450);
    renderClientes();
  });
}

/* ──────────────────────────────────────────────────────────
   MINI-STATS EN TIEMPO REAL
────────────────────────────────────────────────────────── */
function _actualizarStats(clientes) {
  const activos = clientes.filter(c => (c.Estado || 'activo').toLowerCase() === 'activo').length;
  const mant    = clientes.filter(c => (c.Estado || '').toLowerCase() === 'mantenimiento').length;
  const inact   = clientes.filter(c => (c.Estado || '').toLowerCase() === 'inactivo').length;

  _setText('cl-stat-total',   clientes.length);
  _setText('cl-stat-activos', activos);
  _setText('cl-stat-mant',    mant);
  _setText('cl-stat-inact',   inact);
  _setText('cl-count-badge',  clientes.length);
}

function _setResultCount(visible, total) {
  const el = document.getElementById('cl-result-count');
  if (!el) return;
  el.textContent = visible === total
    ? `${total} cliente${total !== 1 ? 's' : ''}`
    : `${visible} de ${total} cliente${total !== 1 ? 's' : ''}`;
}

/* ──────────────────────────────────────────────────────────
   VALIDACIÓN
────────────────────────────────────────────────────────── */
export function validarFormulario({ nombre, numero, negocio, direccion, token }) {
  const e = [];
  if (!nombre)           e.push({ campo: 'cliente-nombre',    msg: 'El nombre es obligatorio.' });
  else if (nombre.length < 3) e.push({ campo: 'cliente-nombre', msg: 'Mínimo 3 caracteres.' });

  const d = numero.replace(/[\s\-()+]/g, '');
  if (!numero)           e.push({ campo: 'cliente-numero',    msg: 'El teléfono es obligatorio.' });
  else if (!/^\d{7,15}$/.test(d)) e.push({ campo: 'cliente-numero', msg: 'Número inválido (7–15 dígitos).' });

  if (!negocio)          e.push({ campo: 'negocio-nombre',    msg: 'El nombre del negocio es obligatorio.' });
  if (!direccion)        e.push({ campo: 'negocio-direccion', msg: 'La dirección es obligatoria.' });
  if (!token)            e.push({ campo: 'servicio-token',    msg: 'Genera un token antes de guardar.' });
  else if (!token.startsWith('PHNX-')) e.push({ campo: 'servicio-token', msg: 'Token inválido. Usa el botón Generar.' });
  return e;
}

export function mostrarErrores(errores) {
  errores.forEach(({ campo, msg }) => {
    const input = document.getElementById(campo);
    if (input) input.classList.add('input-error');
    const errEl = document.getElementById(`err-${campo}`);
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'flex'; }
  });
  document.querySelector('.input-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function limpiarErrores() {
  document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  document.querySelectorAll('.cl-err-msg').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
}

export function limpiarFormulario() {
  ['cliente-nombre','cliente-numero','negocio-nombre','negocio-direccion','servicio-token']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  limpiarErrores();
}

/* ──────────────────────────────────────────────────────────
   ESTADO DEL BOTÓN GUARDAR
────────────────────────────────────────────────────────── */
function _setBtnEstado(btn, estado) {
  if (!btn) return;
  if (estado === 'loading') {
    btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split cl-spin"></i> Guardando…';
  } else if (estado === 'success') {
    btn.disabled = true; btn.innerHTML = '<i class="bi bi-check-lg"></i> ¡Guardado!';
  } else {
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Guardar Registro';
  }
}

/* ──────────────────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────────────────── */
function _val(id)         { return (document.getElementById(id)?.value || '').trim(); }
function _setText(id, v)  { const el = document.getElementById(id); if (el) el.textContent = v; }
function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
