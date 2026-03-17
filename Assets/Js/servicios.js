/**
 * ╔════════════════════════════════════════════════════════════════╗
 *  PHOENIX — servicios.js (SaaS Subscriptions Controller v2)
 *  Módulo: Gestión de Suscripciones y Vencimientos Auto-Asignados
 *
 *  - calcularVencimiento()      → Fecha inicio + 30 días
 *  - verificarServicios()       → Audita expirados y retorna reporte
 *  - actualizarEstados()        → Actualiza en Firebase los vencidos
 *  - obtenerMetricasServicios() → Calcula todas las métricas del panel
 *  - Actividad Reciente         → Lee/escribe /ActividadServicios
 *  - Ingresos Estimados         → Calcula ingresos basado en precio_servicio
 *  - Estado del Sistema         → Verifica conectividad Firebase
 * ╚════════════════════════════════════════════════════════════════╝
 */

import {
  obtenerClientes,
  escucharClientes,
  actualizarCliente,
  registrarActividad,
  Database,
} from './firebase.js';
import {
  ref, get, onValue, query, orderByChild, limitToLast,
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

/* ──────────────────────────────────────────────────────────
   CONSTANTES Y CONFIGURACIÓN
────────────────────────────────────────────────────────── */
const DIAS_ALERTA   = 5;   // Umbral "Por vencer"
const DIAS_CICLO    = 30;  // Días de renovación por defecto

/* ──────────────────────────────────────────────────────────
   SWEETALERT2 — Tema Phoenix
────────────────────────────────────────────────────────── */
const Phoenix = Swal.mixin({
  background: '#14171C', color: '#E8ECF2',
  confirmButtonColor: '#516BEB', cancelButtonColor: '#2A3040',
});

const PhoenixToast = Swal.mixin({
  toast: true, position: 'top-end',
  showConfirmButton: false, timer: 3500, timerProgressBar: true,
  background: '#14171C', color: '#E8ECF2',
});

/* ──────────────────────────────────────────────────────────
   ESTADO INTERNO / CACHÉ
────────────────────────────────────────────────────────── */
let _suscripciones = [];  // Caché principal en memoria
let _unsubscribe   = null;
let _auditStats    = { vencidosDesactivadosHoy: 0 };

/* ──────────────────────────────────────────────────────────
   UI REFS — se resuelven dinámicamente (carga SPA)
────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/* ──────────────────────────────────────────────────────────
   EXPORT: FUNCIONES PÚBLICAS / UTILITARIAS
────────────────────────────────────────────────────────── */

/**
 * Calcula la fecha de vencimiento +DIAS_CICLO días a partir de una fecha inicio.
 * @param {string|Date} fechaInicio
 * @returns {string} ISO string de la fecha de vencimiento
 */
export function calcularVencimiento(fechaInicio) {
  const d = new Date(fechaInicio);
  d.setDate(d.getDate() + DIAS_CICLO);
  return d.toISOString();
}

/**
 * Verifica el estado de todos los servicios en la caché actual.
 * @returns {Object} Reporte: { vencidos, porVencer, activos, total }
 */
export function verificarServicios() {
  const hoy = new Date();
  let vencidos = 0, porVencer = 0, activos = 0;

  _suscripciones.forEach(s => {
    if (s._calcStatus === 'vencido') vencidos++;
    else if (s._calcStatus === 'porvencer') porVencer++;
    else activos++;
  });

  return { vencidos, porVencer, activos, total: _suscripciones.length };
}

/**
 * Actualiza en Firebase todos los clientes que están vencidos
 * pero aún tienen estado "activo" en la base de datos.
 * @returns {Promise<number>} Cantidad de registros actualizados
 */
export async function actualizarEstados() {
  let actualizados = 0;
  for (const sub of _suscripciones) {
    if (sub._calcStatus === 'vencido' && (sub.Estado || 'activo').toLowerCase() === 'activo') {
      try {
        await actualizarCliente(sub.id, { Estado: 'inactivo' });
        await registrarActividad({
          tipo:    'desactivacion',
          desc:    `Servicio de ${sub.Nombre} expiró y fue desactivado automáticamente`,
          nombre:  sub.Nombre,
          color:   'red',
          time:    _tiempoRelativo(new Date()),
        });
        actualizados++;
      } catch (e) {
        console.error(`[Servicios] Error desactivando ${sub.id}:`, e);
      }
    }
  }
  return actualizados;
}

/**
 * Calcula y retorna todas las métricas del panel de servicios.
 * @param {Array} clientes - Lista de clientes con metadata procesada
 * @returns {Object} Métricas completas
 */
export function obtenerMetricasServicios(clientes = _suscripciones) {
  const hoy = new Date();
  let activos = 0, porVencer = 0, vencidos = 0, maint = 0, nuevos = 0, renovados = 0;
  let ingresosMes = 0, ingresosTotal = 0;

  clientes.forEach(s => {
    const fbEstado = (s.Estado || 'activo').toLowerCase();

    if (fbEstado === 'mantenimiento') {
      maint++;
    } else if (fbEstado === 'inactivo' || s._calcStatus === 'vencido') {
      vencidos++;
    } else if (s._calcStatus === 'porvencer') {
      porVencer++;
    } else {
      activos++;
    }

    // Nuevos el mes actual
    if (s.timestamp) {
      const ts = new Date(s.timestamp);
      if (ts.getMonth() === hoy.getMonth() && ts.getFullYear() === hoy.getFullYear()) {
        nuevos++;
      }
    }

    // Renovaciones del mes (Facturacion_Inicio re-firmado este mes, distinto del mes de creación)
    if (s.Facturacion_Inicio) {
      const upd = new Date(s.Facturacion_Inicio);
      if (
        upd.getMonth() === hoy.getMonth() &&
        upd.getFullYear() === hoy.getFullYear()
      ) {
        renovados++;
      }
    }

    // Ingresos estimados
    const precio = parseFloat(s.precio_servicio || 0);
    if (precio > 0) {
      ingresosTotal += precio;
      // Cuenta como ingreso del mes si el servicio se inició/renovó este mes
      if (s.Facturacion_Inicio) {
        const fi = new Date(s.Facturacion_Inicio);
        if (fi.getMonth() === hoy.getMonth() && fi.getFullYear() === hoy.getFullYear()) {
          ingresosMes += precio;
        }
      } else if (s.timestamp) {
        const ts = new Date(s.timestamp);
        if (ts.getMonth() === hoy.getMonth() && ts.getFullYear() === hoy.getFullYear()) {
          ingresosMes += precio;
        }
      }
    }
  });

  return { activos, porVencer, vencidos, maint, nuevos, renovados, ingresosMes, ingresosTotal, total: clientes.length };
}

/* ──────────────────────────────────────────────────────────
   ENTRY POINT — llamado desde app.js al cargar la vista
────────────────────────────────────────────────────────── */
export function initServicios() {
  _initUIListeners();
  _renderSistema();
  _startSubscriptionsListener();
  _renderActividad();
}

/* ──────────────────────────────────────────────────────────
   LISTENERS UI
────────────────────────────────────────────────────────── */
function _initUIListeners() {
  const searchBox   = $('sv-search');
  const searchClr   = $('sv-search-clear');
  const filterState = $('sv-filter-estado');
  const sortType    = $('sv-sort');
  const btnRefresh  = $('sv-btn-refresh');
  const btnRefAct   = $('sv-btn-refresh-activity');

  searchBox?.addEventListener('input', () => {
    if (searchClr) searchClr.style.display = searchBox.value ? 'flex' : 'none';
    _renderDataGrid();
  });

  searchClr?.addEventListener('click', () => {
    if (searchBox) searchBox.value = '';
    if (searchClr) searchClr.style.display = 'none';
    _renderDataGrid();
  });

  filterState?.addEventListener('change', _renderDataGrid);
  sortType?.addEventListener('change', _renderDataGrid);

  btnRefresh?.addEventListener('click', async () => {
    const icon = btnRefresh.querySelector('i');
    if (icon) { icon.style.transition = 'transform .5s'; icon.style.transform = 'rotate(360deg)'; }
    setTimeout(() => { if (icon) icon.style.transform = 'rotate(0deg)'; }, 550);
    _auditAndRender();
  });

  btnRefAct?.addEventListener('click', () => {
    const list = $('sv-activity-list');
    if (list) list.innerHTML = '<div class="sv-activity-empty"><i class="bi bi-hourglass-split sv-spin"></i> Actualizando…</div>';
    _renderActividad();
  });

  // Modal — cerrado
  const closeFn = () => $('modal-editar')?.classList.remove('show');
  $('close-modal')?.addEventListener('click', closeFn);
  $('btn-cancelar-modal')?.addEventListener('click', closeFn);
  $('modal-editar')?.addEventListener('click', e => { if (e.target === $('modal-editar')) closeFn(); });

  // Auto-calc fecha límite al cambiar inicio (binding global en modal)
  document.getElementById('edit-inicio')?.addEventListener('change', e => {
    const limit = $('edit-vencimiento');
    if (limit && e.target.value) {
      const fd = new Date(e.target.value);
      fd.setDate(fd.getDate() + DIAS_CICLO);
      limit.value = fd.toISOString().split('T')[0];
      _actualizarHintDiasRestantes();
    }
  });
  document.getElementById('edit-vencimiento')?.addEventListener('change', _actualizarHintDiasRestantes);

  // ✔ Delegación de eventos en tbody: detecta clic en cualquier botón .sv-open-edit
  //   aunque las filas se re-rendericen sin reattach de listeners.
  const tbody = $('sv-tbody');
  if (tbody) {
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.sv-open-edit');
      if (!btn) return;
      const id = btn.dataset.id;
      const target = _suscripciones.find(x => x.id === id);
      if (target) {
        _openEditorContext(target);
      } else {
        console.warn('[Servicios] Cliente no encontrado en caché para id:', id);
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   FIREBASE — Listener en tiempo real de Clientes
────────────────────────────────────────────────────────── */
function _startSubscriptionsListener() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _renderEstado('loading');

  _unsubscribe = escucharClientes(async (clientesBase) => {
    _suscripciones = _procesarSuscripciones(clientesBase);
    await _auditAndRender();
  });
}

/* ──────────────────────────────────────────────────────────
   PROCESADOR DE SUSCRIPCIONES
   Añade metadata de fechas calculadas a cada cliente
────────────────────────────────────────────────────────── */
function _procesarSuscripciones(clientes) {
  const hoy = new Date();

  return clientes.map(c => {
    let inicio = c.Facturacion_Inicio
      ? new Date(c.Facturacion_Inicio)
      : (c.timestamp ? new Date(c.timestamp) : new Date());

    let limite = c.Facturacion_Limite
      ? new Date(c.Facturacion_Limite)
      : new Date(inicio.getTime() + (DIAS_CICLO * 24 * 60 * 60 * 1000));

    const msRestantes  = limite.getTime() - hoy.getTime();
    const diasRestantes = Math.ceil(msRestantes / (1000 * 60 * 60 * 24));

    let calcStatus = 'activo';
    if (diasRestantes <= 0)          calcStatus = 'vencido';
    else if (diasRestantes <= DIAS_ALERTA) calcStatus = 'porvencer';

    return { ...c, _dtInicio: inicio, _dtLimite: limite, _diasRest: diasRestantes, _calcStatus: calcStatus };
  });
}

/* ──────────────────────────────────────────────────────────
   AUDITORÍA + RENDER COMPLETO
────────────────────────────────────────────────────────── */
async function _auditAndRender() {
  // 1. Auto-desactivación de vencidos
  _auditStats.vencidosDesactivadosHoy = 0;

  for (const sub of _suscripciones) {
    if (sub._calcStatus === 'vencido' && (sub.Estado || 'activo').toLowerCase() === 'activo') {
      try {
        console.warn(`[Auditoría] ${sub.Nombre} expiró. Desactivando…`);
        await actualizarCliente(sub.id, { Estado: 'inactivo' });
        await registrarActividad({
          tipo:  'desactivacion',
          desc:  `${sub.Nombre} — servicio vencido desactivado automáticamente`,
          nombre: sub.Nombre,
          color: 'red',
          time:  _tiempoRelativo(new Date()),
        });
        _auditStats.vencidosDesactivadosHoy++;
      } catch (e) {
        console.error(`[Auditoría] Error desactivando ${sub.id}:`, e);
      }
    }
  }

  // 2. Alerta en header si hubo desactivaciones
  const alertPanel = $('sv-alert-panel');
  const alertCount = $('sv-alert-count');
  if (_auditStats.vencidosDesactivadosHoy > 0 && alertPanel) {
    if (alertCount) alertCount.textContent = _auditStats.vencidosDesactivadosHoy;
    alertPanel.style.display = 'flex';
  } else if (alertPanel) {
    alertPanel.style.display = 'none';
  }

  // 3. Pintar métricas y tabla
  _updateDashboardStats();
  _renderDataGrid();
  _updateSystemRecords();

  // 4. Footer timestamp
  const footerUpdate = $('sv-footer-update');
  if (footerUpdate) {
    footerUpdate.textContent = `Última auditoría: ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
}

/* ──────────────────────────────────────────────────────────
   DASHBOARD STATS — Actualizar contadores
────────────────────────────────────────────────────────── */
function _updateDashboardStats() {
  const m = obtenerMetricasServicios(_suscripciones);

  _setText('sv-stat-total',       m.total);
  _setText('sv-stat-activos',     m.activos);
  _setText('sv-stat-porvencer',   m.porVencer);
  _setText('sv-stat-vencidos',    m.vencidos);
  _setText('sv-stat-mant',        m.maint);
  _setText('sv-stat-nuevos',      m.nuevos);
  _setText('sv-stat-renovaciones', m.renovados);
  _setText('sv-count-badge',      m.total);

  // Ingresos estimados
  const fmtCurrency = (n) => {
    return n > 0 ? `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '$0';
  };

  _setText('sv-ingresos-mes',   fmtCurrency(m.ingresosMes));
  _setText('sv-ingresos-total', fmtCurrency(m.ingresosTotal));

  const ingresosStatus = $('sv-ingresos-status');
  if (ingresosStatus) {
    if (m.ingresosTotal > 0) {
      ingresosStatus.textContent = 'Con datos';
      ingresosStatus.className   = 'sv-panel-badge sv-badge-green';
    } else {
      ingresosStatus.textContent = 'Sin precios';
      ingresosStatus.className   = 'sv-panel-badge sv-badge-dim';
    }
  }

  const revenueNote = $('sv-revenue-note');
  if (revenueNote && m.ingresosTotal === 0) {
    revenueNote.innerHTML = 'Agrega <code>precio_servicio</code> a cada cliente en el modal para ver ingresos.';
  }
}

function _updateSystemRecords() {
  _setText('sv-sys-records', `${_suscripciones.length} clientes`);
}

/* ──────────────────────────────────────────────────────────
   TABLA DATAGRID — Renderizado
────────────────────────────────────────────────────────── */
function _renderDataGrid() {
  const tbody = $('sv-tbody');
  if (!tbody) return;

  const queryRaw  = ($('sv-search')?.value || '').toLowerCase();
  const filterEs  = $('sv-filter-estado')?.value || '';
  const sortTyp   = $('sv-sort')?.value || 'vencimiento-asc';

  // Filtrado
  let procesados = _suscripciones.filter(s => {
    if (queryRaw) {
      const scope = `#${s.cliente_id} ${s.Nombre} ${s.Negocio} ${s.Token} ${s.Numero}`.toLowerCase();
      if (!scope.includes(queryRaw)) return false;
    }
    if (filterEs) {
      const fbE = (s.Estado || 'activo').toLowerCase();
      if (filterEs === 'activo'        && (fbE !== 'activo' || s._calcStatus === 'vencido')) return false;
      if (filterEs === 'inactivo'      && (fbE !== 'inactivo' && s._calcStatus !== 'vencido')) return false;
      if (filterEs === 'mantenimiento' && fbE !== 'mantenimiento') return false;
      if (filterEs === 'porvencer'     && s._calcStatus !== 'porvencer') return false;
    }
    return true;
  });

  // Ordenamiento
  procesados.sort((a, b) => {
    switch (sortTyp) {
      case 'vencimiento-asc':  return a._dtLimite.getTime() - b._dtLimite.getTime();
      case 'vencimiento-desc': return b._dtLimite.getTime() - a._dtLimite.getTime();
      case 'id-asc':           return (a.cliente_id || 0) - (b.cliente_id || 0);
      case 'nombre-asc':       return (a.Nombre || '').localeCompare(b.Nombre || '');
      default: return 0;
    }
  });

  // Render vacío
  if (procesados.length === 0) {
    _renderEstado(queryRaw || filterEs ? 'no-results' : 'empty');
    _setText('sv-result-count', 'Mostrando 0 asignaciones');
    return;
  }

  const fragment = document.createDocumentFragment();
  procesados.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = _buildRow(s);
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
  _setText('sv-result-count', `Mostrando ${procesados.length} de ${_suscripciones.length} asignaciones`);

  _bindActionsDOM(procesados);
}

/* ── Fila de la tabla ── */
function _buildRow(s) {
  const customId    = s.cliente_id !== undefined ? `#${s.cliente_id}` : '—';
  const realStatus  = (s.Estado || 'activo').toLowerCase();
  const dInicioStr  = _fmtDate(s._dtInicio);
  const dLimiteStr  = _fmtDate(s._dtLimite);
  const nombre      = _esc(s.Nombre    || '—');
  const negocio     = _esc(s.Negocio   || '—');
  const telefono    = _esc(s.Numero    || '—');
  const direccion   = _esc(s.Direccion || '—');
  const token       = _esc(s.Token     || '—');

  let labelEstado = 'Operativo'; let bgClass = 'activo'; let icon = 'bi-check-all';
  let avaClass = '';

  if (realStatus === 'mantenimiento') {
    labelEstado = 'Mantenimiento'; bgClass = 'mantenimiento'; icon = 'bi-tools';
  } else if (realStatus === 'inactivo' || s._calcStatus === 'vencido') {
    labelEstado = s._calcStatus === 'vencido' ? 'Vencida' : 'Inactiva';
    bgClass = 'inactivo'; icon = 'bi-ban'; avaClass = 'vencido';
  } else if (s._calcStatus === 'porvencer') {
    labelEstado = 'Vence Pronto'; bgClass = 'porvencer'; icon = 'bi-exclamation-circle'; avaClass = 'porvencer';
  }

  const ini = s.Nombre ? s.Nombre.substring(0, 2).toUpperCase() : '??';

  const isVencida = (realStatus === 'inactivo' || s._calcStatus === 'vencido');
  const diasSpan = isVencida
    ? `<span class="sv-date-sub sv-date-danger">Corte forzado o expirado</span>`
    : `<span class="sv-date-sub ${s._calcStatus === 'porvencer' ? 'sv-date-warn' : ''}"><i class="bi bi-hourglass-bottom"></i> ${s._diasRest}d restantes</span>`;

  return `
    <td data-label="ID">
      <span class="sv-id-badge">${customId}</span>
    </td>
    <td data-label="Cliente">
      <div class="sv-td-user">
        <div class="sv-avatar ${avaClass}">${ini}</div>
        <div class="sv-user-data">
          <span class="sv-user-name">${nombre}</span>
        </div>
      </div>
    </td>
    <td data-label="Teléfono">
      <span class="sv-cell-phone"><i class="bi bi-telephone"></i> ${telefono}</span>
    </td>
    <td data-label="Negocio">
      <span class="sv-user-bzl">${negocio}</span>
    </td>
    <td data-label="Dirección">
      <span class="sv-cell-address" title="${direccion}">${direccion}</span>
    </td>
    <td data-label="Token">
      <span class="sv-token-badge">${token}</span>
    </td>
    <td data-label="F. Inicio">
      <div class="sv-date-group">
        <span class="sv-date-main">${dInicioStr}</span>
        <span class="sv-date-sub"><i class="bi bi-wallet2"></i> Ciclo inicio</span>
      </div>
    </td>
    <td data-label="F. Vencimiento">
      <div class="sv-date-group">
        <span class="sv-date-main">${dLimiteStr}</span>
        ${diasSpan}
      </div>
    </td>
    <td data-label="Estado">
      <span class="sv-status ${bgClass}"><i class="bi ${icon}"></i> ${labelEstado}</span>
    </td>
    <td data-label="Acciones">
      <div class="sv-actions">
        <button class="sv-action-btn edit sv-open-edit" data-id="${_esc(s.id)}" title="Gestionar / Renovar">
          <i class="bi bi-gear-wide-connected"></i>
        </button>
      </div>
    </td>
  `;
}

/* ── Estados vacío / cargando ── */
function _renderEstado(tipo) {
  const tbody = $('sv-tbody');
  if (!tbody) return;
  const msgs = {
    loading:      '<i class="bi bi-hourglass-split sv-spin"></i> Auditando cuentas de suscripción…',
    empty:        '<i class="bi bi-folder-x" style="font-size:2rem;display:block;margin-bottom:8px;"></i>No hay clientes integrados al clúster de servicios.<br><small>Registra clientes desde el módulo de Clientes.</small>',
    'no-results': '<i class="bi bi-search"></i> Ningún cliente coincide con este filtro.',
  };
  const colspan = 10;
  tbody.innerHTML = `<tr><td colspan="${colspan}" class="sv-empty-state">${msgs[tipo] || ''}</td></tr>`;
}

/* ──────────────────────────────────────────────────────────
   MODAL — EDICIÓN & RENOVACIÓN
────────────────────────────────────────────────────────── */
/**
 * _bindActionsDOM — ya no es necesario; la delegación se registra una vez en _initUIListeners.
 * Se mantiene como no-op para compatibilidad con cualquier llamada externa residual.
 */
function _bindActionsDOM(_coleccion) {
  // La lógica se mañejá mediante delegación de eventos en sv-tbody (ver _initUIListeners).
}

function _openEditorContext(clienteObj) {
  const modal = $('modal-editar');
  if (!modal) {
    console.error(
      '[Servicios] #modal-editar no encontrado en el DOM.\n' +
      'Asegúrate de que el modal esté DENTRO de .servicios-wrapper en servicios.html.'
    );
    return;
  }

  modal.dataset.currentId = clienteObj.id;

  // Preview del cliente en el modal
  const preview = $('sv-modal-client-preview');
  if (preview) {
    const ini = clienteObj.Nombre ? clienteObj.Nombre.substring(0, 2).toUpperCase() : '??';
    preview.innerHTML = `
      <div class="sv-modal-avatar">${ini}</div>
      <div>
        <div class="sv-modal-client-name">${_esc(clienteObj.Nombre || '—')}</div>
        <div class="sv-modal-client-meta">
          <i class="bi bi-shop"></i> ${_esc(clienteObj.Negocio || '—')}
          &nbsp;·&nbsp;
          <i class="bi bi-geo-alt"></i> ${_esc(clienteObj.Direccion || '—')}
        </div>
      </div>
    `;
  }

  // Poblar inputs
  _setVal('edit-nombre',     clienteObj.Nombre    || '');
  _setVal('edit-numero',     clienteObj.Numero    || '');
  _setVal('edit-estado',     (clienteObj.Estado   || 'activo').toLowerCase());
  _setVal('edit-precio',     clienteObj.precio_servicio || '');

  const pad = n => n.toString().padStart(2, '0');
  const dIni = clienteObj._dtInicio;
  const dLim = clienteObj._dtLimite;
  _setVal('edit-inicio',      `${dIni.getFullYear()}-${pad(dIni.getMonth()+1)}-${pad(dIni.getDate())}`);
  _setVal('edit-vencimiento', `${dLim.getFullYear()}-${pad(dLim.getMonth()+1)}-${pad(dLim.getDate())}`);

  _actualizarHintDiasRestantes();

  // Alerta de vencido
  const banner = $('modal-alerta-vencido');
  if (banner) {
    banner.style.display =
      (clienteObj._calcStatus === 'vencido' || (clienteObj.Estado || '').toLowerCase() === 'inactivo')
        ? 'flex' : 'none';
  }

  // Clonar form para limpiar listeners acumulados
  const form  = $('form-editar-servicio');
  const fresh = form.cloneNode(true);
  form.parentNode.replaceChild(fresh, form);

  // Re-bind eventos del form clonado
  $('edit-inicio')?.addEventListener('change', e => {
    const limit = $('edit-vencimiento');
    if (limit && e.target.value) {
      const fd = new Date(e.target.value);
      fd.setDate(fd.getDate() + DIAS_CICLO);
      limit.value = fd.toISOString().split('T')[0];
      _actualizarHintDiasRestantes();
    }
  });
  $('edit-vencimiento')?.addEventListener('change', _actualizarHintDiasRestantes);

  const closeFn = () => modal.classList.remove('show');
  $('btn-cancelar-modal')?.addEventListener('click', closeFn);
  $('close-modal')?.addEventListener('click', closeFn);

  // ── Botón Renovar +30 Días ──
  $('btn-renovar-auto')?.addEventListener('click', () => {
    const inpIni = $('edit-inicio');
    const inpLim = $('edit-vencimiento');
    const inpEst = $('edit-estado');

    const hoy = new Date();
    const fim = new Date(hoy);
    fim.setDate(fim.getDate() + DIAS_CICLO);

    inpIni.value = `${hoy.getFullYear()}-${pad(hoy.getMonth()+1)}-${pad(hoy.getDate())}`;
    inpLim.value = `${fim.getFullYear()}-${pad(fim.getMonth()+1)}-${pad(fim.getDate())}`;
    if (inpEst) inpEst.value = 'activo';

    const banner = $('modal-alerta-vencido');
    if (banner) banner.style.display = 'none';
    _actualizarHintDiasRestantes();
    PhoenixToast.fire({ icon: 'info', iconColor: '#17D7A0', title: 'Fechas extendidas +30 días' });
  });

  // ── Guardar en Firebase ──
  fresh.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSave = $('btn-guardar-modal');
    if (btnSave) { btnSave.disabled = true; btnSave.innerHTML = '<i class="bi bi-hourglass-split sv-spin"></i> Proyectando…'; }

    const dInicioT     = $('edit-inicio')?.value;
    const dLimiteT     = $('edit-vencimiento')?.value;
    const nuevoEstado  = $('edit-estado')?.value || 'activo';
    const precioNuevo  = parseFloat($('edit-precio')?.value || 0) || 0;
    const estadoAnterior = (clienteObj.Estado || 'activo').toLowerCase();

    const payload = {
      Nombre:             $('edit-nombre')?.value || clienteObj.Nombre,
      Numero:             $('edit-numero')?.value || clienteObj.Numero,
      Estado:             nuevoEstado,
      Facturacion_Inicio: dInicioT ? new Date(dInicioT).toISOString()              : clienteObj._dtInicio.toISOString(),
      Facturacion_Limite: dLimiteT ? new Date(dLimiteT + 'T23:59:59').toISOString(): clienteObj._dtLimite.toISOString(),
    };

    if (precioNuevo > 0) payload.precio_servicio = precioNuevo;

    try {
      await actualizarCliente(clienteObj.id, payload);

      // Registrar tipo de evento en actividad
      let tipoEvento = 'actualizacion';
      let colorEvento = 'blue';
      let descEvento  = `${clienteObj.Nombre} — datos actualizados`;

      if (nuevoEstado === 'activo' && estadoAnterior !== 'activo') {
        tipoEvento  = 'activacion';
        colorEvento = 'green';
        descEvento  = `${clienteObj.Nombre} — servicio reactivado`;
      } else if (nuevoEstado === 'inactivo' && estadoAnterior !== 'inactivo') {
        tipoEvento  = 'desactivacion';
        colorEvento = 'red';
        descEvento  = `${clienteObj.Nombre} — servicio desactivado manualmente`;
      } else if (dInicioT && dInicioT !== `${pad(clienteObj._dtInicio.getFullYear())}-${pad(clienteObj._dtInicio.getMonth()+1)}-${pad(clienteObj._dtInicio.getDate())}`) {
        tipoEvento  = 'renovacion';
        colorEvento = 'green';
        descEvento  = `${clienteObj.Nombre} — suscripción renovada +${DIAS_CICLO} días`;
      }

      await registrarActividad({ tipo: tipoEvento, desc: descEvento, nombre: clienteObj.Nombre, color: colorEvento, time: _tiempoRelativo(new Date()) });
      _renderActividad(); // Refrescar actividad

      closeFn();
      PhoenixToast.fire({ icon: 'success', iconColor: '#17D7A0', title: 'Suscriptor actualizado con éxito.' });
    } catch (err) {
      if (btnSave) { btnSave.disabled = false; btnSave.innerHTML = '<i class="bi bi-check2-all"></i> Aplicar al Sistema'; }
      Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error al guardar', text: 'Verifica tu conexión a internet.' });
    }
  });

  modal.classList.add('show');
}

/* ── Hint de días restantes en modal ── */
function _actualizarHintDiasRestantes() {
  const hp   = $('hint-dias-restantes');
  const dVal = $('edit-vencimiento')?.value;
  if (!hp || !dVal) return;

  const lim = new Date(dVal + 'T23:59:59');
  const hoy = new Date();
  const dr  = Math.ceil((lim.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));

  if (dr < 0) {
    hp.innerHTML = `<span style="color:var(--red);font-weight:700;"><i class="bi bi-x-circle"></i> Expiró hace ${Math.abs(dr)} días.</span>`;
  } else if (dr === 0) {
    hp.innerHTML = `<span style="color:var(--yellow);font-weight:700;"><i class="bi bi-exclamation-circle"></i> Expira HOY a la medianoche.</span>`;
  } else {
    hp.innerHTML = `<i class="bi bi-stopwatch"></i> Límite de operación: <strong>${dr} días naturales.</strong>`;
  }
}

/* ──────────────────────────────────────────────────────────
   ACTIVIDAD RECIENTE — Leer desde Firebase
────────────────────────────────────────────────────────── */
async function _renderActividad() {
  const container = $('sv-activity-list');
  if (!container) return;

  try {
    const q    = query(ref(Database, 'ActividadServicios'), orderByChild('timestamp'), limitToLast(8));
    const snap = await get(q);

    if (!snap.exists()) {
      container.innerHTML = '<div class="sv-activity-empty"><i class="bi bi-inbox"></i> Sin actividad registrada</div>';
      return;
    }

    const val    = snap.val();
    const events = Object.values(val).reverse(); // Más reciente primero

    container.innerHTML = events.map(a => `
      <div class="sv-activity-item">
        <span class="sv-activity-dot ${a.color || 'blue'}"></span>
        <div class="sv-activity-info">
          <div class="sv-activity-desc">${_esc(a.desc || '')}</div>
          <div class="sv-activity-time">${_esc(a.time || _tiempoRelativo(new Date(a.timestamp || '')))}</div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.warn('[Servicios] Error cargando actividad:', err);
    container.innerHTML = '<div class="sv-activity-empty"><i class="bi bi-wifi-off"></i> Sin conexión para cargar actividad</div>';
  }
}

/* ──────────────────────────────────────────────────────────
   ESTADO DEL SISTEMA
────────────────────────────────────────────────────────── */
function _renderSistema() {
  // Timestamp última actualización
  const lastUpdate = $('sv-sys-lastupdate');
  if (lastUpdate) {
    lastUpdate.textContent = `Actualizado: ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Verificar conectividad Firebase con una lectura ligera
  get(ref(Database, '.info/connected'))
    .then(() => {
      _setSysBadge('sv-sys-firebase', 'Conectado', 'sv-badge-online');
      _setSysBadge('sv-sys-sync',     'Al día',    'sv-badge-online');
    })
    .catch(() => {
      _setSysBadge('sv-sys-firebase', 'Sin conexión', 'sv-badge-error');
      _setSysBadge('sv-sys-sync',     'Pendiente',    'sv-badge-warn');
    });
}

function _setSysBadge(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `sv-sys-badge ${cls}`;
}

/* ──────────────────────────────────────────────────────────
   HELPERS GENERALES
────────────────────────────────────────────────────────── */
function _setText(id, val) { const el = $(id); if (el) el.textContent = val; }
function _setVal(id, val)  { const el = $(id); if (el) el.value = val; }

function _fmtDate(d) {
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _esc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function _tiempoRelativo(fecha) {
  const diff = Math.floor((new Date() - fecha) / 1000);
  if (diff < 60)   return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400)return `Hace ${Math.floor(diff / 3600)} h`;
  return fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}
