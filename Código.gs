// =========================================================================
// CONFIGURACIÓN RELATIVA DEL EVENTO (AUTODETECTADA)
// =========================================================================
const PESTANA_EVENTO_ACTIVO = "Respuestas de formulario 1";
const NOMBRE_CARPETA_POR_FIRMAR = "NO FIRMADOS";
const NOMBRE_CARPETA_FIRMADOS   = "FIRMADOS";

function obtenerNombreActividad() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let nombre = ss.getName();
  nombre = nombre
    .replace(/^Copia de\s+/i, "")
    .replace(/\s*\(\s*Respuestas de formularios?(\s*\d+)?\s*\)\s*$/i, "")
    .replace(/\s*\(\s*Respuestas de hojas? de c[aá]lculo(\s*\d+)?\s*\)\s*$/i, "")
    .replace(/\s*-\s*Respuestas de formularios?(\s*\d+)?/i, "")
    .replace(/\s*-\s*Respuestas de hojas de cálculo(\s*\d+)?/i, "")
    .trim();
  return nombre || "Jornada Académica";
}

function obtenerHojaActiva() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(PESTANA_EVENTO_ACTIVO) || ss.getSheets()[0];
}

// --- Salvaguardas del despacho automático ---
const UMBRAL_INTENTOS_MAXIMOS_POR_FILA = 3;
const LIMITE_HORAS_CAMPANA_DESPACHO = 72;
const COOLDOWN_MINUTOS_ALERTA_SIN_PROGRESO = 60;

const PROP_INICIO_CAMPANA = "despacho_inicio_campana_ts";
const PROP_INTENTOS_POR_DNI = "despacho_intentos_por_dni";
const PROP_ULTIMA_ALERTA_SIN_PROGRESO = "despacho_ultima_alerta_sin_progreso_ts";
const PROP_ULTIMA_ALERTA_ERROR_GENERAL = "despacho_ultima_alerta_error_general_ts";
const MAX_REINTENTOS_ERROR_GENERAL = 5;
const PROP_REINTENTOS_ERROR_GENERAL = "despacho_reintentos_error_general";

// =========================================================================
// HELPERS DE DESCUBRIMIENTO AUTOMÁTICO EN GOOGLE DRIVE
// =========================================================================
function getCarpetaContenedora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const parents = file.getParents();
  if (parents.hasNext()) {
    return parents.next();
  }
  throw new Error(
    "No se pudo identificar la carpeta contenedora del evento. " +
    "Asegurate de que la planilla esté guardada dentro de una carpeta y no suelta en la raíz de Drive."
  );
}

function obtenerOCrearSubcarpeta(nombreSubcarpeta) {
  const carpetaEvento = getCarpetaContenedora();
  const subcarpetas = carpetaEvento.getFoldersByName(nombreSubcarpeta);
  if (subcarpetas.hasNext()) {
    return subcarpetas.next();
  }
  Logger.log(`Subcarpeta '${nombreSubcarpeta}' creada automáticamente.`);
  return carpetaEvento.createFolder(nombreSubcarpeta);
}

// =========================================================================
// AUDITORÍA Y BALANCE DE FIRMAS
// =========================================================================
function obtenerBalanceFirmasInterno() {
  const carpetaPorFirmar = obtenerOCrearSubcarpeta(NOMBRE_CARPETA_POR_FIRMAR);
  const carpetaFirmados = obtenerOCrearSubcarpeta(NOMBRE_CARPETA_FIRMADOS);
  const sheet = obtenerHojaActiva();

  const nombresFirmados = new Set();
  const iterFirmados = carpetaFirmados.getFiles();
  while (iterFirmados.hasNext()) {
    const f = iterFirmados.next();
    if (f.getMimeType() === MimeType.PDF) {
      nombresFirmados.add(f.getName());
    }
  }

  let cantPorFirmar = 0;
  const listaFaltantes = [];
  const iterPorFirmar = carpetaPorFirmar.getFiles();
  while (iterPorFirmar.hasNext()) {
    const f = iterPorFirmar.next();
    if (f.getMimeType() === MimeType.PDF) {
      cantPorFirmar++;
      if (!nombresFirmados.has(f.getName())) {
        listaFaltantes.push(f.getName());
      }
    }
  }

  const cantFirmados = nombresFirmados.size;
  const total = cantPorFirmar + cantFirmados;
  const porcentaje = total > 0 ? ((cantFirmados / total) * 100).toFixed(1) : 0;

  const mapaDniNombre = new Map();
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const dni = String(data[i][3]).replace(/\D/g, "").trim();
      const nom = String(data[i][1]).trim();
      if (dni) mapaDniNombre.set(dni, nom);
    }
  }

  return {
    cantPorFirmar,
    cantFirmados,
    porcentaje,
    listaFaltantes,
    mapaDniNombre
  };
}

function comprobarEstadoFirmas() {
  const ui = SpreadsheetApp.getUi();
  const balance = obtenerBalanceFirmasInterno();
  let detalleFaltantes = "";

  if (balance.listaFaltantes.length > 0) {
    detalleFaltantes = "\n\n📋 Archivos pendientes de firma:\n";
    const limiteMuestra = Math.min(balance.listaFaltantes.length, 10);
    for (let j = 0; j < limiteMuestra; j++) {
      const archivo = balance.listaFaltantes[j];
      const dniExtraido = archivo.replace(/\D/g, "");
      const titular = balance.mapaDniNombre.get(dniExtraido) || "Titular no encontrado";
      detalleFaltantes += `• ${archivo} (${titular})\n`;
    }
    if (balance.listaFaltantes.length > 10) {
      detalleFaltantes += `... y ${balance.listaFaltantes.length - 10} más.\n`;
    }
  }

  ui.alert(
    "📊 Balance de Firmas de PDFs",
    `• En '${NOMBRE_CARPETA_POR_FIRMAR}': ${balance.cantPorFirmar}\n` +
    `• En '${NOMBRE_CARPETA_FIRMADOS}': ${balance.cantFirmados}\n` +
    `• Progreso: ${balance.porcentaje}%` +
    (balance.listaFaltantes.length === 0
      ? "\n\n🎉 ¡Todos los certificados generados están listos y firmados!"
      : detalleFaltantes),
    ui.ButtonSet.OK
  );
}

