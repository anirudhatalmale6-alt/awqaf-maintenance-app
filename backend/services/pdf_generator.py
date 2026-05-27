"""ReportLab-based PDF generator for site-visit requests.

This module replaces the previous WeasyPrint-based implementation, which
required native Pango/Cairo libraries that are NOT present in the default
AWS Lambda Python runtime (Amazon Linux 2/2023). ReportLab is pure-Python
plus a small C-extension shipped as a manylinux wheel — runs on Lambda
with no extra system libraries.

Public API (UNCHANGED — same signatures the routers call)
---------------------------------------------------------
- :func:`render_site_visit_pdf` — main entry point used by routers.
- :func:`build_request_payload` — shapes a SiteVisitRequest ORM row
  into the dict the renderer expects.

Arabic shaping is handled by ``arabic-reshaper`` + ``python-bidi``
before each Arabic string is handed to ReportLab's ``Paragraph`` /
``Table`` cells. Fonts: ``Amiri-Regular.ttf`` and ``Amiri-Bold.ttf``
shipped in ``app/backend/fonts/``.

Layout matches the **official government reference form** 1:1
(``/workspace/uploads/بلاغات صيانة محافظة مبارك الكبير (3).pdf``):

  1. 3-logo header row (right=Ministry, center=2016, left=Mosques).
  2. Gray title bar: "زيارات ميدانية لاستلام مواقع".
  3. Three info rows with dotted underlines:
        - اسم المستلم  ............  شهر -- /  ......
        - الرقم المدني  ......................
        - المسمى الوظيفي  ....................
  4. 5-column visits table (RTL: م | المسجد | التاريخ | سبب الزيارة |
     التوقيع) padded to 12 fixed body rows + الإجمالي total row.
  5. 3-column signature block (right→left: رئيس القسم / مراقب الصيانة /
     مدير الإدارة).
  6. Optional second page with attendance image.

**No "دُقِّق بواسطة" / audit box anywhere** — the reference form has no
such section, so we deliberately omit audit metadata from the rendered
PDF even when the database has it populated.
"""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
FONTS_DIR = BASE_DIR / "fonts"
LOGOS_DIR = BASE_DIR / "assets" / "logos"

_AMIRI_REGULAR = FONTS_DIR / "Amiri-Regular.ttf"
_AMIRI_BOLD = FONTS_DIR / "Amiri-Bold.ttf"

_LOGO_RIGHT = LOGOS_DIR / "right-logo.png"
_LOGO_CENTER = LOGOS_DIR / "center-logo.png"
_LOGO_LEFT = LOGOS_DIR / "left-logo.png"

# Cache the "fonts registered" flag so we only call registerFont once per
# process even when many PDFs are rendered in a row.
_fonts_registered = False


def _ensure_fonts_registered() -> None:
    """Register Amiri-Regular and Amiri-Bold with ReportLab once."""
    global _fonts_registered
    if _fonts_registered:
        return
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    pdfmetrics.registerFont(TTFont("Amiri", str(_AMIRI_REGULAR)))
    pdfmetrics.registerFont(TTFont("Amiri-Bold", str(_AMIRI_BOLD)))
    _fonts_registered = True


# -----------------------------------------------------------------------------
# Status labels (UI Arabic strings)
# -----------------------------------------------------------------------------
_STATUS_LABELS = {
    "pending_audit": "بانتظار التدقيق",
    "rejected_audit": "مرفوض من التدقيق",
    "pending_head": "بانتظار رئيس القسم",
    "pending_supervisor": "بانتظار مراقب الصيانة",
    "pending_director": "بانتظار مدير الإدارة",
    "approved": "معتمد",
    "rejected": "مرفوض",
}


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _fmt_dt(value: Any) -> str:
    """Format a datetime for the PDF; empty string when missing."""
    if not value:
        return ""
    try:
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d %H:%M")
        return str(value)
    except Exception:  # noqa: BLE001
        return str(value)


def _resolve_attendance_disk_path(web_path: str) -> Optional[Path]:
    """Map a public ``/uploads/site-visit-attendance/<file>`` web path to
    the on-disk location, mirroring ``routers/site_visits._attendance_dir``.

    Returns ``None`` for non-local-disk paths (e.g. ``oss://...``); callers
    must handle those via :func:`_load_attendance_bytes` instead.
    """
    if not web_path or web_path.startswith("oss://"):
        return None
    name = Path(web_path).name
    if not name:
        return None
    base = os.environ.get("UPLOADS_DIR", "").strip()
    if base:
        return Path(base) / "site-visit-attendance" / name
    return BASE_DIR / "uploads" / "site-visit-attendance" / name


