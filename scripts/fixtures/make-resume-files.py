"""Builds the synthetic PDF and DOCX resume fixtures from fixtures/resumes/*.txt.

Usage: python3 scripts/fixtures/make-resume-files.py
Needs python-docx and reportlab. The outputs are committed so tests need neither.
"""
import pathlib

from docx import Document
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

root = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "resumes"

for txt in sorted(root.glob("*.txt")):
    lines = txt.read_text(encoding="utf-8").splitlines()

    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    doc.core_properties.author = "CareerMetro fixtures"
    doc.save(txt.with_suffix(".docx"))

    pdf = canvas.Canvas(str(txt.with_suffix(".pdf")), pagesize=A4, invariant=1)
    pdf.setFont("Helvetica", 10)
    y = 800
    for line in lines:
        pdf.drawString(50, y, line)
        y -= 14
    pdf.save()
    print("wrote", txt.stem)
