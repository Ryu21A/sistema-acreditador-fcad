import csv
import os
import re
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from pypdf import PdfReader


class NormalizadorApp:

  def __init__(self, root: tk.Tk):
    self.root = root
    self.root.title("Normalizador Seguro de Certificados y Firmas")
    self.root.geometry("720x580")
    self.root.minsize(580, 460)

    try:
      self.root.iconbitmap("app_icon.ico")
    except Exception:
      pass

    self.ruta_carpeta = tk.StringVar()
    self.ruta_csv = tk.StringVar()
    self.padron_dnis = set()

    self._construir_ui()

  def _construir_ui(self):
    frame_config = ttk.Frame(self.root, padding=14)
    frame_config.pack(fill=tk.X)

    # 1. Selector de Carpeta de PDFs
    ttk.Label(
        frame_config,
        text="Carpeta con PDFs firmados:",
        font=("Segoe UI", 9, "bold"),
    ).pack(anchor=tk.W)
    frame_carpeta = ttk.Frame(frame_config)
    frame_carpeta.pack(fill=tk.X, pady=(4, 10))

    entry_carpeta = ttk.Entry(
        frame_carpeta, textvariable=self.ruta_carpeta, font=("Segoe UI", 9)
    )
    entry_carpeta.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))
    ttk.Button(
        frame_carpeta, text="Examinar...", command=self._seleccionar_carpeta
    ).pack(side=tk.RIGHT)

    # 2. Selector Opcional de CSV de Asistencia
    ttk.Label(
        frame_config,
        text="Padrón de Asistencia (CSV opcional para validación cruzada):",
        font=("Segoe UI", 9, "bold"),
    ).pack(anchor=tk.W)
    frame_csv = ttk.Frame(frame_config)
    frame_csv.pack(fill=tk.X, pady=(4, 12))

    entry_csv = ttk.Entry(
        frame_csv, textvariable=self.ruta_csv, font=("Segoe UI", 9)
    )
    entry_csv.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))
    ttk.Button(
        frame_csv, text="Cargar CSV...", command=self._seleccionar_csv
    ).pack(side=tk.RIGHT)

    # Botón principal y progreso
    self.btn_procesar = ttk.Button(
        frame_config,
        text="⚡ Normalizar y Verificar Nombres",
        command=self._iniciar_hilo_procesamiento,
    )
    self.btn_procesar.pack(fill=tk.X, ipady=4)

    self.progreso = ttk.Progressbar(frame_config, orient="horizontal", mode="determinate")
    self.progreso.pack(fill=tk.X, pady=(8, 2))

    self.lbl_estado = ttk.Label(
        frame_config, text="Listo para procesar.", font=("Segoe UI", 8)
    )
    self.lbl_estado.pack(anchor=tk.W)

    # Log de operaciones
    frame_log = ttk.Frame(self.root, padding=(14, 0, 14, 14))
    frame_log.pack(fill=tk.BOTH, expand=True)

    ttk.Label(
        frame_log, text="Registro de operaciones:", font=("Segoe UI", 9)
    ).pack(anchor=tk.W, pady=(0, 4))

    self.log_text = tk.Text(
        frame_log,
        wrap=tk.WORD,
        font=("Consolas", 9),
        bg="#0f172a",
        fg="#f8fafc",
        insertbackground="#f8fafc",
        state=tk.DISABLED,
    )
    scrollbar = ttk.Scrollbar(
        frame_log, orient=tk.VERTICAL, command=self.log_text.yview
    )
    self.log_text.configure(yscrollcommand=scrollbar.set)

    self.log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

  def _seleccionar_carpeta(self):
    carpeta = filedialog.askdirectory(title="Seleccionar carpeta de PDFs firmados")
    if carpeta:
      self.ruta_carpeta.set(carpeta)

  def _seleccionar_csv(self):
    archivo = filedialog.askopenfilename(
        title="Seleccionar CSV de Asistencia",
        filetypes=[("Archivos CSV", "*.csv"), ("Todos los archivos", "*.*")],
    )
    if archivo:
      self.ruta_csv.set(archivo)
      self._cargar_padron_csv(archivo)

  def _cargar_padron_csv(self, ruta: str):
    self.padron_dnis.clear()
    try:
      with open(ruta, mode="r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for fila in reader:
          for celda in fila:
            candidato = re.sub(r"\D", "", celda).strip()
            # Tolerancia ampliada de 6 a 8 dígitos
            if 6 <= len(candidato) <= 8:
              self.padron_dnis.add(candidato)
      self._log(
          f"ℹ Padrón cargado: {len(self.padron_dnis)} DNIs detectados para verificación cruzada."
      )
    except Exception as e:
      messagebox.showwarning("Aviso", f"No se pudo leer el archivo CSV: {e}\nSe continuará sin él.")

  # Métodos thread-safe para actualizar la interfaz
  def _log(self, mensaje: str):
    def _accion():
      self.log_text.configure(state=tk.NORMAL)
      self.log_text.insert(tk.END, mensaje + "\n")
      self.log_text.see(tk.END)
      self.log_text.configure(state=tk.DISABLED)
    self.root.after(0, _accion)

  def _actualizar_progreso(self, procesados: int, total: int, nombre_actual: str):
    def _accion():
      self.progreso["value"] = procesados
      self.lbl_estado.config(text=f"Procesando {procesados}/{total}: {nombre_actual}")
    self.root.after(0, _accion)

  def _reset_ui(self):
    def _accion():
      self.btn_procesar.config(state=tk.NORMAL)
      self.lbl_estado.config(text="Listo para procesar otro lote.")
    self.root.after(0, _accion)

  def _mostrar_mensaje(self, tipo: str, titulo: str, mensaje: str):
    if tipo == "info":
      self.root.after(0, lambda: messagebox.showinfo(titulo, mensaje))
    elif tipo == "warning":
      self.root.after(0, lambda: messagebox.showwarning(titulo, mensaje))
    elif tipo == "error":
      self.root.after(0, lambda: messagebox.showerror(titulo, mensaje))

  # Patrones actualizados para aceptar de 6 a 8 dígitos
  PATRON_NOMBRE_PROPIO = re.compile(
      r"\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4}\b"
  )
  PATRON_NUMERO_DNI = re.compile(r"\b\d{1,2}(?:\.\d{3}){2}\b|\b\d{6,8}\b")
  PATRON_ANCLAJE_DNI = re.compile(
      r"(?:D\.?N\.?I\.?|Documento|DOC|DNI\s*N[°ºo]?)\s*[:.]?\s*(\d{1,2}(?:\.?\d{3}){2}|\d{6,8})\b",
      re.IGNORECASE,
  )

  def _recolectar_candidatos_dni(self, texto: str) -> list:
    nombres = list(self.PATRON_NOMBRE_PROPIO.finditer(texto))
    anclados = {re.sub(r"\D", "", v) for v in self.PATRON_ANCLAJE_DNI.findall(texto)}

    candidatos = {}
    for m_num in self.PATRON_NUMERO_DNI.finditer(texto):
      valor = re.sub(r"\D", "", m_num.group())
      if not (6 <= len(valor) <= 8) or valor in candidatos:
        continue

      centro_num = (m_num.start() + m_num.end()) / 2
      distancia_nombre = None
      for m_nom in nombres:
        centro_nom = (m_nom.start() + m_nom.end()) / 2
        d = abs(centro_num - centro_nom)
        if distancia_nombre is None or d < distancia_nombre:
          distancia_nombre = d

      candidatos[valor] = {
          "valor": valor,
          "anclaje": valor in anclados,
          "distancia_nombre": distancia_nombre,
      }
    return list(candidatos.values())

  def _detectar_tipo_por_texto(self, texto: str) -> str:
    return "Constancia" if "constancia" in texto.lower() else "Certificado"

  def _extraer_dni_seguro(self, ruta_pdf: Path) -> tuple[str | None, str]:
    try:
      # Apertura con context manager para asegurar el cierre del descriptor de archivo
      with open(ruta_pdf, "rb") as f:
        reader = PdfReader(f)

        texto_acumulado = ""
        for pagina in reader.pages:
          texto_acumulado += " " + (pagina.extract_text() or "")
        tipo_por_contenido = self._detectar_tipo_por_texto(texto_acumulado)

        candidatos = self._recolectar_candidatos_dni(texto_acumulado)

        campos = reader.get_fields()
        if campos:
          for clave in ["DNI", "{{DNI}}", "Documento", "dni", "documento", "num_doc"]:
            if clave in campos and campos[clave].get("/V"):
              valor = re.sub(r"\D", "", str(campos[clave]["/V"])).strip()
              if 6 <= len(valor) <= 8:
                existente = next((c for c in candidatos if c["valor"] == valor), None)
                if existente:
                  existente["anclaje"] = True
                else:
                  candidatos.append({"valor": valor, "anclaje": True, "distancia_nombre": 0})

      if not candidatos:
        return None, tipo_por_contenido

      if self.padron_dnis:
        candidatos = [c for c in candidatos if c["valor"] in self.padron_dnis]
        if not candidatos:
          return None, tipo_por_contenido

      anclados = [c for c in candidatos if c["anclaje"]]
      pool = anclados if anclados else candidatos
      pool.sort(key=lambda c: c["distancia_nombre"] if c["distancia_nombre"] is not None else float("inf"))
      mejor = pool[0]

      if len(pool) > 1 and not anclados:
        self._log(
            f"⚠️ AMBIGUO: '{ruta_pdf.name}' — {len(pool)} números posibles "
            f"({', '.join(c['valor'] for c in pool)}). Se omite para revisión manual."
        )
        return None, tipo_por_contenido

      return mejor["valor"], tipo_por_contenido

    except Exception as e:
      return None, f"Error de lectura: {e}"

  def _iniciar_hilo_procesamiento(self):
    directorio = self.ruta_carpeta.get().strip()
    if not directorio or not os.path.isdir(directorio):
      messagebox.showerror("Error", "Por favor seleccioná una carpeta de PDFs válida.")
      return

    p = Path(directorio)
    archivos_pdf = list(p.glob("*.pdf"))

    if not archivos_pdf:
      messagebox.showwarning("Aviso", "No se encontraron archivos PDF en la carpeta seleccionada.")
      return

    self.btn_procesar.config(state=tk.DISABLED)
    threading.Thread(target=self._procesar_lote, args=(p, archivos_pdf), daemon=True).start()

  def _procesar_lote(self, p: Path, archivos_pdf: list):
    try:
      total = len(archivos_pdf)
      self.root.after(0, lambda: self.progreso.configure(maximum=total, value=0))

      self._log(f"--- Iniciando normalización en: {p.name} ({total} archivos) ---")
      renombrados = 0
      ya_correctos = 0
      errores = 0

      for idx, pdf in enumerate(archivos_pdf):
        nombre_original = pdf.name
        dni = None
        tipo = "Certificado"

        # PASO 1: Búsqueda contextual en el nombre del archivo (6 a 8 dígitos)
        match_nombre = re.search(r"(?:certificado|constancia).*?(\d{6,8})", nombre_original, re.IGNORECASE)
        if not match_nombre:
          match_nombre = re.search(r"\b(\d{6,8})\b", nombre_original)

        if match_nombre:
          candidato_nombre = match_nombre.group(1)
          if not self.padron_dnis or candidato_nombre in self.padron_dnis:
            dni = candidato_nombre
            tipo = "Constancia" if "constancia" in nombre_original.lower() else "Certificado"

        # PASO 2: Inspección interna contextual del PDF
        if not dni:
          dni, tipo_interno = self._extraer_dni_seguro(pdf)
          if dni:
            tipo = tipo_interno

        if not dni:
          self._log(f"⚠️ OMITIDO: '{nombre_original}' (No se validó ningún DNI legítimo).")
          errores += 1
          self._actualizar_progreso(idx + 1, total, nombre_original)
          continue

        nuevo_nombre = f"{tipo}_{dni}.pdf"
        ruta_nueva = p / nuevo_nombre

        if nombre_original == nuevo_nombre:
          ya_correctos += 1
          self._actualizar_progreso(idx + 1, total, nombre_original)
          continue

        if ruta_nueva.exists():
          self._log(f"❌ CONFLICTO: Ya existe '{nuevo_nombre}'. Se omitió '{nombre_original}'.")
          errores += 1
          self._actualizar_progreso(idx + 1, total, nombre_original)
          continue

        try:
          pdf.rename(ruta_nueva)
          self._log(f"✔ RENOMBRADO: '{nombre_original}' -> '{nuevo_nombre}' (DNI: {dni})")
          renombrados += 1
        except Exception as e:
          self._log(f"❌ ERROR al renombrar '{nombre_original}': {e}")
          errores += 1

        self._actualizar_progreso(idx + 1, total, nombre_original)

      self._log(
          f"--- Finalizado: {renombrados} renombrados, {ya_correctos} ya listos, {errores} omitidos/errores ---\n"
      )
      self._mostrar_mensaje(
          "info",
          "Proceso Completado",
          f"Resumen del proceso:\n• Archivos renombrados: {renombrados}\n• Ya estaban correctos: {ya_correctos}\n• Omitidos o con error: {errores}"
      )
    except Exception as e:
      self._mostrar_mensaje("error", "Error", f"Fallo imprevisto durante el procesamiento:\n{e}")
    finally:
      self._reset_ui()


if __name__ == "__main__":
  root = tk.Tk()
  app = NormalizadorApp(root)
  root.mainloop()
