/**
 * ╔════════════════════════════════════════════════════════════════╗
 *  PHOENIX — servicios.js (SaaS Subscriptions Controller)
 *  Módulo: Gestión de Suscripciones y Vencimientos Auto-Asignados
 * 
 *  - Auditoría automática de fechas (+30 Días).
 *  - Desactivación forzada al vencer.
 *  - Interfaz de edición en línea de Fechas/Estados.
 *  - Panel de Estadísticas Avanzadas de control.
 * ╚════════════════════════════════════════════════════════════════╝
 */

import {
  obtenerClientes,
  escucharClientes,
  actualizarCliente
} from './firebase.js';

/* ──────────────────────────────────────────────────────────
   SWAL CONFIGURATION (Phoenix Premium Theme)
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
   ESTADO INTERNO / CACHE
────────────────────────────────────────────────────────── */
let _suscripciones = []; // Cache master in memory
let _unsubscribe = null;
let _auditStats = { vencidosDesactivadosHoy: 0 };
const DIAS_ALERTA = 5;

// Variables de UI compartidas
const UI = {
  tbody:        document.getElementById('sv-tbody'),
  resultCount:  document.getElementById('sv-result-count'),
  countBadge:   document.getElementById('sv-count-badge'),
  // Stats
  stTotal:      document.getElementById('sv-stat-total'),
  stActivos:    document.getElementById('sv-stat-activos'),
  stPorVencer:  document.getElementById('sv-stat-porvencer'),
  stVencidos:   document.getElementById('sv-stat-vencidos'),
  stRenov:      document.getElementById('sv-stat-renovaciones'),
  stNuevos:     document.getElementById('sv-stat-nuevos'),
  stMant:       document.getElementById('sv-stat-mant'),
  // Search / Filtros
  searchBox:    document.getElementById('sv-search'),
  searchClr:    document.getElementById('sv-search-clear'),
  filterState:  document.getElementById('sv-filter-estado'),
  sortType:     document.getElementById('sv-sort'),
  btnRefresh:   document.getElementById('sv-btn-refresh'),
  // Alertas
  alertPanel:   document.getElementById('sv-alert-panel'),
  alertCount:   document.getElementById('sv-alert-count'),
  // Modal Edit
  modal:        document.getElementById('modal-editar'),
  formEdit:     document.getElementById('form-editar-servicio'),
  mdlBtnRenovar:document.getElementById('btn-renovar-auto'),
  mdlBtnCancel: document.getElementById('btn-cancelar-modal'),
  mdlBtnClose:  document.getElementById('close-modal'),
  mdlAlertBanner: document.getElementById('modal-alerta-vencido'),
  hintDiasRep:  document.getElementById('hint-dias-restantes')
};

/* ──────────────────────────────────────────────────────────
   BOOTSTRAP PRINCIPAL
────────────────────────────────────────────────────────── */
export function initServicios() {
  _initUIListeners();
  _startSubscriptionsListener();
}

function _initUIListeners() {
  // Listeners de búsqueda y filtrado
  UI.searchBox?.addEventListener('input', () => {
    UI.searchClr.style.display = UI.searchBox.value ? 'flex' : 'none';
    _renderDataGrid();
  });
  UI.searchClr?.addEventListener('click', () => {
    if(UI.searchBox) UI.searchBox.value = '';
    UI.searchClr.style.display = 'none';
    _renderDataGrid();
  });
  
  UI.filterState?.addEventListener('change', _renderDataGrid);
  UI.sortType?.addEventListener('change', _renderDataGrid);

  // Forzar re-cálculo y parpadeo de Icono.
  UI.btnRefresh?.addEventListener('click', () => {
    const icon = document.querySelector('#sv-btn-refresh i');
    if (icon) { icon.style.transition = 'transform .5s'; icon.style.transform = 'rotate(360deg)'; }
    setTimeout(() => { if (icon) icon.style.transform = 'rotate(0deg)'; }, 550);
    _auditAndRender();
  });

  // Modal Bounds
  const closeFn = () => UI.modal?.classList.remove('show');
  UI.mdlBtnClose?.addEventListener('click', closeFn);
  UI.mdlBtnCancel?.addEventListener('click', closeFn);
  UI.modal?.addEventListener('click', e => { if (e.target === UI.modal) closeFn(); });

  // Disparar fecha limite automatica en modal si el input de INICIO cambia
  document.getElementById('edit-inicio')?.addEventListener('change', (e) => {
    const limit = document.getElementById('edit-vencimiento');
    if(limit && e.target.value) {
       const fd = new Date(e.target.value);
       fd.setDate(fd.getDate() + 30);
       limit.value = fd.toISOString().split('T')[0];
       _actualizarHintDiasRestantes();
    }
  });

  document.getElementById('edit-vencimiento')?.addEventListener('change', _actualizarHintDiasRestantes);
}

