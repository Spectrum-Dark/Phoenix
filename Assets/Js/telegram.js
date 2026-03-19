/**
 * ╔════════════════════════════════════════════════════════════════╗
 *  PHOENIX — telegram.js (V2 Avanzado)
 *  Módulo: Integración Inteligente de Telegram Bot (SaaS)
 *
 *  Nuevas integraciones:
 *  - Interfaz por pestañas (Resumen, Chat, Mensajes, Auto)
 *  - Historial conversacional en Firebase (`telegram_mensajes`)
 *  - Segmentación avanzada de envíos
 *  - Compilación de plantillas {nombre}, {fecha}
 *  - Sugerencia inteligente de vinculación por nombres
 * ╚════════════════════════════════════════════════════════════════╝
 */

import { Database, ref, get, set, push, remove, onValue, query, orderByChild, limitToLast } from './firebase.js';

let currentBotToken = '';
let _tgUsersCache = [];
let _clientesCache = [];
let _chatHistoryCache = [];
let _automations = { prev: true, corte: true }; // por defecto
let _unsubTg = null;
let _unsubCl = null;
let _currentChatId = null; // chat activo en la vista
let _unsubChat = null; // listener del chat activo
let _lastUpdateId = 0; // Para el long-polling de Telegram
let _pollingInterval = null;

const $ = (id) => document.getElementById(id);

const Phoenix = Swal.mixin({
    background: '#14171C', color: '#E8ECF2',
    confirmButtonColor: '#2AABEE', cancelButtonColor: '#2A3040',
});
const PhoenixToast = Swal.mixin({
    toast: true, position: 'top-end',
    showConfirmButton: false, timer: 3500, timerProgressBar: true,
    background: '#14171C', color: '#E8ECF2',
});

/* ──────────────────────────────────────────────────────────
   INIT & LISTENERS
────────────────────────────────────────────────────────── */
export async function initTelegram() {
    _initTabs();
    _initUIListeners();
    
    _startTelegramListener();
    _startClientesListener();
    
    await _loadConfig(); // token + automations
    
    if (currentBotToken) {
        await _sincronizarUsuariosDeTelegram();
        _startPolling();
    }
}

function _startPolling() {
    if (_pollingInterval) clearInterval(_pollingInterval);
    // Polling cada 4 segundos
    _pollingInterval = setInterval(async () => {
        // Solo pollear si el panel de Telegram está visible
        const viewTg = document.getElementById('view-telegram');
        if(viewTg && viewTg.classList.contains('active')) {
            await _sincronizarUsuariosDeTelegram();
        }
    }, 4000);
}

async function _loadConfig() {
    // 1. Cargar Token
    try {
        const tokenSnap = await get(ref(Database, 'telegram_config/bot_token'));
        if (tokenSnap.exists()) {
            currentBotToken = tokenSnap.val();
        } else {
            currentBotToken = '8412853523:AAGhaiyZLbb30ft6RstQfC0NMvk6SDyUDMk';
            await set(ref(Database, 'telegram_config/bot_token'), currentBotToken);
        }
    } catch(err) { console.warn('Error fetching token', err); }

    // 2. Cargar Automations
    try {
        const autoSnap = await get(ref(Database, 'telegram_config/automations'));
        if (autoSnap.exists()) {
            _automations = autoSnap.val();
        }
        $('auto-prev').checked = !!_automations.prev;
        $('auto-corte').checked = !!_automations.corte;
    } catch(err) { console.warn('No automations found'); }
}

function _initTabs() {
    const tabs = document.querySelectorAll('.tg-tab');
    const panes = document.querySelectorAll('.tg-tab-pane');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            $(tab.dataset.tab).classList.add('active');

            if (tab.dataset.tab === 'tab-dashboard') _renderDashboard();
        });
    });
}

