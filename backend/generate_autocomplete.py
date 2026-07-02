"""Generate p123_autocomplete.json from the portfolio123 skill's extraction-verified
Factor Reference files (4,463 factors / 465 functions, verified against the official
P123 dictionary). Replaces the old hand-typed autocomplete list, which contained
factor names that do not exist on P123.

Usage:
    python generate_autocomplete.py <path-to-skill-references-dir>

The references directory comes from the portfolio123 skill repo
(https://github.com/acombs/p123-skill → references/). Re-run whenever the
skill reference files are updated; commit the resulting JSON.
"""

import json
import re
import sys
from pathlib import Path

# file stem -> category badge shown in the autocomplete dropdown
FILE_CATEGORIES = {
    "ratios-statistics": "Ratios",
    "financials": "Financials",
    "fundamentals": "Fundamentals",
    "estimates": "Estimates",
    "technical": "Technical",
    "advanced-functions": "Advanced",
    "strategy": "Strategy",
    "universe-operations": "Universe",
    "universe-filters": "Universe",
    "benchmark-functions": "Benchmark",
    "industry-sector": "Industry",
    "misc": "Misc",
}

NAME_RE = re.compile(r"^[A-Za-z#$@][A-Za-z0-9%#_]*$")
FUNC_HEADING_RE = re.compile(r"^####\s+`([^`]+)`")
TABLE_ROW_RE = re.compile(r"^\|\s*`([^`]+)`\s*\|(.+)\|\s*$")

MAX_DESC = 150


def clean_desc(text: str) -> str:
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # strip md links
    text = text.replace("`", "").strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > MAX_DESC:
        text = text[: MAX_DESC - 1].rstrip() + "…"
    return text


def parse_file(path: Path, category: str) -> list[dict]:
    items: list[dict] = []
    lines = path.read_text().splitlines()

    in_common_mistakes = False
    table_header_first_cell = None

    i = 0
    while i < len(lines):
        line = lines[i]

        heading = re.match(r"^(#{2,3})\s+(.*)", line)
        if heading:
            in_common_mistakes = "common mistakes" in heading.group(2).lower()
            table_header_first_cell = None

        # Function headings: #### `Name(args)`
        m = FUNC_HEADING_RE.match(line)
        if m and not in_common_mistakes:
            sig = m.group(1).strip()
            name = sig.split("(")[0].strip()
            if NAME_RE.match(name):
                desc = ""
                for j in range(i + 1, min(i + 6, len(lines))):
                    nxt = lines[j].strip()
                    if not nxt or nxt.startswith("#"):
                        if nxt.startswith("#"):
                            break
                        continue
                    if nxt.startswith("*Period"):
                        continue
                    if nxt.startswith("|"):
                        break
                    desc = clean_desc(nxt)
                    break
                items.append({"label": name, "category": category, "desc": desc,
                              "sig": sig, "kind": "function"})
            i += 1
            continue

        # Track table headers so we only harvest factor tables
        if line.startswith("|") and "---" not in line:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if cells and not line.strip().startswith("| `"):
                table_header_first_cell = cells[0].lower()
                i += 1
                continue

        row = TABLE_ROW_RE.match(line)
        if row and not in_common_mistakes and table_header_first_cell in ("factor", "operator"):
            name = row.group(1).strip()
            rest = [c.strip() for c in row.group(2).split("|")]
            desc = clean_desc(rest[0]) if rest else ""
            period = rest[1].strip() if len(rest) > 1 else ""
            if period and period.lower() not in ("", "n/a"):
                desc = f"{desc} [{period}]" if desc else f"[{period}]"
            if NAME_RE.match(name):
                kind = "operator" if table_header_first_cell == "operator" else "factor"
                items.append({"label": name, "category": category, "desc": desc, "kind": kind})

        i += 1

    return items


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python generate_autocomplete.py <path-to-skill-references-dir>")
    refs = Path(sys.argv[1])
    if not refs.is_dir():
        sys.exit(f"Skill references directory not found: {refs}")

    all_items: list[dict] = []
    for stem, category in FILE_CATEGORIES.items():
        path = refs / f"{stem}.md"
        if not path.is_file():
            print(f"warning: {path.name} missing, skipped")
            continue
        items = parse_file(path, category)
        print(f"{path.name}: {len(items)} entries")
        all_items.extend(items)

    # Keep the first occurrence of each name (category files are ordered by specificity)
    seen: set[str] = set()
    deduped = []
    for it in all_items:
        key = it["label"].lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(it)

    # Logical operators aren't factor-reference entries but belong in completion.
    for op, desc in (("AND", "Logical AND — both conditions must be true"),
                     ("OR", "Logical OR — either condition may be true"),
                     ("NOT", "Logical NOT — negates the condition"),
                     ("NA", "Missing value — test with `expr = NA` (IsNA is a 2-arg replacement)")):
        if op.lower() not in seen:
            deduped.append({"label": op, "category": "Operator", "desc": desc, "kind": "operator"})

    out = Path(__file__).parent / "p123_autocomplete.json"
    with open(out, "w") as f:
        json.dump(deduped, f, separators=(",", ":"))
    print(f"\nWrote {len(deduped)} entries to {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