/* ──────────────────────────────────────────────────────────
   MOTOR LÓGICO: Listener y Auditoría (30 Dias / Vencimientos)
────────────────────────────────────────────────────────── */
function _startSubscriptionsListener() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _renderEstado('loading');

  _unsubscribe = escucharClientes((clientesBase) => {
    _suscripciones = _procesarSuscripciones(clientesBase);
    _auditAndRender();
  });
}

/** 
 * Añade la Metadata necesaria (Fechas calculadas de 30 dias si no existen)
 * a cada cliente leído desde Firebase.
 */
function _procesarSuscripciones(clientes) {
  const hoy = new Date();
  
  return clientes.map(c => {
    let inicio = c.Facturacion_Inicio ? new Date(c.Facturacion_Inicio) : (c.timestamp ? new Date(c.timestamp) : new Date());
    let limite = c.Facturacion_Limite ? new Date(c.Facturacion_Limite) : new Date(inicio.getTime() + (30 * 24*60*60*1000));
    
    // Distancia Matemática
    const msRestantes = limite.getTime() - hoy.getTime();
    const diasRestantes = Math.ceil(msRestantes / (1000*60*60*24));
    
    // Etiquetas de Cálculo
    let calcStatus = 'activo';
    if(diasRestantes <= 0) calcStatus = 'vencido';
    else if(diasRestantes <= DIAS_ALERTA) calcStatus = 'porvencer';

    return {
      ...c,
      _dtInicio: inicio,
      _dtLimite: limite,
      _diasRest: diasRestantes,
      _calcStatus: calcStatus
    };
  });
}

/**
 * Recorre la base calculada y fuerza DESACTIVACIONES a Firebase si detectó clientes caídos
 * que sigan marcados como "Activos" en la nube. Luego renderiza el Grid.
 */
async function _auditAndRender() {
  // 1. Auditoría auto-desactivación
  _auditStats.vencidosDesactivadosHoy = 0;
  
  for (const sub of _suscripciones) {
    if (sub._calcStatus === 'vencido' && (sub.Estado || 'activo') === 'activo') {
      try {
        console.warn(`[Auditoría]: El servicio de ${sub.Nombre} expiró. Desactivando suscripción.`);
        await actualizarCliente(sub.id, { Estado: 'inactivo' }); // Firebase trigger loop again.
        _auditStats.vencidosDesactivadosHoy++;
      } catch (e) {
         console.error(`Fallo auto-desactivando a ${sub.id}`);
      }
    }
  }

  // 2. Proyectar Alertas a UI si hubo auto-kills
  if (_auditStats.vencidosDesactivadosHoy > 0 && UI.alertPanel) {
    UI.alertCount.textContent = _auditStats.vencidosDesactivadosHoy;
    UI.alertPanel.style.display = 'flex';
  } else if(UI.alertPanel) {
    UI.alertPanel.style.display = 'none';
  }

  // 3. Pintar DOM
  _updateDashboardStats();
  _renderDataGrid();
}

