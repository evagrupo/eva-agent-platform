export type Language = "en" | "es";

export const LANGUAGE_EVENT = "bb-spanish-localization-language-change";
export const LANGUAGE_STORAGE_KEY = "bb-spanish-localization.language";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es";
}

const translations: Readonly<Record<string, string>> = {
  // Navigation and shell
  Settings: "Ajustes",
  "New thread": "Nuevo hilo",
  "New Thread": "Nuevo hilo",
  Threads: "Hilos",
  Thread: "Hilo",
  Projects: "Proyectos",
  Project: "Proyecto",
  Workspaces: "Espacios de trabajo",
  Workspace: "Espacio de trabajo",
  Hosts: "Máquinas",
  Host: "Máquina",
  Providers: "Proveedores",
  Provider: "Proveedor",
  Extensions: "Extensiones",
  Plugins: "Complementos",
  Appearance: "Apariencia",
  General: "General",
  Keyboard: "Teclado",
  "Keyboard shortcuts": "Atajos de teclado",
  "AI services": "Servicios de IA",
  "Command palette": "Paleta de comandos",
  "Quick palette": "Paleta rápida",
  "What's new": "Novedades",
  Help: "Ayuda",
  Feedback: "Comentarios",
  "Report a bug": "Informar de un error",
  // EVA agent names
  "Master Orchestrator": "Orquestador Maestro",
  Compliance: "Cumplimiento",
  Creativity: "Creatividad",
  "CRM & Call Center": "CRM y Call Center",
  Email: "Correo",
  "AI Voice": "Voz IA",
  Payments: "Recobro",
  HR: "RR. HH.",
  "Open settings": "Abrir ajustes",
  "Close settings": "Cerrar ajustes",
  "Toggle sidebar": "Alternar barra lateral",
  "Toggle panel": "Alternar panel",
  Sidebar: "Barra lateral",
  Panel: "Panel",
  Menu: "Menú",
  "Open menu": "Abrir menú",
  "Close menu": "Cerrar menú",
  "More options": "Más opciones",

  // Composer and thread actions
  Send: "Enviar",
  Submit: "Enviar",
  "Send message": "Enviar mensaje",
  "Stop generating": "Detener generación",
  "Stop generation": "Detener generación",
  "Start side chat": "Iniciar chat lateral",
  "Start terminal": "Iniciar terminal",
  "Start a new thread": "Iniciar un hilo nuevo",
  "Create a new thread": "Crear un hilo nuevo",
  "New message": "Nuevo mensaje",
  "Type a message": "Escribe un mensaje",
  "Ask anything": "Pregunta lo que quieras",
  "What are you working on?": "¿En qué estás trabajando?",
  "Add attachment": "Añadir archivo adjunto",
  "Attach files": "Adjuntar archivos",
  Attachments: "Archivos adjuntos",
  Voice: "Voz",
  "Record voice message": "Grabar mensaje de voz",
  Expand: "Expandir",
  Collapse: "Contraer",
  "Expand composer": "Expandir editor",
  "Collapse composer": "Contraer editor",
  Queue: "Cola",
  Queued: "En cola",
  Plan: "Plan",
  "Plan mode": "Modo de planificación",
  Review: "Revisar",
  Approve: "Aprobar",
  Reject: "Rechazar",
  Apply: "Aplicar",
  Accept: "Aceptar",
  Discard: "Descartar",
  Continue: "Continuar",
  Retry: "Reintentar",
  "Retry request": "Reintentar solicitud",

  // Common actions
  Save: "Guardar",
  Saved: "Guardado",
  Cancel: "Cancelar",
  Close: "Cerrar",
  Delete: "Eliminar",
  Remove: "Quitar",
  Archive: "Archivar",
  Archived: "Archivado",
  Unarchive: "Desarchivar",
  Rename: "Cambiar nombre",
  Edit: "Editar",
  "Edit message": "Editar mensaje",
  Copy: "Copiar",
  Copied: "Copiado",
  "Copy link": "Copiar enlace",
  Open: "Abrir",
  "Open in new tab": "Abrir en una pestaña nueva",
  "Open folder": "Abrir carpeta",
  "Open file": "Abrir archivo",
  Search: "Buscar",
  "Search threads": "Buscar hilos",
  "Search files": "Buscar archivos",
  Refresh: "Actualizar",
  Reload: "Recargar",
  Back: "Atrás",
  Next: "Siguiente",
  More: "Más",
  Less: "Menos",
  "Show more": "Mostrar más",
  "Show less": "Mostrar menos",
  Clear: "Borrar",
  Reset: "Restablecer",
  Restore: "Restaurar",
  Create: "Crear",
  "Create project": "Crear proyecto",
  "New project": "Nuevo proyecto",
  "Add project": "Añadir proyecto",
  Select: "Seleccionar",
  "Select all": "Seleccionar todo",
  All: "Todos",
  None: "Ninguno",
  Download: "Descargar",
  Upload: "Subir",
  Install: "Instalar",
  Installed: "Instalado",
  Installing: "Instalando",
  Uninstall: "Desinstalar",
  Update: "Actualizar",
  Updates: "Actualizaciones",
  Enable: "Activar",
  Enabled: "Activado",
  Disable: "Desactivar",
  Disabled: "Desactivado",
  Connect: "Conectar",
  Connected: "Conectado",
  Disconnect: "Desconectar",
  Disconnected: "Desconectado",
  "Sign in": "Iniciar sesión",
  "Sign out": "Cerrar sesión",
  "Log in": "Iniciar sesión",
  "Log out": "Cerrar sesión",

  // Panels, tools, and execution
  Files: "Archivos",
  File: "Archivo",
  Folders: "Carpetas",
  Folder: "Carpeta",
  Terminal: "Terminal",
  Browser: "Navegador",
  Commands: "Comandos",
  Command: "Comando",
  Run: "Ejecutar",
  Running: "Ejecutando",
  Done: "Completado",
  Pending: "Pendiente",
  Error: "Error",
  Warning: "Advertencia",
  Loading: "Cargando",
  "Loading...": "Cargando...",
  "Loading…": "Cargando…",
  Ready: "Listo",
  Status: "Estado",
  Details: "Detalles",
  Logs: "Registros",
  Output: "Salida",
  Input: "Entrada",
  Preview: "Vista previa",
  Source: "Fuente",
  Changes: "Cambios",
  Diff: "Diferencias",
  "Source code": "Código fuente",
  Environment: "Entorno",
  Environments: "Entornos",
  Branch: "Rama",
  "Branch from": "Crear rama desde",
  Local: "Local",
  Remote: "Remoto",
  Machine: "Máquina",
  Default: "Predeterminado",
  Personal: "Personal",
  Model: "Modelo",
  Models: "Modelos",
  Reasoning: "Razonamiento",
  Permission: "Permiso",
  Permissions: "Permisos",
  "Permission mode": "Modo de permisos",
  Fast: "Rápido",
  Medium: "Medio",
  High: "Alto",
  Low: "Bajo",
  Advanced: "Avanzado",
  Experimental: "Experimental",
  Configuration: "Configuración",
  Configure: "Configurar",
  Preferences: "Preferencias",
  Name: "Nombre",
  Title: "Título",
  Description: "Descripción",
  Type: "Tipo",
  Version: "Versión",
  Theme: "Tema",
  Themes: "Temas",
  Light: "Claro",
  Dark: "Oscuro",
  System: "Sistema",
  Language: "Idioma",
  English: "Inglés",
  Spanish: "Español",

  // Thread and empty states
  "No threads yet": "Aún no hay hilos",
  "No projects yet": "Aún no hay proyectos",
  "No files found": "No se encontraron archivos",
  "No results": "Sin resultados",
  "Nothing here yet": "Aún no hay nada aquí",
  Untitled: "Sin título",
  "Untitled thread": "Hilo sin título",
  "Start a conversation": "Inicia una conversación",
  "Start a new conversation": "Inicia una conversación nueva",
  "There are no messages yet.": "Aún no hay mensajes.",
  "This cannot be undone.": "Esta acción no se puede deshacer.",
  "Are you sure?": "¿Estás seguro?",
  "You have unsaved changes.": "Tienes cambios sin guardar.",
  "No active threads": "No hay hilos activos",
  "No archived threads": "No hay hilos archivados",
  "No connected machines": "No hay máquinas conectadas",
  "No providers available": "No hay proveedores disponibles",

  // Time and status labels
  Today: "Hoy",
  Yesterday: "Ayer",
  Tomorrow: "Mañana",
  "Just now": "Ahora mismo",
  Never: "Nunca",
  "Last updated": "Última actualización",
  "Updated just now": "Actualizado ahora mismo",
  "All changes saved": "Todos los cambios están guardados",
  "Waiting for input": "Esperando tu respuesta",
  "Needs your input": "Necesita tu respuesta",
  "Needs configuration": "Necesita configuración",
  "Not installed": "No instalado",
  Available: "Disponible",
  Unavailable: "No disponible",
  Success: "Correcto",
  Failed: "Fallido",
  Interrupted: "Interrumpido",

  // Confirmation and plugin management
  "Delete thread": "Eliminar hilo",
  "Archive thread": "Archivar hilo",
  "Rename thread": "Cambiar nombre del hilo",
  "Restore thread": "Restaurar hilo",
  "Delete project": "Eliminar proyecto",
  "Install plugin": "Instalar complemento",
  "Remove plugin": "Quitar complemento",
  "Enable plugin": "Activar complemento",
  "Disable plugin": "Desactivar complemento",
  "Check for updates": "Buscar actualizaciones",
  "Plugin settings": "Ajustes del complemento",
  "Open plugin settings": "Abrir ajustes del complemento",
  // Additional BB shell, thread, and composer labels
  "Creating thread": "Creando hilo",
  "Starting thread...": "Iniciando hilo...",
  "Stopping thread...": "Deteniendo hilo...",
  "Provisioning thread...": "Configurando hilo...",
  "Moving attachments to the selected project...":
    "Moviendo archivos adjuntos al proyecto seleccionado...",
  "Uploading attachments...": "Subiendo archivos adjuntos...",
  "Creating a new thread": "Creando un hilo nuevo",
  "Create new thread in this worktree":
    "Crear un hilo nuevo en este árbol de trabajo",
  "Open workspace": "Abrir espacio de trabajo",
  "Open Workspace": "Abrir espacio de trabajo",
  "Parent thread": "Hilo principal",
  "Thread details": "Detalles del hilo",
  "Thread info": "Información del hilo",
  "Show thread info panel": "Mostrar panel de información del hilo",
  "Show diff panel": "Mostrar panel de diferencias",
  "Show right panel": "Mostrar panel derecho",
  "Hide right panel": "Ocultar panel derecho",
  "Right panel": "Panel derecho",
  "Close pane": "Cerrar panel",
  "Close search": "Cerrar búsqueda",
  "More actions": "Más acciones",
  "Agent messages": "Mensajes del agente",
  "Your messages": "Tus mensajes",
  "Ask a follow-up": "Hacer una pregunta de seguimiento",
  "Send a follow-up": "Enviar una pregunta de seguimiento",
  "Ask for a follow-up. @ to mention files, folders, sections, or threads":
    "Pide una pregunta de seguimiento. Usa @ para mencionar archivos, carpetas, secciones o hilos",
  "Editing message": "Editando mensaje",
  "Submit edit (Enter)": "Enviar edición (Intro)",
  "Stop editing sent message": "Dejar de editar el mensaje enviado",
  "Failed to edit the message": "No se pudo editar el mensaje",
  "The message being edited is no longer available.":
    "El mensaje que estás editando ya no está disponible.",
  "No prompt text.": "No hay texto de indicación.",
  "Value copied": "Valor copiado",
  "Thread storage path is not available yet.":
    "La ruta del almacenamiento del hilo aún no está disponible.",
  "Thread table of contents": "Índice del hilo",
  "Thread file links are only available when the thread has an environment.":
    "Los enlaces de archivos del hilo solo están disponibles cuando el hilo tiene un entorno.",
  "Thread file links must use absolute file paths.":
    "Los enlaces de archivos del hilo deben usar rutas absolutas.",
  "No thread details available.": "No hay detalles del hilo disponibles.",
  "File attachment": "Archivo adjunto",
  "Image attachment": "Imagen adjunta",
  "No terminals": "No hay terminales",
  "Terminals unavailable.": "Terminales no disponibles.",
  "Starting terminal...": "Iniciando terminal...",
  "Starting terminal…": "Iniciando terminal…",
  "Setting up workspace...": "Configurando espacio de trabajo...",
  "Setting up...": "Configurando...",
  "Workspace not found.": "No se encontró el espacio de trabajo.",
  "Workspace status unavailable.":
    "El estado del espacio de trabajo no está disponible.",
  "Host disconnected": "La máquina se desconectó",
  "Waiting for host to reconnect...":
    "Esperando a que la máquina se vuelva a conectar...",
  "Waiting for reconnection": "Esperando la reconexión",
  "Waiting for the machine to connect…":
    "Esperando a que la máquina se conecte…",
  "A newer version is required.": "Se necesita una versión más reciente.",
  "A merge base branch is required": "Se necesita una rama base de combinación",
  "Branch has diverged.": "La rama ha divergido.",
  "Branch is behind its merge base.":
    "La rama está atrasada respecto a su base de combinación.",
  "Local commits pending merge.":
    "Hay confirmaciones locales pendientes de combinar.",

  // Settings, machines, projects, and preferences
  "Working…": "Trabajando…",
  "This machine": "Esta máquina",
  Primary: "Principal",
  "No machines available.": "No hay máquinas disponibles.",
  "No machines yet.": "Aún no hay máquinas.",
  "Another machine cannot use this address.":
    "Otra máquina no puede usar esta dirección.",
  "Remove machine": "Quitar máquina",
  "Machine information": "Información de la máquina",
  "Danger zone": "Zona peligrosa",
  "Status unavailable": "Estado no disponible",
  "Unavailable while offline": "No disponible sin conexión",
  "Up to date": "Actualizado",
  "None installed": "Ninguno instalado",
  "Never refreshed": "Nunca actualizado",
  "All threads": "Todos los hilos",
  "Root threads": "Hilos raíz",
  "Child threads": "Hilos secundarios",
  "All projects": "Todos los proyectos",
  "Archived threads": "Hilos archivados",
  "Search archived threads": "Buscar hilos archivados",
  "Search archived threads…": "Buscar hilos archivados…",
  "Find and restore archived threads from across your projects.":
    "Busca y restaura hilos archivados de todos tus proyectos.",
  "No archived threads match these filters.":
    "Ningún hilo archivado coincide con estos filtros.",
  "Unknown project": "Proyecto desconocido",
  "Default shortcut": "Atajo predeterminado",
  "Default shortcuts": "Atajos predeterminados",
  "Search keyboard shortcuts": "Buscar atajos de teclado",
  "Search shortcuts": "Buscar atajos",
  "Press keys": "Pulsa las teclas",
  "Press a non-modifier key.": "Pulsa una tecla que no sea modificadora.",
  "Use Command, Control, or Alt with a key.":
    "Usa Comando, Control o Alt con una tecla.",
  "Click a shortcut, then press its new keys. Changes sync to every bb window.":
    "Haz clic en un atajo y pulsa sus nuevas teclas. Los cambios se sincronizan con todas las ventanas de bb.",
  "Show keyboard hints when holding CMD / Control":
    "Mostrar sugerencias de teclado al mantener pulsada la tecla CMD / Control",
  "Show shortcut badges after holding Command or Control.":
    "Mostrar insignias de atajos después de mantener pulsada la tecla Comando o Control.",
  "Changelog preview": "Vista previa del registro de cambios",
  "Mobile app": "Aplicación móvil",
  "Idle provider session release":
    "Liberación de sesiones inactivas del proveedor",
  "Timeline windowing": "Ventana de la línea de tiempo",
  "Favicon color": "Color del favicon",
  "File openers": "Abridores de archivos",
  "File Preferences": "Preferencias de archivos",
  "Local editor integration": "Integración con el editor local",
  "Markdown formatting in prompt box":
    "Formato Markdown en el cuadro de indicaciones",
  "Navigate to threads on creation": "Navegar a los hilos al crearlos",
  "Streamer mode": "Modo streamer",
  "Voice Input": "Entrada de voz",
  "Load microphones": "Cargar micrófonos",
  "Loading microphones": "Cargando micrófonos",
  "Loading microphones.": "Cargando micrófonos.",
  "No microphones found.": "No se encontraron micrófonos.",
  "Selected microphone is unavailable.":
    "El micrófono seleccionado no está disponible.",
  "This browser does not expose microphone devices.":
    "Este navegador no proporciona dispositivos de micrófono.",
  "Used for prompt voice input.":
    "Se usa para la entrada de voz de las indicaciones.",
  "Save settings": "Guardar ajustes",
  "Plugin settings saved": "Ajustes del complemento guardados",
  "Saving plugin settings failed":
    "No se pudieron guardar los ajustes del complemento",
  "Unknown error": "Error desconocido",
  "Update check failed": "Falló la comprobación de actualizaciones",
  "Update check incomplete":
    "La comprobación de actualizaciones quedó incompleta",
  "Update didn't finish": "La actualización no terminó",
  "Update failed": "Falló la actualización",
  "Update blocked": "Actualización bloqueada",
  "Couldn't check for updates": "No se pudieron comprobar las actualizaciones",
  "Checking for updates…": "Comprobando actualizaciones…",
  "Retry update": "Reintentar actualización",
  "Retrying update…": "Reintentando actualización…",
  "Relaunch bb to finish updating":
    "Reinicia bb para terminar la actualización",
  "Relaunch failed": "No se pudo reiniciar",
  "Upgrade command copied": "Comando de actualización copiado",
  "Couldn't copy upgrade command":
    "No se pudo copiar el comando de actualización",
  "View log": "Ver registro",

  // Projects, machines, and source controls
  "Add a machine": "Añadir una máquina",
  "Add local path": "Añadir ruta local",
  "Add on a machine": "Añadir en una máquina",
  "Edit local path": "Editar ruta local",
  "Remove source": "Quitar fuente",
  "Remove source?": "¿Quitar fuente?",
  "Invalid local path": "Ruta local no válida",
  "Already added": "Ya añadido",
  "Project Sources": "Fuentes del proyecto",
  "Source actions": "Acciones de fuente",
  "Clone & continue": "Clonar y continuar",
  "Clone destination": "Destino del clon",
  "Clone from the project remote": "Clonar desde el remoto del proyecto",
  "Choose a folder.": "Elige una carpeta.",
  "Use folder & continue": "Usar carpeta y continuar",
  "Use this destination": "Usar este destino",
  "Setup method": "Método de configuración",
  "Select a project…": "Selecciona un proyecto…",
  "Set up a project on it →": "Configurar un proyecto en ella →",
  "Create a commit from the current workspace changes.":
    "Crear una confirmación con los cambios actuales del espacio de trabajo.",
  "Commit changes": "Confirmar cambios",
  "Commit + squash merge": "Confirmar y combinar con squash",
  "Commit and squash merge": "Confirmar y combinar con squash",
  "Squash merge": "Combinar con squash",
  "Merge base": "Base de combinación",
  "Pull request": "Solicitud de incorporación",
  "Create a new bb plugin that": "Crear un nuevo complemento de bb que",
  "Create a new bb skill that": "Crear una nueva habilidad de bb que",

  // Browser and navigation
  "Address and search bar": "Barra de direcciones y búsqueda",
  "Find in page": "Buscar en la página",
  "Next match": "Coincidencia siguiente",
  "Previous match": "Coincidencia anterior",
  "Go back": "Atrás",
  "Go forward": "Adelante",
  "Enter a URL": "Introduce una URL",
  "Clear recently visited": "Borrar visitas recientes",
  "Recently visited": "Visitados recientemente",
  "Open externally": "Abrir externamente",
  "Open in external browser": "Abrir en el navegador externo",
  "Connection not secure": "Conexión no segura",
  "Secure connection": "Conexión segura",
  "Page blocked": "Página bloqueada",
  "Page unavailable": "Página no disponible",
  "Server not reachable": "No se puede acceder al servidor",
  "Stop loading": "Detener carga",
  "The browser could not load this page. Try reloading or opening it externally.":
    "El navegador no pudo cargar esta página. Intenta recargarla o abrirla externamente.",
  "Open new tab": "Abrir pestaña nueva",
  "Open browser": "Abrir navegador",

  // Files, previews, terminals, and diffs
  "Loading files...": "Cargando archivos...",
  "No files yet.": "Aún no hay archivos.",
  "No files match search.": "Ningún archivo coincide con la búsqueda.",
  "Copy file path": "Copiar ruta del archivo",
  "File path copied": "Ruta del archivo copiada",
  "Failed to copy file path": "No se pudo copiar la ruta del archivo",
  "Copy file name": "Copiar nombre del archivo",
  "File name copied": "Nombre del archivo copiado",
  "Failed to copy file name": "No se pudo copiar el nombre del archivo",
  "Copy file contents": "Copiar contenido del archivo",
  "Copy HTML source": "Copiar código fuente HTML",
  "Copy markdown": "Copiar Markdown",
  "Copy CSV": "Copiar CSV",
  "Copy path": "Copiar ruta",
  "Failed to copy path.": "No se pudo copiar la ruta.",
  "Open in editor": "Abrir en el editor",
  "Refresh file": "Actualizar archivo",
  "Refreshing file": "Actualizando archivo",
  "Empty file.": "Archivo vacío.",
  "File not found.": "Archivo no encontrado.",
  "HTML view mode": "Modo de vista HTML",
  "Markdown view mode": "Modo de vista Markdown",
  "CSV view mode": "Modo de vista CSV",
  "Diff view mode": "Modo de vista de diferencias",
  "Show full diff": "Mostrar diferencias completas",
  "Load diff": "Cargar diferencias",
  "No diff was available for this file.":
    "No había diferencias disponibles para este archivo.",
  "No renderable diff for this file.":
    "No hay diferencias renderizables para este archivo.",
  "Failed to load file diff":
    "No se pudieron cargar las diferencias del archivo",
  "Failed to load this file's diff.":
    "No se pudieron cargar las diferencias de este archivo.",
  "This diff was truncated for display.":
    "Estas diferencias se truncaron para mostrarlas.",
  "Wrap lines": "Ajustar líneas",
  "Disable line wrap": "Desactivar ajuste de línea",
  "Split diff view": "Vista de diferencias dividida",
  "Stacked diff view": "Vista de diferencias apilada",
  "Start new terminal": "Iniciar terminal nueva",
  "Terminal starting": "Terminal iniciándose",
  "Terminal running": "Terminal en ejecución",
  "Terminal disconnected": "Terminal desconectada",
  "Terminal reconnected": "Terminal reconectada",
  "Terminal exited": "Terminal finalizada",
  "Failed to load terminals": "No se pudieron cargar los terminales",
  "Some terminal output was unavailable after reconnect":
    "Parte de la salida del terminal no estuvo disponible después de la reconexión",

  // Plugin, skill, update, and extension management
  "Add plugin": "Añadir complemento",
  "New plugin": "Nuevo complemento",
  "Plugin examples": "Ejemplos de complementos",
  "Plugin marketplaces": "Mercados de complementos",
  "Plugin name": "Nombre del complemento",
  "Plugin source": "Fuente del complemento",
  "Skill name": "Nombre de la habilidad",
  "Skill not found.": "No se encontró la habilidad.",
  "Search installed plugins": "Buscar complementos instalados",
  "Search plugins": "Buscar complementos",
  "Search skills": "Buscar habilidades",
  "Loading plugin": "Cargando complemento",
  "Loading plugins": "Cargando complementos",
  "Installing plugin": "Instalando complemento",
  "No plugins installed. Browse the catalog, create a plugin, or run bb plugin install <source>.":
    "No hay complementos instalados. Explora el catálogo, crea un complemento o ejecuta bb plugin install <source>.",
  "No plugins match these filters.":
    "Ningún complemento coincide con estos filtros.",
  "No plugins match this search.":
    "Ningún complemento coincide con esta búsqueda.",
  "No skills match these filters.":
    "Ninguna habilidad coincide con estos filtros.",
  "No skills.sh resources available.":
    "No hay recursos de skills.sh disponibles.",
  "Explore plugin capabilities": "Explorar capacidades del complemento",
  "Plugin not found.": "No se encontró el complemento.",
  "Plugin removed from bb": "Complemento eliminado de bb",
  "Plugin uninstalled": "Complemento desinstalado",
  "Remove from bb": "Quitar de bb",
  "Remove plugin from bb?": "¿Quitar el complemento de bb?",
  "Uninstall plugin?": "¿Desinstalar complemento?",
  "Remove the plugin, then install it again from its source.":
    "Quita el complemento y vuelve a instalarlo desde su fuente.",
  "Checking for plugin updates failed":
    "No se pudieron comprobar las actualizaciones del complemento",
  "Installing the plugin failed": "No se pudo instalar el complemento",
  "Failed to reload plugin": "No se pudo recargar el complemento",
  "Failed to delete plugin": "No se pudo eliminar el complemento",
  "Install from npm, a Git repository, or a local path.":
    "Instala desde npm, un repositorio de Git o una ruta local.",
  "Install a version compatible with this bb.":
    "Instala una versión compatible con este bb.",
  "Update bb to install this plugin":
    "Actualiza bb para instalar este complemento",
  "Fix the plugin, then reload it.":
    "Corrige el complemento y vuelve a cargarlo.",
  "Reload the plugin. If it still fails, restart bb.":
    "Recarga el complemento. Si sigue fallando, reinicia bb.",
  "Reload the plugin. If it still fails, remove it and install it again.":
    "Recarga el complemento. Si sigue fallando, elimínalo y vuelve a instalarlo.",
  "Wait a moment, then reload the plugin.":
    "Espera un momento y vuelve a cargar el complemento.",
  "Add the required configuration, then reload the plugin.":
    "Añade la configuración necesaria y vuelve a cargar el complemento.",
  "Install bb CLI skills": "Instalar habilidades CLI de bb",
  "Open on skills.sh": "Abrir en skills.sh",
  "Not now": "Ahora no",
  "Included in plugin": "Incluido en el complemento",
  "Bundled with plugin": "Incluido con el complemento",
  "Built-in preview": "Vista previa integrada",
  "Built-in skill": "Habilidad integrada",
  "BB Official": "Oficial de BB",
  "BB preview": "Vista previa de BB",
  "Technical details": "Detalles técnicos",
  "In progress": "En curso",
  "Working for you": "Trabajando para ti",
  "Agent tool": "Herramienta del agente",
  "Background commands": "Comandos en segundo plano",
  "Background services": "Servicios en segundo plano",
  "Scheduled jobs": "Tareas programadas",
  "No editor configured": "No hay ningún editor configurado",
  "No searchable source": "No hay una fuente que se pueda buscar",
  "No searchable source is available.":
    "No hay ninguna fuente disponible para buscar",
  "No results match your search.": "Ningún resultado coincide con tu búsqueda.",
  "Search failed.": "La búsqueda falló.",
  "Searching files...": "Buscando archivos...",
  "File search results": "Resultados de búsqueda de archivos",
  "Type to search files.": "Escribe para buscar archivos.",
  "One page": "Una página",
  "Included with": "Incluido con",
  "Shared · project": "Compartido · proyecto",
  "Shared · user": "Compartido · usuario",
  "Ships with bb": "Incluido con bb",
  "Newest compatible": "Más reciente compatible",
  "Install date unavailable": "Fecha de instalación no disponible",
  Waiting: "Esperando",
  Working: "Trabajando",
  Stopped: "Detenido",
  Cancelled: "Cancelado",
  Canceled: "Cancelado",
  Starting: "Iniciando",
  Stopping: "Deteniendo",
  Streaming: "Transmitiendo",
  Thinking: "Pensando",
  "Awaiting approval": "Esperando aprobación",
  "Waiting for approval": "Esperando aprobación",
  "Awaiting input": "Esperando entrada",
  "Needs attention": "Requiere atención",
  "Provider unavailable": "Proveedor no disponible",
  "Provider error": "Error del proveedor",
  "Connection failed": "Falló la conexión",
  "Connection lost": "Se perdió la conexión",
  Reconnecting: "Reconectando",
  Connecting: "Conectando",
  Online: "En línea",
  Offline: "Sin conexión",
  "Failed to send message": "No se pudo enviar el mensaje",
  "Failed to queue message": "No se pudo poner el mensaje en cola",
  "Retry by sending a follow-up message":
    "Reintentar enviando una pregunta de seguimiento",
  "Retry the download": "Reintentar la descarga",
  "Download failed": "Falló la descarga",
  "Refreshing the marketplace failed": "No se pudo actualizar el mercado",
  "Removing the marketplace failed": "No se pudo quitar el mercado",
  "Adding the marketplace failed": "No se pudo añadir el mercado",
  "Couldn't load plugin.": "No se pudo cargar el complemento.",
  "Couldn't load plugins.": "No se pudieron cargar los complementos.",
  "Couldn't load skill.": "No se pudo cargar la habilidad.",
  "Couldn't load skills.": "No se pudieron cargar las habilidades.",
  "Couldn't load skills.sh.": "No se pudo cargar skills.sh.",
  "Couldn't load more from skills.sh.":
    "No se pudo cargar más contenido de skills.sh.",

  // Common input, browser, panel, and status strings
  "Search…": "Buscar…",
  "Search files…": "Buscar archivos…",
  "Search threads…": "Buscar hilos…",
  "Search projects…": "Buscar proyectos…",
  "Search messages…": "Buscar mensajes…",
  "Search commands": "Buscar comandos",
  "Search providers": "Buscar proveedores",
  "Search models": "Buscar modelos",
  "Search environments": "Buscar entornos",
  "Reply…": "Responder…",
  "Describe the plugin you want to build…":
    "Describe el complemento que quieres crear…",
  "Marketplace source": "Fuente del mercado",
  "Enter a path": "Introduce una ruta",
  "Enter a name": "Introduce un nombre",
  "Project name": "Nombre del proyecto",
  "Thread title": "Título del hilo",
  "Working directory": "Directorio de trabajo",
  "Select a folder": "Selecciona una carpeta",
  "Select a machine": "Selecciona una máquina",
  "Select a provider": "Selecciona un proveedor",
  "Select a model": "Selecciona un modelo",
  "Select an environment": "Selecciona un entorno",
  "Choose a folder": "Elige una carpeta",
  "Expand all files": "Expandir todos los archivos",
  "Collapse all files": "Contraer todos los archivos",
  "Scroll tabs left": "Desplazar pestañas a la izquierda",
  "Scroll tabs right": "Desplazar pestañas a la derecha",
  "Resize right panel": "Cambiar tamaño del panel derecho",
  "Resize right panel panes": "Cambiar tamaño de los paneles derechos",
  "Resize stacked right panel panes":
    "Cambiar tamaño de los paneles derechos apilados",
  "Resize thread and right panel":
    "Cambiar tamaño del hilo y del panel derecho",
  "Group tab here": "Agrupar pestaña aquí",
  "Panel tab": "Pestaña del panel",
  "Open preview": "Abrir vista previa",
  "Open with": "Abrir con",
  "Open with built-in preview": "Abrir con la vista previa integrada",
  "Open in": "Abrir en",
  "Open source": "Abrir fuente",
  "Open PRs": "Abrir solicitudes de incorporación",
  "Copy command": "Copiar comando",
  "Copy checkout value": "Copiar valor del checkout",
  "Copy directory": "Copiar directorio",
  "Directory copied": "Directorio copiado",
  "Failed to copy directory": "No se pudo copiar el directorio",
  "Failed to copy value": "No se pudo copiar el valor",
  "Failed to copy commit SHA": "No se pudo copiar el SHA de la confirmación",
  "Commit SHA copied": "SHA de la confirmación copiado",
  "No local changes.": "No hay cambios locales.",
  "No goal objective.": "No hay objetivo de meta.",
  "Clear active Goal": "Borrar meta activa",
  "Exit plan mode": "Salir del modo de planificación",
  "Expected commit action response.":
    "Se esperaba la respuesta de la acción de confirmación.",
  "Expected pull request draft action response.":
    "Se esperaba la respuesta de la acción de borrador de solicitud de incorporación.",
  "Expected pull request merge action response.":
    "Se esperaba la respuesta de la acción de combinación de solicitud de incorporación.",
  "Expected pull request ready action response.":
    "Se esperaba la respuesta de la acción de marcar solicitud de incorporación como lista.",
  "Expected squash merge action response.":
    "Se esperaba la respuesta de la acción de combinación con squash.",
  "Failed to start git action": "No se pudo iniciar la acción de Git",
  "Failed to update merge base branch":
    "No se pudo actualizar la rama base de combinación",
  "Failed to update pull request":
    "No se pudo actualizar la solicitud de incorporación",
  "Failed to merge pull request":
    "No se pudo combinar la solicitud de incorporación",
  "Pull request was not merged": "La solicitud de incorporación no se combinó",
  "Pull request was not updated":
    "La solicitud de incorporación no se actualizó",
  "Merging pull request": "Combinando solicitud de incorporación",
  "Rebase merging pull request":
    "Combinando solicitud de incorporación mediante rebase",
  "Marking pull request ready":
    "Marcando la solicitud de incorporación como lista",
  "Converting pull request to draft":
    "Convirtiendo la solicitud de incorporación en borrador",
  "Commit the current workspace changes, then squash merge this branch.":
    "Confirma los cambios actuales del espacio de trabajo y combina esta rama con squash.",
  "Squash merge this branch into the selected merge base.":
    "Combina esta rama con squash en la base de combinación seleccionada.",
  "Squash merge requires a local target branch.":
    "La combinación con squash necesita una rama local de destino.",
  "Squash merge requires an existing local target branch.":
    "La combinación con squash necesita una rama local de destino existente.",
  "Checking target branch": "Comprobando la rama de destino",
  "Git status": "Estado de Git",
};

