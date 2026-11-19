# Sistema de Acreditación y Certificación de Eventos — FCAD (UNER)

Suite de automatización end-to-end desarrollada para el Área de Extensión de la Facultad de Ciencias de la Administración (FCAD - UNER). Digitaliza el ciclo completo de eventos académicos: desde la inscripción con código QR y el control de asistencia en puerta sin conexión a internet, hasta la generación masiva de certificados PDF y su envío automatizado respetando las cuotas diarias de Gmail.

---

## El problema que resuelve

La gestión manual de jornadas y cursos (planillas en papel, consolidación manual entre varias mesas, edición uno a uno de certificados y envíos individuales por correo) genera cuellos de botella en la entrada, errores de tipeo en nombres/DNIs y horas de trabajo administrativo posterior.

Este sistema automatiza todo el flujo de extremo a extremo, permitiendo operar en salones sin Wi-Fi estable y garantizando trazabilidad desde la inscripción hasta la entrega del certificado firmado digitalmente.

---

## Flujo de trabajo (End-to-End)

```text
[1. Google Forms + Sheets (Código.gs)]
        │  Envío automático de correo de confirmación con QR (DNI)
        │  Limpieza de duplicados y exportación de padrón (CSV único o ZIP por mesas)
        ▼
[2. Acreditador Offline (Acreditador Offline.html)]
        │  Control de Entrada y Salida en múltiples dispositivos (localStorage)
        │  Registro de inscriptos en puerta + feedback sonoro/háptico
        ▼
[3. Unificador de Mesas (UnificadorFCAD.py)]
        │  Consolida los CSVs de todas las mesas en un único asistencia_final.csv
        │  Prioriza entrada más temprana y salida más tardía; reporta descartados
        ▼
[4. Generador y Normalizador de PDFs (GeneradorPDF.py / NormalizadorPDF.py)]
        │  Genera Certificados y Constancias AcroForm aplanados (no editables)
        │  Tras la firma digital, normaliza los nombres a Certificado_<DNI>.pdf
        ▼
[5. Despacho Automático por Lotes (Código.gs)]
           Audita firmas faltantes en Drive y envía los PDFs por Gmail en tandas
           con control de cuota diaria, reintentos y reportes automáticos
```

---

## Componentes del sistema

### 1. Backend y Automatización en Google Workspace (`Código.gs`)
Script vinculado a Google Sheets que incorpora un menú nativo (**🎓 Certificaciones**) para operar todo el evento sin tocar código:
- **Confirmación con QR:** Al enviarse el formulario (`onFormSubmit`), envía un correo automático con el código QR del DNI generado vía QuickChart (con respaldo en texto si el servicio externo no responde).
- **Preparación y división de padrones:** Elimina DNIs duplicados al cierre de inscripciones y permite exportar un CSV general o un `.zip` con padrones repartidos equitativamente entre 1 y 20 mesas de acreditación (ordenados alfabéticamente).
- **Seguridad en exportación:** Normaliza fechas a `YYYY-MM-DD HH:mm:ss` (`America/Argentina/Cordoba`), agrega BOM UTF-8 (`\uFEFF`) para compatibilidad con Excel y neutraliza inyección de fórmulas CSV (`=`, `+`, `-`, `@`).
- **Sincronización de asistencia:** Importa `asistencia_final.csv` actualizando únicamente estados superadores (`Presente` / `Completado`) e incorporando a los acreditados en puerta.
- **Auditoría y despacho tolerante a fallos:** Verifica qué PDFs de `NO FIRMADOS` ya están en `FIRMADOS` antes de enviar. Despacha en tandas respetando el límite de ejecución de Apps Script (4,5 min por ciclo) y la cuota diaria de Gmail; si la cuota se agota, pausa y programa un activador automático a 24 horas. Incluye bloqueo de filas tras 3 fallos, límite de campaña de 72 horas, almacenamiento compacto dentro del límite de 9 KB de `PropertiesService` y reportes por correo al organizador.

### 2. Aplicación Web de Acreditación Offline (`Acreditador Offline.html`)
Aplicación web autocontenida en un único archivo HTML/CSS/JS optimizada para celulares, tablets o notebooks en mesas de ingreso:
- **100 % offline:** Persiste el padrón y los registros en `localStorage` separados por evento (detectando automáticamente el nombre del evento desde el archivo CSV cargado).
- **Control en tiempo real:** Muestra métricas de *Inscriptos*, *En Sala* y *Completados*, con validación de secuencia (impide registrar salida sin entrada previa o duplicar registros) y feedback sonoro (Web Audio API) y háptico.
- **Compatible con lectores QR/código de barras:** Campo DNI enfocado automáticamente (6 a 8 dígitos numéricos) que bloquea envíos accidentales con `Enter`.
- **Alta en puerta y exportación:** Modal para registrar asistentes no empadronados en el momento, descarga automática de DNIs descartados al importar y reinicio seguro protegido por código de confirmación (`2121`).