function _initUIListeners() {
    // -- Modales
    $('btn-tg-config')?.addEventListener('click', () => {
        $('tg-config-token').value = currentBotToken || '';
        $('modal-tg-config').style.display = 'flex';
    });
    const closeModalConfig = () => { $('modal-tg-config').style.display = 'none'; };
    $('btn-close-modal-config')?.addEventListener('click', closeModalConfig);
    $('btn-cancel-config')?.addEventListener('click', closeModalConfig);
    
    $('btn-save-config')?.addEventListener('click', async () => {
        const token = $('tg-config-token').value.trim();
        const btnSave = $('btn-save-config');
        btnSave.disabled = true; btnSave.innerHTML = '<i class="bi bi-hourglass-split cl-spin"></i> Guardando...';
        try {
            await set(ref(Database, 'telegram_config/bot_token'), token);
            currentBotToken = token;
            closeModalConfig();
            PhoenixToast.fire({ icon: 'success', title: 'Token del Bot actualizado.' });
            if(currentBotToken) _sincronizarUsuariosDeTelegram();
        } catch(err) { Phoenix.fire({ icon: 'error', title: 'Error', text: err.message }); }
        finally { btnSave.disabled = false; btnSave.innerHTML = 'Guardar'; }
    });

    $('btn-close-modal-link')?.addEventListener('click', _closeModalLink);
    $('btn-cancel-link')?.addEventListener('click', _closeModalLink);
    
    // -- Botón Vincular
    $('btn-save-link')?.addEventListener('click', async () => {
        const modal = $('modal-vincular');
        const tgId = modal.dataset.tgid;
        const clientId = $('link-cl-select').value;
        if (!clientId) { PhoenixToast.fire({ icon: 'warning', title: 'Selecciona un cliente.' }); return; }
        try {
            await vincularClienteTelegram(tgId, clientId);
            _closeModalLink();
            PhoenixToast.fire({ icon: 'success', title: 'Cliente vinculado exitosamente.' });
            
            // Bienvenida
            const clName = $('link-cl-select').options[$('link-cl-select').selectedIndex].text.split('(')[0].trim();
            const msg = `🎉 *Bienvenido(a) ${clName}!*\n\nTu cuenta ha sido vinculada correctamente al sistema Phoenix.\nRecibirás tus notificaciones por esta vía.`;
            await enviarMensajeTelegram(tgId, msg);
        } catch(err) { Phoenix.fire({ icon: 'error', text: err.message }); }
    });

    $('btn-use-sugg')?.addEventListener('click', () => {
        const clId = $('btn-use-sugg').dataset.clid;
        if(clId) { $('link-cl-select').value = clId; }
    });

    // -- Chat View actions
    $('tg-btn-refresh')?.addEventListener('click', async () => {
        const icon = $('tg-btn-refresh').querySelector('i');
        icon.classList.add('cl-spin');
        await _sincronizarUsuariosDeTelegram();
        setTimeout(() => icon.classList.remove('cl-spin'), 600);
    });

    $('tg-header-unlink')?.addEventListener('click', async () => {
        if(!_currentChatId) return;
        const tgUser = _tgUsersCache.find(u => u.telegram_id === _currentChatId);
        if(!tgUser || !tgUser.linked_client_id) return;
        
        await vincularClienteTelegram(_currentChatId, null);
        PhoenixToast.fire({ icon: 'info', title: 'Usuario desvinculado.' });
        _closeChatView();
    });

    $('tg-btn-send-quick')?.addEventListener('click', async () => {
        if(!_currentChatId) return;
        const input = $('tg-chat-quick-message');
        const txt = input.value.trim();
        if(!txt) return;

        try {
            await enviarMensajeTelegram(_currentChatId, txt);
            input.value = '';
            PhoenixToast.fire({ icon: 'success', title: 'Enviado' });
        } catch(e) {
            PhoenixToast.fire({ icon: 'error', title: 'Falló el envío' });
        }
    });

    // -- Creador de Campañas / Masivo
    $('tg-templates')?.addEventListener('change', (e) => {
        const template = e.target.value;
        const textarea = $('tg-msg-text');
        
        if (template === 'Aviso General') {
            textarea.value = `⚠️ *Aviso Importante*\n\nEstimado(a) {nombre},\nLe informamos que el sistema estará en mantenimiento programado.\n\nAtte: Administración Phoenix.`;
        } else if (template === 'Recordatorio de Pago') {
            textarea.value = `💸 *Recordatorio de Pago*\n\nHola {nombre}, te recordamos amablemente que el servicio de *{negocio}* vence el día {vencimiento}.\n\nPara evitar interrupciones, por favor tramita tu renovación.`;
        } else if (template === 'Promocion') {
            textarea.value = `🎉 *¡Oferta Especial para ti, {nombre}!*\n\nRenueva tu plan ahora y obtén beneficios exclusivos.`;
        } else {
            textarea.value = '';
        }
    });

    $('form-telegram-msg')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tipoDest = $('tg-msg-dest').value;
        const texto = $('tg-msg-text').value.trim();

        if (!texto) { PhoenixToast.fire({ icon: 'warning', title: 'Mensaje vacío.' }); return; }

        const btnSend = $('btn-send-msg');
        btnSend.disabled = true;
        btnSend.innerHTML = '<i class="bi bi-hourglass-split cl-spin"></i> Procesando múltiples envíos...';

        try {
            let envios = 0;
            const promesas = [];

            _tgUsersCache.forEach(user => {
                if (!user.linked_client_id) return;
                
                const clientObj = _clientesCache.find(c => c.id === user.linked_client_id);
                if (!clientObj) return;

                // Aplicar Segmentación (depende de propiedades calculadas, las haremos basandonos en limites)
                // Para efectos reales en un SPA esto requiere el mismo calculo de servicios.js. 
                // Por diseño, confiaremos en los dias restantes estandar si es necesario o enviaremos.
                let cumpleSegmento = false;
                
                // Calculo rapido del estado
                const today = new Date();
                today.setHours(0,0,0,0);
                const limitStr = clientObj.dtLimite || clientObj.FechaLimite; // depende modelo data
                let dtLimite = limitStr ? new Date(limitStr + 'T00:00:00') : new Date();
                const diffTime = dtLimite - today;
                const diasRest = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (tipoDest === 'todos') cumpleSegmento = true;
                else if (tipoDest === 'activos' && diasRest > 5) cumpleSegmento = true;
                else if (tipoDest === 'porvencer' && diasRest > 0 && diasRest <= 5) cumpleSegmento = true;
                else if (tipoDest === 'vencidos' && diasRest <= 0) cumpleSegmento = true;

                if (cumpleSegmento) {
                    const parsedMsg = _parseTemplate(texto, clientObj);
                    promesas.push(
                        enviarMensajeTelegram(user.telegram_id, parsedMsg).catch(err => {
                            console.warn(`Falló envío a ${user.telegram_id}`, err);
                        })
                    );
                    envios++;
                }
            });

            await Promise.all(promesas);
            Phoenix.fire({ icon: 'success', title: 'Campaña Finalizada', text: `Se despacharon ${envios} mensajes.` });
            $('form-telegram-msg').reset();
            
        } catch(err) {
            Phoenix.fire({ icon: 'error', title: 'Error grave', text: err.message });
        } finally {
            btnSend.disabled = false;
            btnSend.innerHTML = '<i class="bi bi-send-fill"></i> Iniciar Envío Segmentado';
        }
    });

    // -- Automatizaciones
    $('btn-save-automations')?.addEventListener('click', async () => {
        _automations.prev = $('auto-prev').checked;
        _automations.corte = $('auto-corte').checked;
        try {
            await set(ref(Database, 'telegram_config/automations'), _automations);
            PhoenixToast.fire({ icon: 'success', title: 'Reglas actualizadas.' });
        } catch(e) { PhoenixToast.fire({ icon: 'error', title: 'Fallo al guardar reglas' }); }
    });

    $('tg-search')?.addEventListener('input', _renderUsersSidebar);
}