const evaTranslations: Readonly<Record<string, string>> = {
  Agents: "Agentes",
  "EVA Agents": "EVA Agentes",
  "Loading agents": "Cargando agentes",
  "Agents could not be loaded.": "No se pudieron cargar los agentes.",
  "No activity yet": "Sin actividad todavía",
  Now: "Ahora",
  "New agent": "Nuevo agente",
  "Complete every field and use a valid agent id.":
    "Completa todos los campos y usa un id válido para el agente.",
  "Agent created": "Agente creado",
  "Agent could not be created": "No se pudo crear el agente",
  "All agents": "Todos los agentes",
  "Create a specialist with its own workspace, instructions, skills, and CLI tools.":
    "Crea un especialista con su propio workspace, instrucciones, habilidades y herramientas CLI.",
  "Example: Sales analyst": "Ejemplo: Analista de ventas",
  "Agent id": "Id del agente",
  "Lowercase letters, numbers, and hyphens. This also becomes its folder name and @ mention.":
    "Letras minúsculas, números y guiones. También será el nombre de su carpeta y su etiqueta @.",
  "Short mandate": "Mandato breve",
  "What work this agent should own": "Qué trabajo debe asumir este agente",
  "Saved as": "Se guardan como",
  "inside the agent folder. BB loads it when constructing the agent session.":
    "dentro de la carpeta del agente. BB las carga al construir su sesión.",
  "Describe goals, working style, limits, and when to delegate…":
    "Describe objetivos, forma de trabajar, límites y cuándo debe delegar…",
  "EVA will create": "EVA creará",
  "and the instructions file.": "y el archivo de instrucciones.",
  "Creating…": "Creando…",
  "Create agent": "Crear agente",
  "Agent status": "Estado del agente",
  "Status saved": "Estado guardado",
  "Instructions saved": "Instrucciones guardadas",
  "Every skill needs a name and instructions.":
    "Cada habilidad necesita un nombre e instrucciones.",
  "Skills saved": "Habilidades guardadas",
  "Start conversation": "Iniciar conversación",
  "Operating status": "Estado operativo",
  "The mode is added to the instructions for each new session.":
    "El modo se añade a las instrucciones de cada nueva sesión.",
  "Custom instructions": "Instrucciones personalizadas",
  "This editor changes": "Este editor modifica directamente",
  "directly. BB loads it when constructing the agent's next session.":
    "BB lo carga cuando construye la siguiente sesión del agente.",
  "Unsaved changes": "Cambios sin guardar",
  "Everything saved": "Todo guardado",
  "Custom skills": "Habilidades personalizadas",
  "Each skill is saved as a native BB skill in this agent's":
    "Cada habilidad se guarda como un skill nativo de BB en la carpeta",
  "folder.": "de este agente.",
  "Add skill": "Añadir habilidad",
  "No custom skills": "Sin habilidades personalizadas",
  "Add a capability with specific rules for this agent.":
    "Añade una capacidad con reglas concretas para este agente.",
  "Skill name": "Nombre de la habilidad",
  "Example: Campaign research": "Ejemplo: Investigación de campañas",
  "How this skill should be applied": "Cómo debe aplicar esta habilidad",
  "Describe the process, limits, and expected result.":
    "Describe el proceso, los límites y el resultado esperado.",
  "Uses BB's normal provider resolution.":
    "Usa la resolución normal de proveedores de BB.",
  "Agent workspace": "Workspace del agente",
  "Instructions in": "Instrucciones en",
  "skills in": "habilidades en",
  "CLI tools in": "herramientas CLI en",
  "Configure the agents root folder in Extensions → EVA Agents.":
    "Configura la carpeta raíz agents en Extensiones → EVA Agentes.",
  "Recent conversations": "Conversaciones recientes",
  "No conversations yet": "Sin conversaciones todavía",
  "Start a conversation": "Iniciar una conversación",
  "The host project is not configured.":
    "Falta configurar el proyecto anfitrión.",
  "Configure EVA's project in Extensions → EVA Agents before starting a conversation.":
    "Configura el proyecto de EVA en Extensiones → EVA Agentes antes de crear una conversación.",
  "Configure EVA's project in Extensions → EVA Agents before starting":
    "Configura el proyecto de EVA en Extensiones → EVA Agentes antes de",
  "a conversation.": "crear una conversación.",
  "Back to agent": "Volver al agente",
  "The agents workspace is not configured.":
    "Falta configurar el workspace de agentes.",
  "Conversation started": "Conversación iniciada",
  "New conversation with": "Nueva conversación con",
  "This conversation will be linked to": "Esta conversación se vinculará a",
  "Pinned provider:": "Proveedor fijado:",
  "Agent folder:": "Carpeta del agente:",
  "Switch agent": "Cambiar de agente",
  "EVA could not be loaded.": "No se pudo cargar EVA.",
  "Conversation name": "Nombre de la conversación",
  "Manage conversation": "Gestionar conversación",
  "Open in split pane": "Abrir en panel dividido",
  "No conversations": "Sin conversaciones",
  "Loading conversations…": "Cargando conversaciones…",
  "Chooses which agent acts and keeps work within bounds":
    "Decide qué agente actúa y controla los límites",
  "Reviews and approves everything that goes public":
    "Revisa y aprueba todo lo que sale al público",
  "Creates ads, images, videos, and pages":
    "Crea anuncios, imágenes, vídeos y páginas",
  "Facebook and Instagram campaigns": "Campañas de Facebook e Instagram",
  "TikTok campaigns and creative": "Campañas y creatividades de TikTok",
  "Google search, keywords, and campaigns":
    "Búsquedas, palabras clave y campañas de Google",
  "Lead queue, operators, and first calls":
    "Cola de leads, operadores y primera llamada",
  "Classifies email and creates tasks": "Clasifica el correo y crea tareas",
  "Calls and voice experiences for the app and web":
    "Llamadas y voz en la app y la web",
  "Failed payments and returns through collection":
    "Impagos y devoluciones hasta el cobro",
  "Team productivity and capacity": "Productividad del equipo y capacidad",
  "EVA host project": "Proyecto anfitrión de EVA",
  "Agents workspace folder": "Carpeta del workspace de agentes",
  "Absolute path to the agents repository. Each agent uses its own subfolder.":
    "Ruta absoluta al repositorio agents. Cada agente usa su propia subcarpeta.",
  "Listing EVA agents": "Consultando agentes de EVA",
  "Listed EVA agents": "Agentes de EVA consultados",
  "Delegating to EVA agent": "Delegando a un agente de EVA",
  "Delegated to EVA agent": "Trabajo delegado a un agente de EVA",
  "Finding agent threads": "Buscando hilos de agentes",
  "Found agent threads": "Hilos de agentes encontrados",
  "Reading agent result": "Leyendo resultado del agente",
  "Read agent result": "Resultado del agente leído",
  "Messaging EVA agent": "Enviando mensaje al agente de EVA",
  "Messaged EVA agent": "Mensaje enviado al agente de EVA",
};

