import csv
import os
import re
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import fitz  # PyMuPDF

# Nombres de campo que TODA plantilla (certificado o constancia) debe tener
# para que el sistema pueda completarla correctamente.
CAMPOS_REQUERIDOS = ("NOMBRE", "DNI")


def _normalizar_campo(nombre: str) -> str:
    """Única forma de comparar nombres de campo, tanto en la validación como
    en el relleno, para que ambas coincidan siempre."""
    return nombre.strip().lower()


def obtener_nombres_de_campos(ruta_pdf: str) -> set:
    """Devuelve el conjunto de nombres de campo de formulario (normalizados)
    presentes en un PDF, recorriendo todas sus páginas."""
    doc = fitz.open(ruta_pdf)
    try:
        nombres = set()
        for page in doc:
            for widget in page.widgets():
                if widget.field_name:
                    nombres.add(_normalizar_campo(widget.field_name))
        return nombres
    finally:
        doc.close()


def validar_campos_plantilla(ruta_pdf: str, campos_requeridos=CAMPOS_REQUERIDOS) -> list:
    """Devuelve la lista de campos requeridos que NO se encuentran entre los
    campos de formulario de la plantilla indicada."""
    presentes = obtener_nombres_de_campos(ruta_pdf)
    return [c for c in campos_requeridos if _normalizar_campo(c) not in presentes]