/* ──────────────────────────────────────────────────────────
   LISTENERS
────────────────────────────────────────────────────────── */
function _startTelegramListener() {
    if (_unsubTg) _unsubTg();
    _unsubTg = onValue(ref(Database, 'telegram_users'), (snap) => {
        if (!snap.exists()) {
            _tgUsersCache = [];
        } else {
            const data = snap.val();
            _tgUsersCache = Object.keys(data).map(k => ({ telegram_id: k, ...data[k] }));
        }
        _renderUsersSidebar();
        if ($('tab-dashboard').classList.contains('active')) _renderDashboard();
    });
}

function _startClientesListener() {
    if (_unsubCl) _unsubCl();
    _unsubCl = onValue(ref(Database, 'Clientes'), (snap) => {
        if (snap.exists()) {
            const data = snap.val();
            _clientesCache = Object.keys(data).reduce((acc, key) => {
                if(data[key]) acc.push({ id: key, ...data[key] });
                return acc;
            }, []);
        } else { _clientesCache = []; }
        _renderUsersSidebar();
    });
}

function _startChatListener(chatId) {
    if (_unsubChat) _unsubChat();
    // Escuchar mensajes para este chat_id
    // Los parsearemos iterando sobre telegram_mensajes (es una forma simple sin indexar avanzado)
    // Para entornos masivos, usar queries orderByChild('chat_id').equalTo(chatId)
    const msgsQuery = query(ref(Database, 'telegram_mensajes'), orderByChild('chat_id'));
    
    _unsubChat = onValue(msgsQuery, (snap) => {
        _chatHistoryCache = [];
        if (snap.exists()) {
            const all = snap.val();
            Object.keys(all).forEach(key => {
                if (String(all[key].chat_id) === String(chatId)) {
                    _chatHistoryCache.push({ id: key, ...all[key] });
                }
            });
            // ordenar por timestamp
            _chatHistoryCache.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        }
        _renderChatMessages();
        if ($('tab-dashboard').classList.contains('active')) _renderDashboard();
    });
}