def _load_attendance_bytes(web_path: str) -> Optional[bytes]:
    """Synchronously load the attendance image bytes for any storage scheme.

    Supports both legacy ``/uploads/...`` local paths and new
    ``oss://<bucket>/<key>`` Atoms Cloud OSS paths. The OSS branch issues
    a presigned download URL via ``services.storage.StorageService`` and
    fetches the file with a blocking ``httpx.Client`` so this helper stays
    safe to call from ReportLab's synchronous ``build()`` flow.

    Returns ``None`` when the image cannot be located or fetched (the
    renderer treats a missing attendance image as a no-op rather than
    erroring out).
    """
    if not web_path:
        return None
    web_path = web_path.strip()
    if not web_path:
        return None

    # Local disk (legacy / dev)
    if not web_path.startswith("oss://"):
        disk = _resolve_attendance_disk_path(web_path)
        if disk and disk.is_file():
            try:
                return disk.read_bytes()
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"attendance disk read failed for {disk}: {exc}")
        return None

    # OSS-backed path
    try:
        import asyncio

        import httpx

        from schemas.storage import FileUpDownRequest
        from services.storage import StorageService

        # oss://<bucket>/<object_key>
        without_scheme = web_path[len("oss://"):]
        if "/" not in without_scheme:
            return None
        bucket, object_key = without_scheme.split("/", 1)
        if not bucket or not object_key:
            return None

        async def _fetch() -> Optional[bytes]:
            svc = StorageService()
            url_resp = await svc.create_download_url(
                FileUpDownRequest(bucket_name=bucket, object_key=object_key)
            )
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.get(url_resp.download_url)
                r.raise_for_status()
                return r.content

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is None:
            return asyncio.run(_fetch())
        # We're inside a running loop; run the coroutine in a worker thread
        # with its own loop so we don't deadlock the parent.
        import concurrent.futures

        def _runner() -> Optional[bytes]:
            return asyncio.run(_fetch())

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            return ex.submit(_runner).result(timeout=90)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"OSS attendance fetch failed for {web_path!r}: {exc}")
        return None


def _shape_arabic(text: Any) -> str:
    """Reshape Arabic text and apply BiDi so it renders correctly in
    ReportLab (which has no native Arabic shaping engine).

    Safe for non-Arabic strings — returns them mostly unchanged.
    """
    if text is None:
        return ""
    s = str(text)
    if not s:
        return ""
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        reshaped = arabic_reshaper.reshape(s)
        return get_display(reshaped)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Arabic shaping failed for {s!r}: {exc}")
        return s