// =========================================================================
// EXPORTACIÓN E IMPORTACIÓN DE CSV DE ASISTENCIA
// =========================================================================
function descargarCsvAsistencia() {
  const sheet = obtenerHojaActiva();
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Error: No se encontró la hoja de datos.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    SpreadsheetApp.getUi().alert("La hoja no contiene datos para exportar.");
    return;
  }

  // REFACTOR: Filtro anti-inyección de fórmulas y normalización de fechas
  const contenidoCsv = data.map(fila =>
    fila.map(campo => {
      let valor = campo instanceof Date ? normalizarFechaHora(campo) : String(campo);
      if (/^[=+\-@]/.test(valor)) valor = "'" + valor; // Bloquea ejecución en Excel
      valor = valor.replace(/"/g, '""');
      return `"${valor}"`;
    }).join(",")
  ).join("\r\n");

  const nombreActividad = obtenerNombreActividad();
  const nombreArchivo = `${nombreActividad.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`;
  
  // REFACTOR: Agregado \uFEFF (BOM) para que Excel reconozca el UTF-8 (tildes y ñ)
  const base64 = Utilities.base64Encode("\uFEFF" + contenidoCsv, Utilities.Charset.UTF_8);

  const html = HtmlService.createHtmlOutput(`
    <html>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100%; margin: 0; background: #f8fafc;">
        <p style="color: #334155; font-size: 0.95rem;">Descargando padrón inicial...</p>
        <script>
          const a = document.createElement("a");
          a.href = "data:text/csv;charset=utf-8;base64,${base64}";
          a.download = "${nombreArchivo}";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => google.script.host.close(), 1000);
        </script>
      </body>
    </html>
  `).setWidth(260).setHeight(100);

  SpreadsheetApp.getUi().showModalDialog(html, "Exportando Padrón");
}


