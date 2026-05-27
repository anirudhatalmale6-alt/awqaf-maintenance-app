"""Full site backup: export all database tables to JSON and import them back.

Admin-only endpoints for disaster recovery and migration.

Robustness design (import):
- Each table is processed in its own SAVEPOINT (nested transaction). A failure
  in one table does not poison the outer transaction or kill subsequent tables.
- Each row is processed in its own SAVEPOINT inside the table's SAVEPOINT.
  A bad row is reported as `skipped` with its error message, but the rest of
  the table proceeds.
- ISO 8601 strings in JSON are converted back to native datetime / date
  objects according to the live column type (DateTime, Date, Time).
- For `replace` mode:
    * `session_replication_role = replica` is attempted but its failure is
      no longer treated as fatal (managed Postgres often forbids it).
    * Tables are deleted in reverse FK-dependency order (children first).
    * Tables are inserted in forward FK-dependency order (parents first).
- Identifier whitelist (regex + live-schema set) is applied as defense in
  depth. All DML uses SQLAlchemy Core with reflected `Table` objects (no
  raw SQL strings) so identifiers and values are always safely compiled.
"""
import json
import logging
import re
from datetime import datetime, date, time, timezone
from decimal import Decimal
from typing import Any, Dict, List, Set, Tuple

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import (
    DateTime,
    Date,
    Time,
    MetaData,
    Table,
    inspect,
    select,
    func,
    delete,
    insert,
    text,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db, Base
from dependencies.auth import get_admin_user
from schemas.auth import UserResponse

# Import models package so all tables are registered on Base.metadata
import models  # noqa: F401

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/backup", tags=["backup"])

# Tables that are managed automatically or should not be restored from backup.
EXCLUDED_TABLES = {
    "alembic_version",
    "oidc_states",
}

# SQL identifier whitelist: letters, digits, and underscores only.
_SAFE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Static, parameter-less session settings used during bulk replace.
_SET_SESSION_REPLICA = text("SET session_replication_role = replica")
_SET_SESSION_DEFAULT = text("SET session_replication_role = DEFAULT")


def _safe_ident(name: str, allowed: Set[str]) -> str:
    """Validate a SQL identifier against a regex + whitelist.

    Raises:
        ValueError: if the identifier fails either check.
    """
    if not isinstance(name, str) or not _SAFE_IDENT_RE.match(name):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    if name not in allowed:
        raise ValueError(f"Unknown SQL identifier (not in schema): {name!r}")
    return name


async def _reflect_table(
    db: AsyncSession, table_name: str, allowed_tables: Set[str]
) -> Table:
    """Reflect a whitelisted table into a SQLAlchemy `Table` object."""
    _safe_ident(table_name, allowed_tables)
    metadata = MetaData()
    raw_conn = await db.connection()

    def _reflect(sync_conn):
        return Table(table_name, metadata, autoload_with=sync_conn)

    return await raw_conn.run_sync(_reflect)


def _json_default(obj: Any) -> Any:
    """JSON serializer for objects not serializable by default."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8")
        except Exception:
            return obj.hex()
    return str(obj)


async def _fetch_table_rows(
    db: AsyncSession, table_name: str, allowed_tables: Set[str]
) -> List[Dict[str, Any]]:
    """Fetch every row from a whitelisted table as list of dicts."""
    tbl = await _reflect_table(db, table_name, allowed_tables)
    result = await db.execute(select(tbl))
    rows = result.mappings().all()
    return [dict(row) for row in rows]


# --- Helpers for import -----------------------------------------------------


def _parse_iso_dt(value: Any) -> Any:
    """Convert ISO-8601 string to datetime; pass-through otherwise."""
    if not isinstance(value, str):
        return value
    s = value
    # Python <3.11 doesn't accept trailing 'Z' in fromisoformat.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return value


def _parse_iso_date(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return date.fromisoformat(value[:10])
    except Exception:
        return value


def _parse_iso_time(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return time.fromisoformat(value)
    except Exception:
        return value


def _coerce_row_for_table(row: Dict[str, Any], tbl: Table) -> Dict[str, Any]:
    """Coerce JSON-friendly values back to native Python types per column.

    This is best-effort: if coercion fails, the original value is left and
    the database will surface the error per-row (which we then report).
    """
    out: Dict[str, Any] = {}
    cols = tbl.columns
    for k, v in row.items():
        if k not in cols:
            continue
        if v is None:
            out[k] = None
            continue
        col = cols[k]
        col_type = col.type
        try:
            if isinstance(col_type, DateTime):
                out[k] = _parse_iso_dt(v)
            elif isinstance(col_type, Date):
                out[k] = _parse_iso_date(v)
            elif isinstance(col_type, Time):
                out[k] = _parse_iso_time(v)
            else:
                out[k] = v
        except Exception:
            out[k] = v
    return out


def _topo_sort_tables(
    table_names: List[str], db_info: Dict[str, Dict[str, Any]]
) -> List[str]:
    """Return tables sorted so parents come before children (FK targets first).

    Uses Kahn's algorithm. Ties (no FK relation) preserve input order.
    Cycles are broken by appending remaining nodes in input order.
    """
    name_set = set(table_names)
    deps: Dict[str, Set[str]] = {t: set() for t in table_names}
    for t in table_names:
        for fk_target in db_info.get(t, {}).get("fk_targets", set()):
            if fk_target in name_set and fk_target != t:
                deps[t].add(fk_target)

    result: List[str] = []
    remaining = list(table_names)  # preserve original order
    while remaining:
        # Find a table with all deps already in result.
        progressed = False
        for i, t in enumerate(remaining):
            if deps[t].issubset(set(result)):
                result.append(t)
                remaining.pop(i)
                progressed = True
                break
        if not progressed:
            # Cycle: append remaining in original order.
            result.extend(remaining)
            break
    return result


# --- Endpoints --------------------------------------------------------------


@router.get("/export")
async def export_backup(
    db: AsyncSession = Depends(get_db),
    _admin: UserResponse = Depends(get_admin_user),
):
    """Export all tables (excluding sensitive/system) as a single JSON payload."""
    payload: Dict[str, Any] = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tables": {},
    }

    def _list_tables(sync_conn):
        insp = inspect(sync_conn)
        return insp.get_table_names()

    raw_conn = await db.connection()
    table_names: List[str] = await raw_conn.run_sync(_list_tables)
    allowed_tables: Set[str] = set(table_names)

    for tname in table_names:
        if tname in EXCLUDED_TABLES:
            continue
        try:
            rows = await _fetch_table_rows(db, tname, allowed_tables)
            payload["tables"][tname] = rows
        except Exception as exc:  # noqa: BLE001
            logger.warning("Skipping table %s during export: %s", tname, exc)
            payload["tables"][tname] = []

    body = json.loads(json.dumps(payload, default=_json_default, ensure_ascii=False))
    headers = {
        "Content-Disposition": (
            'attachment; filename="site-backup-'
            + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            + '.json"'
        )
    }
    return JSONResponse(content=body, headers=headers)


@router.get("/summary")
async def backup_summary(
    db: AsyncSession = Depends(get_db),
    _admin: UserResponse = Depends(get_admin_user),
):
    """Return table-by-table row counts for admin review."""

    def _list_tables(sync_conn):
        insp = inspect(sync_conn)
        return insp.get_table_names()

    raw_conn = await db.connection()
    table_names: List[str] = await raw_conn.run_sync(_list_tables)
    allowed_tables: Set[str] = set(table_names)

    summary: List[Dict[str, Any]] = []
    for tname in sorted(table_names):
        if tname in EXCLUDED_TABLES:
            continue
        try:
            tbl = await _reflect_table(db, tname, allowed_tables)
            result = await db.execute(select(func.count()).select_from(tbl))
            count = result.scalar() or 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("Count failed for %s: %s", tname, exc)
            count = -1
        summary.append({"table": tname, "rows": count})

    return {"tables": summary, "total_tables": len(summary)}


@router.post("/import")
async def import_backup(
    payload: Dict[str, Any] = Body(...),
    mode: str = "merge",
    db: AsyncSession = Depends(get_db),
    _admin: UserResponse = Depends(get_admin_user),
):
    """Restore data from a previously exported backup JSON payload.

    - mode="merge": upsert on primary key.
    - mode="replace": delete then insert (children first, parents first).
    """
    if mode not in ("merge", "replace"):
        raise HTTPException(
            status_code=400, detail="mode must be 'merge' or 'replace'"
        )

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid backup payload")

    tables_data = payload.get("tables") or {}
    if not isinstance(tables_data, dict):
        raise HTTPException(
            status_code=400, detail="Invalid backup format: 'tables' missing"
        )

    def _inspect(sync_conn):
        insp = inspect(sync_conn)
        info: Dict[str, Dict[str, Any]] = {}
        for tname in insp.get_table_names():
            pk = insp.get_pk_constraint(tname).get("constrained_columns") or []
            cols = [c["name"] for c in insp.get_columns(tname)]
            fks = insp.get_foreign_keys(tname) or []
            fk_targets: Set[str] = {
                fk.get("referred_table")
                for fk in fks
                if fk.get("referred_table")
            }
            info[tname] = {"pk": pk, "cols": cols, "fk_targets": fk_targets}
        return info

    raw_conn = await db.connection()
    db_info: Dict[str, Dict[str, Any]] = await raw_conn.run_sync(_inspect)
    allowed_tables: Set[str] = set(db_info.keys())

    # Reflect all tables present in BOTH the backup and the DB schema, once.
    candidate_tables = [
        t for t in tables_data.keys() if t in allowed_tables and t not in EXCLUDED_TABLES
    ]
    reflected: Dict[str, Table] = {}
    report: Dict[str, Any] = {"mode": mode, "tables": {}}

    for tname in candidate_tables:
        try:
            reflected[tname] = await _reflect_table(db, tname, allowed_tables)
        except Exception as exc:  # noqa: BLE001
            report["tables"][tname] = {
                "status": "error",
                "detail": "reflect failed: " + str(exc),
                "inserted": 0,
                "updated": 0,
                "skipped": 0,
            }

    # Tables in backup that aren't in our schema.
    for tname in tables_data.keys():
        if tname in EXCLUDED_TABLES:
            report["tables"][tname] = {
                "status": "skipped",
                "detail": "excluded",
                "inserted": 0,
                "updated": 0,
                "skipped": 0,
            }
        elif tname not in allowed_tables:
            report["tables"][tname] = {
                "status": "skipped",
                "detail": "table not present in current schema",
                "inserted": 0,
                "updated": 0,
                "skipped": 0,
            }

    # Order: forward (parents-first) for inserts; reverse for deletes.
    order_forward = _topo_sort_tables(list(reflected.keys()), db_info)
    order_reverse = list(reversed(order_forward))

    # Replace mode: try to relax FK enforcement (best-effort, non-fatal).
    #
    # IMPORTANT: managed Postgres (Supabase / RDS / etc.) typically forbids
    # `SET session_replication_role = replica` for non-superusers. When it
    # fails it raises an asyncpg error that poisons the OUTER transaction
    # (every subsequent statement, including SAVEPOINT, then errors with
    # "current transaction is aborted, commands ignored until end of
    # transaction block"). To avoid that we wrap the SET in a SAVEPOINT so
    # its failure is contained and rolled back, leaving the outer txn clean.
    replica_role_set = False
    if mode == "replace":
        try:
            async with db.begin_nested():
                await db.execute(_SET_SESSION_REPLICA)
            replica_role_set = True
        except Exception as exc:  # noqa: BLE001
            logger.info(
                "session_replication_role=replica not allowed (continuing): %s",
                exc,
            )

        # Delete children first.
        for tname in order_reverse:
            tbl = reflected[tname]
            try:
                async with db.begin_nested():
                    await db.execute(delete(tbl))
            except Exception as exc:  # noqa: BLE001
                # Record the error but keep going. The subsequent insert
                # will likely also fail, which is fine — it gets reported.
                logger.warning("Clear failed for %s: %s", tname, exc)
                report["tables"].setdefault(
                    tname,
                    {
                        "status": "error",
                        "detail": "clear failed: " + str(exc),
                        "inserted": 0,
                        "updated": 0,
                        "skipped": 0,
                    },
                )

    # Insert / upsert in forward order (parents first).
    #
    # Important: we do NOT wrap the per-table loop in an outer SAVEPOINT.
    # With asyncpg, when a statement fails inside a SAVEPOINT, the SAVEPOINT
    # itself is aborted along with any enclosing SAVEPOINTs that haven't been
    # explicitly released. Nesting per-row SAVEPOINTs inside a per-table
    # SAVEPOINT caused the first failed row to poison the table SAVEPOINT,
    # so all subsequent per-row SAVEPOINT creations failed with
    # "current transaction is aborted, commands ignored until end of
    # transaction block". Per-row SAVEPOINTs (begin_nested) directly under
    # the outer transaction give us isolation without that pitfall.
    for tname in order_forward:
        tbl = reflected[tname]
        info = db_info[tname]
        db_cols: Set[str] = set(info["cols"])
        pk_cols: List[str] = info["pk"]
        rows = tables_data.get(tname) or []

        inserted = 0
        updated = 0
        skipped = 0
        first_error: str | None = None

        # Pre-process rows: drop unknown columns, coerce types, validate identifiers.
        prepared: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                skipped += 1
                continue
            coerced = _coerce_row_for_table(row, tbl)
            if not coerced:
                skipped += 1
                continue
            bad_col = False
            for c in coerced.keys():
                try:
                    _safe_ident(c, db_cols)
                except ValueError:
                    bad_col = True
                    break
            if bad_col:
                skipped += 1
                continue
            prepared.append(coerced)

        # Helper to build a single-row statement for the current mode (used in
        # the per-row fallback path, when batch fails).
        def _build_stmt(payload: Dict[str, Any]):
            if (
                mode == "merge"
                and pk_cols
                and all(pk in payload for pk in pk_cols)
            ):
                stmt = pg_insert(tbl).values(**payload)
                update_payload = {
                    k: stmt.excluded[k]
                    for k in payload.keys()
                    if k not in pk_cols
                }
                if update_payload:
                    return stmt.on_conflict_do_update(
                        index_elements=list(pk_cols),
                        set_=update_payload,
                    ), "update"
                return stmt.on_conflict_do_nothing(
                    index_elements=list(pk_cols)
                ), "update"
            if mode == "replace" and pk_cols:
                stmt = pg_insert(tbl).values(**payload)
                return stmt.on_conflict_do_nothing(
                    index_elements=list(pk_cols)
                ), "insert"
            return insert(tbl).values(**payload), "insert"

        # Helper to build a MULTI-ROW statement for the current mode.
        # This is the fast path: 1 round-trip per table instead of 1 per row.
        # All rows in `payloads` must share the same column set, so we group
        # rows by their key signature before calling this.
        def _build_multi_stmt(payloads: List[Dict[str, Any]]):
            if not payloads:
                return None, "skip"
            # All payloads in this group share the same keys.
            first_keys = list(payloads[0].keys())
            if (
                mode == "merge"
                and pk_cols
                and all(pk in payloads[0] for pk in pk_cols)
            ):
                stmt = pg_insert(tbl).values(payloads)
                update_payload = {
                    k: stmt.excluded[k]
                    for k in first_keys
                    if k not in pk_cols
                }
                if update_payload:
                    return stmt.on_conflict_do_update(
                        index_elements=list(pk_cols),
                        set_=update_payload,
                    ), "update"
                return stmt.on_conflict_do_nothing(
                    index_elements=list(pk_cols)
                ), "update"
            if mode == "replace" and pk_cols:
                stmt = pg_insert(tbl).values(payloads)
                return stmt.on_conflict_do_nothing(
                    index_elements=list(pk_cols)
                ), "insert"
            return insert(tbl).values(payloads), "insert"

        # Group prepared rows by their column-key signature so each multi-row
        # INSERT statement has a uniform column list (asyncpg requires this).
        groups: Dict[Tuple[str, ...], List[Dict[str, Any]]] = {}
        group_order: List[Tuple[str, ...]] = []
        for payload in prepared:
            sig = tuple(sorted(payload.keys()))
            if sig not in groups:
                groups[sig] = []
                group_order.append(sig)
            groups[sig].append(payload)

        # Multi-row chunk size: keep statements under ~5000 placeholders to
        # stay well below asyncpg's parameter limit (32k).
        def _chunk_size_for(cols_per_row: int) -> int:
            if cols_per_row <= 0:
                return 500
            return max(1, min(500, 4000 // cols_per_row))

        # Fast path: batched multi-row INSERT per group, all under ONE
        # whole-table SAVEPOINT. This collapses N round-trips into ceil(N/chunk).
        # If ANY chunk fails, we roll back and fall back to per-row mode to
        # surface row-level errors and skip bad rows.
        batch_ok = False
        if prepared:
            try:
                async with db.begin_nested():
                    for sig in group_order:
                        group_rows = groups[sig]
                        chunk = _chunk_size_for(len(sig))
                        for i in range(0, len(group_rows), chunk):
                            slice_rows = group_rows[i:i + chunk]
                            stmt, kind = _build_multi_stmt(slice_rows)
                            if stmt is None:
                                continue
                            await db.execute(stmt)
                            if kind == "update":
                                updated += len(slice_rows)
                            else:
                                inserted += len(slice_rows)
                batch_ok = True
            except Exception as exc:  # noqa: BLE001
                # Reset counters; fall back to per-row.
                inserted = 0
                updated = 0
                first_error = str(exc)[:300]
                logger.info(
                    "Batch import failed for %s, falling back to per-row: %s",
                    tname, str(exc)[:200],
                )

        if not batch_ok and prepared:
            # Per-row SAVEPOINT fallback: surface row-level errors, skip bad rows.
            for payload in prepared:
                try:
                    async with db.begin_nested():
                        stmt, kind = _build_stmt(payload)
                        await db.execute(stmt)
                        if kind == "update":
                            updated += 1
                        else:
                            inserted += 1
                except Exception as exc:  # noqa: BLE001
                    skipped += 1
                    if first_error is None:
                        first_error = str(exc)[:300]
                    logger.warning(
                        "Row import failed for %s: %s", tname, exc
                    )

        # Build the final report entry for this table.
        if (inserted + updated) > 0 and first_error is None:
            status = "ok"
        elif (inserted + updated) > 0 and first_error is not None:
            status = "partial"
        elif rows and first_error is not None:
            status = "error"
        else:
            status = "ok"

        entry = {
            "status": status,
            "inserted": inserted,
            "updated": updated,
            "skipped": skipped,
        }
        if first_error:
            entry["detail"] = first_error

        # Don't overwrite a prior "clear failed" report unless we made progress.
        prev = report["tables"].get(tname)
        if prev is None or (inserted + updated) > 0:
            report["tables"][tname] = entry
        else:
            # Merge counters into the prior error report.
            prev["inserted"] = inserted
            prev["updated"] = updated
            prev["skipped"] = skipped
            if first_error and "detail" not in prev:
                prev["detail"] = first_error

    if replica_role_set:
        try:
            await db.execute(_SET_SESSION_DEFAULT)
        except Exception:
            pass

    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=500, detail="Import commit failed: " + str(exc)
        )

    # Top-level totals for the UI.
    totals = {
        "tables_total": len(report["tables"]),
        "tables_ok": sum(
            1 for v in report["tables"].values() if v.get("status") == "ok"
        ),
        "tables_partial": sum(
            1 for v in report["tables"].values() if v.get("status") == "partial"
        ),
        "tables_error": sum(
            1 for v in report["tables"].values() if v.get("status") == "error"
        ),
        "tables_skipped": sum(
            1 for v in report["tables"].values() if v.get("status") == "skipped"
        ),
        "rows_inserted": sum(
            v.get("inserted", 0) for v in report["tables"].values()
        ),
        "rows_updated": sum(
            v.get("updated", 0) for v in report["tables"].values()
        ),
        "rows_skipped": sum(
            v.get("skipped", 0) for v in report["tables"].values()
        ),
    }
    report["totals"] = totals
    return report