import json
import re
import sys
from pathlib import Path
from typing import Any, Optional


def normalize_label(label: Optional[str]) -> str:
    value = (label or "paragraph").lower()
    mapping = {
        "title": "TITLE",
        "document_title": "TITLE",
        "section_header": "HEADING",
        "section-title": "HEADING",
        "heading": "HEADING",
        "list_item": "LIST_ITEM",
        "table": "TABLE",
        "table_row": "TABLE_ROW",
        "table_cell": "TABLE_CELL",
        "text": "PARAGRAPH",
        "paragraph": "PARAGRAPH",
    }
    return mapping.get(value, "PARAGRAPH")


INTERNAL_REF_RE = re.compile(r"^#/(?:body|groups|texts|tables|pages)(?:/|$)", re.IGNORECASE)
CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十百千零〇]+(章|部分)")
SECTION_RE = re.compile(r"^第[一二三四五六七八九十百千零〇]+节")
ARTICLE_RE = re.compile(r"^第[一二三四五六七八九十百千零〇]+条")
CHINESE_HEADING_RE = re.compile(r"^[一二三四五六七八九十]+、")
NUMERIC_HEADING_RE = re.compile(r"^(\d+(?:\.\d+){1,4})(?:[、.\s]|$)")
PAREN_HEADING_RE = re.compile(r"^[（(][一二三四五六七八九十]+[）)]")
TOC_PAGE_RE = re.compile(r"[\t\s]+[0-9]{1,4}\s*$")


def get_bbox(prov: Optional[dict]):
    if not prov:
        return None
    bbox = prov.get("bbox") or {}
    left = bbox.get("l")
    top = bbox.get("t")
    right = bbox.get("r")
    bottom = bbox.get("b")
    if None in (left, top, right, bottom):
        return None
    return [left, top, right, bottom]


