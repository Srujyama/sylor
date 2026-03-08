"""
File upload and parsing endpoint.
Accepts CSV/Excel files, returns parsed columns with statistics.
"""
import io
import csv
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/upload", tags=["upload"])


class ColumnInfo(BaseModel):
    name: str
    type: str  # "float64", "int64", "string", "datetime"
    sample: str
    min: Optional[float] = None
    max: Optional[float] = None
    mean: Optional[float] = None
    std: Optional[float] = None
    non_null_count: int = 0


class ParseResponse(BaseModel):
    file_name: str
    file_size: int
    row_count: int
    columns: List[ColumnInfo]


def detect_column_type(values: List[str]) -> str:
    """Detect the data type of a column from string values."""
    numeric_count = 0
    int_count = 0
    date_chars = set("-/T:")

    for v in values[:100]:  # Sample first 100
        v = v.strip()
        if not v:
            continue
        try:
            float(v.replace(",", ""))
            numeric_count += 1
            if "." not in v:
                int_count += 1
        except ValueError:
            # Check for date-like patterns
            if any(c in v for c in date_chars) and len(v) >= 8:
                return "datetime"

    sample_size = min(len(values), 100)
    if sample_size == 0:
        return "string"

    if numeric_count / sample_size > 0.8:
        if int_count == numeric_count:
            return "int64"
        return "float64"
    return "string"


def compute_stats(values: List[str], col_type: str) -> Dict[str, Any]:
    """Compute basic statistics for numeric columns."""
    if col_type not in ("float64", "int64"):
        return {"non_null_count": len([v for v in values if v.strip()])}

    nums = []
    for v in values:
        try:
            nums.append(float(v.strip().replace(",", "")))
        except (ValueError, AttributeError):
            pass

    if not nums:
        return {"non_null_count": 0}

    import statistics
    return {
        "min": min(nums),
        "max": max(nums),
        "mean": round(statistics.mean(nums), 4),
        "std": round(statistics.stdev(nums), 4) if len(nums) > 1 else 0,
        "non_null_count": len(nums),
    }


@router.post("/parse", response_model=ParseResponse)
async def parse_file(file: UploadFile = File(...)):
    """Parse an uploaded CSV or Excel file and return column info + statistics."""

    # Validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(status_code=400, detail="Unsupported file type. Use CSV, XLSX, or XLS.")

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Max 10MB
    if file_size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10MB.")

    rows: List[List[str]] = []
    headers: List[str] = []

    if ext == "csv":
        # Parse CSV
        try:
            text = content.decode("utf-8")
            reader = csv.reader(io.StringIO(text))
            all_rows = list(reader)
            if not all_rows:
                raise HTTPException(status_code=400, detail="Empty CSV file")
            headers = all_rows[0]
            rows = all_rows[1:]
        except UnicodeDecodeError:
            # Try latin-1 fallback
            text = content.decode("latin-1")
            reader = csv.reader(io.StringIO(text))
            all_rows = list(reader)
            if not all_rows:
                raise HTTPException(status_code=400, detail="Empty CSV file")
            headers = all_rows[0]
            rows = all_rows[1:]
    elif ext in ("xlsx", "xls"):
        # Parse Excel using openpyxl
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            ws = wb.active
            if ws is None:
                raise HTTPException(status_code=400, detail="No active worksheet found")
            all_rows = [[str(cell) if cell is not None else "" for cell in row] for row in ws.iter_rows(values_only=True)]
            wb.close()
            if not all_rows:
                raise HTTPException(status_code=400, detail="Empty Excel file")
            headers = all_rows[0]
            rows = all_rows[1:]
        except ImportError:
            raise HTTPException(status_code=500, detail="Excel parsing not available. Install openpyxl.")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {str(e)}")

    # Build column info
    columns: List[ColumnInfo] = []
    for i, header in enumerate(headers):
        col_values = [row[i] if i < len(row) else "" for row in rows]
        col_type = detect_column_type(col_values)
        stats = compute_stats(col_values, col_type)

        # Get first non-empty sample
        sample = next((v.strip() for v in col_values if v.strip()), "")

        columns.append(ColumnInfo(
            name=header.strip() or f"column_{i}",
            type=col_type,
            sample=sample[:50],  # Truncate long samples
            **stats,
        ))

    return ParseResponse(
        file_name=file.filename,
        file_size=file_size,
        row_count=len(rows),
        columns=columns,
    )
