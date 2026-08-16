#!/usr/bin/env python3
"""
CLI script for PDF/DOCX ingestion - called from Node.js handler.
Extracts text, chunks via rag_engine, outputs JSON.
"""
import sys
import os
import json
import io

# Add rag_engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from chunking import chunk_text

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    import docx
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

try:
    import pytesseract
    from PIL import Image
    HAS_TESSERACT = True
    # Set Tesseract path for Windows
    if os.name == 'nt':
        tesseract_paths = [
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            r'C:\Users\Parth\AppData\Local\Programs\Tesseract-OCR\tesseract.exe',
        ]
        for path in tesseract_paths:
            if os.path.exists(path):
                pytesseract.pytesseract.tesseract_cmd = path
                print(f"Tesseract found at: {path}", file=sys.stderr)
                break
        else:
            print("WARNING: Tesseract executable not found in standard locations", file=sys.stderr)
except ImportError:
    HAS_TESSERACT = False

def extract_text_from_pdf(filepath: str) -> str:
    """Extract text from PDF using pdfplumber first, then PyMuPDF with OCR fallback."""
    text_parts = []
    
    # Try pdfplumber first
    if HAS_PDFPLUMBER:
        try:
            with pdfplumber.open(filepath) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        text_parts.append(t)
            if text_parts:
                return "\n\n".join(text_parts)
        except Exception:
            pass  # Fall through to PyMuPDF
    
    # Try PyMuPDF
    if HAS_PYMUPDF:
        try:
            doc = fitz.open(filepath)
            for page in doc:
                t = page.get_text()
                if t:
                    text_parts.append(t)
            doc.close()
            if text_parts:
                return "\n\n".join(text_parts)
        except Exception:
            pass  # Fall through to OCR
    
    # Try OCR with PyMuPDF + Tesseract for image-based PDFs
    if HAS_PYMUPDF and HAS_TESSERACT:
        try:
            print(f"Attempting OCR with Tesseract at: {pytesseract.pytesseract.tesseract_cmd}", file=sys.stderr)
            doc = fitz.open(filepath)
            print(f"PDF has {len(doc)} pages", file=sys.stderr)
            for page_num, page in enumerate(doc):
                # First try to get embedded images
                images = page.get_images()
                print(f"Page {page_num + 1} has {len(images)} embedded images", file=sys.stderr)
                for img in images:
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image['image']
                    image = Image.open(io.BytesIO(image_bytes))
                    # Convert to RGB if needed
                    if image.mode != 'RGB':
                        image = image.convert('RGB')
                    text = pytesseract.image_to_string(image)
                    if text.strip():
                        text_parts.append(text)
            
            # If no text from embedded images, render pages as images and OCR
            if not text_parts:
                print("No text from embedded images, rendering pages for OCR...", file=sys.stderr)
                for page_num, page in enumerate(doc):
                    # Render page as image at 150 DPI
                    pix = page.get_pixmap(dpi=150)
                    img_data = pix.tobytes("png")
                    image = Image.open(io.BytesIO(img_data))
                    if image.mode != 'RGB':
                        image = image.convert('RGB')
                    text = pytesseract.image_to_string(image)
                    if text.strip():
                        text_parts.append(text)
                    print(f"Page {page_num + 1} OCR text length: {len(text)}", file=sys.stderr)
            
            doc.close()
            if text_parts:
                return "\n\n".join(text_parts)
        except Exception as e:
            print(f"OCR error: {e}", file=sys.stderr)
            pass
    
    # If all methods fail, return empty string
    return ""

def extract_text_from_docx(filepath: str) -> str:
    """Extract text from DOCX using python-docx."""
    if not HAS_DOCX:
        raise RuntimeError("python-docx not installed")
    doc = docx.Document(filepath)
    return "\n".join([p.text for p in doc.paragraphs if p.text.strip()])

def extract_text(filepath: str, filename: str) -> str:
    """Extract text based on file extension."""
    ext = filename.lower().split('.')[-1]
    if ext == 'pdf':
        return extract_text_from_pdf(filepath)
    elif ext in ('docx', 'doc'):
        return extract_text_from_docx(filepath)
    elif ext in ('txt', 'md'):
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    else:
        raise ValueError(f"Unsupported file type: {ext}")

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python ingest_cli.py <filepath> <filename>"}))
        sys.stdout.flush()
        sys.exit(1)
    
    filepath = sys.argv[1]
    filename = sys.argv[2]
    
    try:
        # Extract text
        text = extract_text(filepath, filename)
        if not text or len(text.strip()) < 50:
            print(json.dumps({"error": "Could not extract meaningful text from file. The file may be a scanned/image PDF without OCR support, or the document may be empty."}))
            sys.stdout.flush()
            sys.exit(1)
        
        # Chunk using rag_engine
        title = filename.rsplit('.', 1)[0]
        chunks = chunk_text(text, title=title)
        
        # Output result
        result = {
            "title": title,
            "content": text,
            "chunks": chunks
        }
        print(json.dumps(result))
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.stdout.flush()
        sys.exit(1)

if __name__ == '__main__':
    main()