/* ──────────────────────────────────────────────────────────
   CALCULADORA DE ESTADÍSTICAS
────────────────────────────────────────────────────────── */
function _updateDashboardStats() {
  let activos = 0, porVencer = 0, vencidos = 0, renovados = 0, nuevos = 0, maint = 0;
  const hoy = new Date();

  _suscripciones.forEach(s => {
    // Lectura cruda de Firebase (Lo que rige)
    const fbEstado = (s.Estado || 'activo').toLowerCase();
    
    if (fbEstado === 'mantenimiento') maint++;
    else if (fbEstado === 'inactivo' || s._calcStatus === 'vencido') vencidos++;
    else if (s._calcStatus === 'porvencer') porVencer++;
    else activos++;

    // Nuevos en el mes (Timestamp)
    if(s.timestamp) {
      const ts = new Date(s.timestamp);
      if(ts.getMonth() === hoy.getMonth() && ts.getFullYear() === hoy.getFullYear()) nuevos++;
    }

    // Renovados en el mes (Ultima Actualización que modificó Facturación) -> Aproximado
    if(s.Facturacion_Inicio) {
      const upd = new Date(s.Facturacion_Inicio);
      // Es una renovación del mes en curso pero que NO es igual a su mes de creacion original para contar ambas?
      // O simplemente "Inicios re-firmados este mes"
      if(upd.getMonth() === hoy.getMonth() && upd.getFullYear() === hoy.getFullYear()) renovados++;
    }
  });

  if(UI.stTotal) UI.stTotal.textContent = _suscripciones.length;
  if(UI.stActivos) UI.stActivos.textContent = activos;
  if(UI.stPorVencer) UI.stPorVencer.textContent = porVencer;
  if(UI.stVencidos) UI.stVencidos.textContent = vencidos;
  if(UI.stMant) UI.stMant.textContent = maint;
  if(UI.stNuevos) UI.stNuevos.textContent = nuevos;
  if(UI.stRenov) UI.stRenov.textContent = renovados;
  
  if(UI.countBadge) UI.countBadge.textContent = _suscripciones.length;
}

/* ──────────────────────────────────────────────────────────
   PINTAR TABLA GLASSMORPHISM (Table-to-Cards)
────────────────────────────────────────────────────────── */
function _renderDataGrid() {
  if (!UI.tbody) return;

  const queryRaw = (UI.searchBox?.value || '').toLowerCase();
  const filterEs = UI.filterState?.value || '';
  const sortTyp  = UI.sortType?.value || 'vencimiento-asc';

  // Filtrado
  let procesados = _suscripciones.filter(s => {
    // Filto Query (Nombre, ID, Tel, Empresa)
    if(queryRaw) {
      const matchScope = `#${s.cliente_id} ${s.Nombre} ${s.Negocio} ${s.Token}`.toLowerCase();
      if(!matchScope.includes(queryRaw)) return false;
    }
    // Filtro Estado Selectbox
    if(filterEs) {
      const fbE = (s.Estado || 'activo').toLowerCase();
      if(filterEs === 'activo' && (fbE !== 'activo' || s._calcStatus === 'vencido')) return false;
      if(filterEs === 'inactivo' && (fbE !== 'inactivo' && s._calcStatus !== 'vencido')) return false;
      if(filterEs === 'mantenimiento' && fbE !== 'mantenimiento') return false;
      if(filterEs === 'porvencer' && s._calcStatus !== 'porvencer') return false;
    }
    return true;
  });

  // Ordenamiento
  procesados.sort((a,b) => {
    switch(sortTyp) {
      case 'vencimiento-asc': return a._dtLimite.getTime() - b._dtLimite.getTime();
      case 'vencimiento-desc': return b._dtLimite.getTime() - a._dtLimite.getTime();
      case 'id-asc': return (a.cliente_id||0) - (b.cliente_id||0);
      case 'nombre-asc': return (a.Nombre||'').localeCompare(b.Nombre||'');
      default: return 0;
    }
  });

  // Pintar DOM
  UI.tbody.innerHTML = '';
  if (UI.resultCount) UI.resultCount.textContent = `Mostrando ${procesados.length} asignaciones`;

  if(procesados.length === 0) {
    _renderEstado(queryRaw || filterEs ? 'no-results' : 'empty');
    return;
  }

  const fragment = document.createDocumentFragment();
  procesados.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = _domBuildRow(s);
    fragment.appendChild(tr);
  });
  
  UI.tbody.appendChild(fragment);

  // Vincular Modal Openers en esta tabla viva
  _bindActionsDOM(procesados);
}

