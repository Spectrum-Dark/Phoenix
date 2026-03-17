/**
 * ╔════════════════════════════════════════════════════════════════╗
 *  PHOENIX — firebase.js
 *  Inicializa Firebase y exporta Database + funciones CRUD
 *  para Clientes y Administradores.
 * ╚════════════════════════════════════════════════════════════════╝
 */

import { initializeApp }   from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getDatabase, ref, get, set, push, update, remove, onValue, query, orderByChild, limitToLast }
  from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

/* ──────────────────────────────────────────────────────────
   CONFIGURACIÓN
────────────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            'AIzaSyBXMBE5G8WW6g94uOJXmCDHIdOtNBP-utM',
  authDomain:        'phoenix-a4bcb.firebaseapp.com',
  databaseURL:       'https://phoenix-a4bcb-default-rtdb.firebaseio.com',
  projectId:         'phoenix-a4bcb',
  storageBucket:     'phoenix-a4bcb.firebasestorage.app',
  messagingSenderId: '165847423607',
  appId:             '1:165847423607:web:f0eca1e58c54906d640472',
  measurementId:     'G-RR5EFTWSBE',
};

const app      = initializeApp(firebaseConfig);
const Database = getDatabase(app);

/* ──────────────────────────────────────────────────────────
   CRUD — CLIENTES (Auto-Incremental ID)
   Ruta principal: /Clientes/{pushId}
   Ruta contador: /Contadores/clientes
────────────────────────────────────────────────────────── */

/**
 * Obtiene el siguiente ID leyendo directamente del nodo /Clientes
 * a través de una consulta ordenada, sin usar nodos contadores externos.
 * @returns {Promise<number>} El nuevo ID autoincremental
 */
async function _obtenerSiguienteID() {
  try {
    const q = query(ref(Database, 'Clientes'), orderByChild('cliente_id'), limitToLast(1));
    const snap = await get(q);
    
    if (!snap.exists()) return 1; // Primer cliente

    const val = snap.val();
    const keys = Object.keys(val);
    const ultimoCliente = val[keys[0]];
    
    // Incrementa en 1 el ID más alto encontrado
    return (ultimoCliente.cliente_id || 0) + 1;
  } catch (err) {
    console.error('Firebase: Error obteniendo último ID:', err);
    throw err;
  }
}

/**
 * Guarda un nuevo cliente en /Clientes, usando el ID numérico como Key Principal.
 * @param {Object} cliente - Campos del cliente (Nombre, Numero, Negocio, Direccion, Token)
 * @returns {Promise<string>} El ID asignado como string (Ej: "1")
 */
export async function guardarCliente(cliente) {
  // 1. Obtener y asegurar el ID incremental atómicamente
  const nextId = await _obtenerSiguienteID();

  // 2. Insertar cliente usando el ID generado como la Key del nodo
  const nuevoRef = ref(Database, `Clientes/${nextId}`);

  await set(nuevoRef, {
    cliente_id: nextId,
    ...cliente,
    Estado:     'activo',
    timestamp:  new Date().toISOString(),
  });

  return String(nextId);
}

/**
 * Obtiene todos los clientes una sola vez (snapshot).
 * Resiste Array coercion por claves numéricas en Firebase.
 * @returns {Array} array de objetos { id, ...campos }
 */
export async function obtenerClientes() {
  const snap = await get(ref(Database, 'Clientes'));
  if (!snap.exists()) return [];
  const val = snap.val();
  return Object.keys(val).reduce((acc, key) => {
    if (val[key]) acc.push({ id: key, ...val[key] });
    return acc;
  }, []);
}

/**
 * Escucha cambios en tiempo real en /Clientes.
 * Resiste Array coercion por claves numéricas en Firebase.
 * @param {Function} cb - callback(clientes: Array)
 * @returns {Function} función de baja (unsubscribe)
 */
export function escucharClientes(cb) {
  const r = ref(Database, 'Clientes');
  return onValue(r, snap => {
    if (!snap.exists()) { cb([]); return; }
    const val = snap.val();
    const list = Object.keys(val).reduce((acc, key) => {
      if (val[key]) acc.push({ id: key, ...val[key] });
      return acc;
    }, []);
    cb(list);
  });
}

/**
 * Actualiza campos de un cliente existente.
 * @param {string} id - pushId del cliente
 * @param {Object} cambios - campos a actualizar
 */
export async function actualizarCliente(id, cambios) {
  await update(ref(Database, `Clientes/${id}`), {
    ...cambios,
    ultimaActualizacion: new Date().toISOString(),
  });
}