function exportarPadronDivididoPorMesas() {
  const ui = SpreadsheetApp.getUi();
  const respuesta = ui.prompt(
    "Exportar Padrón Dividido por Mesas",
    "¿En cuántas mesas/acreditadores querés dividir el padrón?\n" +
    "(Se reparte por cantidad real de inscriptos, no por letra fija, para que quede parejo entre mesas.)",
    ui.ButtonSet.OK_CANCEL
  );
  if (respuesta.getSelectedButton() !== ui.Button.OK) return;

  const n = parseInt(respuesta.getResponseText().trim(), 10);
  if (!n || n < 1 || n > 20) {
    ui.alert("Ingresá un número entero de mesas entre 1 y 20.");
    return;
  }

  const sheet = obtenerHojaActiva();
  if (!sheet) {
    ui.alert("Error: No se encontró la hoja de datos.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    ui.alert("La hoja no contiene datos para exportar.");
    return;
  }

  const encabezado = data[0];
  const filas = data.slice(1);

  if (n > filas.length) {
    ui.alert(`Pediste ${n} mesas, pero solo hay ${filas.length} inscriptos.`);
    return;
  }

  filas.sort((a, b) => String(a[1]).trim().localeCompare(String(b[1]).trim(), "es", { sensitivity: "base" }));

  const tamañoBase = Math.floor(filas.length / n);
  const resto = filas.length % n;
  const grupos = [];
  let inicio = 0;
  for (let i = 0; i < n; i++) {
    const tamaño = tamañoBase + (i < resto ? 1 : 0);
    grupos.push(filas.slice(inicio, inicio + tamaño));
    inicio += tamaño;
  }

  const nombreActividad = obtenerNombreActividad();
  const idLimpio = nombreActividad.replace(/[^a-zA-Z0-9_-]/g, "_");
  const blobs = [];
  const resumenPorMesa = [];
  
  grupos.forEach((grupo, i) => {
    // REFACTOR: Filtro anti-inyección y fechas normalizadas aplicados también acá
    const contenido = [encabezado, ...grupo].map(fila =>
      fila.map(campo => {
        let valor = campo instanceof Date ? normalizarFechaHora(campo) : String(campo);
        if (/^[=+\-@]/.test(valor)) valor = "'" + valor; // Bloquea ejecución en Excel
        valor = valor.replace(/"/g, '""');
        return `"${valor}"`;
      }).join(",")
    ).join("\r\n");
    
    const nombreArchivo = `${idLimpio}_Mesa_${i + 1}.csv`;
    blobs.push(Utilities.newBlob("\uFEFF" + contenido, "text/csv;charset=utf-8", nombreArchivo));

    const primerApellido = grupo.length > 0 ? String(grupo[0][1]).trim() : "-";
    const ultimoApellido = grupo.length > 0 ? String(grupo[grupo.length - 1][1]).trim() : "-";
    resumenPorMesa.push(`Mesa ${i + 1}: ${grupo.length} inscriptos (${primerApellido} → ${ultimoApellido})`);
  });

  const zipBlob = Utilities.zip(blobs, `Padrones_${idLimpio}_${n}_Mesas.zip`);
  const base64 = Utilities.base64Encode(zipBlob.getBytes());

  const html = HtmlService.createHtmlOutput(`
    <html>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100%; margin: 0; background: #f8fafc;">
        <p style="color: #334155; font-size: 0.95rem;">Descargando ${n} padrones...</p>
        <script>
          const a = document.createElement("a");
          a.href = "data:application/zip;base64,${base64}";
          a.download = "${zipBlob.getName()}";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => google.script.host.close(), 1000);
        </script>
      </body>
    </html>
  `).setWidth(280).setHeight(100);

  SpreadsheetApp.getUi().showModalDialog(html, "Exportando Padrones Divididos");

  Utilities.sleep(1500);
  ui.alert(
    "Padrón dividido generado",
    `Se generaron ${n} archivos dentro del ZIP:\n\n${resumenPorMesa.join("\n")}\n\n` +
    "Cargá cada archivo CSV en el dispositivo correspondiente con el botón 'Cargar Padrón'.",
    ui.ButtonSet.OK
  );
}

function importarCsvAsistenciaFinal() {
  const html = HtmlService.createHtmlOutput(`
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 12px; margin: 0; color: #1e293b; }
          p { font-size: 0.9rem; margin-top: 0; color: #64748b; }
          textarea { width: 100%; height: 160px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font-family: monospace; font-size: 0.8rem; }
          .btn-bar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
          button { padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem; }
          .btn-primary { background: #2563eb; color: white; }
          .btn-secondary { background: #e2e8f0; color: #475569; }
          #fileInput { margin-bottom: 8px; font-size: 0.85rem; }
        </style>
      </head>
      <body>
        <p>Seleccioná el archivo <b>asistencia_final.csv</b> consolidado o pegá su contenido:</p>
        <input type="file" id="fileInput" accept=".csv" />
        <textarea id="csvData" placeholder="Pegar contenido CSV aquí..."></textarea>
        <div class="btn-bar">
          <button class="btn-secondary" onclick="google.script.host.close()">Cancelar</button>
          <button class="btn-primary" id="btnProcesar" onclick="procesar()">Sincronizar Asistencia</button>
        </div>

        <script>
          document.getElementById('fileInput').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(evt) {
              document.getElementById('csvData').value = evt.target.result;
            };
            reader.readAsText(file, "UTF-8");
          });

          function procesar() {
            const texto = document.getElementById('csvData').value.trim();
            if (!texto) {
              alert("Por favor cargá un archivo o pegá el contenido del CSV.");
              return;
            }
            document.getElementById('btnProcesar').disabled = true;
            document.getElementById('btnProcesar').innerText = "Procesando...";
            google.script.run
              .withSuccessHandler(function(res) {
                alert(res);
                google.script.host.close();
              })
              .withFailureHandler(function(err) {
                alert("Error: " + err.message);
                document.getElementById('btnProcesar').disabled = false;
                document.getElementById('btnProcesar').innerText = "Sincronizar Asistencia";
              })
              .procesarTextoCsvFinal(texto);
          }
        </script>
      </body>
    </html>
  `).setWidth(480).setHeight(330);

  SpreadsheetApp.getUi().showModalDialog(html, "Sincronizar Asistencia Final");
}

// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// PROCESAMIENTO EN MEMORIA PARA OPTIMIZAR I/O (HORAS NORMALIZADAS)
// -------------------------------------------------------------------------
function normalizarFechaHora(valor) {
  if (!valor) return "";
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, "America/Argentina/Cordoba", "yyyy-MM-dd HH:mm:ss");
  }
  const str = String(valor).trim();
  // Si ya tiene el formato limpio y estándar YYYY-MM-DD HH:mm:ss, lo deja intacto
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
    return str;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, "America/Argentina/Cordoba", "yyyy-MM-dd HH:mm:ss");
  }
  return str;
}
function procesarTextoCsvFinal(textoCsv) {
  const sheet = obtenerHojaActiva();
  if (!sheet) throw new Error("No se encontró la hoja de datos del evento.");

  const lineas = Utilities.parseCsv(textoCsv);
  if (lineas.length <= 1) return "El CSV no contiene filas de datos válidas.";

  const dataActual = sheet.getDataRange().getValues();
  const mapaIndicesDni = new Map();

  for (let i = 1; i < dataActual.length; i++) {
    const dniExistente = String(dataActual[i][3]).replace(/\D/g, "").trim();
    if (dniExistente) {
      mapaIndicesDni.set(dniExistente, i);
    }
  }

  let actualizados = 0;
  const nuevasFilas = [];
  const nuevasPorDni = new Map();
  const now = Utilities.formatDate(new Date(), "America/Argentina/Cordoba", "yyyy-MM-dd HH:mm:ss");

  const totalColumnas = Math.max(dataActual[0].length, 11);

  for (let j = 1; j < lineas.length; j++) {
    const fila = lineas[j];
    if (fila.length < 4) continue;

    const nombre = String(fila[1] || "").trim();
    const email = String(fila[2] || "").trim();
    const dni = String(fila[3] || "").replace(/\D/g, "").trim();
    const constancia = String(fila[4] || "No").trim();
    const estadoEntradaCSV = String(fila[5] || "").trim();
    const horaEntrada = normalizarFechaHora(fila[6]);
    const estadoSalidaCSV = String(fila[7] || "").trim();
    const horaSalida = normalizarFechaHora(fila[8]);
    const invitaciones = String(fila[10] || "Sí").trim();

    if (!dni) continue;

    if (mapaIndicesDni.has(dni)) {
      const idx = mapaIndicesDni.get(dni);
      const rowNum = idx + 1; // Fila real en la hoja (idx es índice de array 0-based)
      
      const estadoEntradaHoja = String(dataActual[idx][5] || "").trim();
      const estadoSalidaHoja = String(dataActual[idx][7] || "").trim();

      // Lógica de protección: Solo actualizamos si el CSV tiene un estado superador
      let updateEntrada = estadoEntradaHoja;
      let updateHoraE = dataActual[idx][6];
      let updateSalida = estadoSalidaHoja;
      let updateHoraS = dataActual[idx][8];
      let modifico = false;

      if (estadoEntradaCSV === "Presente" && estadoEntradaHoja !== "Presente") {
        updateEntrada = "Presente";
        updateHoraE = horaEntrada;
        modifico = true;
      }
      if (estadoSalidaCSV === "Completado" && estadoSalidaHoja !== "Completado") {
        updateSalida = "Completado";
        updateHoraS = horaSalida;
        modifico = true;
      }

      // Actualización táctica: solo tocamos las 4 columnas de tiempo y estado de esa fila
      if (modifico) {
        sheet.getRange(rowNum, 6, 1, 4).setValues([[updateEntrada, updateHoraE, updateSalida, updateHoraS]]);
        actualizados++;
      }

    } else if (nuevasPorDni.has(dni)) {
      const nuevaFilaExistente = nuevasFilas[nuevasPorDni.get(dni)];
      nuevaFilaExistente[5] = estadoEntradaCSV || nuevaFilaExistente[5];
      nuevaFilaExistente[6] = horaEntrada || nuevaFilaExistente[6];
      nuevaFilaExistente[7] = estadoSalidaCSV || nuevaFilaExistente[7];
      nuevaFilaExistente[8] = horaSalida || nuevaFilaExistente[8];
      actualizados++;
    } else {
      const nuevaFila = [
        now,
        nombre || "Acreditado en Puerta",
        email,
        dni,
        constancia,
        estadoEntradaCSV || "Presente",
        horaEntrada || now,
        estadoSalidaCSV || "Completado",
        horaSalida || now,
        "No",
        invitaciones
      ];
      while (nuevaFila.length < totalColumnas) nuevaFila.push("");

      nuevasPorDni.set(dni, nuevasFilas.length);
      nuevasFilas.push(nuevaFila);
    }
  }

  // Insertamos solo las filas nuevas al final, sin destruir el resto de la hoja
  if (nuevasFilas.length > 0) {
    const filaDestino = sheet.getLastRow() + 1;
    sheet.getRange(filaDestino, 1, nuevasFilas.length, totalColumnas).setValues(nuevasFilas);
  }

  return `✅ Sincronización finalizada con éxito:\n\n• Asistentes actualizados: ${actualizados}\n• Nuevos inscriptos en puerta: ${nuevasFilas.length}`;
}
// =========================================================================
// ACTIVADORES Y MENÚ NATIVO
// =========================================================================
function configurarActivadoresAutomaticos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  try {
    eliminarTriggersDeFuncion("onFormSubmit");
    ScriptApp.newTrigger("onFormSubmit").forSpreadsheet(ss).onFormSubmit().create();
    ui.alert("✅ Activador de formulario configurado con éxito.", ui.ButtonSet.OK);
  } catch (error) {
    ui.alert("⚠️ Error al configurar activador: " + error.toString(), ui.ButtonSet.OK);
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎓 Certificaciones")
    .addItem("⚙️ Configurar Activadores Automáticos", "configurarActivadoresAutomaticos")
    .addSeparator()
    .addItem("🧹 Preparar Padrón Final (Limpiar Duplicados)", "prepararPadronFinal") // <-- ¡Nuevo botón!
    .addItem("📤 Exportar Padrón Inicial (CSV)", "descargarCsvAsistencia")
    .addItem("📤 Exportar Padrón Dividido por Mesas (ZIP)", "exportarPadronDivididoPorMesas")
    .addItem("📥 Sincronizar Asistencia Final (CSV)", "importarCsvAsistenciaFinal")
    .addSeparator()
    .addItem("📊 Consultar Estado de Firmas", "comprobarEstadoFirmas")
    .addItem("🚀 Despachar PDFs Firmados (Lote)", "iniciarDespachoFirmados")
    .addItem("🔄 Reiniciar Seguimiento de Despacho", "reiniciarSeguimientoDespacho")
    .addToUi();
}