function _domBuildRow(s) {
  const customId = s.cliente_id !== undefined ? `#${s.cliente_id}` : '—';
  const realStatus = (s.Estado || 'activo').toLowerCase();
  const dInicioStr = s._dtInicio.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  const dLimiteStr = s._dtLimite.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  
  let labelEstado = 'Operativo'; let bgClass = 'activo'; let icon = 'bi-check-all';
  let isVencida = false;
  let avaClass = '';

  if (realStatus === 'mantenimiento') {
    labelEstado = 'Mantenimiento'; bgClass = 'mantenimiento'; icon = 'bi-tools';
  } else if (realStatus === 'inactivo' || s._calcStatus === 'vencido') {
    labelEstado = s._calcStatus === 'vencido' ? 'Vencida' : 'Inactiva'; 
    bgClass = 'inactivo'; icon = 'bi-ban'; isVencida = true; avaClass = 'vencido';
  } else if (s._calcStatus === 'porvencer') {
    labelEstado = 'Vence Pronto'; bgClass = 'porvencer'; icon = 'bi-exclamation-circle';
  }

  const ini = s.Nombre ? s.Nombre.substring(0, 2).toUpperCase() : '??';

  let diasSpan = `<span class="sv-date-sub sv-date-danger">Corte forzado o expirado</span>`;
  if(!isVencida) {
     diasSpan = `<span class="sv-date-sub ${s._calcStatus==='porvencer'?'sv-date-warn':''}"><i class="bi bi-hourglass-bottom"></i> ${s._diasRest} días restantes</span>`;
  }

  return `
    <td data-label="ID">
      <span class="sv-id-badge">${customId}</span>
    </td>
    <td data-label="Cartera / Titular">
      <div class="sv-td-user">
        <div class="sv-avatar ${avaClass}">${ini}</div>
        <div class="sv-user-data">
          <span class="sv-user-name">${s.Nombre || '—'}</span>
          <span class="sv-user-bzl">${s.Negocio || '—'}</span>
        </div>
      </div>
    </td>
    <td data-label="Vigencia">
      <div class="sv-date-group">
        <span class="sv-date-main">${dInicioStr}</span>
        <span class="sv-date-sub"><i class="bi bi-wallet2"></i> Ciclo Iniciado</span>
      </div>
    </td>
    <td data-label="Vencimiento">
      <div class="sv-date-group">
        <span class="sv-date-main">${dLimiteStr}</span>
        ${diasSpan}
      </div>
    </td>
    <td data-label="Estado Sistema">
      <span class="sv-status ${bgClass}"><i class="bi ${icon}"></i> ${labelEstado}</span>
    </td>
    <td data-label="Soporte">
      <div class="sv-actions">
        <button class="sv-action-btn edit sv-open-edit" data-id="${s.id}" title="Gestionar / Renovar">
          <i class="bi bi-gear-wide-connected"></i>
        </button>
      </div>
    </td>
  `;
}

function _renderEstado(tipo) {
  if (!UI.tbody) return;
  const msgs = {
    loading:    '<i class="bi bi-hourglass-split sv-spin"></i> Auditando cuentas de suscripción…',
    empty:      '<i class="bi bi-folder-x" style="font-size:2rem;display:block;margin-bottom:8px;"></i>No hay clientes integrados al clúster de Servicios.',
    'no-results': '<i class="bi bi-search"></i> Los filtros no retornaron asignaciones vigentes.',
  };
  UI.tbody.innerHTML = `<tr><td colspan="6" class="sv-empty-state">${msgs[tipo] || ''}</td></tr>`;
}

/* ──────────────────────────────────────────────────────────
   MODAL: EDICIÓN Y RENOVACIÓN
────────────────────────────────────────────────────────── */
function _bindActionsDOM(coleccion) {
  const btns = document.querySelectorAll('.sv-open-edit');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = coleccion.find(x => x.id === id);
      if(target) _openEditorContext(target);
    });
  });
}

