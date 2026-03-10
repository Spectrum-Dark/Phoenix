//Importamos Firebase
import { Database } from "./firebase.js";
//Funciones de Firebase
import {
  ref,
  set,
  push,
  get,
  update,
  remove,
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

// ── Configuración base de SweetAlert2 con tema Phoenix ──
const Phoenix = Swal.mixin({
  background: "#1C2028",
  color: "#E8ECF2",
  confirmButtonColor: "#17D7A0",
  cancelButtonColor: "#2A3040",
  customClass: {
    popup:         "phoenix-popup",
    confirmButton: "phoenix-btn-confirm",
    cancelButton:  "phoenix-btn-cancel",
    title:         "phoenix-title",
    htmlContainer: "phoenix-text",
  },
});

// Toast rápido (esquina superior derecha)
const PhoenixToast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 3500,
  timerProgressBar: true,
  background: "#1C2028",
  color: "#E8ECF2",
  customClass: {
    popup: "phoenix-toast",
    timerProgressBar: "phoenix-progress",
  },
});

//Registrar Administrador
async function RegistrarAdmin() {
  //Capturamos los datos
  const email = document.getElementById("reg-email").value;
  const password = document.getElementById("reg-password").value;
  const passwordConfirm = document.getElementById("reg-password-confirm").value;

  //Validamos que las contraseñas sean iguales
  if (password !== passwordConfirm) {
    Phoenix.fire({
      icon: "error",
      iconColor: "#eb5757",
      title: "Contraseñas distintas",
      text: "Las contraseñas ingresadas no coinciden. Verifica e inténtalo de nuevo.",
      confirmButtonText: "Entendido",
    });
    return;
  }

  //Validamos el correo
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    Phoenix.fire({
      icon: "warning",
      iconColor: "#F0A500",
      title: "Correo inválido",
      text: "El formato del correo electrónico no es válido. Ejemplo: nombre@dominio.com",
      confirmButtonText: "Corregir",
    });
    return;
  }

  //Creamos la referencia
  const AdminRef = ref(Database, "Administradores");

  //Obtenemos los admins existentes
  const Snapshot = await get(AdminRef);

  //Validamos el ID
  let Id = 1;

  if (Snapshot.exists()) {
    //Obtenemos el ultimo ID
    const AdminData = Snapshot.val();
    //Mapeamos el IDS
    const AdminIds = Object.keys(AdminData).map(Number);
    //Obtenemos el mayor
    Id = Math.max(...AdminIds) + 1;
  }

  //Guardamos el registro en un array
  const Admins = [{ Nombre: email, Contraseña: password }];

  //Recorremos el array y guardamos el registro
  for (const Admin of Admins) {
    //Guardamos el registro
    await set(ref(Database, "Administradores/" + Id), Admin);
    //Incrementamos el id
    Id++;
  }

  //Limpiamos el formulario
  document.getElementById("reg-email").value = "";
  document.getElementById("reg-password").value = "";
  document.getElementById("reg-password-confirm").value = "";

  //Mostramos un mensaje de éxito y cambiamos al login
  PhoenixToast.fire({
    icon: "success",
    iconColor: "#17D7A0",
    title: "Administrador registrado",
  });

  //Cambiamos automáticamente al tab de login
  document.getElementById("tab-login").click();
}

//Obtenemos el boton de registrar
const btnRegister = document.getElementById("btn-register");

//Agregamos el evento click
btnRegister.addEventListener("click", RegistrarAdmin);