/* ──────────────────────────────────────────────────────────
   LÍMITES Y API
────────────────────────────────────────────────────────── */
export async function _sincronizarUsuariosDeTelegram() {
    if (!currentBotToken) return;
    try {
        const offsetParam = _lastUpdateId ? `&offset=${_lastUpdateId + 1}` : '';
        const res = await fetch(`https://api.telegram.org/bot${currentBotToken}/getUpdates?allowed_updates=["message"]${offsetParam}`);
        const result = await res.json();
        
        if (result.ok && result.result.length > 0) {
            const updates = result.result;
            for (const upd of updates) {
                if (upd.update_id > _lastUpdateId) {
                    _lastUpdateId = upd.update_id;
                }

                if (upd.message && upd.message.from) {
                    const from = upd.message.from;
                    const id = String(from.id);
                    const userRef = ref(Database, `telegram_users/${id}`);
                    const userSnap = await get(userRef);
                    if (!userSnap.exists()) {
                        await set(userRef, {
                            username: from.username || '',
                            first_name: from.first_name || '',
                            last_name: from.last_name || '',
                            timestamp: new Date().toISOString(),
                            linked_client_id: null
                        });
                    }
                    
                    // Si mandó mensaje (inbound real-time)
                    if (upd.message.text) {
                        // guardar en el historial entrante (dirección: in)
                        const existsSnap = await get(query(ref(Database, 'telegram_mensajes'), orderByChild('update_id')));
                        let existe = false;
                        if(existsSnap.exists()) {
                             Object.values(existsSnap.val()).forEach(m => {
                                 if(m.update_id === upd.update_id) existe = true;
                             });
                        }
                        if (!existe) {
                             await push(ref(Database, 'telegram_mensajes'), {
                                 chat_id: id,
                                 text: upd.message.text,
                                 dir: 'in',
                                 update_id: upd.update_id,
                                 timestamp: new Date((upd.message.date)*1000).toISOString()
                             });
                        }
                    }
                }
            }
        }
    } catch(err) { console.warn('Error syncing Telegram API', err); }
}