function _openEditorContext(clienteObj) {
  UI.modal.dataset.currentId = clienteObj.id; // Recordar objetivo

  // Set Inputs Básicos
  document.getElementById('edit-nombre').value = clienteObj.Nombre || '';
  document.getElementById('edit-numero').value = clienteObj.Numero || '';
  document.getElementById('edit-estado').value = (clienteObj.Estado || 'activo').toLowerCase();

  // Set Fechas YYYY-MM-DD (para input date)
  const pad = (n) => n.toString().padStart(2, '0');
  const dIni = clienteObj._dtInicio;
  const dLim = clienteObj._dtLimite;
  
  document.getElementById('edit-inicio').value = `${dIni.getFullYear()}-${pad(dIni.getMonth()+1)}-${pad(dIni.getDate())}`;
  document.getElementById('edit-vencimiento').value = `${dLim.getFullYear()}-${pad(dLim.getMonth()+1)}-${pad(dLim.getDate())}`;

  _actualizarHintDiasRestantes();

  // Advertencia de Vencido
  if(clienteObj._calcStatus === 'vencido' || (clienteObj.Estado||'').toLowerCase() === 'inactivo') {
      UI.mdlAlertBanner.style.display = 'flex';
  } else {
      UI.mdlAlertBanner.style.display = 'none';
  }

  // Prevenir Listeners Acumulativos clonando form central
  const form = UI.formEdit;
  const fresh = form.cloneNode(true);
  form.parentNode.replaceChild(fresh, form);
  UI.formEdit = fresh; // Actualizar ref
  
  // Re-bind listeners de auto calculo
  document.getElementById('edit-inicio')?.addEventListener('change', (e) => {
    const limit = document.getElementById('edit-vencimiento');
    if(limit && e.target.value) {
       const fd = new Date(e.target.value); fd.setDate(fd.getDate() + 30);
       limit.value = fd.toISOString().split('T')[0];
       _actualizarHintDiasRestantes();
    }
  });
  document.getElementById('edit-vencimiento')?.addEventListener('change', _actualizarHintDiasRestantes);

  // Re-bind BOTONES del form clonado
  const btnRenew = document.getElementById('btn-renovar-auto');
  const btnSave  = document.getElementById('btn-guardar-modal');
  const btnCll   = document.getElementById('btn-cancelar-modal');
  const closeFn = () => UI.modal.classList.remove('show');
  
  btnCll?.addEventListener('click', closeFn);

  // ---- Boton Renovar (One Click) ----
  btnRenew?.addEventListener('click', () => {
    const inpIni = document.getElementById('edit-inicio');
    const inpLim = document.getElementById('edit-vencimiento');
    const inpEst = document.getElementById('edit-estado');
    
    // Al renovar, el inicio es HOY, el vencimiento es en 30 Días y Estado Activo
    const fd = new Date();
    inpIni.value = `${fd.getFullYear()}-${pad(fd.getMonth()+1)}-${pad(fd.getDate())}`;
    fd.setDate(fd.getDate() + 30);
    inpLim.value = `${fd.getFullYear()}-${pad(fd.getMonth()+1)}-${pad(fd.getDate())}`;
    inpEst.value = 'activo';
    
    UI.mdlAlertBanner.style.display = 'none';
    _actualizarHintDiasRestantes();
    PhoenixToast.fire({ icon: 'info', title: 'Fechas extendidas +30 Días' });
  });

  // ---- SAVE A FIREBASE ----
  UI.formEdit.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(btnSave) { btnSave.disabled=true; btnSave.innerHTML='<i class="bi bi-hourglass-split sv-spin"></i> Proyectando...';}

    const dInicioT = document.getElementById('edit-inicio').value;
    const dLimiteT = document.getElementById('edit-vencimiento').value;

    const targetPayload = {
      Nombre:             document.getElementById('edit-nombre').value,
      Numero:             document.getElementById('edit-numero').value,
      Estado:             document.getElementById('edit-estado').value,
      Facturacion_Inicio: dInicioT ? new Date(dInicioT).toISOString() : clienteObj._dtInicio.toISOString(),
      Facturacion_Limite: dLimiteT ? new Date(dLimiteT + 'T23:59:59').toISOString() : clienteObj._dtLimite.toISOString()  // Vence al final de ese dia
    };

    try {
      await actualizarCliente(clienteObj.id, targetPayload);
      closeFn();
      PhoenixToast.fire({ icon: 'success', iconColor: '#516BEB', title: 'Suscriptor actualizado con éxito.' });
    } catch(err) {
      if(btnSave) { btnSave.disabled=false; btnSave.innerHTML='<i class="bi bi-check2-all"></i> Aplicar al Sistema';}
      Phoenix.fire({ icon: 'error', iconColor: '#FF4D4D', title: 'Error de Red' });
    }
  });

  // Finally show modal
  UI.modal.classList.add('show');
}

function _actualizarHintDiasRestantes() {
  const hp = document.getElementById('hint-dias-restantes');
  const dVal = document.getElementById('edit-vencimiento')?.value;
  if(hp && dVal) {
     const lim = new Date(dVal);
     const hoy = new Date();
     const mss = lim.getTime() - hoy.getTime();
     const dr = Math.ceil(mss / (1000*60*60*24));

     if(dr < 0) { hp.innerHTML = `<span style="color:var(--red); font-weight:700;">El servicio expiró hace ${Math.abs(dr)} días.</span>`; }
     else if(dr === 0) { hp.innerHTML = `<span style="color:var(--yellow); font-weight:700;">Expira HOY a la medianoche.</span>`; }
     else { hp.innerHTML = `<i class="bi bi-stopwatch"></i> Límite de operación: <strong>${dr} días naturales.</strong>`; }
  }
}
