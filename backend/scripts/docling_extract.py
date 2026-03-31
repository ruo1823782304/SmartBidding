import json
import sys
from pathlib import Path
from typing import Optional


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


def build_section_path(item: dict):
    text = (item.get("text") or "").strip()
    label = normalize_label(item.get("label"))
    if label in {"TITLE", "HEADING"} and text:
        return text
    return item.get("parent") or item.get("section_path") or "Unclassified"


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
    items = doc_dict.get("texts") or []
    for item in items:
        text = (item.get("text") or "").strip()
        if not text:
            continue
        label = normalize_label(item.get("label"))
        prov_list = item.get("prov") or []
        prov = prov_list[0] if prov_list else {}
        page_no = prov.get("page_no") or 1
        if label not in {"TITLE", "HEADING"}:
            paragraph_no += 1

        blocks.append(
            {
                "page_no": page_no,
                "block_type": label,
                "section_path": build_section_path(item),
                "heading_level": 1 if label in {"TITLE", "HEADING"} else None,
                "paragraph_no": None if label in {"TITLE", "HEADING"} else paragraph_no,
                "text": text,
                "bbox": get_bbox(prov),
                "metadata": {
                    "docling_label": item.get("label"),
                    "self_ref": item.get("self_ref"),
                },
            }
        )

    tables = doc_dict.get("tables") or []
    for table in tables:
        rows = table.get("data") or table.get("cells") or []
        for row_index, row in enumerate(rows, start=1):
            text = json.dumps(row, ensure_ascii=False)
            blocks.append(
                {
                    "page_no": 1,
                    "block_type": "TABLE_ROW",
                    "section_path": table.get("caption") or "Table",
                    "heading_level": None,
                    "paragraph_no": paragraph_no + row_index,
                    "text": text,
                    "bbox": None,
                    "metadata": {
                        "table_caption": table.get("caption"),
                    },
                }
            )
        paragraph_no += len(rows)

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
