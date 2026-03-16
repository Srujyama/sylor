"""
Document text processing service for Sylor.
Adapted from MiroFish's text_processor.py with improvements:
- Async file handling
- PDF support via PyMuPDF
- Better encoding detection
- Richer text statistics
- Configurable chunking strategies
"""
import io
import re
import csv
import math
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field


@dataclass
class TextChunk:
    """A chunk of text with metadata."""
    content: str
    index: int
    start_char: int
    end_char: int
    word_count: int


@dataclass
class TextStats:
    """Statistics about processed text."""
    total_chars: int
    total_words: int
    total_sentences: int
    total_paragraphs: int
    avg_sentence_length: float
    language_hint: str  # "en", "zh", "mixed"
    estimated_tokens: int


@dataclass
class ProcessedDocument:
    """Result of document processing."""
    text: str
    stats: TextStats
    chunks: List[TextChunk] = field(default_factory=list)
    source_filename: Optional[str] = None


class TextProcessor:
    """
    Processes documents into clean text and chunks for knowledge graph ingestion.
    Supports PDF, TXT, CSV, and Markdown files.
    """

    @staticmethod
    def extract_text_from_bytes(content: bytes, filename: str) -> str:
        """Extract text from file bytes based on file extension."""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext == "pdf":
            return TextProcessor._extract_pdf(content)
        elif ext == "csv":
            return TextProcessor._extract_csv(content)
        elif ext in ("xlsx", "xls"):
            return TextProcessor._extract_excel(content)
        elif ext in ("md", "markdown"):
            return TextProcessor._extract_markdown(content)
        else:
            # Plain text with encoding detection
            return TextProcessor._extract_text(content)

    @staticmethod
    def _extract_pdf(content: bytes) -> str:
        """Extract text from PDF using PyMuPDF."""
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=content, filetype="pdf")
            pages = []
            for page in doc:
                pages.append(page.get_text())
            doc.close()
            return "\n\n".join(pages)
        except ImportError:
            raise RuntimeError("PDF support requires PyMuPDF. Install with: pip install PyMuPDF")

    @staticmethod
    def _extract_csv(content: bytes) -> str:
        """Convert CSV to readable text format."""
        text = TextProcessor._decode_bytes(content)
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            return ""
        headers = rows[0]
        lines = []
        for row in rows[1:]:
            parts = [f"{h}: {v}" for h, v in zip(headers, row) if v.strip()]
            lines.append("; ".join(parts))
        return "\n".join(lines)

    @staticmethod
    def _extract_excel(content: bytes) -> str:
        """Convert Excel to readable text format."""
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            lines = []
            for ws in wb.worksheets:
                rows = list(ws.iter_rows(values_only=True))
                if not rows:
                    continue
                headers = [str(c) if c else f"col_{i}" for i, c in enumerate(rows[0])]
                for row in rows[1:]:
                    parts = [f"{h}: {str(v)}" for h, v in zip(headers, row) if v is not None]
                    lines.append("; ".join(parts))
            wb.close()
            return "\n".join(lines)
        except ImportError:
            raise RuntimeError("Excel support requires openpyxl.")

    @staticmethod
    def _extract_markdown(content: bytes) -> str:
        """Extract text from markdown, stripping formatting."""
        text = TextProcessor._decode_bytes(content)
        # Remove code blocks
        text = re.sub(r'```[\s\S]*?```', '', text)
        # Remove inline code
        text = re.sub(r'`[^`]+`', '', text)
        # Remove images
        text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
        # Convert links to text
        text = re.sub(r'\[([^\]]+)\]\(.*?\)', r'\1', text)
        # Remove headers markers but keep text
        text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
        # Remove bold/italic markers
        text = re.sub(r'[*_]{1,3}', '', text)
        return text.strip()

    @staticmethod
    def _extract_text(content: bytes) -> str:
        """Extract text with encoding detection."""
        return TextProcessor._decode_bytes(content)

    @staticmethod
    def _decode_bytes(content: bytes) -> str:
        """Decode bytes to string with encoding fallback chain."""
        for encoding in ("utf-8", "utf-8-sig", "latin-1", "cp1252", "gbk", "gb2312"):
            try:
                return content.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                continue
        return content.decode("utf-8", errors="replace")

    @staticmethod
    def preprocess(text: str) -> str:
        """
        Clean and normalize text for graph ingestion.
        Adapted from MiroFish with additional cleaning steps.
        """
        # Normalize line endings
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        # Collapse excessive blank lines (3+ -> 2)
        text = re.sub(r'\n{3,}', '\n\n', text)
        # Collapse excessive spaces
        text = re.sub(r' {3,}', '  ', text)
        # Remove null bytes
        text = text.replace('\x00', '')
        # Strip leading/trailing whitespace per line
        lines = [line.strip() for line in text.split('\n')]
        text = '\n'.join(lines)
        # Strip overall
        return text.strip()

    @staticmethod
    def split_text(
        text: str,
        chunk_size: int = 500,
        overlap: int = 50,
        respect_sentences: bool = True,
    ) -> List[TextChunk]:
        """
        Split text into overlapping chunks.
        Improved over MiroFish: respects sentence boundaries and returns metadata.
        """
        if not text:
            return []

        if respect_sentences:
            return TextProcessor._split_by_sentences(text, chunk_size, overlap)
        return TextProcessor._split_by_chars(text, chunk_size, overlap)

    @staticmethod
    def _split_by_sentences(text: str, chunk_size: int, overlap: int) -> List[TextChunk]:
        """Split by character count but break at sentence boundaries."""
        # Split into sentences (handles English and Chinese)
        sentence_pattern = r'(?<=[.!?。！？\n])\s+'
        sentences = re.split(sentence_pattern, text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks = []
        current_chunk = []
        current_size = 0
        chunk_start = 0
        char_pos = 0

        for sentence in sentences:
            sentence_len = len(sentence)

            if current_size + sentence_len > chunk_size and current_chunk:
                # Emit current chunk
                chunk_text = " ".join(current_chunk)
                chunks.append(TextChunk(
                    content=chunk_text,
                    index=len(chunks),
                    start_char=chunk_start,
                    end_char=char_pos,
                    word_count=len(chunk_text.split()),
                ))

                # Calculate overlap: keep last N characters worth of sentences
                overlap_text = ""
                overlap_sentences = []
                for s in reversed(current_chunk):
                    if len(overlap_text) + len(s) > overlap:
                        break
                    overlap_sentences.insert(0, s)
                    overlap_text = " ".join(overlap_sentences)

                current_chunk = overlap_sentences
                current_size = len(overlap_text)
                chunk_start = char_pos - len(overlap_text)

            current_chunk.append(sentence)
            current_size += sentence_len + 1
            char_pos += sentence_len + 1

        # Emit final chunk
        if current_chunk:
            chunk_text = " ".join(current_chunk)
            chunks.append(TextChunk(
                content=chunk_text,
                index=len(chunks),
                start_char=chunk_start,
                end_char=char_pos,
                word_count=len(chunk_text.split()),
            ))

        return chunks

    @staticmethod
    def _split_by_chars(text: str, chunk_size: int, overlap: int) -> List[TextChunk]:
        """Simple character-based splitting with overlap."""
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk_text = text[start:end]
            chunks.append(TextChunk(
                content=chunk_text,
                index=len(chunks),
                start_char=start,
                end_char=min(end, len(text)),
                word_count=len(chunk_text.split()),
            ))
            start += chunk_size - overlap
        return chunks

    @staticmethod
    def get_stats(text: str) -> TextStats:
        """Compute text statistics."""
        words = text.split()
        sentences = re.split(r'[.!?。！？]+', text)
        sentences = [s for s in sentences if s.strip()]
        paragraphs = [p for p in text.split('\n\n') if p.strip()]

        # Language detection heuristic
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        total_chars = len(text)
        if chinese_chars > total_chars * 0.3:
            lang = "zh"
        elif chinese_chars > total_chars * 0.05:
            lang = "mixed"
        else:
            lang = "en"

        # Rough token estimation (English ~4 chars/token, Chinese ~2 chars/token)
        estimated_tokens = int(len(text) / 3.5)

        return TextStats(
            total_chars=total_chars,
            total_words=len(words),
            total_sentences=len(sentences),
            total_paragraphs=len(paragraphs),
            avg_sentence_length=len(words) / max(len(sentences), 1),
            language_hint=lang,
            estimated_tokens=estimated_tokens,
        )

    @staticmethod
    def process_document(content: bytes, filename: str, chunk_size: int = 500, chunk_overlap: int = 50) -> ProcessedDocument:
        """Full pipeline: extract -> preprocess -> chunk -> stats."""
        raw_text = TextProcessor.extract_text_from_bytes(content, filename)
        clean_text = TextProcessor.preprocess(raw_text)
        stats = TextProcessor.get_stats(clean_text)
        chunks = TextProcessor.split_text(clean_text, chunk_size, chunk_overlap)

        return ProcessedDocument(
            text=clean_text,
            stats=stats,
            chunks=chunks,
            source_filename=filename,
        )