def normalize_whitespace(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def is_internal_ref(value: Optional[str]) -> bool:
    return bool(value and INTERNAL_REF_RE.match(value.strip()))


def build_ref_index(value: Any, index: Optional[dict] = None):
    ref_index = index if index is not None else {}
    if isinstance(value, dict):
        self_ref = value.get("self_ref")
        if isinstance(self_ref, str) and self_ref:
            ref_index[self_ref] = value
        for child in value.values():
            build_ref_index(child, ref_index)
    elif isinstance(value, list):
        for child in value:
            build_ref_index(child, ref_index)
    return ref_index


def resolve_ref(value: Any, ref_index: dict):
    if isinstance(value, dict):
        cref = value.get("cref")
        if isinstance(cref, str) and cref:
            return ref_index.get(cref)
        return value
    if isinstance(value, str) and is_internal_ref(value):
        return ref_index.get(value)
    return value


def resolve_inline_text(value: Any, ref_index: dict, visited: Optional[set] = None) -> str:
    resolved = resolve_ref(value, ref_index)
    seen = visited or set()

    if isinstance(resolved, dict):
        self_ref = resolved.get("self_ref")
        if isinstance(self_ref, str):
            if self_ref in seen:
                return ""
            seen = set(seen)
            seen.add(self_ref)

        text = normalize_whitespace(resolved.get("text"))
        if text:
            return text

        pieces = [resolve_inline_text(child, ref_index, seen) for child in resolved.get("children") or []]
        combined = "".join(piece for piece in pieces if piece)
        if combined:
            return normalize_whitespace(combined)
        return ""

    if isinstance(resolved, list):
        pieces = [resolve_inline_text(child, ref_index, seen) for child in resolved]
        return normalize_whitespace("".join(piece for piece in pieces if piece))

    if isinstance(resolved, str):
        if is_internal_ref(resolved):
            return ""
        return normalize_whitespace(resolved)

    return ""


def clean_heading_text(text: str) -> str:
    return normalize_whitespace(TOC_PAGE_RE.sub("", text))


def infer_heading_level(text: str, label: str) -> int:
    heading_text = clean_heading_text(text)
    if label == "TITLE":
        return 1
    if CHAPTER_RE.match(heading_text):
        return 1
    if SECTION_RE.match(heading_text):
        return 2
    if ARTICLE_RE.match(heading_text):
        return 3
    if CHINESE_HEADING_RE.match(heading_text):
        return 2
    if PAREN_HEADING_RE.match(heading_text):
        return 3
    numeric_match = NUMERIC_HEADING_RE.match(heading_text)
    if numeric_match:
        return min(5, len(numeric_match.group(1).split(".")))
    return 2


def looks_like_title(text: str) -> bool:
    normalized = clean_heading_text(text).replace(" ", "")
    return normalized in {"招标文件", "投标文件", "目录"}


def looks_like_heading(item: dict, text: str) -> bool:
    if not text:
        return False

    heading_text = clean_heading_text(text)
    if looks_like_title(heading_text):
        return True
    if CHAPTER_RE.match(heading_text) or SECTION_RE.match(heading_text) or ARTICLE_RE.match(heading_text):
        return True
    if CHINESE_HEADING_RE.match(heading_text) or PAREN_HEADING_RE.match(heading_text):
        return True
    if NUMERIC_HEADING_RE.match(heading_text):
        return True

    formatting = item.get("formatting") or {}
    bold = bool(formatting.get("bold"))
    if bold and len(heading_text) <= 48 and re.search(r"(要求|方案|计划|说明|范围|目录|联系方式|投诉|答疑|偏离|响应|附表)", heading_text):
        return True

    return False


def derive_block_type(item: dict, text: str) -> str:
    label = normalize_label(item.get("label"))
    if label == "PARAGRAPH":
        if item.get("enumerated") or item.get("marker"):
            return "LIST_ITEM"
        if looks_like_title(text):
            return "TITLE"
        if looks_like_heading(item, text):
            return "HEADING"
    return label


def extract_item_text(item: dict, ref_index: dict) -> str:
    text = normalize_whitespace(item.get("text"))
    inline_text = ""
    if not text and item.get("children"):
        inline_text = resolve_inline_text(item.get("children"), ref_index)
    marker = normalize_whitespace(item.get("marker"))
    if marker and inline_text:
        return normalize_whitespace(f"{marker} {inline_text}")
    return text or inline_text or marker


def compose_section_path(stack: list[str]) -> str:
    return " > ".join(part for part in stack if part) or "Unclassified"


def update_heading_stack(stack: list[str], level: int, text: str) -> list[str]:
    next_stack = stack[: max(0, level - 1)]
    next_stack.append(text)
    return next_stack


def collect_text_refs(value: Any, ref_index: dict, visited: Optional[set] = None) -> list[str]:
    resolved = resolve_ref(value, ref_index)
    seen = visited or set()

    if isinstance(resolved, dict):
        self_ref = resolved.get("self_ref")
        if isinstance(self_ref, str):
            if self_ref in seen:
                return []
            seen = set(seen)
            seen.add(self_ref)
            if self_ref.startswith("#/texts/"):
                return [self_ref]
        collected = []
        for child in resolved.get("children") or []:
            collected.extend(collect_text_refs(child, ref_index, seen))
        return collected

    if isinstance(resolved, list):
        collected = []
        for child in resolved:
            collected.extend(collect_text_refs(child, ref_index, seen))
        return collected

    return []


def get_row_text(cells: Any) -> str:
    values = []
    for cell in cells or []:
        if isinstance(cell, dict):
            text = normalize_whitespace(cell.get("text"))
        else:
            text = normalize_whitespace(str(cell))
        if not text:
            continue
        if values and values[-1] == text:
            continue
        values.append(text)
    return " | ".join(values)


def extract_table_rows(table: dict) -> list[str]:
    payload = table.get("data") or {}
    grid = payload.get("grid") or []
    rows = []
    if isinstance(grid, list):
        for row in grid:
            row_text = get_row_text(row if isinstance(row, list) else [row])
            if row_text:
                rows.append(row_text)

    if rows:
        return rows

    table_cells = payload.get("table_cells") or table.get("cells") or []
    if isinstance(table_cells, list):
        grouped = {}
        for cell in table_cells:
            if not isinstance(cell, dict):
                continue
            row_index = int(cell.get("start_row_offset_idx") or 0)
            grouped.setdefault(row_index, []).append(cell)
        for row_index in sorted(grouped):
            row_text = get_row_text(grouped[row_index])
            if row_text:
                rows.append(row_text)
    return rows


def collect_pages(doc_dict: dict):
    pages = []
    raw_pages = doc_dict.get("pages") or {}
    if isinstance(raw_pages, dict):
        iterable = raw_pages.items()
    else:
        iterable = enumerate(raw_pages, start=1)

    for key, page in iterable:
        page_no = int(page.get("page_no") or key)
        size = page.get("size") or {}
        pages.append(
            {
                "page_no": page_no,
                "width": size.get("width"),
                "height": size.get("height"),
                "rotation": page.get("rotation"),
                "image_key": None,
            }
        )
    return sorted(pages, key=lambda item: item["page_no"])


def collect_blocks(doc_dict: dict):
    blocks = []
    paragraph_no = 0
    ref_index = build_ref_index(doc_dict)
    items = doc_dict.get("texts") or []
    section_stack: list[str] = []
    text_ref_context: dict[str, dict] = {}

    for item in items:
        text = extract_item_text(item, ref_index)
        label = derive_block_type(item, text)
        page_no = 1
        prov_list = item.get("prov") or []
        prov = prov_list[0] if prov_list else {}
        if prov.get("page_no"):
            page_no = prov.get("page_no")

        self_ref = item.get("self_ref")
        if label in {"TITLE", "HEADING"} and text:
            section_stack = update_heading_stack(section_stack, infer_heading_level(text, label), clean_heading_text(text))
        section_path = compose_section_path(section_stack)

        if isinstance(self_ref, str) and self_ref:
            text_ref_context[self_ref] = {
                "section_path": section_path,
                "page_no": page_no,
            }

        if not text:
            continue

        if label not in {"TITLE", "HEADING"}:
            paragraph_no += 1

        blocks.append(
            {
                "page_no": page_no,
                "block_type": label,
                "section_path": section_path,
                "heading_level": infer_heading_level(text, label) if label in {"TITLE", "HEADING"} else None,
                "paragraph_no": None if label in {"TITLE", "HEADING"} else paragraph_no,
                "text": clean_heading_text(text) if label in {"TITLE", "HEADING"} else text,
                "bbox": get_bbox(prov),
                "metadata": {
                    "docling_label": item.get("label"),
                    "self_ref": item.get("self_ref"),
                },
            }
        )

    tables = doc_dict.get("tables") or []
    for table in tables:
        rows = extract_table_rows(table)
        table_text_refs = collect_text_refs(table.get("children"), ref_index)
        anchor_context = None
        for text_ref in table_text_refs:
            anchor_context = text_ref_context.get(text_ref)
            if anchor_context:
                break

        prov_list = table.get("prov") or []
        prov = prov_list[0] if prov_list else {}
        table_page_no = prov.get("page_no") or (anchor_context or {}).get("page_no") or 1
        section_path = (anchor_context or {}).get("section_path") or normalize_whitespace(table.get("caption")) or "Unclassified"

        for row_index, text in enumerate(rows, start=1):
            paragraph_no += 1
            blocks.append(
                {
                    "page_no": table_page_no,
                    "block_type": "TABLE_ROW",
                    "section_path": section_path,
                    "heading_level": None,
                    "paragraph_no": paragraph_no,
                    "text": text,
                    "bbox": None,
                    "metadata": {
                        "table_ref": table.get("self_ref"),
                        "table_caption": table.get("caption"),
                        "row_index": row_index,
                    },
                }
            )

    return blocks


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: docling_extract.py <input_path> <output_path>")

    input_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()

    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(str(input_path))
    document = result.document

    if hasattr(document, "model_dump"):
        doc_dict = document.model_dump(mode="json")
    elif hasattr(document, "export_to_dict"):
        doc_dict = document.export_to_dict()
    else:
        raise RuntimeError("Unsupported Docling document object: no model_dump/export_to_dict found")

    payload = {
        "pages": collect_pages(doc_dict),
        "blocks": collect_blocks(doc_dict),
        "metadata": {
            "parser": "docling-python",
            "source_name": input_path.name,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