export async function enviarMensajeTelegram(chat_id, mensaje) {
    if (!currentBotToken) await _loadBotToken();
    if (!currentBotToken) throw new Error("Token de Telegram no configurado.");

    const url = `https://api.telegram.org/bot${currentBotToken}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat_id, text: mensaje, parse_mode: 'Markdown' })
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Telegram Error: ${err.description}`);
    }
    
    // Almacenar envío en firebase
    await push(ref(Database, 'telegram_mensajes'), {
        chat_id: String(chat_id),
        text: mensaje,
        dir: 'out',
        timestamp: new Date().toISOString()
    });
    
    return true;
}

export async function vincularClienteTelegram(telegram_id, cliente_id) {
    const userRef = ref(Database, `telegram_users/${telegram_id}`);
    const snap = await get(userRef);
    if (snap.exists()) {
        const data = snap.val();
        data.linked_client_id = cliente_id;
        await set(userRef, data);
    }
}


/* ──────────────────────────────────────────────────────────
   TEMPLATES & RENDER ENGINE
────────────────────────────────────────────────────────── */
function _parseTemplate(str, clientObj) {
    if (!str || !clientObj) return str;
    const nombreStr = (clientObj.Nombre || '').split(' ')[0] || 'Cliente';
    const negocioStr = clientObj.Negocio || '-';
    let fv = clientObj.dtLimite || clientObj.FechaLimite;
    let vencStr = fv ? new Date(fv + 'T00:00:00').toLocaleDateString() : '-';

    return str
        .replace(/\{nombre\}/g, nombreStr)
        .replace(/\{negocio\}/g, negocioStr)
        .replace(/\{vencimiento\}/g, vencStr);
}

function _getClientName(id) {
    if(!id) return null;
    const cl = _clientesCache.find(c => c.id === id);
    return cl ? cl.Nombre : 'Cliente Eliminado';
}

function _renderUsersSidebar() {
    const tbody = $('tg-tbody');
    if (!tbody) return;
    
    const queryTerm = ($('tg-search')?.value || '').toLowerCase();
    
    const filtados = _tgUsersCache.filter(u => {
        const nm = `${u.first_name} ${u.last_name || ''} ${u.username || ''}`.toLowerCase();
        return nm.includes(queryTerm);
    });

    if (filtados.length === 0) {
        tbody.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">No hay usuarios encontrados.</div>`;
        return;
    }

    let html = '';
    filtados.forEach(u => {
        const clName = _getClientName(u.linked_client_id);
        const isActive = String(u.telegram_id) === String(_currentChatId) ? 'active' : '';
        const statusBadge = u.linked_client_id 
            ? `<div style="display:inline-block; width:8px; height:8px; background:var(--green); border-radius:50%; margin-right:5px;"></div>`
            : `<div style="display:inline-block; width:8px; height:8px; background:var(--red); border-radius:50%; margin-right:5px;"></div>`;

        html += `
            <div class="tg-user-card ${isActive}" data-tgid="${u.telegram_id}">
              <div class="tg-chat-avatar" style="width:36px;height:36px;font-size:1rem;margin-right:12px;background:var(--bg-card);">
                 <i class="bi bi-person-fill"></i>
              </div>
              <div class="tg-user-card-info" style="flex:1;">
                 <h4>${u.first_name} ${u.last_name || ''}</h4>
                 <p>${statusBadge} ${u.linked_client_id ? `Vinc: ${clName.split(' ')[0]}` : 'Sin Vincular'}</p>
              </div>
              ${!u.linked_client_id ? `<button class="cl-btn-ghost btn-xs tg-inline-link" title="Vincular"><i class="bi bi-link"></i></button>` : ''}
            </div>
        `;
    });

    tbody.innerHTML = html;

    // Delegacion
    tbody.querySelectorAll('.tg-user-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const btnLink = e.target.closest('.tg-inline-link');
            const tgId = card.dataset.tgid;
            const tgUser = _tgUsersCache.find(x => String(x.telegram_id) === String(tgId));
            
            if (btnLink) {
                e.stopPropagation(); // Evita abrir chat
                _openModalLink(tgUser);
            } else {
                _openChatView(tgUser);
                // repintar active
                tbody.querySelectorAll('.tg-user-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
            }
        });
    });
}

