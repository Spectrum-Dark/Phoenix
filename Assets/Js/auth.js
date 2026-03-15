(function () {
  const isAdmin = localStorage.getItem("Admin");

  if (!isAdmin) {
    // Si NO hay sesión, redirigir inmediatamente
    window.location.replace("../index.html");
  } else {
    // Si HAY sesión, quitamos el "velo" apenas el DOM sea procesado
    document.documentElement.style.visibility = "visible";
    
    // Opcional: Inyectar CSS para mostrar el body
    const style = document.createElement('style');
    style.innerHTML = `body { visibility: visible !important; opacity: 1 !important; }`;
    document.head.appendChild(style);
  }

  /* Lógica de UI */
  document.addEventListener("DOMContentLoaded", () => {
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
      btnLogout.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("Admin");
        window.location.replace("../index.html");
      });
    }
  });
})();