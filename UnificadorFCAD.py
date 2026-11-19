import csv
import os
import re
import tkinter as tk
from tkinter import filedialog, messagebox

# Encabezados de la planilla maestra (Columnas A a K)
ENCABEZADOS_CANONICOS = [
    "Marca temporal",
    "Nombre completo (Nombre y Apellido)",
    "Correo Electrónico",
    "DNI",
    "¿Necesita una constancia de asistencia para el trabajo/estudio?",
    "Estado Entrada",
    "Hora Entrada",
    "Estado Salida",
    "Hora Salida",
    "Certificación Enviada",
    "¿Desea recibir invitaciones a futuros eventos?"
]

# Índices posicionales directos
COL_TIMESTAMP = 0
COL_NOMBRE = 1
COL_EMAIL = 2
COL_DNI = 3
COL_CONSTANCIA = 4
COL_ESTADO_ENTRADA = 5
COL_HORA_ENTRADA = 6
COL_ESTADO_SALIDA = 7
COL_HORA_SALIDA = 8
COL_CERT_ENVIADA = 9
COL_INVITACIONES = 10


def normalizar_dni(valor: str) -> str:
    return re.sub(r"\D", "", str(valor or "")).strip()


def _encabezado_parece_esperado(fila_encabezado: list[str]) -> bool:
    """Chequeo blando: no exige coincidencia exacta de texto (podría variar
    apenas entre versiones), pero sí que haya al menos 11 columnas y que la
    columna de DNI (índice 3) contenga la palabra 'dni' en el título."""
    if len(fila_encabezado) < 11:
        return False
    columna_dni = fila_encabezado[COL_DNI].strip().lower()
    return "dni" in columna_dni


def consolidar_archivos(rutas_archivos: list[str]) -> tuple[list[list[str]], dict]:
    padron_consolidado: dict[str, list[str]] = {}
    descartados: list[dict] = []
    archivos_con_encabezado_inesperado: list[str] = []

    for ruta in rutas_archivos:
        nombre_archivo = ruta.replace("\\", "/").split("/")[-1]
        with open(ruta, mode="r", encoding="utf-8-sig", errors="replace") as f:
            lector = csv.reader(f)

            try:
                encabezado = next(lector)
            except StopIteration:
                continue

            if not _encabezado_parece_esperado(encabezado):
                archivos_con_encabezado_inesperado.append(nombre_archivo)

            for num_fila, fila in enumerate(lector, start=2):
                if len(fila) <= COL_DNI:
                    descartados.append({
                        "archivo": nombre_archivo,
                        "fila": num_fila,
                        "dni_original": "(fila incompleta)",
                        "nombre": fila[COL_NOMBRE].strip() if len(fila) > COL_NOMBRE else "",
                    })
                    continue

                dni_original = fila[COL_DNI]
                dni = normalizar_dni(dni_original)
                
                # Tolerancia unificada de 6 a 8 dígitos
                if not (6 <= len(dni) <= 8):
                    descartados.append({
                        "archivo": nombre_archivo,
                        "fila": num_fila,
                        "dni_original": dni_original.strip() or "(vacío)",
                        "nombre": fila[COL_NOMBRE].strip() if len(fila) > COL_NOMBRE else "",
                    })
                    continue

                while len(fila) < 11:
                    fila.append("")

                timestamp = fila[COL_TIMESTAMP].strip()
                nombre = fila[COL_NOMBRE].strip()
                email = fila[COL_EMAIL].strip()
                constancia = fila[COL_CONSTANCIA].strip() or "No"
                estado_in = fila[COL_ESTADO_ENTRADA].strip() or "Pendiente"
                hora_in = fila[COL_HORA_ENTRADA].strip()
                estado_out = fila[COL_ESTADO_SALIDA].strip() or "Pendiente"
                hora_out = fila[COL_HORA_SALIDA].strip()
                cert_enviada = fila[COL_CERT_ENVIADA].strip() or "No"
                invitaciones = fila[COL_INVITACIONES].strip() or "Sí"

                if dni not in padron_consolidado:
                    padron_consolidado[dni] = [
                        timestamp,
                        nombre,
                        email,
                        dni,
                        constancia,
                        estado_in,
                        hora_in,
                        estado_out,
                        hora_out,
                        cert_enviada,
                        invitaciones
                    ]
                else:
                    reg = padron_consolidado[dni]

                    if not reg[COL_NOMBRE] and nombre:
                        reg[COL_NOMBRE] = nombre
                    if not reg[COL_EMAIL] and email:
                        reg[COL_EMAIL] = email
                    if reg[COL_CONSTANCIA] == "No" and constancia == "Sí":
                        reg[COL_CONSTANCIA] = "Sí"

                    # Entrada (prioriza 'Presente' y hora más temprana)
                    if estado_in == "Presente":
                        reg[COL_ESTADO_ENTRADA] = "Presente"
                        if hora_in:
                            reg[COL_HORA_ENTRADA] = min(reg[COL_HORA_ENTRADA], hora_in) if reg[COL_HORA_ENTRADA] else hora_in

                    # Salida (prioriza 'Completado' y hora más tardía)
                    if estado_out == "Completado":
                        reg[COL_ESTADO_SALIDA] = "Completado"
                        if hora_out:
                            reg[COL_HORA_SALIDA] = max(reg[COL_HORA_SALIDA], hora_out) if reg[COL_HORA_SALIDA] else hora_out

    # Orden defensivo alfabético por Nombre y Apellido
    filas_ordenadas = sorted(
        padron_consolidado.values(),
        key=lambda x: (x[COL_NOMBRE] or "").strip().lower()
    )
    reporte = {
        "descartados": descartados,
        "archivos_con_encabezado_inesperado": archivos_con_encabezado_inesperado,
    }
    return filas_ordenadas, reporte