### 3. Utilidades de Escritorio en Python (`Tkinter`)
Diseñadas con interfaz gráfica simple para personal administrativo no técnico:
- **`UnificadorFCAD.py` (Consolidador de Mesas):** Unifica múltiples CSVs exportados desde distintas mesas en un único `asistencia_final.csv` ordenado alfabéticamente. Conserva la hora de entrada más temprana y la de salida más tardía por DNI, valida el formato de encabezados y exporta un archivo `*_descartados.csv` con filas inválidas.
- **`GeneradorPDF.py` (Generador Masivo de Certificados):** Procesa `asistencia_final.csv` en un hilo secundario (sin congelar la UI) y completa plantillas PDF con formularios AcroForm (`NOMBRE` y `DNI`) usando **PyMuPDF (`fitz`)**. Aplana los documentos (`doc.bake()`) para que no sean editables, normaliza nombres en español respetando conectores (`de`, `del`, `la`, etc.), genera constancias opcionales solo para quienes las solicitaron y emite un reporte `incidencias.csv` si detecta errores.
- **`NormalizadorPDF.py` (Normalizador de PDFs Firmados):** Estandariza los nombres de archivos firmados digitalmente al formato `Certificado_<DNI>.pdf` o `Constancia_<DNI>.pdf` esperado por el despachador. Combina análisis del nombre de archivo, extracción de texto y campos internos del PDF con **pypdf** (evaluando etiquetas de anclaje y proximidad a nombres propios) y validación cruzada opcional contra el CSV del padrón.

---

## Stack tecnológico

| Capa | Tecnologías |
| :--- | :--- |
| **Automatización y Cloud** | Google Apps Script (JavaScript), Google Sheets, Google Drive, Gmail (`MailApp`), QuickChart API |
| **Frontend Offline** | HTML5, CSS3, Vanilla JavaScript, `localStorage`, Web Audio API |
| **Herramientas de Escritorio** | Python 3, Tkinter, PyMuPDF (`fitz`), `pypdf`, `threading`, `csv` |

---

## Estructura del repositorio

```text
sistema-acreditacion-fcad/
├── apps-script/
│   └── Código.gs                 # Automatización en Google Sheets, Drive y Gmail
├── web-acreditador/
│   └── Acreditador Offline.html  # Interfaz web offline para mesas de acreditación
├── desktop-tools/
│   ├── UnificadorFCAD.py         # Consolidador de CSVs de múltiples mesas
│   ├── GeneradorPDF.py           # Generador masivo de certificados/constancias AcroForm
│   ├── NormalizadorPDF.py        # Renombrador y validador de PDFs firmados
│   └── requirements.txt          # Dependencias de Python
├── demo/
│   └── padron_ejemplo.csv        # (Opcional) Padrón con datos ficticios para pruebas
└── README.md
```

---

## Esquema de datos (CSV / Google Sheets)

Todo el ecosistema comparte un contrato posicional de 11 columnas (A–K):

| Columna | Campo | Uso principal |
| :--- | :--- | :--- |
| A | `Marca temporal` | Fecha/hora de inscripción |
| B | `Nombre completo (Nombre y Apellido)` | Impresión en certificado y correos |
| C | `Correo Electrónico` | Envío de QR y certificados firmados |
| D | `DNI` | Clave única de identificación (6 a 8 dígitos) |
| E | `¿Necesita constancia...?` | Dispara generación/envío de `Constancia_<DNI>.pdf` (`Sí`/`No`) |
| F | `Estado Entrada` | `Pendiente` / `Presente` |
| G | `Hora Entrada` | Timestamp de acreditación de ingreso |
| H | `Estado Salida` | `Pendiente` / `Completado` (habilita emisión de certificado) |
| I | `Hora Salida` | Timestamp de acreditación de egreso |
| J | `Certificación Enviada` | `No` / `Sí` / `ERROR` |
| K | `¿Desea recibir invitaciones...?` | Preferencia de difusión (`Sí`/`No`) |

---

## Instalación y puesta en marcha

### 1. Google Apps Script
1. Crea un Google Form vinculado a una hoja de cálculo dentro de una carpeta dedicada en Google Drive (no suelta en la raíz).
2. En Google Sheets, abre **Extensiones → Apps Script**, pega el contenido de `apps-script/Código.gs` y guarda.
3. Recarga la planilla; aparecerá el menú **🎓 Certificaciones**.
4. Ejecuta **⚙️ Configurar Activadores Automáticos** y concede los permisos solicitados. Las subcarpetas `NO FIRMADOS` y `FIRMADOS` se crearán automáticamente dentro de la carpeta del evento.

### 2. Acreditador Offline
- Abre `web-acreditador/Acreditador Offline.html` directamente en cualquier navegador moderno (o alójalo en un servidor estático como Cloudflare Pages / GitHub Pages).
- Presiona **Cargar Padrón** y selecciona el archivo `.csv` exportado desde Google Sheets.

### 3. Utilidades de escritorio (Python)
Requiere **Python 3.10+** (con `tkinter` habilitado).

```bash
cd desktop-tools
python -m venv .venv

# En Linux / macOS:
source .venv/bin/activate
# En Windows:
.venv\Scripts\activate

pip install -r requirements.txt
```

Ejecución individual:

```bash
python UnificadorFCAD.py
python GeneradorPDF.py
python NormalizadorPDF.py
```

> **Nota sobre plantillas PDF:** Para `GeneradorPDF.py`, las plantillas de certificado y constancia deben ser archivos PDF con campos de formulario AcroForm llamados `NOMBRE` y `DNI`. El programa valida automáticamente su existencia antes de procesar el lote.

---

## Autor

**Alejo Ragone** — Estudiante de Licenciatura en Sistemas (FCAD - UNER)  
GitHub: [@Ryu21A](https://github.com/Ryu21A)