/**
 * Elimina un cliente por su ID.
 * @param {string} id - pushId del cliente
 */
export async function eliminarCliente(id) {
  await remove(ref(Database, `Clientes/${id}`));
}

/**
 * Registra un evento de actividad en /ActividadServicios.
 * Usado por servicios.js para loguear activaciones, desactivaciones y renovaciones.
 * @param {Object} evento - { tipo, desc, nombre, color, time }
 */
export async function registrarActividad(evento) {
  try {
    await push(ref(Database, 'ActividadServicios'), {
      ...evento,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Firebase: Error registrando actividad:', err);
  }
}

/**
 * Verifica si un token ya existe en /Clientes.
 * @param {string} token
 * @returns {boolean}
 */
export async function tokenExiste(token) {
  const snap = await get(ref(Database, 'Clientes'));
  if (!snap.exists()) return false;
  const val = snap.val();
  return Object.keys(val).some(k => val[k] && val[k].Token === token);
}

/* ──────────────────────────────────────────────────────────
   LOG DE ACTIVIDAD — Ruta: /actividad/
   Registra eventos del sistema: login, nuevo cliente, eliminado, etc.
────────────────────────────────────────────────────────── */

/**
 * Registra un evento en /actividad/ con tipo, descripción, color y timestamp.
 * @param {string} tipo   - 'login' | 'nuevo_cliente' | 'eliminar_cliente' | 'update' | etc.
 * @param {string} desc   - Descripción legible del evento
 * @param {string} [color='blue'] - Color del dot: 'green' | 'blue' | 'red' | 'yellow'
 */
export async function registrarActividadDash(tipo, desc, color = 'blue') {
  try {
    await push(ref(Database, 'actividad'), {
      tipo,
      desc,
      color,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Firebase: Error registrando actividad dashboard:', err);
  }
}

/**
 * Escucha en tiempo real los últimos 10 eventos de /actividad/
 * @param {Function} cb - callback(eventos: Array)
 * @returns {Function} unsubscribe
 */
export function escucharActividadDash(cb) {
  const q = query(ref(Database, 'actividad'), orderByChild('timestamp'), limitToLast(10));
  return onValue(q, snap => {
    if (!snap.exists()) { cb([]); return; }
    const val = snap.val();
    const list = Object.entries(val)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Más reciente primero
    cb(list);
  });
}

/**
 * Obtiene los últimos N eventos de actividad (snapshot único).
 * @param {number} [limit=10]
 * @returns {Promise<Array>}
 */
export async function obtenerActividadDash(limit = 10) {
  const q    = query(ref(Database, 'actividad'), orderByChild('timestamp'), limitToLast(limit));
  const snap = await get(q);
  if (!snap.exists()) return [];
  const val = snap.val();
  return Object.entries(val)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/* ──────────────────────────────────────────────────────────
   PRESENCIA ADMINS — Ruta: /Administradores_Online/
   Registra qué administradores están conectados en este momento.
────────────────────────────────────────────────────────── */

/**
 * Marca un administrador como online en /Administradores_Online/{key}
 * @param {string} email
 * @param {string} [nombre]
 */
export async function registrarAdminOnline(email, nombre = '') {
  if (!email) return;
  const key = email.replace(/[.#$[\]]/g, '_');
  try {
    await set(ref(Database, `Administradores_Online/${key}`), {
      email,
      nombre: nombre || email.split('@')[0],
      desde:  new Date().toISOString(),
      online: true,
    });
  } catch (err) {
    console.warn('Firebase: Error marcando admin online:', err);
  }
}

/**
 * Marca un administrador como offline, removiendo su entrada.
 * @param {string} email
 */
export async function marcarAdminOffline(email) {
  if (!email) return;
  const key = email.replace(/[.#$[\]]/g, '_');
  try {
    await remove(ref(Database, `Administradores_Online/${key}`));
  } catch (err) {
    console.warn('Firebase: Error marcando admin offline:', err);
  }
}

/**
 * Escucha en tiempo real la lista de admins online.
 * @param {Function} cb - callback(admins: Array)
 * @returns {Function} unsubscribe
 */
export function escucharAdminsOnline(cb) {
  const r = ref(Database, 'Administradores_Online');
  return onValue(r, snap => {
    if (!snap.exists()) { cb([]); return; }
    const val = snap.val();
    const list = Object.values(val).filter(Boolean);
    cb(list);
  });
}

/* ──────────────────────────────────────────────────────────
   EXPORTACIONES BASE
────────────────────────────────────────────────────────── */
export { app, Database, ref, get, set, push, update, remove, onValue, query, orderByChild, limitToLast };