# -----------------------------------------------------------------------------
# Public: build_request_payload (UNCHANGED API — routers call this)
# -----------------------------------------------------------------------------
def build_request_payload(
    item: Any,
    rows: List[Dict[str, Any]],
    override_names: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    """Shape a ``SiteVisitRequest`` ORM row into the dict the renderer
    expects. Same signature & semantics as the previous WeasyPrint version.

    ``override_names`` (optional) replaces the displayed approver names at
    render time only — the database is never modified. Recognized keys:
    ``head``, ``supervisor``, ``director``.
    """
    head_name = getattr(item, "head_signed_by_name", "") or ""
    sup_name = getattr(item, "supervisor_signed_by_name", "") or ""
    dir_name = getattr(item, "director_signed_by_name", "") or ""
    if override_names:
        oh = (override_names.get("head") or "").strip()
        os_ = (override_names.get("supervisor") or "").strip()
        od = (override_names.get("director") or "").strip()
        if oh:
            head_name = oh
        if os_:
            sup_name = os_
        if od:
            dir_name = od

    # Count non-empty visit rows for the total row.
    visit_count = 0
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        if (
            str(r.get("date") or "").strip()
            or str(r.get("description") or "").strip()
            or str(r.get("mosque") or "").strip()
        ):
            visit_count += 1

    # Resolve attendance image. Bytes are loaded lazily at render time —
    # we only stash the stored path here so the renderer can decide between
    # "local disk → pass path to ReportLab Image" and "OSS → fetch bytes
    # and write a temp file".
    attendance_path_for_render: Optional[str] = None
    web_path = (getattr(item, "attendance_attachment", None) or "").strip()
    if web_path:
        if web_path.startswith("oss://"):
            attendance_path_for_render = web_path  # renderer fetches bytes
        else:
            disk = _resolve_attendance_disk_path(web_path)
            if disk and disk.is_file():
                attendance_path_for_render = str(disk)

    return {
        "id": getattr(item, "id", None),
        "owner_name": getattr(item, "owner_name", "") or "",
        "civil_id": getattr(item, "civil_id", "") or "",
        "job_title": getattr(item, "job_title", "") or "",
        "month": getattr(item, "month", None),
        "year": getattr(item, "year", None),
        "area": getattr(item, "area", "") or "",
        "reason": getattr(item, "reason", "") or "",
        "rows": rows or [],
        "visit_count": visit_count,
        "status": getattr(item, "status", "") or "",
        "status_label": _STATUS_LABELS.get(
            getattr(item, "status", "") or "", getattr(item, "status", "") or ""
        ),
        "head_signed_by_name": head_name,
        "supervisor_signed_by_name": sup_name,
        "director_signed_by_name": dir_name,
        "head_signed_at": _fmt_dt(getattr(item, "head_signed_at", None)),
        "supervisor_signed_at": _fmt_dt(getattr(item, "supervisor_signed_at", None)),
        "director_signed_at": _fmt_dt(getattr(item, "director_signed_at", None)),
        # Audit fields are kept in the payload for backward compatibility
        # with any caller still reading them, but the renderer DELIBERATELY
        # ignores them — the official reference form has no audit section.
        "audited_by_name": getattr(item, "audited_by_name", "") or "",
        "audited_at": _fmt_dt(getattr(item, "audited_at", None)),
        "audit_note": getattr(item, "audit_note", "") or "",
        "attendance_image_path": attendance_path_for_render,
        "attendance_image_data_uri": None,
    }


# -----------------------------------------------------------------------------
# Public: render_site_visit_pdf
# -----------------------------------------------------------------------------
def render_site_visit_pdf(payload: Dict[str, Any]) -> bytes:
    """Render the site-visit print form into PDF bytes via ReportLab.

    Layout matches the official reference form 1:1. See module docstring
    for the full structural breakdown.
    """
    _ensure_fonts_registered()

    # Lazy-import heavy ReportLab classes only at render time.
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Image,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT

    page_w, page_h = A4
    margin_l = 13 * mm
    margin_r = 13 * mm
    margin_t = 12 * mm
    margin_b = 13 * mm
    content_w = page_w - margin_l - margin_r

    # Paragraph styles -----------------------------------------------------
    style_title = ParagraphStyle(
        "title",
        fontName="Amiri-Bold",
        fontSize=16,
        leading=20,
        alignment=TA_CENTER,
        textColor=colors.black,
    )
    style_label = ParagraphStyle(
        "label",
        fontName="Amiri-Bold",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
    )
    style_value = ParagraphStyle(
        "value",
        fontName="Amiri",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
    )
    style_cell = ParagraphStyle(
        "cell",
        fontName="Amiri",
        fontSize=10,
        leading=12,
        alignment=TA_CENTER,
    )
    style_cell_bold = ParagraphStyle(
        "cell_bold",
        fontName="Amiri-Bold",
        fontSize=10,
        leading=12,
        alignment=TA_CENTER,
    )
    style_sig_title = ParagraphStyle(
        "sig_title",
        fontName="Amiri-Bold",
        fontSize=11,
        leading=14,
        alignment=TA_CENTER,
    )
    style_sig_name = ParagraphStyle(
        "sig_name",
        fontName="Amiri",
        fontSize=10,
        leading=13,
        alignment=TA_CENTER,
    )
    style_logo_caption = ParagraphStyle(
        "logo_cap",
        fontName="Amiri",
        fontSize=7.5,
        leading=9,
        alignment=TA_CENTER,
    )
    style_logo_caption_bold = ParagraphStyle(
        "logo_cap_bold",
        fontName="Amiri-Bold",
        fontSize=7.5,
        leading=9,
        alignment=TA_CENTER,
    )

    def P(style: ParagraphStyle, text: Any) -> Paragraph:
        """Convenience: shape Arabic + wrap in a Paragraph."""
        return Paragraph(_shape_arabic(text), style)

    # ---------------------------------------------------------------------
    # 1. Header — 3 logos in a row
    # ---------------------------------------------------------------------
    def _logo_cell(path: Path, captions: List[tuple]) -> List[Any]:
        """Build a logo cell with image on top + multiple caption lines.

        ``captions`` is a list of ``(text, bold)`` tuples; bold lines use
        the bold caption style, others use the regular one. Latin/English
        strings are passed through ``_shape_arabic`` (which is a no-op for
        them) and rendered in the same Amiri font for consistency.
        """
        items: List[Any] = []
        try:
            if path.is_file():
                img = Image(str(path), width=18 * mm, height=18 * mm)
                img.hAlign = "CENTER"
                items.append(img)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"logo image failed: {path}: {exc}")
        for text, is_bold in captions:
            if not text:
                continue
            items.append(P(
                style_logo_caption_bold if is_bold else style_logo_caption,
                text,
            ))
        return items

    # ReportLab Table layout is LTR: cell index 0 = page-LEFT, last = page-RIGHT.
    # Per the reference form (visual right-to-left):
    #   page-RIGHT  = Ministry of Islamic Affairs (3-line caption Ar+En)
    #   page-CENTER = Kuwait Capital Of Islamic Culture 2016
    #   page-LEFT   = Mubarak Al-Kabeer Mosques Directorate (Arabic only)
    # So the LTR-ordered array reads: [LEFT_visual, CENTER_visual, RIGHT_visual].
    header_data = [[
        _logo_cell(_LOGO_LEFT, [
            ("إدارة مساجد محافظة مبارك الكبير", True),
        ]),
        _logo_cell(_LOGO_CENTER, [
            ("Kuwait Capital Of Islamic Culture 2016", True),
        ]),
        _logo_cell(_LOGO_RIGHT, [
            ("وزارة الشؤون الإسلامية", True),
            ("Ministry Of Islamic Affairs", False),
            ("State Of Kuwait | دولة الكويت", False),
        ]),
    ]]
    # Right-logo block needs room for: image (18mm) + 3 caption lines.
    # Each caption is fontSize 7.5pt with leading 9pt ≈ 3.2mm per line.
    # 18 + (3 × 3.2) + small padding ≈ 28mm. Use 30mm to guarantee no clip.
    header_tbl = Table(
        header_data,
        colWidths=[content_w / 3.0] * 3,
        rowHeights=[30 * mm],
    )
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    # ---------------------------------------------------------------------
    # 2. Title bar (gray background)
    # ---------------------------------------------------------------------
    # White background per reference; only top + bottom black horizontal
    # lines (NOT a full box). No left/right borders.
    # Title bar: text vertically centered between top + bottom horizontal
    # rules. Bumped row height to 12mm so 16pt text (~5.6mm) sits comfortably
    # in the middle with ~3mm padding above and below.
    title_tbl = Table(
        [[P(style_title, "زيارات ميدانية لاستلام مواقع")]],
        colWidths=[content_w],
        rowHeights=[12 * mm],
    )
    title_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("LINEABOVE", (0, 0), (-1, 0), 0.8, colors.black),
        ("LINEBELOW", (0, 0), (-1, -1), 0.8, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        # Compensate for Arabic descenders so visual center of glyphs sits
        # at the geometric center of the bar: bump TOPPADDING higher than
        # BOTTOMPADDING by ~3pt (~1mm).
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    # ---------------------------------------------------------------------
    # 3. Info rows
    # ---------------------------------------------------------------------
    owner_name = payload.get("owner_name") or ""
    civil_id = payload.get("civil_id") or ""
    job_title = payload.get("job_title") or ""
    month_v = payload.get("month")
    year_v = payload.get("year")
    month_str = str(month_v) if month_v not in (None, "") else ""
    year_str = str(year_v) if year_v not in (None, "") else ""

    # Info rows — match the reference form's layout exactly:
    #   [LABEL : VALUE] [........... dashed line ............]
    # The label and value are merged into ONE right-aligned Paragraph in
    # the page-rightmost cell so the value sits IMMEDIATELY next to its
    # colon (no empty gap). The leftover horizontal space (page-leftward)
    # is rendered as an empty cell whose bottom border is the dashed line.
    #
    # ReportLab Table layout is LTR, so cell index 0 = page-LEFT
    # (the dashed underline area) and cell index N-1 = page-RIGHT
    # (the label+value text).
    #
    # Row 1 has an inline "شهر <m> /" + year segment that visually sits in
    # the MIDDLE of the line. We model it as 4 cells:
    #   col 0 page-LEFT  = trailing dashed underline
    #   col 1            = year value (dashed underline cell)
    #   col 2            = "شهر <m> /" inline label
    #   col 3 page-RIGHT = "اسم المستلم : <owner>" merged
    style_label_value = ParagraphStyle(
        "label_value",
        fontName="Amiri",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
    )
    month_label_text = f"شهر {month_str} /" if month_str else "شهر    /"

    # Helpers — split label and value into SEPARATE cells so the dashed
    # underline can run under the value (and the empty filler to its left)
    # but stop where the label begins.
    style_value_only = ParagraphStyle(
        "value_only",
        fontName="Amiri",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
    )
    style_label_only = ParagraphStyle(
        "label_only",
        fontName="Amiri-Bold",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
    )

    def _value_para(value: str) -> Paragraph:
        """Render the user-provided value alone, right-aligned, no underline."""
        return Paragraph(_shape_arabic(value or ""), style_value_only)

    def _label_para(label: str) -> Paragraph:
        """Render the bold label alone, right-aligned (e.g. 'اسم المستلم :')."""
        return Paragraph(_shape_arabic(label), style_label_only)

    # CRITICAL — verified visually against the official reference form:
    # the dashed underline must run UNDER THE VALUE (e.g. under "فيصل")
    # AND under the empty area to its left, but must NOT run under the
    # label (e.g. "اسم المستلم").
    #
    # Implementation: each info row is now built from THREE cells (or four
    # for row 1, which has the inline month/year segment):
    #   col 0 page-LEFT  = empty filler         (LINEBELOW dashed)
    #   col 1            = value                (LINEBELOW dashed)
    #   col 2 page-RIGHT = label                (NO LINEBELOW)
    # So the dashes appear from the page-left margin up to (but not under)
    # the label cell — covering both the value text and the empty space
    # to its left.
    #
    # Row 1 inserts the year value + شهر/year label segment between the
    # owner-name filler and the owner-name label, giving 5 cells total:
    #   col 0 = year-value cell with dashed LINEBELOW
    #   col 1 = "شهر <m> /" inline label, NO LINEBELOW
    #   col 2 = owner-name filler with dashed LINEBELOW
    #   col 3 = owner-name value with dashed LINEBELOW
    #   col 4 = "اسم المستلم :" label, NO LINEBELOW
    # KEY INSIGHT: instead of separate (filler) + (value) cells (which
    # leaves visible micro-gaps at the cell boundary because each cell's
    # LINEBELOW is drawn independently), put the value Paragraph DIRECTLY
    # into the filler cell with TA_RIGHT alignment. This way:
    #   - The value text right-aligns to the right edge of the merged
    #     filler-value cell, sitting flush against the label cell.
    #   - The dashed LINEBELOW runs continuously under the entire cell,
    #     with NO segment break, so dashes appear under the empty space
    #     AND right up to the value text's left edge.
    # NEW APPROACH — combine label + value into a single right-aligned
    # Paragraph in the page-RIGHTMOST cell. The label cell width is sized
    # generously so any short value sits flush at its visual-right (next
    # to the label) with no internal padding gap. The page-LEFTMOST cell
    # is a pure-empty filler whose LINEBELOW renders the dashed line.
    #
    # Why this works pixel-perfectly:
    #   - A single combined Paragraph "اسم المستلم : <name>" with TA_RIGHT
    #     places ALL the text against the cell's right edge. Value and
    #     label are guaranteed adjacent — same Paragraph, no cell gap.
    #   - The filler cell's LINEBELOW spans its FULL width (cell-level
    #     decoration in ReportLab IS the cell's full width, not the text
    #     width). So dashes run from page-left margin to the boundary
    #     where the combined-text cell starts.
    #   - To make the dashes visually meet the value text, we shrink the
    #     combined-text cell width so its LEFT edge sits ~2pt to the right
    #     of where the value text begins. Approximate text widths:
    #       "اسم المستلم : <16-char name>"  ≈ 60-70 mm
    #       "الرقم المدني : 12-digit"      ≈ 55-65 mm
    #       "المسمى الوظيفي : 12-char"     ≈ 55-65 mm
    #     We use a fixed 75mm right-cell width — generous enough that even
    #     long names fit, but tight enough that the dashes get within ~1mm
    #     of typical short values.
    #
    # Tradeoff: very long values may overflow into the empty filler area
    # (no dashes under them then), but they won't truncate.
    style_combined = ParagraphStyle(
        "combined",
        fontName="Amiri",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
        wordWrap="RTL",
    )
    style_combined_bold_label = ParagraphStyle(
        "combined_bold",
        fontName="Amiri-Bold",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
        wordWrap="RTL",
    )

    # CRITICAL — user feedback (Task 101): the value (e.g. "فيصل") must
    # sit IMMEDIATELY adjacent to the label "اسم المستلم :" with NO gap.
    # The previous 2-cell layout left a visible empty band between the
    # value's right-edge (in the value cell) and the label's left-edge
    # (in the label cell, which had width 32mm causing ~20mm visible gap
    # for short values).
    #
    # FIX: combine "<value> : <bold label>" into ONE Paragraph in a single
    # right-aligned cell. The label and value render in the SAME inline
    # text run with a single space separator, so they're guaranteed
    # adjacent — no inter-cell padding can split them. The leftover
    # horizontal space is a separate empty filler cell whose LINEBELOW
    # renders the dashed line.
    # USER FEEDBACK (Task 102, image-1 (119).png): the dashed line must
    # extend UNDER THE VALUE itself (e.g. under "فيصل" / "212358" /
    # "مسمى وظيفي تجريبي") and stop EXACTLY at the colon ":". The colon
    # and the bold label must NOT have any underline.
    #
    # NEW LAYOUT — split each info row into 3 cells (4 for row 1):
    #   col 0 page-LEFT  = empty filler                   (DASHED LINEBELOW)
    #   col 1            = value text, right-aligned      (DASHED LINEBELOW)
    #   col 2 page-RIGHT = ": <bold label>"               (NO LINEBELOW)
    # The value cell is right-aligned so the value sits flush against
    # the label cell's left edge — adjacent to the colon. The dashed
    # LINEBELOW spans BOTH the filler and the value cells continuously
    # (filler → value), running from the page-left margin all the way
    # under the value glyphs and stopping exactly where the label cell
    # (with the colon) begins.
    #
    # We use a SINGLE LINEBELOW spanning (0,0)-(1,0) so the dashes have
    # no visible boundary gap between the filler and value cells.

    # USER FEEDBACK Task 103 (image-1 (120).png): the value "فيصل" was
    # floating ~15mm away from "اسم المستلم :" because the value cell
    # had a fixed 35mm width with TA_RIGHT — short value sat at value-
    # cell's right edge but there was a hidden gap visually.
    #
    # NEW APPROACH — DYNAMIC text-cell width based on stringWidth():
    #
    # 1. Combine value + " : " + bold label into ONE right-aligned
    #    Paragraph (single inline text run, NO inter-cell padding).
    # 2. Compute the EXACT pixel/point width of that text using
    #    `pdfmetrics.stringWidth()`. Add a tiny 1mm safety margin.
    # 3. Place the text Paragraph in a cell whose width = exactly that
    #    text width. So the value+colon+label occupy exactly the space
    #    they need, no more.
    # 4. Place a filler cell on its left = (content_w - text_width).
    #    Apply dashed LINEBELOW only to the filler. The dashes therefore
    #    end EXACTLY at the left edge of the value glyph — no gap.
    #
    # Result: "فيصل" sits flush against ":" (same Paragraph), and the
    # dashes start IMMEDIATELY to the left of "ف" with no visible
    # space between them.
    from reportlab.pdfbase.pdfmetrics import stringWidth

    # Task 104 — split into 3 separate cells per row so the dashed line
    # runs UNDER THE VALUE GLYPHS THEMSELVES (not just to their left):
    #   col 0 (left, wide):   empty filler            → LINEBELOW dashed
    #   col 1 (middle):       value text TA_RIGHT     → LINEBELOW dashed
    #   col 2 (right):        " : <bold label>"       → NO LINEBELOW
    #
    # The LINEBELOW spans (0,0)-(1,0) as ONE continuous line so the
    # dashes flow visually unbroken under both the empty area AND the
    # value characters, ending exactly where ":" begins.

    style_colon_label = ParagraphStyle(
        "colon_label",
        fontName="Amiri-Bold",
        fontSize=11,
        leading=14,
        alignment=TA_RIGHT,
        wordWrap="RTL",
    )

    def _value_only_paragraph(value: str) -> Paragraph:
        """Render the value alone, right-aligned, sized so it sits
        flush against the adjacent ' : <label>' cell.
        """
        return Paragraph(_shape_arabic(value or ""), style_value_only)

    def _colon_label_paragraph(label: str) -> Paragraph:
        """Render ' : <bold label>' as a SEPARATE right-aligned cell
        with NO underline. The leading space + colon visually-LEFT of the
        bold label (because TA_RIGHT + RTL puts the label on the right).
        """
        shaped_label = _shape_arabic(label)
        return Paragraph(f": <b>{shaped_label}</b>", style_colon_label)

    def _measure_value_width(value: str) -> float:
        """Width of the value alone in Amiri 11pt, plus a tiny safety
        margin so the cell right edge sits just past the last glyph.
        """
        if not value:
            return 0.0
        return stringWidth(_shape_arabic(value), "Amiri", 11)

    def _measure_colon_label_width(label: str) -> float:
        """Width of ' : <bold label>' in Amiri-Bold 11pt + colon."""
        shaped_label = _shape_arabic(label)
        # ": " (colon + space) in regular + label in bold
        w_colon = stringWidth(": ", "Amiri", 11)
        w_label = stringWidth(shaped_label, "Amiri-Bold", 11)
        return w_colon + w_label

    # Per-row dimensions:
    YEAR_VALUE_W = 18 * mm
    MONTH_LABEL_W = 22 * mm

    # Value cell width: actual text width + 1mm safety. If value is empty,
    # give it a small placeholder width (just so the cell is visible and
    # the dashes don't disappear).
    MIN_VALUE_W = 30 * mm  # writing-room when value is short or empty

    owner_value_w = max(_measure_value_width(owner_name) + 2 * mm, MIN_VALUE_W)
    civil_value_w = max(_measure_value_width(civil_id) + 2 * mm, MIN_VALUE_W)
    job_value_w = max(_measure_value_width(job_title) + 2 * mm, MIN_VALUE_W)

    owner_label_w = _measure_colon_label_width("اسم المستلم") + 2 * mm
    civil_label_w = _measure_colon_label_width("الرقم المدني") + 2 * mm
    job_label_w = _measure_colon_label_width("المسمى الوظيفي") + 2 * mm

    # ---------- Row 1: year + شهر/year + filler + owner-value + owner-label ----------
    # 5 cells (LTR):
    #   col 0: year value                       (DASHED)
    #   col 1: "شهر <m> /" inline label         (NO DASH)
    #   col 2: empty filler                     (DASHED — start of owner segment)
    #   col 3: owner value, TA_RIGHT            (DASHED — dashes UNDER value glyphs)
    #   col 4: " : <bold اسم المستلم>"          (NO DASH)
    info_row1 = Table(
        [[
            P(style_value_only, year_str),
            P(style_label, month_label_text),
            "",
            _value_only_paragraph(owner_name),
            _colon_label_paragraph("اسم المستلم"),
        ]],
        colWidths=[
            YEAR_VALUE_W,
            MONTH_LABEL_W,
            content_w - YEAR_VALUE_W - MONTH_LABEL_W - owner_value_w - owner_label_w,
            owner_value_w,
            owner_label_w,
        ],
        rowHeights=[7.5 * mm],
    )
    info_row1.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        # Dashes under col 0 (year value).
        ("LINEBELOW", (0, 0), (0, 0), 0.6, colors.black, None, (3, 2)),
        # CONTINUOUS dashed span across [filler + value] so dashes flow
        # unbroken under both — including UNDER the value glyphs.
        ("LINEBELOW", (2, 0), (3, 0), 0.6, colors.black, None, (3, 2)),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))

    # ---------- Row 2: civil_id ----------
    # 3 cells:
    #   col 0: empty filler                       (DASHED)
    #   col 1: civil_id value, TA_RIGHT           (DASHED — UNDER value)
    #   col 2: " : <bold الرقم المدني>"           (NO DASH)
    info_row2 = Table(
        [[
            "",
            _value_only_paragraph(civil_id),
            _colon_label_paragraph("الرقم المدني"),
        ]],
        colWidths=[
            content_w - civil_value_w - civil_label_w,
            civil_value_w,
            civil_label_w,
        ],
        rowHeights=[7.5 * mm],
    )
    info_row2.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        # Continuous dashed span across [filler + value]
        ("LINEBELOW", (0, 0), (1, 0), 0.6, colors.black, None, (3, 2)),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))

    # ---------- Row 3: job_title ----------
    info_row3 = Table(
        [[
            "",
            _value_only_paragraph(job_title),
            _colon_label_paragraph("المسمى الوظيفي"),
        ]],
        colWidths=[
            content_w - job_value_w - job_label_w,
            job_value_w,
            job_label_w,
        ],
        rowHeights=[7.5 * mm],
    )
    info_row3.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LINEBELOW", (0, 0), (1, 0), 0.6, colors.black, None, (3, 2)),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))

    # ---------------------------------------------------------------------
    # 4. Visits table — 5 cols × 12 fixed body rows + total row
    # Header (visual right→left): م | المسجد | التاريخ | سبب الزيارة | التوقيع
    # We place cells in REVERSE (LTR layout) so the page-rightmost cell = "م".
    # ---------------------------------------------------------------------
    rows = payload.get("rows") or []
    header_cells = [
        P(style_cell_bold, "التوقيع"),
        P(style_cell_bold, "سبب الزيارة"),
        P(style_cell_bold, "التاريخ"),
        P(style_cell_bold, "المسجد"),
        P(style_cell_bold, "م"),
    ]
    col_w = [
        content_w * 0.18,  # signature
        content_w * 0.32,  # reason
        content_w * 0.18,  # date
        content_w * 0.24,  # mosque
        content_w * 0.08,  # row number
    ]
    visits_data: List[List[Any]] = [header_cells]

    for i in range(12):
        if i < len(rows) and isinstance(rows[i], dict):
            r = rows[i]
            mosque = r.get("mosque") or ""
            date = r.get("date") or ""
            reason = r.get("description") or r.get("reason") or ""
            signature = r.get("signature") or ""
        else:
            mosque = date = reason = signature = ""
        visits_data.append([
            P(style_cell, signature),
            P(style_cell, reason),
            P(style_cell, date),
            P(style_cell, mosque),
            P(style_cell, str(i + 1)),
        ])

    # Total row — per the OFFICIAL REFERENCE FORM (verified visually with
    # ImageAnalyzer.qa on `بلاغات صيانة محافظة مبارك الكبير (3).pdf`):
    #   - "الإجمالي" is in a SINGLE merged cell that spans the TWO
    #     rightmost columns visually, i.e. the م column + the المسجد column.
    #   - The other three columns (التاريخ / سبب الزيارة / التوقيع) are
    #     individual empty cells.
    #   - The reference form has NO numeric total in this row.
    #
    # In ReportLab (LTR table layout), col 0 = visual-LEFT and col 4 =
    # visual-RIGHT. Our column order is:
    #   col 0 = التوقيع, col 1 = سبب الزيارة, col 2 = التاريخ,
    #   col 3 = المسجد, col 4 = م
    # So "الإجمالي" must SPAN cols 3-4. ReportLab renders the SPAN's
    # top-left cell content (= col 3 in our LTR layout), so we put the
    # text in col 3 and leave col 4 empty. The reshaped+BiDi Arabic text
    # is centered in the merged cell visually.
    visits_data.append([
        P(style_cell, ""),                   # col 0: التوقيع
        P(style_cell, ""),                   # col 1: سبب الزيارة
        P(style_cell, ""),                   # col 2: التاريخ
        P(style_cell_bold, "الإجمالي"),       # col 3: المسجد — text here
        P(style_cell, ""),                   # col 4: م — absorbed by SPAN
    ])

    # Reference body row height ≈ 13mm. We use 13mm × 12 = 156mm of body
    # plus 8mm header + 8mm total row = ~172mm visits table height. The
    # final composition (header 24 + title 9 + 3 info × 7.5 + spacers
    # + table 172 + sig 20 + small spacers ≈ 263mm) fits in the 271mm
    # usable A4 height with ~8mm to spare and lets the signature block
    # sit ~16mm above the page bottom, matching the reference.
    body_row_h = 13 * mm
    visits_tbl = Table(
        visits_data,
        colWidths=col_w,
        rowHeights=[8 * mm] + [body_row_h] * 12 + [8 * mm],
    )
    visits_tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d9d9d9")),
        # Total row — SPAN the المسجد column (col 3) with the م column
        # (col 4) so "الإجمالي" occupies the two rightmost columns
        # visually, matching the official reference form exactly.
        ("SPAN", (3, 13), (4, 13)),
        # Gray shading for the merged "الإجمالي" cell.
        ("BACKGROUND", (3, 13), (4, 13), colors.HexColor("#d9d9d9")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))

    # ---------------------------------------------------------------------
    # 5. Signatures — 3 columns
    #
    # NOTE: The reference government form has NO audit/"دُقِّق بواسطة"
    # section anywhere on the page. We deliberately do NOT render audit
    # metadata in the PDF even when audited_by_name / audit_note are
    # present in the database — the PDF must match the official form 100%.
    # ---------------------------------------------------------------------
    head_name = payload.get("head_signed_by_name") or ""
    sup_name = payload.get("supervisor_signed_by_name") or ""
    dir_name = payload.get("director_signed_by_name") or ""
    head_at = payload.get("head_signed_at") or ""
    sup_at = payload.get("supervisor_signed_at") or ""
    dir_at = payload.get("director_signed_at") or ""

    # Per reference: each signature column = bold title on TOP, then a tall
    # blank vertical space, then a solid horizontal signature line near the
    # BOTTOM of the cell where the user actually signs. When a name/ts is
    # already recorded, render it just ABOVE the signature line.
    #
    # We model the cell as a small inner Table with 2 rows:
    #   row 0 = title           (top-aligned, no bottom border)
    #   row 1 = name+timestamp  (bottom-aligned + LINEBELOW = sig line)
    # The outer signature row is a 3-column table with NO grid borders, so
    # the only visible lines are the per-cell LINEBELOW signature lines.
    def _sig_inner(title: str, name: str, ts: str) -> Table:
        name_block: List[Any] = []
        if name:
            name_block.append(P(style_sig_name, name))
        if ts:
            name_block.append(P(style_sig_name, ts))
        if not name_block:
            name_block.append(Spacer(1, 1))  # keep cell non-empty

        inner = Table(
            [[P(style_sig_title, title)], [name_block]],
            colWidths=[content_w / 3.0 - 16],
            rowHeights=[7 * mm, 14 * mm],
        )
        inner.setStyle(TableStyle([
            ("VALIGN", (0, 0), (0, 0), "TOP"),
            ("VALIGN", (0, 1), (0, 1), "BOTTOM"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            # Signature line: solid black horizontal under row 1 only.
            ("LINEBELOW", (0, 1), (0, 1), 0.6, colors.black),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        return inner

    # Visual page order right→left: رئيس القسم / مراقب الصيانة / مدير الإدارة.
    # Reverse for LTR table layout so the rightmost cell on page = رئيس القسم.
    sig_data = [[
        _sig_inner("مدير الإدارة", dir_name, dir_at),
        _sig_inner("مراقب الصيانة", sup_name, sup_at),
        _sig_inner("رئيس القسم", head_name, head_at),
    ]]
    sig_tbl = Table(
        sig_data,
        colWidths=[content_w / 3.0] * 3,
        rowHeights=[20 * mm],
    )
    # No outer grid / no LINEABOVE — only the per-cell signature lines
    # rendered by the inner tables remain visible. This matches the
    # reference: signatures float free under the table with their own lines.
    sig_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    # ---------------------------------------------------------------------
    # 6. Optional attendance image (page 2)
    # ---------------------------------------------------------------------
    attendance_flowables: List[Any] = []
    attendance_path = payload.get("attendance_image_path")
    if attendance_path:
        try:
            from PIL import Image as PILImage  # ships with reportlab deps

            local_image_path: Optional[str] = None
            tmp_image_handle: Any = None

            if str(attendance_path).startswith("oss://"):
                img_bytes = _load_attendance_bytes(str(attendance_path))
                if not img_bytes:
                    raise RuntimeError("OSS fetch returned no bytes")
                import tempfile

                suffix = Path(str(attendance_path)).suffix.lower() or ".jpg"
                tmp_image_handle = tempfile.NamedTemporaryFile(
                    suffix=suffix, delete=False
                )
                tmp_image_handle.write(img_bytes)
                tmp_image_handle.flush()
                tmp_image_handle.close()
                local_image_path = tmp_image_handle.name
            else:
                local_image_path = str(attendance_path)

            with PILImage.open(local_image_path) as im:
                iw, ih = im.size
            max_w = content_w
            max_h = page_h - margin_t - margin_b - 20 * mm
            scale = min(max_w / float(iw), max_h / float(ih), 1.0)
            disp_w = iw * scale
            disp_h = ih * scale
            attendance_flowables.extend([
                PageBreak(),
                P(style_title, "صورة الحضور / كشف الزيارات"),
                Spacer(1, 4 * mm),
                Image(local_image_path, width=disp_w, height=disp_h),
            ])
            # Note: temp file (when used) is leaked intentionally until
            # process exit — ReportLab opens it during ``doc.build()``
            # AFTER this function returns the flowables. On Lambda the
            # /tmp dir is wiped on container recycle, so this is bounded.
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"attendance image render failed: {exc}")

    # ---------------------------------------------------------------------
    # Compose the document
    # ---------------------------------------------------------------------
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=margin_l,
        rightMargin=margin_r,
        topMargin=margin_t,
        bottomMargin=margin_b,
        title=f"site-visit-{payload.get('id') or ''}",
    )

    flow: List[Any] = [
        header_tbl,
        Spacer(1, 1 * mm),
        title_tbl,
        Spacer(1, 2 * mm),
        info_row1,
        info_row2,
        info_row3,
        Spacer(1, 2 * mm),
        visits_tbl,
        Spacer(1, 4 * mm),
        sig_tbl,
    ]
    flow.extend(attendance_flowables)

    doc.build(flow)
    return buf.getvalue()