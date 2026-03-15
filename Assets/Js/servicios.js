// Lógica independiente para la vista de Servicios (Gestión de Clientes)
export function initServicios() {
    console.log("Módulo de Servicios inicializado.");
    
    // Referencias al DOM del Modal
    const modalEditar = document.getElementById('modal-editar');
    const btnCerrarModal = document.getElementById('close-modal');
    const btnCancelarModal = document.getElementById('btn-cancelar-modal');
    const formEditar = document.getElementById('form-editar-servicio');

    // Referencias a botones de acción en la tabla
    const btnEditAll = document.querySelectorAll('.edit-btn');
    const btnDeleteAll = document.querySelectorAll('.delete-btn');

    // --- FUNCIONES DEL MODAL ---

    const openModal = () => {
        if(modalEditar) modalEditar.classList.add('show');
    };

    const closeModal = () => {
        if(modalEditar) modalEditar.classList.remove('show');
    };

    // Cerrar modal al interactuar con la cruz o cancelar
    if(btnCerrarModal) btnCerrarModal.addEventListener('click', closeModal);
    if(btnCancelarModal) btnCancelarModal.addEventListener('click', closeModal);

    // Cerrar modal haciendo clic fuera de la tarjeta
    if(modalEditar) {
        modalEditar.addEventListener('click', (e) => {
            if(e.target === modalEditar) closeModal();
        });
    }

    // --- MANEJO DE TABLA ---

    // Abrir modal de edición
    btnEditAll.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const servicioId = e.currentTarget.dataset.id;
            console.log(`Editando servicio/cliente ID: ${servicioId}`);
            
            // Aquí en un futuro puedes hacer un fetch a Firebase 
            // y llenar los inputs (edit-nombre, edit-numero, etc.)
            // simulamos apertura:
            openModal();
        });
    });

    // Acción de eliminar (simulada con confirmación clásica por ahora)
    btnDeleteAll.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const servicioId = e.currentTarget.dataset.id;
            console.log(`Intentando eliminar ID: ${servicioId}`);

            // Si tienes SweetAlert2 (que vi en index.html) podrías usarlo:
            if(typeof Swal !== 'undefined') {
                Swal.fire({
                    title: '¿Estás seguro?',
                    text: "Esta acción no se puede deshacer.",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#FF4B4B',
                    cancelButtonColor: '#2A3040',
                    confirmButtonText: 'Sí, eliminar',
                    cancelButtonText: 'Cancelar',
                    background: '#1C2028',
                    color: '#E8ECF2'
                }).then((result) => {
                    if (result.isConfirmed) {
                        console.log("Eliminando desde Firebase logic...");
                        Swal.fire({
                            title: 'Eliminado!', 
                            text: 'El registro ha sido borrado.', 
                            icon: 'success',
                            background: '#1C2028',
                            color: '#e8ecf2'
                        });
                        // Eliminar fila del DOM visualmente
                        e.currentTarget.closest('tr').remove();
                    }
                });
            } else {
                // Confirmación nativa si SweetAlert no ha cargado
                if(confirm("¿Estás seguro de que quieres eliminar este registro?")) {
                    console.log("Eliminando...");
                    e.currentTarget.closest('tr').remove();
                }
            }
        });
    });

    // Guardar cambios en el form del modal
    if(formEditar) {
        formEditar.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log("Guardando cambios... (Lógica de base de datos pendiente)");
            
            // Simular actualización exitosa
            closeModal();
            // Actualizar fila del DOM visualmente en el futuro
        });
    }
}