// =========================================================================
// 1. REGISTRO (CORREO 1: CONFIRMACIÓN SIMPLE DE INSCRIPCIÓN CON QR)
// =========================================================================
function onFormSubmit(e) {
  try {
    let nombre = "";
    let email = "";
    let dni = "";

    // Leemos los datos directamente del objeto del evento para evitar tocar la hoja física
    if (e && e.namedValues) {
      const keys = Object.keys(e.namedValues);
      for (let k of keys) {
        const kNorm = k.toLowerCase();
        if (kNorm.includes("nombre")) nombre = e.namedValues[k][0];
        if (kNorm.includes("correo") || kNorm.includes("email")) email = e.namedValues[k][0];
        if (kNorm.includes("dni") || kNorm.includes("documento")) dni = e.namedValues[k][0];
      }
    } else {
      // Respaldo por si se ejecuta manualmente desde el editor (testing)
      const sheet = obtenerHojaActiva();
      const row = sheet.getLastRow();
      if (row <= 1) return;
      nombre = String(sheet.getRange(row, 2).getValue()).trim();
      email = String(sheet.getRange(row, 3).getValue()).trim();
      dni = String(sheet.getRange(row, 4).getValue()).toString();
    }

    dni = String(dni).replace(/\D/g, "").trim();

    if (!dni || !email) {
      Logger.log("Aviso: DNI o Email no detectados. No se envía el QR.");
      return;
    }

    const nombreActividad = obtenerNombreActividad();
    let inlineImagesMap = {};
    let bloqueQrHtml = "";
    
    try {
      const qrUrl = "https://quickchart.io/qr?text=" + encodeURIComponent(dni) + "&size=250&margin=2";
      const qrBlob = UrlFetchApp.fetch(qrUrl).getBlob().setName("qr_dni.png");
      inlineImagesMap = { codigoQr: qrBlob };
      bloqueQrHtml = `
        <div style="text-align: center; margin: 24px 0; padding: 18px; background-color: #f8fafc; border-radius: 10px; border: 1px dashed #cbd5e1;">
          <p style="margin: 0 0 10px 0; font-size: 0.82rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Mostrá este código para entrar y salir</p>
          <img src="cid:codigoQr" alt="Código QR DNI" style="width: 190px; height: 190px; display: inline-block; border-radius: 8px;" />
          <p style="margin: 10px 0 0 0; font-size: 1.15rem; font-weight: bold; color: #1e293b; letter-spacing: 1.5px;">DNI: ${dni}</p>
        </div>
      `;
    } catch (eQr) {
      Logger.log("Aviso: no se pudo obtener imagen QR de QuickChart.");
      bloqueQrHtml = `<p style="font-size: 1.25rem; font-weight: bold; color: #2563eb; margin: 16px 0; text-align: center;">DNI REGISTRADO: ${dni}</p>`;
    }

    MailApp.sendEmail({
      to: email,
      name: "Jornadas-Facultad de Ciencias de la Administración",
      subject: `Inscripción Confirmada - ${nombreActividad}`,
      htmlBody: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; max-width: 520px; margin: auto; padding: 22px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #2563eb; margin-top: 0; font-size: 1.35rem;">¡Inscripción Confirmada!</h2>
          <p>Hola <b>${escaparHtml(nombre)}</b>,</p>
          <p>Tu inscripción a <b>"${nombreActividad}"</b> ha sido registrada exitosamente.</p>
          ${bloqueQrHtml}
          <p style="font-size: 0.85rem; color: #64748b; line-height: 1.4;">Debés presentar el código QR desde la pantalla de tu celular al ingresar y al retirarte de la sala, o indicar tu DNI verbalmente en la mesa. Recordá que esto es obligatorio.</p>
          <p style="margin-bottom: 0; color: #334155;">¡Saludos cordiales!</p>
        </div>
      `,
      inlineImages: inlineImagesMap
    });

    Logger.log(`Correo con QR enviado a ${email} (DNI ${dni}).`);
  } catch (error) {
    Logger.log("Error en onFormSubmit: " + error.toString());
  }
}

// =========================================================================
// REFACTORIZADO: Seguimiento podado para respetar los 9 KB de PropertiesService
// =========================================================================
function obtenerEstadoIntentosDespacho() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP_INTENTOS_POR_DNI);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const normalizado = {};
    for (const dni in data) {
      const reg = data[dni];
      normalizado[dni] = {
        intentos: reg.intentos !== undefined ? reg.intentos : (reg.i || 0),
        bloqueada: reg.bloqueada !== undefined ? !!reg.bloqueada : !!reg.b
      };
    }
    return normalizado;
  } catch (e) {
    return {};
  }
}

function guardarEstadoIntentosDespacho(mapaEstado) {
  const estadoCompacto = {};
  for (const dni in mapaEstado) {
    const reg = mapaEstado[dni];
    const cant = reg.intentos !== undefined ? reg.intentos : (reg.i || 0);
    const bloq = reg.bloqueada !== undefined ? !!reg.bloqueada : !!reg.b;
    
    if (cant > 0 || bloq) {
      estadoCompacto[dni] = { i: cant, b: bloq };
    }
  }

  const json = JSON.stringify(estadoCompacto);
  if (json.length > 8000) {
    const soloBloqueadas = {};
    for (const dni in estadoCompacto) {
      if (estadoCompacto[dni].b) soloBloqueadas[dni] = { b: true, i: UMBRAL_INTENTOS_MAXIMOS_POR_FILA };
    }
    PropertiesService.getScriptProperties().setProperty(PROP_INTENTOS_POR_DNI, JSON.stringify(soloBloqueadas));
  } else {
    PropertiesService.getScriptProperties().setProperty(PROP_INTENTOS_POR_DNI, json);
  }
}

function registrarIntentoFallidoDni(mapaEstado, dni) {
  const reg = mapaEstado[dni] || { intentos: 0, bloqueada: false };
  let intentos = (reg.intentos !== undefined ? reg.intentos : reg.i) || 0;
  let bloqueada = reg.bloqueada !== undefined ? !!reg.bloqueada : !!reg.b;

  if (!bloqueada) {
    intentos += 1;
    if (intentos >= UMBRAL_INTENTOS_MAXIMOS_POR_FILA) {
      bloqueada = true;
    }
  }
  mapaEstado[dni] = { intentos: intentos, bloqueada: bloqueada, i: intentos, b: bloqueada };
  return bloqueada;
}

function estaDniBloqueado(mapaEstado, dni) {
  const reg = mapaEstado[dni];
  if (!reg) return false;
  return reg.bloqueada !== undefined ? !!reg.bloqueada : !!reg.b;
}

function obtenerInicioCampanaDespacho() {
  const props = PropertiesService.getScriptProperties();
  let inicio = props.getProperty(PROP_INICIO_CAMPANA);
  if (!inicio) {
    inicio = new Date().getTime().toString();
    props.setProperty(PROP_INICIO_CAMPANA, inicio);
  }
  return parseInt(inicio, 10);
}

function horasTranscurridasDesdeInicioCampana() {
  const inicio = obtenerInicioCampanaDespacho();
  return (new Date().getTime() - inicio) / (1000 * 60 * 60);
}

function puedeEnviarAlertaSinProgreso() {
  const props = PropertiesService.getScriptProperties();
  const ultima = props.getProperty(PROP_ULTIMA_ALERTA_SIN_PROGRESO);
  if (!ultima) return true;
  const minutosDesdeUltima = (new Date().getTime() - parseInt(ultima, 10)) / (1000 * 60);
  return minutosDesdeUltima >= COOLDOWN_MINUTOS_ALERTA_SIN_PROGRESO;
}

function marcarAlertaSinProgresoEnviada() {
  PropertiesService.getScriptProperties().setProperty(PROP_ULTIMA_ALERTA_SIN_PROGRESO, new Date().getTime().toString());
}

function reiniciarSeguimientoDespacho() {
  const ui = SpreadsheetApp.getUi();
  const respuesta = ui.alert(
    "Reiniciar seguimiento de despacho",
    "Esto borra los contadores de intentos, las filas marcadas como bloqueadas y el cronómetro de la campaña actual. " +
    "Usalo después de corregir manualmente los archivos faltantes en Drive. ¿Continuar?",
    ui.ButtonSet.YES_NO
  );
  if (respuesta !== ui.Button.YES) return;

  eliminarTriggersDeFuncion("despacharPdfsFirmados");
  
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_INICIO_CAMPANA);
  props.deleteProperty(PROP_INTENTOS_POR_DNI);
  props.deleteProperty(PROP_ULTIMA_ALERTA_SIN_PROGRESO);
  props.deleteProperty(PROP_ULTIMA_ALERTA_ERROR_GENERAL);
  props.deleteProperty(PROP_REINTENTOS_ERROR_GENERAL);
  ui.alert("✅ Seguimiento de despacho reiniciado. El próximo despacho arranca con el cronómetro y los contadores en cero.");
}

// =========================================================================
// 2. DESPACHO MASIVO (CORREO 2: ENVÍO DE CERTIFICADOS FIRMADOS)
// =========================================================================
function iniciarDespachoFirmados() {
  const ui = SpreadsheetApp.getUi();
  
  // --- CANDADO DE SEGURIDAD (Evita colisiones con los triggers) ---
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    ui.alert(
      "⚠️ Despacho en curso", 
      "El sistema ya está enviando correos en segundo plano. Esperá unos minutos antes de volver a lanzarlo para no enviar certificados duplicados.", 
      ui.ButtonSet.OK
    );
    return;
  }

  try {
    const balance = obtenerBalanceFirmasInterno();

    if (balance.listaFaltantes.length > 0) {
      let detalle = `⚠️ DESPACHO CANCELADO: Faltan firmar y pasar a la carpeta '${NOMBRE_CARPETA_FIRMADOS}' los siguientes archivos:\n\n`;
      const maxMuestra = Math.min(balance.listaFaltantes.length, 8);
      for (let i = 0; i < maxMuestra; i++) {
        const arch = balance.listaFaltantes[i];
        const dni = arch.replace(/\D/g, "");
        const nom = balance.mapaDniNombre.get(dni) || "Desconocido";
        detalle += `• ${arch} (${nom})\n`;
      }
      if (balance.listaFaltantes.length > 8) {
        detalle += `... y ${balance.listaFaltantes.length - 8} más.\n`;
      }
      detalle += `\nFirmá y mové estos archivos a '${NOMBRE_CARPETA_FIRMADOS}' antes de despachar.`;
      ui.alert("Faltan firmas obligatorias", detalle, ui.ButtonSet.OK);
      return;
    }

    if (balance.cantFirmados === 0) {
      ui.alert("Atención", `No hay ningún archivo disponible en la carpeta '${NOMBRE_CARPETA_FIRMADOS}' para despachar.`, ui.ButtonSet.OK);
      return;
    }

    eliminarTriggersDeFuncion("despacharPdfsFirmados");
    despacharPdfsFirmados();

  } finally {
    // --- LIBERAR EL CANDADO ---
    // Esto asegura que el bloqueo se levante sí o sí, incluso si hubo un error en tu código
    lock.releaseLock();
  }
}

function despacharPdfsFirmados() {
  const props = PropertiesService.getScriptProperties();
  try {
    despacharPdfsFirmadosInterno();
    props.deleteProperty(PROP_REINTENTOS_ERROR_GENERAL); // ciclo OK: se resetea el contador
  } catch (errorGeneral) {
    Logger.log("Error general en despacharPdfsFirmados: " + errorGeneral.toString());

    const intentos = (parseInt(props.getProperty(PROP_REINTENTOS_ERROR_GENERAL), 10) || 0) + 1;
    props.setProperty(PROP_REINTENTOS_ERROR_GENERAL, String(intentos));

    if (intentos < MAX_REINTENTOS_ERROR_GENERAL) {
      programarTrigger("despacharPdfsFirmados", intentos * 60 * 1000); // 1, 2, 3, 4 min
      return;
    }

    // Reintentos agotados: se corta el bucle y se avisa siempre
    eliminarTriggersDeFuncion("despacharPdfsFirmados");
    props.deleteProperty(PROP_REINTENTOS_ERROR_GENERAL);
    try {
      const nombreActividad = obtenerNombreActividad();
      MailApp.sendEmail({
        to: Session.getEffectiveUser().getEmail(),
        subject: `[ERROR] El despacho se detuvo tras ${MAX_REINTENTOS_ERROR_GENERAL} fallos consecutivos - ${nombreActividad}`,
        htmlBody: `
          <h2>⚠️ Falló despacharPdfsFirmados</h2>
          <p>Último error: ${errorGeneral.toString()}</p>
          <p>Se reintentó ${MAX_REINTENTOS_ERROR_GENERAL} veces y el bucle automático fue detenido.
          Corregí la causa y relanzá el despacho desde el menú "🎓 Certificaciones → 🚀 Despachar PDFs Firmados (Lote)".</p>
        `
      });
    } catch (_) {}
  }
}

function despacharPdfsFirmadosInterno() {
  const tiempoInicio = new Date().getTime();
  const LIMITE_TIEMPO_MS = 4.5 * 60 * 1000;
  const sheet = obtenerHojaActiva();
  if (!sheet) return;

  const cuotaInicial = MailApp.getRemainingDailyQuota();
  if (cuotaInicial <= 1) {
    Logger.log("Ejecución pausada al inicio: cuota reservada para el reporte.");
    manejarPausaPorCuota(0, cuotaInicial, []);
    return;
  }

  const carpetaFirmados = obtenerOCrearSubcarpeta(NOMBRE_CARPETA_FIRMADOS);
  const mapaFirmados = new Map();
  const iterFirmados = carpetaFirmados.getFiles();
  
  while (iterFirmados.hasNext()) {
    const f = iterFirmados.next();
    // FIX 2: Normalizamos los nombres de archivo a minúsculas para que no falle si alguien pone .PDF
    mapaFirmados.set(f.getName().toLowerCase(), f); 
  }

  // FIX 3: Guarda de seguridad. Si la carpeta está vacía, abortamos para no bloquear masivamente a la gente.
  if (mapaFirmados.size === 0) {
    throw new Error(
      "La carpeta '" + NOMBRE_CARPETA_FIRMADOS + "' está vacía o no se pudo leer. " +
      "Se aborta el ciclo para no bloquear filas por un archivo que no se encontró."
    );
  }

  const estadoIntentos = obtenerEstadoIntentosDespacho();
  const dniRecienBloqueados = [];
  const nombreActividad = obtenerNombreActividad();

  const data = sheet.getDataRange().getValues();
  let despachadosEnTanda = 0;
  let cuotaAgotada = false;
  const logErrores = [];

  for (let i = 1; i < data.length; i++) {
    if (new Date().getTime() - tiempoInicio > LIMITE_TIEMPO_MS) break;
    if (MailApp.getRemainingDailyQuota() <= 1) {
      cuotaAgotada = true;
      break;
    }

    const row = i + 1;
    const nombre = String(data[i][1]).trim();
    const email = String(data[i][2]).trim();
    const dni = String(data[i][3]).replace(/\D/g, "").trim();
    const quiereMaterial = String(data[i][4]).trim().toLowerCase();
    const estadoSalida = data[i][7];
    const yaCertificado = data[i][9];

    if (estadoSalida === "Completado" && yaCertificado !== "Sí" && yaCertificado !== "ERROR") {
      if (estaDniBloqueado(estadoIntentos, dni)) continue;

      // Buscamos los archivos forzando a minúsculas
      const certFile = mapaFirmados.get(`certificado_${dni}.pdf`.toLowerCase());
      const solicitaExtra = (quiereMaterial === "sí" || quiereMaterial === "si" || quiereMaterial === "yes");
      const extraFile = solicitaExtra ? mapaFirmados.get(`constancia_${dni}.pdf`.toLowerCase()) : null;

      if (certFile && (!solicitaExtra || extraFile)) {
        try {
          const adjuntos = [certFile.getAs(MimeType.PDF)];
          let textoMaterial = "";

          if (solicitaExtra && extraFile) {
            adjuntos.push(extraFile.getAs(MimeType.PDF));
            textoMaterial = "<p>Adjuntamos también tu constancia de asistencia solicitada.</p>";
          }

          MailApp.sendEmail({
            to: email,
            name: "Jornadas-Facultad de Ciencias de la Administración",
            subject: `Certificado Oficial de Asistencia - ${nombreActividad}`,
            htmlBody: `
              <p>Hola <b>${escaparHtml(nombre)}</b>,</p>
              <p>La Facultad de Ciencias de la Administración se complace en hacerle llegar su certificado de asistencia a <b>"${nombreActividad}"</b>. Quedamos a disposición por cualquier consulta.</p>
              ${textoMaterial}
              <p>¡Muchas gracias! Atentamente.</p>
            `,
            attachments: adjuntos
          });

          sheet.getRange(row, 10).setValue("Sí");
          despachadosEnTanda++;
          Utilities.sleep(1200);
        } catch (err) {
          const errMsg = err.toString().toLowerCase();
          // Hacemos la detección de cuota más específica para no frenar la campaña por un PDF muy pesado
          if (errMsg.includes("service invoked too many times") || errMsg.includes("daily message quota") || MailApp.getRemainingDailyQuota() <= 1) {
            cuotaAgotada = true;
            break;
          } else {
            logErrores.push(`${nombre} (${email}): ${err.toString()}`);
            // FIX 1: Marcamos ERROR en la hoja para no caer en un bucle infinito por un mail mal escrito
            sheet.getRange(row, 10).setValue("ERROR"); 
          }
        }
      } else {
        const seAcabaDeBloquear = registrarIntentoFallidoDni(estadoIntentos, dni);
        if (seAcabaDeBloquear) {
          dniRecienBloqueados.push({
            dni, nombre, email,
            motivo: !certFile ? "Falta el certificado firmado" : "Falta la constancia solicitada"
          });
        }
      }
    }
  }

  guardarEstadoIntentosDespacho(estadoIntentos);
  
  // (El resto de la función para mandar reportes y pausar se mantiene igual)
  const cuotaRestante = MailApp.getRemainingDailyQuota();
  const emailOrganizador = Session.getEffectiveUser().getEmail();

  if (dniRecienBloqueados.length > 0 && cuotaRestante > 1) {
    try { enviarAlertaFilasBloqueadas(emailOrganizador, dniRecienBloqueados); } catch (_) {}
  }

  if (cuotaAgotada || cuotaRestante <= 1) {
    manejarPausaPorCuota(despachadosEnTanda, cuotaRestante, logErrores);
    return;
  }

  const dataFinal = sheet.getDataRange().getValues();
  let existenPendientesReales = false;
  let pendientesBloqueadas = 0;
  let totalAcumuladoDespachados = 0;

  for (let j = 1; j < dataFinal.length; j++) {
    if (dataFinal[j][9] === "Sí") totalAcumuladoDespachados++;
    if (dataFinal[j][7] === "Completado" && dataFinal[j][9] !== "Sí" && dataFinal[j][9] !== "ERROR") {
      const dniFila = String(dataFinal[j][3]).replace(/\D/g, "").trim();
      if (estaDniBloqueado(estadoIntentos, dniFila)) {
        pendientesBloqueadas++;
      } else {
        existenPendientesReales = true;
      }
    }
  }

  const horasTranscurridas = horasTranscurridasDesdeInicioCampana();
  const seAgotoElTiempoDeCampana = horasTranscurridas > LIMITE_HORAS_CAMPANA_DESPACHO;

  if (existenPendientesReales && despachadosEnTanda === 0 && !cuotaAgotada && puedeEnviarAlertaSinProgreso()) {
    marcarAlertaSinProgresoEnviada();
    try { enviarAlertaSinProgreso(emailOrganizador, horasTranscurridas); } catch (_) {}
  }

  if (existenPendientesReales && !seAgotoElTiempoDeCampana) {
    programarTrigger("despacharPdfsFirmados", 60 * 1000);
  } else {
    eliminarTriggersDeFuncion("despacharPdfsFirmados");
    const estadoFinal = existenPendientesReales
      ? "DETENIDO_LIMITE_TIEMPO"
      : (pendientesBloqueadas > 0 ? "FINALIZADO_CON_BLOQUEADAS" : "FINALIZADO");
    enviarReporteDespacho(emailOrganizador, despachadosEnTanda, cuotaRestante, estadoFinal, logErrores, pendientesBloqueadas, horasTranscurridas, totalAcumuladoDespachados);
  }
}

function manejarPausaPorCuota(despachadosEnTanda, cuotaRestante, logErrores) {
  eliminarTriggersDeFuncion("despacharPdfsFirmados");
  programarTrigger("despacharPdfsFirmados", 24 * 60 * 60 * 1000);
  Logger.log("Pausa de 24 horas programada.");

  if (cuotaRestante >= 1) {
    try {
      let totalAcumulado = 0;
      const sheet = obtenerHojaActiva();
      if (sheet) {
        const valores = sheet.getDataRange().getValues();
        for (let r = 1; r < valores.length; r++) {
          if (valores[r][9] === "Sí") totalAcumulado++;
        }
      }

      const emailOrganizador = Session.getEffectiveUser().getEmail();
      enviarReporteDespacho(emailOrganizador, despachadosEnTanda, cuotaRestante - 1, "PAUSADO_CUOTA", logErrores, 0, 0, totalAcumulado);
    } catch (e) {
      Logger.log("No se pudo enviar el reporte de cuota: " + e.toString());
    }
  } else {
    Logger.log("Cuota absoluta en 0. No es posible enviar el correo de reporte.");
  }
}

function puedeEnviarAlertaErrorGeneral() {
  const props = PropertiesService.getScriptProperties();
  const ultima = props.getProperty(PROP_ULTIMA_ALERTA_ERROR_GENERAL);
  if (!ultima) return true;
  const minutosDesdeUltima = (new Date().getTime() - parseInt(ultima, 10)) / (1000 * 60);
  return minutosDesdeUltima >= COOLDOWN_MINUTOS_ALERTA_SIN_PROGRESO;
}

function marcarAlertaErrorGeneralEnviada() {
  PropertiesService.getScriptProperties().setProperty(PROP_ULTIMA_ALERTA_ERROR_GENERAL, new Date().getTime().toString());
}

function enviarAlertaFilasBloqueadas(destinatario, filasBloqueadas) {
  const nombreActividad = obtenerNombreActividad();
  let cuerpo = `
    <h2>⚠️ Filas bloqueadas en el despacho automático</h2>
    <p>Las siguientes personas tienen su jornada "Completada" pero el sistema no encontró su certificado
    (o constancia solicitada) en la carpeta '${NOMBRE_CARPETA_FIRMADOS}' después de ${UMBRAL_INTENTOS_MAXIMOS_POR_FILA} intentos.
    Dejaron de reintentarse automáticamente para no trabar el despacho del resto.</p>
    <ul>
  `;
  filasBloqueadas.forEach(f => {
    cuerpo += `<li><b>${f.nombre}</b> (DNI ${f.dni}, ${f.email}) — ${f.motivo}</li>`;
  });
  cuerpo += `</ul>
    <p>Revisá el archivo correspondiente en Drive y, una vez corregido, usá el menú
    "🎓 Certificaciones → 🔄 Reiniciar Seguimiento de Despacho" para que vuelva a intentarse.</p>
  `;
  MailApp.sendEmail({
    to: destinatario,
    subject: `[Acción requerida] Certificados bloqueados en el despacho - ${nombreActividad}`,
    htmlBody: cuerpo
  });
}

function enviarAlertaSinProgreso(destinatario, horasTranscurridas) {
  const nombreActividad = obtenerNombreActividad();
  const cuerpo = `
    <h2>⚠️ El despacho no avanzó en el último ciclo</h2>
    <p>Hay personas pendientes de recibir su certificado, la cuota de Gmail no está agotada, y sin embargo
    no se envió ningún correo en el último intento. Esto puede indicar un problema distinto a la cuota
    (por ejemplo, la carpeta '${NOMBRE_CARPETA_FIRMADOS}' vacía o mal ubicada).</p>
    <p>La campaña de despacho lleva ${horasTranscurridas.toFixed(1)} horas corriendo
    (límite antes de detenerse solo: ${LIMITE_HORAS_CAMPANA_DESPACHO} hs).</p>
    <p>Te recomendamos revisar manualmente el estado desde el menú
    "🎓 Certificaciones → 📊 Consultar Estado de Firmas".</p>
  `;
  MailApp.sendEmail({
    to: destinatario,
    subject: `[Atención] El despacho de certificados no está avanzando - ${nombreActividad}`,
    htmlBody: cuerpo
  });
}

function enviarReporteDespacho(destinatario, enviados, cuotaRestante, estado, errores, pendientesBloqueadas, horasTranscurridas, totalAcumulado) {
  const titulosPorEstado = {
    FINALIZADO: 'Completado',
    FINALIZADO_CON_BLOQUEADAS: 'Completado con filas bloqueadas',
    PAUSADO_CUOTA: 'Pausa por Cuota',
    DETENIDO_LIMITE_TIEMPO: 'Detenido por límite de tiempo'
  };
  const descripcionesPorEstado = {
    FINALIZADO: '✅ Todos los certificados disponibles fueron despachados.',
    FINALIZADO_CON_BLOQUEADAS: `⚠️ Se despacharon todos los certificados disponibles, pero quedan ${pendientesBloqueadas || 0} fila(s) bloqueada(s) que requieren revisión manual (ver alertas previas).`,
    PAUSADO_CUOTA: '⚠️ Pausa activada por límite de cuota diaria.',
    DETENIDO_LIMITE_TIEMPO: `⚠️ El despacho se detuvo porque superó las ${LIMITE_HORAS_CAMPANA_DESPACHO} horas de reintento continuo (llevaba ${(horasTranscurridas || 0).toFixed(1)} hs) y todavía quedan personas pendientes.`
  };

  const nombreActividad = obtenerNombreActividad();
  const asunto = `[Reporte] Despacho de Certificados - ${nombreActividad} - ${titulosPorEstado[estado] || estado}`;
  
  const lineaTotal = (totalAcumulado !== undefined)
    ? `<p><b>Total acumulado despachados (evento):</b> ${totalAcumulado}</p>`
    : "";

  let cuerpo = `
    <h2>Reporte de Envío de Certificados</h2>
    <p><b>Estado del lote:</b> ${descripcionesPorEstado[estado] || estado}</p>
    <p><b>Certificados despachados en este ciclo:</b> ${enviados}</p>
    ${lineaTotal}
    <p><b>Cuota diaria restante en Gmail:</b> ${cuotaRestante} correos disponibles.</p>
  `;
  if (errores && errores.length > 0) {
    cuerpo += `<h3>Errores individuales:</h3><ul>`;
    errores.forEach(err => { cuerpo += `<li>${err}</li>`; });
    cuerpo += `</ul>`;
  }
  if (estado === 'PAUSADO_CUOTA') {
    cuerpo += `<p><i>El activador continuará automáticamente en 24 horas.</i></p>`;
  }
  if (estado === 'DETENIDO_LIMITE_TIEMPO') {
    cuerpo += `<p><i>El sistema dejó de reintentar automáticamente. Corregí lo que falte y volvé a ejecutar
    "🎓 Certificaciones → 🚀 Despachar PDFs Firmados (Lote)" manualmente para retomar.</i></p>`;
  }

  MailApp.sendEmail({
    to: destinatario,
    subject: asunto,
    htmlBody: cuerpo
  });
}

// =========================================================================
// PREPARACIÓN DEL PADRÓN FINAL (Cierre de inscripciones)
// =========================================================================
function prepararPadronFinal() {
  const ui = SpreadsheetApp.getUi();
  const respuesta = ui.alert(
    "🧹 Preparar Padrón Final",
    "Esta acción debe ejecutarse cuando cierres las inscripciones.\n\nEliminará automáticamente todos los DNI duplicados y preparará las columnas de asistencia para exportar el CSV a la PWA.\n\n¿Querés continuar?",
    ui.ButtonSet.YES_NO
  );
  
  if (respuesta !== ui.Button.YES) return;

  const sheet = obtenerHojaActiva();
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    ui.alert("No hay datos para procesar.");
    return;
  }

  const encabezado = data[0];
  const filas = data.slice(1);
  const dnisProcesados = new Set();
  const filasLimpias = [];
  let duplicadosBorrados = 0;

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const dni = String(fila[3]).replace(/\D/g, "").trim();

    if (!dni) {
      filasLimpias.push(fila);
      continue;
    }

    // Lógica de deduplicación limpia
    if (dnisProcesados.has(dni)) {
      duplicadosBorrados++;
      continue; 
    }
    dnisProcesados.add(dni);

    // Rellenamos las columnas vacías para que el array quede parejo (11 columnas)
    while (fila.length < 11) fila.push("");

    // Seteamos los estados iniciales solo si están vacíos
    if (!fila[5]) fila[5] = "Pendiente"; // Estado Entrada
    if (!fila[7]) fila[7] = "Pendiente"; // Estado Salida
    if (!fila[9]) fila[9] = "No";        // Certificado Enviado

    filasLimpias.push(fila);
  }

  // Escribimos los datos limpios en la hoja en una sola transacción
  sheet.getDataRange().clearContent();
  const datosFinales = [encabezado, ...filasLimpias];
  sheet.getRange(1, 1, datosFinales.length, datosFinales[0].length).setValues(datosFinales);

  ui.alert(
    "Padrón Preparado con Éxito",
    `✅ Se procesaron ${filasLimpias.length} inscriptos válidos.\n🗑️ Se eliminaron ${duplicadosBorrados} registros duplicados.\n\nEl sistema está listo para que exportes el CSV.`,
    ui.ButtonSet.OK
  );
}

function programarTrigger(nombreFuncion, delayMs) {
  eliminarTriggersDeFuncion(nombreFuncion);
  ScriptApp.newTrigger(nombreFuncion).timeBased().after(delayMs).create();
}

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function eliminarTriggersDeFuncion(nombreFuncion) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === nombreFuncion) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
