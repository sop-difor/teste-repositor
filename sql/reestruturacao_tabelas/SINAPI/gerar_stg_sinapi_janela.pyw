# -*- coding: utf-8 -*-
"""
Janela simples para rodar o gerar_stg_sinapi.py sem terminal.
Dois cliques neste arquivo (.pyw abre sem janela preta de console).
Requer: Python + openpyxl  (pip install openpyxl)
"""
import re
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox

AQUI = Path(__file__).resolve().parent
SCRIPT = AQUI / "gerar_stg_sinapi.py"


def detectar_mes(p):
    m = re.search(r"(20\d{2})[ _.-]?(0[1-9]|1[0-2])(?!\d)", Path(p).stem)
    return f"{m.group(1)}-{m.group(2)}" if m else ""


def escolher():
    p = filedialog.askopenfilename(
        title="Planilha SINAPI (.xlsx)",
        filetypes=[("Planilha Excel", "*.xlsx"), ("Todos", "*.*")],
    )
    if p:
        v_arquivo.set(p)
        mm = detectar_mes(p)
        if mm:
            v_mes.set(mm)


def gerar():
    arq = v_arquivo.get().strip()
    mm = v_mes.get().strip()
    if not arq:
        messagebox.showwarning("Falta a planilha", "Clique em 'Escolher planilha' primeiro.")
        return
    if not re.match(r"^\d{4}-\d{2}$", mm):
        messagebox.showwarning("Mês inválido", "Informe o mês no formato AAAA-MM (ex.: 2025-01).")
        return

    btn.config(state="disabled")
    txt.delete("1.0", "end")
    txt.insert("end", "Processando... isso leva ~30 segundos.\n")
    root.update_idletasks()

    def run():
        try:
            r = subprocess.run(
                [sys.executable, str(SCRIPT), arq, mm],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            txt.insert("end", (r.stdout or "") + (r.stderr or ""))
            txt.see("end")
            if r.returncode == 0:
                messagebox.showinfo("Pronto", f"Gerado: stg_sinapi_{mm}.csv\n(na pasta {AQUI})")
                try:
                    subprocess.run(["explorer", str(AQUI)])
                except Exception:
                    pass
            else:
                messagebox.showerror("Erro", "Não deu certo. Veja as mensagens na janela.")
        finally:
            btn.config(state="normal")

    threading.Thread(target=run, daemon=True).start()


root = tk.Tk()
root.title("Gerar CSV do SINAPI")
root.geometry("680x460")
root.minsize(560, 360)

v_arquivo = tk.StringVar()
v_mes = tk.StringVar()

tk.Label(root, text="1) Escolha a planilha mensal do SINAPI (.xlsx):").pack(anchor="w", padx=12, pady=(12, 2))
lin1 = tk.Frame(root)
lin1.pack(fill="x", padx=12)
tk.Entry(lin1, textvariable=v_arquivo).pack(side="left", fill="x", expand=True)
tk.Button(lin1, text="Escolher planilha...", command=escolher).pack(side="left", padx=(6, 0))

lin2 = tk.Frame(root)
lin2.pack(anchor="w", padx=12, pady=8)
tk.Label(lin2, text="2) Mês (AAAA-MM):").pack(side="left")
tk.Entry(lin2, textvariable=v_mes, width=12).pack(side="left", padx=6)
tk.Label(lin2, text="(preenchido automático pelo nome do arquivo)").pack(side="left")

btn = tk.Button(root, text="3) Gerar CSV", command=gerar, height=2)
btn.pack(fill="x", padx=12, pady=6)

txt = tk.Text(root, height=16, wrap="word")
txt.pack(fill="both", expand=True, padx=12, pady=(4, 12))

root.mainloop()
