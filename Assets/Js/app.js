import { initClientes } from './clientes.js';
import { initServicios } from './servicios.js';

/* ─── Navegación entre vistas (SPA) ─── */
const views    = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const topbarTitle = document.getElementById('topbar-title');

const viewTitles = {
  'view-inicio':    'Inicio',
  'view-clientes':  'Registrar Cliente',
  'view-servicios': 'Servicios',
  'view-perfil':    'Mi Perfil',
  'view-ajustes':   'Ajustes',
};

// Mapa de URLs de las vistas
const viewUrls = {
  'view-clientes':  './clientes.html',
  'view-servicios': './servicios.html'
  // Puedes ir agregando las demás aquí
};

async function switchView(viewId) {
  views.forEach(v => v.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));

  const target = document.getElementById(viewId);
  
  // Si la vista todavía no se ha cargado desde el archivo
  if (target && viewUrls[viewId] && !target.hasAttribute('data-loaded')) {
    try {
      target.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);"><i class="bi bi-hourglass-split" style="font-size: 2rem;"></i><p>Cargando vista...</p></div>';
      
      const resp = await fetch(viewUrls[viewId]);
      if (resp.ok) {
        const html = await resp.text();
        
        // Parseamos el HTML y extraemos el wrapper
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const wrapper = doc.querySelector('.clientes-wrapper') || 
                        doc.querySelector('.servicios-wrapper') || 
                        doc.body;

        target.innerHTML = '';
        target.appendChild(wrapper);
        target.setAttribute('data-loaded', 'true');

        // Inicializamos la lógica correspondiente
        if (viewId === 'view-clientes') initClientes();
        if (viewId === 'view-servicios') initServicios();
        
      } else {
        target.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--red);"><p>Error al cargar la vista</p></div>';
      }
    } catch (err) {
      console.error('Error fetching view:', err);
    }
  } else if (target) {
     target.classList.add('active'); // Si ya estabá cargada o es la de inicio
  }

  if (target) target.classList.add('active');

  const navMatch = document.querySelector(`.nav-item[data-view="${viewId}"]`);
  if (navMatch) navMatch.classList.add('active');

  topbarTitle.textContent = viewTitles[viewId] || 'Phoenix';
}

navItems.forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    switchView(item.dataset.view);
  });
});

/* ─── Accesos rápidos en panel inicio ─── */
document.querySelectorAll('.quick-card[data-view]').forEach(card => {
  card.addEventListener('click', () => switchView(card.dataset.view));
  card.addEventListener('keydown', e => { if (e.key === 'Enter') switchView(card.dataset.view); });
});

/* ─── Carga de Perfil de Usuario ─── */
function loadUserProfile() {
  const adminEmail = JSON.parse(localStorage.getItem("Admin"));
  if (!adminEmail) return;

  const avatarDisplay = document.querySelector(".avatar");
  const nameDisplay = document.querySelector(".avatar-name");
  const roleDisplay = document.querySelector(".avatar-role");
  const welcomeName = document.querySelector(".view-title");

  // Extraer iniciales coherentes (ej: "juan.perez" -> "JP")
  const usernamePart = adminEmail.split("@")[0];
  let initials = "";

  if (usernamePart.includes(".")) {
    const parts = usernamePart.split(".");
    initials = (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  } else if (usernamePart.includes("_")) {
    const parts = usernamePart.split("_");
    initials = (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  } else {
    initials = usernamePart.substring(0, 2).toUpperCase();
  }

  // Actualizar elementos del DOM
  if (avatarDisplay) avatarDisplay.textContent = initials;
  if (nameDisplay) nameDisplay.textContent = adminEmail;
  if (roleDisplay) roleDisplay.textContent = "Propietario";

  // Actualizar mensaje de bienvenida en la vista de inicio
  if (welcomeName && welcomeName.textContent.includes("¡Bienvenido")) {
    const displayName = usernamePart.split(/[._]/)[0];
    const formattedName =
      displayName.charAt(0).toUpperCase() + displayName.slice(1);
    welcomeName.textContent = `¡Bienvenido, ${formattedName}! 👋`;
  }
}

// Ejecutar carga de perfil
loadUserProfile();