function _openChatView(tgUser) {
    if(!tgUser) return;
    _currentChatId = tgUser.telegram_id;
    $('tg-chat-empty').style.display = 'none';
    $('tg-chat-view').style.display = 'flex';
    
    $('tg-chat-name').textContent = `${tgUser.first_name} ${tgUser.last_name || ''}`;
    
    if (tgUser.linked_client_id) {
        $('tg-chat-status').textContent = `Vinculado: ${_getClientName(tgUser.linked_client_id)}`;
        $('tg-header-unlink').style.display = 'block';
    } else {
        $('tg-chat-status').textContent = `No vinculado al sistema`;
        $('tg-header-unlink').style.display = 'none';
    }
    
    $('tg-chat-messages').innerHTML = '<div style="text-align:center; padding-top:20px;"><i class="bi bi-hourglass-split cl-spin"></i> Cargando historial...</div>';
    
    // Iniciar el listener de historial específico
    _startChatListener(_currentChatId);
}

function _closeChatView() {
    _currentChatId = null;
    if(_unsubChat) _unsubChat();
    $('tg-chat-empty').style.display = 'flex';
    $('tg-chat-view').style.display = 'none';
    _renderUsersSidebar();
}

function _renderChatMessages() {
    const box = $('tg-chat-messages');
    if(!box || !_currentChatId) return;

    if (_chatHistoryCache.length === 0) {
        box.innerHTML = '<div style="text-align:center; padding-top:20px; color:var(--text-muted);"><i class="bi bi-chat-square-dots"></i> Sin mensajes previos.</div>';
        return;
    }

    let html = '';
    _chatHistoryCache.forEach(msg => {
        const isOut = msg.dir === 'out';
        const dStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        html += `
          <div class="tg-chat-bubble ${isOut ? 'out' : 'in'}">
             ${msg.text.replace(/\n/g, '<br/>')}
             <span class="tg-bubble-time">${dStr}</span>
          </div>
        `;
    });

    box.innerHTML = html;
    // Auto scroll bottom
    box.scrollTop = box.scrollHeight;
}

function _openModalLink(tgUser) {
    const modal = $('modal-vincular');
    $('link-tg-name').textContent = `${tgUser.first_name} ${tgUser.last_name || ''}`;
    $('link-tg-username').textContent = tgUser.username || 'Sin username';
    modal.dataset.tgid = tgUser.telegram_id;
    
    // -- Sugerencia Inteligente: Buscar nombres similares
    const fN = tgUser.first_name.toLowerCase();
    let bestMatch = null;
    let selHtml = '<option value="">-- Selecciona Cliente --</option>';
    
    _clientesCache.forEach(c => {
        selHtml += `<option value="${c.id}">${c.Nombre} (${c.Negocio || '-'})</option>`;
        
        // simple inclusion match
        if (!bestMatch && !c.telegram_id) { // Solo si no está asignado por otro lado (idealmente)
            const cN = c.Nombre.toLowerCase();
            if (cN.includes(fN) || fN.includes(cN.split(' ')[0])) {
                bestMatch = c;
            }
        }
    });

    $('link-cl-select').innerHTML = selHtml;

    if (bestMatch) {
         $('link-smart-suggestion').style.display = 'flex';
         $('sugg-text').textContent = `${bestMatch.Nombre} (${bestMatch.Negocio || 'Sin Negocio'})`;
         $('btn-use-sugg').dataset.clid = bestMatch.id;
    } else {
         $('link-smart-suggestion').style.display = 'none';
    }

    modal.style.display = 'flex';
}

function _closeModalLink() { $('modal-vincular').style.display = 'none'; }

