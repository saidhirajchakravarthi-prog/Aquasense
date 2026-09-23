"""
CGWB PDF table extraction — structural inspection only.
Reads the PDF, prints table layout/rows, writes nothing, touches no DB.
"""
import sys
import pdfplumber

target = sys.argv[1] if len(sys.argv) > 1 else "C:/Users/DELL/certificates/sih documents/final_nhs-wq_pre_2022_compressed.pdf"
start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
end = int(sys.argv[3]) if len(sys.argv) > 3 else 3

with pdfplumber.open(target) as pdf:
    print(f"pages: {len(pdf.pages)}")
    for pi in range(start, min(end, len(pdf.pages))):
        page = pdf.pages[pi]
        print(f"\n========== PAGE {pi+1} ==========")
        tables = page.extract_tables()
        print(f"tables found: {len(tables)}")
        for ti, t in enumerate(tables):
            rows = len(t)
            cols = len(t[0]) if t else 0
            print(f"  table {ti}: {rows} rows x {cols} cols")
            for ri in range(min(10, rows)):
                print(f"    row {ri}: {t[ri]}")
        if not tables:
            text = page.extract_text() or ""
            print(f"  raw text (first 800):\n{text[:800]}")