# Conectores típicos de apellidos/nombres compuestos en español que van en
# minúscula salvo que sean la primera palabra del nombre completo.
CONECTORES_MINUSCULA = {"de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "van", "von", "di"}


def _capitalizar_palabra(palabra_lower: str) -> str:
    """Capitaliza cada segmento de una palabra, separando por guion y por
    apóstrofo, para no romper apellidos como 'García-López' o "O'Higgins"."""
    def _cap_segmento(seg: str) -> str:
        return seg[:1].upper() + seg[1:] if seg else seg

    partes = re.split(r"(-)", palabra_lower)
    partes = [_cap_segmento(p) if p != "-" else p for p in partes]
    palabra = "".join(partes)

    partes = re.split(r"(['’])", palabra)
    partes = [_cap_segmento(p) if p not in ("'", "’") else p for p in partes]
    return "".join(partes)


def normalizar_nombre(nombre: str) -> str:
    """Normaliza un nombre a formato Título (Mayúscula-minúscula), sin importar
    cómo lo haya tipeado la persona en el formulario. Mantiene en minúscula los
    conectores típicos de apellidos compuestos en español, salvo que sean la
    primera palabra."""
    nombre = re.sub(r"\s+", " ", nombre.strip())
    if not nombre:
        return nombre

    resultado = []
    for idx, palabra in enumerate(nombre.split(" ")):
        palabra_lower = palabra.lower()
        if idx > 0 and palabra_lower in CONECTORES_MINUSCULA:
            resultado.append(palabra_lower)
        else:
            resultado.append(_capitalizar_palabra(palabra_lower))
    return " ".join(resultado)


def rellenar_acroform(plantilla_bytes: bytes, datos: dict) -> bytes:
    """Rellena los campos interactivos de un PDF y lo aplana (bake) para que
    no sea editable."""
    doc = fitz.open(stream=plantilla_bytes, filetype="pdf")
    try:
        datos_norm = {_normalizar_campo(k): v for k, v in datos.items()}
        for page in doc:
            for widget in page.widgets():
                campo = widget.field_name
                if not campo:
                    continue
                clave = _normalizar_campo(campo)
                if clave in datos_norm:
                    valor_limpio = str(datos_norm[clave]).strip()
                    widget.field_value = valor_limpio if valor_limpio else " "
                    widget.update()
        doc.bake()
        return doc.tobytes()
    finally:
        doc.close()


def _activar_dpi_aware():
    """En Windows evita que el sistema escale la ventana y desubique los
    diálogos nativos (selector de carpetas, etc.). Debe llamarse antes de
    crear la ventana."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


class GeneradorCertificadosApp(tk.Tk):

    def __init__(self):
        super().__init__()
        self.title("Generador de Certificados y Constancias - FCAD")
        self.geometry("600x540")
        self.resizable(False, False)
        try:
            self.iconbitmap("app_icon.ico")
        except Exception:
            pass

        # Variables de control
        self.var_csv = tk.StringVar()
        self.var_cert = tk.StringVar()
        self.var_const = tk.StringVar()
        self.var_salida = tk.StringVar()
        self.var_sobrescribir = tk.BooleanVar(value=False)

        self._construir_ui()

    # ------------------------------------------------------------------
    # Interfaz
    # ------------------------------------------------------------------
    def _crear_selector(self, titulo, variable, comando):
        marco = tk.LabelFrame(self, text=titulo, font=("Helvetica", 9, "bold"))
        marco.pack(fill="x", padx=16, pady=6)
        tk.Entry(marco, textvariable=variable, width=54).pack(side="left", padx=8, pady=8)
        tk.Button(marco, text="Buscar...", command=comando, width=10).pack(side="right", padx=8)

    def _construir_ui(self):
        self._crear_selector(" 1. Archivo CSV de Asistencia ", self.var_csv, self._seleccionar_csv)
        self._crear_selector(
            " 2. Plantilla Certificado (.pdf) ", self.var_cert,
            lambda: self._seleccionar_pdf(self.var_cert))
        self._crear_selector(
            " 3. Plantilla Constancia (.pdf - Opcional) ", self.var_const,
            lambda: self._seleccionar_pdf(self.var_const))
        self._crear_selector(" 4. Carpeta de Destino ", self.var_salida, self._seleccionar_carpeta)

        tk.Checkbutton(
            self,
            text="Sobrescribir archivos que ya existen en la carpeta",
            variable=self.var_sobrescribir,
            font=("Helvetica", 9),
        ).pack(anchor="w", padx=20, pady=(2, 0))

        self.progreso = ttk.Progressbar(self, orient="horizontal", mode="determinate")
        self.progreso.pack(fill="x", padx=16, pady=(12, 4))

        self.lbl_estado = tk.Label(
            self, text="Seleccioná los archivos necesarios para comenzar.",
            font=("Helvetica", 9), fg="#475569")
        self.lbl_estado.pack(pady=2)

        self.btn_ejecutar = tk.Button(
            self,
            text="🚀 Generar Lote de PDFs",
            bg="#1d4ed8",
            fg="white",
            activebackground="#1e40af",
            activeforeground="white",
            font=("Helvetica", 11, "bold"),
            height=2,
            cursor="hand2",
            command=self._iniciar_hilo_procesamiento
        )
        self.btn_ejecutar.pack(fill="x", padx=16, pady=10)

    def _seleccionar_csv(self):
        ruta = filedialog.askopenfilename(
            title="Seleccionar archivo CSV",
            filetypes=[("Archivos CSV", "*.csv"), ("Todos los archivos", "*.*")]
        )
        if ruta:
            self.var_csv.set(ruta)

    def _seleccionar_pdf(self, variable):
        ruta = filedialog.askopenfilename(
            title="Seleccionar archivo PDF",
            filetypes=[("Archivos PDF", "*.pdf"), ("Todos los archivos", "*.*")]
        )
        if ruta:
            variable.set(ruta)

    def _seleccionar_carpeta(self):
        ruta = filedialog.askdirectory(title="Seleccionar Carpeta de Destino")
        if ruta:
            self.var_salida.set(ruta)

    # ------------------------------------------------------------------
    # Validaciones previas
    # ------------------------------------------------------------------
    def _iniciar_hilo_procesamiento(self):
        csv_p = self.var_csv.get().strip()
        cert_p = self.var_cert.get().strip()
        const_p = self.var_const.get().strip()
        dest_p = self.var_salida.get().strip()

        if not csv_p or not os.path.isfile(csv_p):
            messagebox.showerror("Archivo Faltante", "Debés indicar un archivo CSV válido.")
            return

        if not cert_p or not os.path.isfile(cert_p):
            messagebox.showerror("Archivo Faltante", "Debés indicar la plantilla PDF del Certificado.")
            return

        if const_p and not os.path.isfile(const_p):
            messagebox.showerror(
                "Archivo Faltante",
                "Indicaste una plantilla de Constancia, pero el archivo no existe:\n"
                f"{const_p}\n\nCorregí la ruta o dejá el campo vacío."
            )
            return

        if not dest_p or not os.path.isdir(dest_p):
            messagebox.showerror("Carpeta Inválida", "Debés indicar una carpeta de destino válida.")
            return

        if not self._validar_plantilla_o_avisar(cert_p, "Certificado", "los certificados"):
            return
        if const_p and not self._validar_plantilla_o_avisar(const_p, "Constancia", "las constancias"):
            return

        self.btn_ejecutar.config(state="disabled")
        threading.Thread(target=self._procesar_generacion, daemon=True).start()

    def _validar_plantilla_o_avisar(self, ruta: str, nombre_plantilla: str, plural: str) -> bool:
        try:
            faltantes = validar_campos_plantilla(ruta)
        except Exception as e:
            messagebox.showerror(
                f"No se pudo leer la plantilla de {nombre_plantilla}",
                f"El archivo no se pudo abrir como PDF:\n{e}"
            )
            return False

        if faltantes:
            encontrados = ", ".join(sorted(obtener_nombres_de_campos(ruta))) or "(ninguno)"
            messagebox.showerror(
                f"Plantilla de {nombre_plantilla} incompleta",
                f"A la plantilla de {nombre_plantilla} le falta el campo de formulario "
                f"'{' y '.join(faltantes)}'.\n\n"
                f"Campos encontrados en el PDF: {encontrados}\n\n"
                "Revisá el nombre del campo en el editor de formularios (por ejemplo Acrobat) "
                "y volvé a intentar. Sin ese campo, ese dato va a salir en blanco en "
                f"TODOS {plural} generados."
            )
            return False
        return True

    # ------------------------------------------------------------------
    # Helpers de UI (seguros para llamar desde el hilo de trabajo)
    # ------------------------------------------------------------------
    def _ui_actualizar_progreso(self, valor: int, texto: str):
        self.after(0, lambda: (
            self.progreso.configure(value=valor),
            self.lbl_estado.configure(text=texto)
        ))

    def _ui_mostrar_mensaje(self, tipo: str, titulo: str, mensaje: str):
        if tipo == "info":
            self.after(0, lambda: messagebox.showinfo(titulo, mensaje))
        elif tipo == "warning":
            self.after(0, lambda: messagebox.showwarning(titulo, mensaje))
        elif tipo == "error":
            self.after(0, lambda: messagebox.showerror(titulo, mensaje))

    def _reset_ui(self):
        self.after(0, lambda: (
            self.btn_ejecutar.config(state="normal"),
            self.progreso.configure(value=0),
            self.lbl_estado.config(text="Listo para procesar otro lote.")
        ))

    # ------------------------------------------------------------------
    # Generación del lote
    # ------------------------------------------------------------------
    def _procesar_generacion(self):
        try:
            self._ui_actualizar_progreso(0, "Cargando plantillas...")
            sobrescribir = self.var_sobrescribir.get()

            with open(self.var_cert.get().strip(), "rb") as f:
                cert_bytes = f.read()

            const_bytes = None
            const_p = self.var_const.get().strip()
            if const_p and os.path.isfile(const_p):
                with open(const_p, "rb") as f:
                    const_bytes = f.read()

            carpeta_salida = self.var_salida.get().strip()
            carpeta_no_firmados = os.path.join(carpeta_salida, "NO FIRMADOS")
            os.makedirs(carpeta_no_firmados, exist_ok=True)

            with open(self.var_csv.get().strip(), mode="r", encoding="utf-8-sig", newline="") as f:
                filas = list(csv.reader(f))

            if len(filas) < 2:
                self._ui_mostrar_mensaje("warning", "Atención", "El archivo CSV está vacío o no contiene registros.")
                return

            registros = filas[1:]
            total_registros = len(registros)
            self.after(0, lambda: self.progreso.configure(maximum=total_registros))

            cert_generados = const_generadas = 0
            cert_salteados = const_salteadas = 0
            no_completaron = 0
            incidencias = []  # (fila del CSV, nombre, dni, motivo)

            for idx, fila in enumerate(registros):
                num_fila = idx + 2  # +1 por el encabezado, +1 porque se cuenta desde 1
                fila_norm = fila + [""] * (11 - len(fila))

                nombre_crudo = fila_norm[1]
                nombre = normalizar_nombre(nombre_crudo)
                dni_original = fila_norm[3]
                dni = re.sub(r"\D", "", dni_original).strip()
                quiere_material = fila_norm[4].strip().lower()
                estado_salida = fila_norm[7].strip().lower()

                if estado_salida != "completado":
                    no_completaron += 1
                else:
                    try:
                        if not (6 <= len(dni) <= 8):
                            incidencias.append((num_fila, nombre_crudo, dni_original, f"DNI inválido: '{dni_original}'"))
                        elif not nombre:
                            incidencias.append((num_fila, nombre_crudo, dni, "Nombre vacío"))
                        else:
                            datos = {"NOMBRE": nombre, "DNI": dni}

                            # 1. Certificado
                            ruta_cert = os.path.join(carpeta_no_firmados, f"Certificado_{dni}.pdf")
                            if sobrescribir or not os.path.exists(ruta_cert):
                                with open(ruta_cert, "wb") as out:
                                    out.write(rellenar_acroform(cert_bytes, datos))
                                cert_generados += 1
                            else:
                                cert_salteados += 1

                            # 2. Constancia (solo si la pidió)
                            if quiere_material in ("sí", "si", "yes"):
                                if const_bytes is None:
                                    incidencias.append((
                                        num_fila, nombre_crudo, dni,
                                        "Pidió constancia pero no se cargó plantilla de Constancia"))
                                else:
                                    ruta_const = os.path.join(carpeta_no_firmados, f"Constancia_{dni}.pdf")
                                    if sobrescribir or not os.path.exists(ruta_const):
                                        with open(ruta_const, "wb") as out:
                                            out.write(rellenar_acroform(const_bytes, datos))
                                        const_generadas += 1
                                    else:
                                        const_salteadas += 1
                    except Exception as e:
                        incidencias.append((num_fila, nombre_crudo, dni, f"Error al generar: {e}"))

                self._ui_actualizar_progreso(
                    idx + 1,
                    f"Procesando: {idx + 1} de {total_registros} registros..."
                )

            # Resumen final
            self._ui_actualizar_progreso(total_registros, "¡Generación finalizada!")
            resumen = (
                f"Documentos generados en:\n{carpeta_no_firmados}\n\n"
                f"• Certificados generados: {cert_generados}\n"
                f"• Constancias generadas: {const_generadas}\n"
                f"• Ya existían (salteados): {cert_salteados} certificados, {const_salteadas} constancias\n"
                f"• No completaron el curso: {no_completaron}\n"
                f"• Filas con incidencias: {len(incidencias)}"
            )

            if incidencias:
                ruta_inc = os.path.join(carpeta_salida, "incidencias.csv")
                try:
                    with open(ruta_inc, "w", encoding="utf-8-sig", newline="") as f:
                        w = csv.writer(f)
                        w.writerow(["Fila del CSV", "Nombre", "DNI", "Motivo"])
                        w.writerows(incidencias)
                    resumen += f"\n\nEl detalle está en:\n{ruta_inc}"
                except Exception as e:
                    resumen += f"\n\nNo se pudo guardar incidencias.csv: {e}"
                self._ui_mostrar_mensaje("warning", "Lote completado con incidencias", resumen)
            else:
                self._ui_mostrar_mensaje("info", "Lote Completado", resumen)

        except Exception as e:
            self._ui_mostrar_mensaje("error", "Error", f"Fallo imprevisto durante el procesamiento:\n{e}")
        finally:
            self._reset_ui()


if __name__ == "__main__":
    _activar_dpi_aware()
    app = GeneradorCertificadosApp()
    app.mainloop()