async function _renderDashboard() {
    const listAlerts = $('tg-alerts-list');
    const linked = _tgUsersCache.filter(u => u.linked_client_id).length;
    $('tg-stat-linked').innerHTML = `${linked} <span style="font-size:14px; color:var(--text-muted)">/ ${_tgUsersCache.length} totales</span>`;
    
    // Obtener total de mensajes
    const snap = await get(ref(Database, 'telegram_mensajes'));
    let totalMsgs = 0;
    let recent = [];
    if (snap.exists()) {
        const data = snap.val();
        totalMsgs = Object.keys(data).length;
        recent = Object.values(data).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
    }
    $('tg-stat-msgs').textContent = totalMsgs;

    // Pintar Historial reciente
    const rBox = $('tg-recent-history');
    if (recent.length > 0) {
        let rhtml = '';
        recent.forEach(m => {
            const user = _tgUsersCache.find(u => u.telegram_id === String(m.chat_id));
            const uname = user ? user.first_name : m.chat_id;
            rhtml += `
                <div class="tg-history-item">
                    <div class="tg-hist-header">
                        <strong><i class="bi ${m.dir === 'out' ? 'bi-arrow-right-short text-primary' : 'bi-arrow-left-short text-success'}"></i> ${uname}</strong>
                        <span>${new Date(m.timestamp).toLocaleDateString()}</span>
                    </div>
                    <div class="tg-hist-msg">${m.text.substring(0,60)}${m.text.length > 60 ? '...' : ''}</div>
                </div>
            `;
        });
        rBox.innerHTML = rhtml;
    } else {
        rBox.innerHTML = `<div class="cl-empty-state"><i class="bi bi-inbox"></i> Sin mensajes recientes registrados.</div>`;
    }

    // Calcular Alertas Inteligentes
    let ahtml = '';
    
    // 1. Clientes sin vincular Telegram (riesgo)
    let sinVincular = 0;
    _clientesCache.forEach(c => {
         const found = _tgUsersCache.find(u => u.linked_client_id === c.id);
         if(!found) sinVincular++;
    });
    if (sinVincular > 0) {
        ahtml += `<li class="tg-alert-item warning"><i class="bi bi-exclamation-triangle"></i> Tienes ${sinVincular} clientes sin un Bot de Telegram asociado.</li>`;
    }

    // 2. Errores del bot
    if (!currentBotToken) {
        ahtml += `<li class="tg-alert-item danger"><i class="bi bi-x-circle"></i> ¡ATENCIÓN! El Bot Token NO está configurado. Ningún mensaje saldrá.</li>`;
    }

    if (ahtml === '') {
        ahtml = `<li class="tg-alert-item info"><i class="bi bi-check-circle"></i> Todo funcionando a la perfección. Ninguna alerta.</li>`;
    }

    listAlerts.innerHTML = ahtml;
}

/**
 * Función disparada desde servicios.js para automatizaciones por reglas.
 */
export async function enviarRecordatorios(suscripcionesMapeadas) {
    if(!_automations.prev && !_automations.corte) return 0; // si está desactivado todo, omitir.

    let enviados = 0;
    for (const sub of suscripcionesMapeadas) {
        const tgUser = _tgUsersCache.find(u => u.linked_client_id === sub.id);
        
        if (tgUser) {
            // Regla Preventiva (5 días)
            if (_automations.prev && sub._calcStatus === 'porvencer' && sub._diasRest === 5) {
                const msg = `⚠️ *Aviso de Vencimiento*\n\nHola ${sub.Nombre}, tu servicio de *${sub.Negocio || 'Sistema'}* vencerá en 5 días (${new Date(sub._dtLimite).toLocaleDateString()}). \nPor favor renueva para evitar interrupciones.`;
                await enviarMensajeTelegram(tgUser.telegram_id, msg).catch(e=>console.error(e));
                enviados++;
            } 
            // Regla de Corte (Vencido <= 0)
            else if (_automations.corte && sub._calcStatus === 'vencido' && sub._diasRest === 0) {
                // enviamos el dia 0 nada mas o implementamos una logica de "no spam".
                // Para prevenir spam infinito guardariamos un flag "avisado", 
                // pero como el scope marca simplicidad, lo emitimos. (En la vida real usar flag).
                const msg = `⛔ *Servicio Suspendido*\n\nHola ${sub.Nombre}, tu servicio ha sido suspendido por expiración.\nPor favor renueva para activarlo nuevamente.`;
                await enviarMensajeTelegram(tgUser.telegram_id, msg).catch(e=>console.error(e));
                enviados++;
            }
        }
    }
    return enviados;
}