class AppConsolidador:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Consolidador de Asistencia Offline")
        self.root.geometry("540x500")
        self.root.resizable(False, False)

        try:
            self.root.iconbitmap("app_icon.ico")
        except Exception:
            pass

        self.archivos_seleccionados: list[str] = []

        lbl_titulo = tk.Label(
            root, text="Unificación Posicional de Mesas (Cols A-K)", font=("Helvetica", 12, "bold"), pady=10
        )
        lbl_titulo.pack()

        frame_botones_archivos = tk.Frame(root)
        frame_botones_archivos.pack(pady=5)

        btn_seleccionar = tk.Button(
            frame_botones_archivos,
            text="➕ Agregar Archivo(s)",
            font=("Helvetica", 10),
            padx=10,
            pady=6,
            command=self.agregar_archivos,
        )
        btn_seleccionar.pack(side="left", padx=4)

        btn_quitar = tk.Button(
            frame_botones_archivos,
            text="➖ Quitar Seleccionado",
            font=("Helvetica", 10),
            padx=10,
            pady=6,
            command=self.quitar_archivo_seleccionado,
        )
        btn_quitar.pack(side="left", padx=4)

        btn_vaciar = tk.Button(
            frame_botones_archivos,
            text="🧹 Vaciar Lista",
            font=("Helvetica", 10),
            padx=10,
            pady=6,
            command=self.vaciar_lista,
        )
        btn_vaciar.pack(side="left", padx=4)

        lbl_ayuda = tk.Label(
            root,
            text="Podés apretar \"Agregar Archivo(s)\" las veces que necesites: cada archivo que elijas se suma a la lista.",
            font=("Helvetica", 8), fg="#64748b", wraplength=480, justify="center"
        )
        lbl_ayuda.pack(pady=(0, 4))

        self.lbl_conteo = tk.Label(root, text="Archivos cargados: 0", font=("Helvetica", 9), fg="#64748b")
        self.lbl_conteo.pack()

        self.lista_box = tk.Listbox(root, width=64, height=8, font=("Courier", 9))
        self.lista_box.pack(pady=10)

        self.btn_procesar = tk.Button(
            root,
            text="⚡ Consolidar y Guardar asistencia_final.csv",
            font=("Helvetica", 10, "bold"),
            bg="#16a34a",
            fg="white",
            padx=10,
            pady=8,
            state=tk.DISABLED,
            command=self.procesar_y_guardar,
        )
        self.btn_procesar.pack(pady=10)

    def agregar_archivos(self):
        rutas = filedialog.askopenfilenames(
            title="Seleccionar archivos CSV de asistencia (podés elegir uno o varios)",
            filetypes=[("Archivos CSV", "*.csv")],
        )
        if not rutas:
            return

        for r in rutas:
            if r not in self.archivos_seleccionados:
                self.archivos_seleccionados.append(r)
                nombre_archivo = r.replace("\\", "/").split("/")[-1]
                self.lista_box.insert(tk.END, nombre_archivo)

        self._actualizar_estado_lista()

    def quitar_archivo_seleccionado(self):
        seleccion = self.lista_box.curselection()
        if not seleccion:
            messagebox.showinfo("Quitar archivo", "Primero hacé clic sobre el archivo que querés quitar de la lista.")
            return
        idx = seleccion[0]
        self.lista_box.delete(idx)
        del self.archivos_seleccionados[idx]
        self._actualizar_estado_lista()

    def vaciar_lista(self):
        if not self.archivos_seleccionados:
            return
        respuesta = messagebox.askyesno("Vaciar Lista", "¿Seguro que querés quitar todos los archivos de la lista?")
        if not respuesta:
            return
        self.archivos_seleccionados = []
        self.lista_box.delete(0, tk.END)
        self._actualizar_estado_lista()

    def _actualizar_estado_lista(self):
        self.lbl_conteo.config(text=f"Archivos cargados: {len(self.archivos_seleccionados)}")
        self.btn_procesar.config(state=tk.NORMAL if self.archivos_seleccionados else tk.DISABLED)

    def procesar_y_guardar(self):
        if not self.archivos_seleccionados:
            return

        ruta_guardado = filedialog.asksaveasfilename(
            title="Guardar CSV Consolidado",
            defaultextension=".csv",
            initialfile="asistencia_final.csv",
            filetypes=[("Archivos CSV", "*.csv")],
        )

        if not ruta_guardado:
            return

        try:
            filas_consolidadas, reporte = consolidar_archivos(self.archivos_seleccionados)
            descartados = reporte["descartados"]

            # Escritura con utf-8-sig para compatibilidad nativa con Excel y Sheets
            with open(ruta_guardado, mode="w", newline="", encoding="utf-8-sig") as f:
                escritor = csv.writer(f, quoting=csv.QUOTE_ALL)
                escritor.writerow(ENCABEZADOS_CANONICOS)
                escritor.writerows(filas_consolidadas)

            ruta_descartados = None
            if descartados:
                base, _ext = os.path.splitext(ruta_guardado)
                ruta_descartados = f"{base}_descartados.csv"
                with open(ruta_descartados, mode="w", newline="", encoding="utf-8-sig") as f:
                    escritor = csv.writer(f, quoting=csv.QUOTE_ALL)
                    escritor.writerow(["Archivo", "Fila", "Nombre", "DNI original", "Motivo"])
                    for d in descartados:
                        escritor.writerow([
                            d["archivo"],
                            d["fila"],
                            d["nombre"] or "(sin nombre)",
                            d["dni_original"],
                            "DNI inválido (no tiene entre 6 y 8 dígitos) o fila incompleta"
                        ])

            total = len(filas_consolidadas)
            presentes = sum(1 for r in filas_consolidadas if r[COL_ESTADO_ENTRADA] == "Presente")
            completados = sum(1 for r in filas_consolidadas if r[COL_ESTADO_SALIDA] == "Completado")

            resumen = (
                f"Archivos unificados por posición:\n\n"
                f"• Padrón total consolidado: {total}\n"
                f"• Con Entrada registrada: {presentes}\n"
                f"• Con Salida completada: {completados}\n"
            )
            if descartados:
                resumen += (
                    f"• ⚠️ Filas descartadas: {len(descartados)}\n"
                    f"  (detalle guardado en:\n  {ruta_descartados})\n"
                )
            if reporte["archivos_con_encabezado_inesperado"]:
                archivos = ", ".join(reporte["archivos_con_encabezado_inesperado"])
                resumen += f"\n⚠️ Archivos con encabezado inesperado: {archivos}\n"

            resumen += f"\nArchivo guardado en:\n{ruta_guardado}"

            messagebox.showinfo("Consolidación Exitosa", resumen)
        except Exception as e:
            messagebox.showerror("Error al procesar", f"Ocurrió un problema durante la unificación:\n{str(e)}")


if __name__ == "__main__":
    ventana = tk.Tk()
    app = AppConsolidador(ventana)
    ventana.mainloop()