const normalizedTranslations = new Map(
  [...Object.entries(translations), ...Object.entries(evaTranslations)].map(
    ([key, value]) => [
      key.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US"),
      value,
    ],
  ),
);

type DynamicRule = {
  pattern: RegExp;
  replace: (...matches: string[]) => string;
};

const evaAgentNameTranslations: Readonly<Record<string, string>> = {
  "master orchestrator": "Orquestador Maestro",
  compliance: "Cumplimiento",
  creativity: "Creatividad",
  "crm & call center": "CRM y Call Center",
  email: "Correo",
  "ai voice": "Voz IA",
  payments: "Recobro",
  hr: "RR. HH.",
};

const dynamicRules: readonly DynamicRule[] = [
  {
    pattern:
      /^(\d+)\s+agents?\s+·\s+(\d+)\s+live\s+·\s+(\d+)\s+shadow\s+·\s+(\d+)\s+conversations?\s+this\s+week$/i,
    replace: (_full, agents, live, shadow, conversations) =>
      `${agents} ${agents === "1" ? "agente" : "agentes"} · ${live} en vivo · ${shadow} en shadow · ${conversations} ${conversations === "1" ? "conversación" : "conversaciones"} esta semana`,
  },
  {
    pattern: /^(\d+)\s+conversations?\s+linked\s+to\s+this\s+agent\.$/i,
    replace: (_full, count) =>
      `${count} ${count === "1" ? "conversación vinculada" : "conversaciones vinculadas"} a este agente.`,
  },
  {
    pattern: /^(\d+)\s+conversations?$/i,
    replace: (_full, count) =>
      `${count} ${count === "1" ? "conversación" : "conversaciones"}`,
  },
  {
    pattern: /^(\d+)\s+of\s+16\s+skills$/i,
    replace: (_full, count) => `${count} de 16 habilidades`,
  },
  {
    pattern: /^(\d+)\s+weeks?\s+ago$/i,
    replace: (_full, count) =>
      `Hace ${count} ${count === "1" ? "semana" : "semanas"}`,
  },
  {
    pattern: /^Pinned to\s+(.+)$/i,
    replace: (_full, provider) => `Fijado a ${provider}`,
  },
  {
    pattern: /^New conversation (with|in)\s+(.+)$/i,
    replace: (_full, relation, target) => {
      const translatedTarget =
        relation.toLowerCase() === "with"
          ? (evaAgentNameTranslations[target.toLowerCase()] ?? target)
          : target;
      return `${relation.toLowerCase() === "with" ? "Nueva conversación con" : "Nueva conversación en"} ${translatedTarget}`;
    },
  },
  {
    pattern: /^No conversations match\s+[“\"](.+)[”\"]\.$/i,
    replace: (_full, query) =>
      `No hay conversaciones que coincidan con “${query}”.`,
  },
  {
    pattern: /^Manage\s+(.+)$/i,
    replace: (_full, target) => `Gestionar ${target}`,
  },
  {
    pattern: /^Delete skill\s+(.+)$/i,
    replace: (_full, skill) => `Eliminar habilidad ${skill}`,
  },
  {
    pattern: /^Skill\s+(\d+)$/i,
    replace: (_full, index) => `Habilidad ${index}`,
  },
  {
    pattern: /^(.+)\s+\((\d+)\s+conversations?\)$/i,
    replace: (_full, label, count) => `${label} (${count} conversaciones)`,
  },
  {
    pattern:
      /^(Master Orchestrator|Compliance|Creativity|CRM & Call Center|Email|AI Voice|Payments|HR)\s+—\s+(.+)$/i,
    replace: (_full, name, title) =>
      `${evaAgentNameTranslations[name.toLowerCase()] ?? name} — ${title}`,
  },
  {
    pattern: /^Open workspace in (.+?)(?: \((.+)\))?$/i,
    replace: (_full, label, other) =>
      "Abrir espacio de trabajo en " +
      label +
      (other === undefined ? "" : " (" + other + ")"),
  },
  {
    pattern: /^Find in page(?: \((.+)\))?$/i,
    replace: (_full, context) =>
      "Buscar en la página" +
      (context === undefined ? "" : " (" + context + ")"),
  },
  {
    pattern: /^(\d+)\s+of\s+(\d+)\s+selected$/i,
    replace: (_full, selected, total) =>
      selected + " de " + total + " seleccionados",
  },
  {
    pattern: /^(?:Delete|Remove)\s+["“](.*)["”]$/i,
    replace: (_full, title) => `Eliminar «${title}»`,
  },
  {
    pattern: /^Mark\s+["“](.*)["”]\s+as\s+(done|not done)$/i,
    replace: (_full, title, state) =>
      `Marcar «${title}» como ${state.toLowerCase() === "done" ? "completado" : "pendiente"}`,
  },
  {
    pattern: /^(\d+)\s+of\s+(\d+)\s+done$/i,
    replace: (_full, done, total) => `${done} de ${total} completados`,
  },
  {
    pattern: /^(\d+)\s+of\s+(\d+)$/i,
    replace: (_full, current, total) => `${current} de ${total}`,
  },
  {
    pattern: /^(\d+)\s+selected$/i,
    replace: (_full, count) => `${count} seleccionados`,
  },
  {
    pattern:
      /^(\d+)\s+(files?|folders?|threads?|messages?|projects?|changes?)$/i,
    replace: (_full, count, noun) => {
      const forms: Record<string, string> = {
        file: "archivo",
        files: "archivos",
        folder: "carpeta",
        folders: "carpetas",
        thread: "hilo",
        threads: "hilos",
        message: "mensaje",
        messages: "mensajes",
        project: "proyecto",
        projects: "proyectos",
        change: "cambio",
        changes: "cambios",
      };
      return `${count} ${forms[noun.toLowerCase()] ?? noun}`;
    },
  },
  {
    pattern: /^(\d+)\s+(minutes?|hours?|days?)\s+ago$/i,
    replace: (_full, count, unit) => {
      const units: Record<string, string> = {
        minute: "minuto",
        minutes: "minutos",
        hour: "hora",
        hours: "horas",
        day: "día",
        days: "días",
      };
      return `Hace ${count} ${units[unit.toLowerCase()] ?? unit}`;
    },
  },
  {
    pattern: /^Last updated\s+(.+)$/i,
    replace: (_full, date) => `Última actualización: ${date}`,
  },
  {
    pattern: /^Page\s+(\d+)\s+of\s+(\d+)$/i,
    replace: (_full, page, total) => `Página ${page} de ${total}`,
  },
  {
    pattern: /^Showing\s+(\d+)\s+of\s+(\d+)$/i,
    replace: (_full, shown, total) => `Mostrando ${shown} de ${total}`,
  },
];

function translateTrimmed(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const exact = normalizedTranslations.get(
    normalized.toLocaleLowerCase("en-US"),
  );
  if (exact !== undefined) return exact;

  for (const rule of dynamicRules) {
    const match = normalized.match(rule.pattern);
    if (match !== null) return rule.replace(...match);
  }
  return value;
}

/** Translate one UI string while preserving whitespace around it. */
export function translateText(value: string, language: Language): string {
  if (language === "en" || value.trim() === "") return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const inner = value.slice(leading.length, value.length - trailing.length);
  const translated = translateTrimmed(inner);
  return translated === inner ? value : `${leading}${translated}${trailing}`;
}

export function languageFromPayload(payload: unknown): Language | null {
  if (typeof payload !== "object" || payload === null) return null;
  const language = (payload as { language?: unknown }).language;
  return isLanguage(language) ? language : null;
}

/** Notify this BB client immediately after a setting is changed in the UI. */
export function announceLanguage(language: Language): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Private browsing or a restrictive browser policy can disable storage.
  }
  window.dispatchEvent(
    new CustomEvent(LANGUAGE_EVENT, { detail: { language } }),
  );
}

/** Read this browser profile's language preference. */
export function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : "en";
  } catch {
    return "en";
  }
}
