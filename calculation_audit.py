"""Audit VERIFIED Market Terminal calculations and their actual source dates.

Only public market feeds, calculation-method fingerprints, and bounded diagnostic
metrics are logged. No personal watchlist, portfolio weights, accounts, secrets,
or position values are included. The SHA-256 chain detects accidental changes,
but is not a signature or a tamper-proof audit ledger.

The build workflow appends locally after hard verification. A bounded JSONL
export is published and the entire local record is included in workflow artifacts.
GitHub cache/artifact retention means this is NOT a permanent archive.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
from collections import defaultdict
from pathlib import Path
from uuid import uuid4

import return_risk

SCHEMA_VERSION = 1
PUBLIC_KEYS = ("quotes", "history", "uk_rates", "us_rates", "eu_rates",
               "macro", "gilts", "gilt_history", "us_treasuries",
               "us_treasury_history", "marketAnalytics", "etfTracker")
METHOD_FILES = ("return_risk.py", "market_analytics.py", "etf_tracker.py",
                "etf_metrics.py", "terminal_template.html",
                "terminal_research_upgrade.js")
REFERENCE_SYMBOLS = ("^FTSE", "^FTMC", "^GSPC", "^IXIC", "SPY", "QQQ")
MAX_PUBLISHED_RECORDS = 400


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _valid_date(value):
    try:
        return dt.date.fromisoformat(str(value)[:10]).isoformat() == str(value)[:10]
    except (ValueError, TypeError):
        return False


def _section(raw):
    if not isinstance(raw, (list, dict)):
        return None
    dates = []
    if isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                continue
            date = row.get("date") or row.get("asOf") or row.get("tradingDay")
            if _valid_date(date):
                dates.append(str(date)[:10])
    return {"sha256": digest(raw),
            "observations": len(raw),
            "latestSourceObservation": max(dates) if dates else None}


def reference_checks(history):
    """Independent, appropriately labelled close-to-close cross-checks.

    These are *audit samples*, not NAV metrics and not replacements for
    calculated values displayed elsewhere. For missing/sparse data show null.
    """
    history_by_symbol = defaultdict(dict)
    for p in history or []:
        if not isinstance(p, dict) or p.get("symbol") not in REFERENCE_SYMBOLS:
            continue
        date = p.get("date")
        close = p.get("close")
        if not _valid_date(date):
            continue
        if not isinstance(close, (int, float)) or not math.isfinite(close) or close <= 0:
            continue
        history_by_symbol[p["symbol"]][date] = float(close)
    output = []
    for symbol in REFERENCE_SYMBOLS:
        p = sorted(history_by_symbol[symbol].items())
        if len(p) < 2:
            continue
        last_date = dt.date.fromisoformat(p[-1][0])
        recent = [(d, v) for d, v in p if 0 <= (last_date - dt.date.fromisoformat(d)).days <= 370]
        if len(recent) < 2:
            continue
        # There must be no missing long period in a metric presented as daily.
        valid_gaps = all(1 <= (dt.date.fromisoformat(b[0]) -
                               dt.date.fromisoformat(a[0])).days <= 5
                         for a, b in zip(recent, recent[1:]))
        moves = [b[1] / a[1] - 1 for a, b in zip(recent, recent[1:])]
        clean_moves = all(abs(v) <= .55 for v in moves)
        volatility = None
        if valid_gaps and clean_moves and len(moves) >= 150 and (
                dt.date.fromisoformat(recent[-1][0]) -
                dt.date.fromisoformat(recent[0][0])).days >= 295:
            volatility = return_risk.annualized_metrics(moves)["volatility"]
        output.append({
            "symbol": symbol, "lastCloseDate": p[-1][0],
            "closeToClosePriceReturnPct": round(moves[-1] * 100, 6) if
                valid_gaps and clean_moves else None,
            "annualizedPriceVolatilityPct": (
                round(volatility * 100, 6) if volatility is not None else None
            ),
            "eligibleDailyReturns": len(moves),
            "basis": "price_only_close_to_close; no dividends; local quote currency",
        })
    return output


def create_record(payload, *, method_root, run_id=None, run_attempt=None,
                  checked_at=None):
    if payload.get("demo") is not False:
        raise ValueError("Only verified real-data snapshots may be audited")
    run = str(run_id or os.environ.get("GITHUB_RUN_ID") or uuid4())
    attempt = str(run_attempt or os.environ.get("GITHUB_RUN_ATTEMPT") or "1")
    if not run.strip() or not attempt.strip():
        raise ValueError("Missing run identifier")
    root = Path(method_root)
    methods = {}
    for path in METHOD_FILES:
        raw = (root / path).read_bytes()
        methods[path] = hashlib.sha256(raw).hexdigest()
    sections = {}
    for name in PUBLIC_KEYS:
        val = _section(payload.get(name))
        if val is not None:
            sections[name] = val
    q = payload.get("quality") or {}
    validation = q.get("returnValidation") or {}
    # Whitelist public counts, not full source warnings or personal data.
    counters = {key: validation.get(key) for key in
                ("inputPoints", "validPoints", "invalidPricePoints",
                 "invalidAdjustedPoints", "duplicateDates",
                 "conflictingDates") if isinstance(validation.get(key), int)}
    record = {
        "schemaVersion": SCHEMA_VERSION,
        "runId": run,
        "runAttempt": attempt,
        "recordedAtUtc": checked_at or utc_now(),
        "snapshotGeneratedAt": payload.get("generatedAt"),
        "verified": True,
        "verificationGate": "verify_live_research + verify_snapshot + completed_layout; no fixture",
        "marketInputSections": sections,
        "methodFingerprint": methods,
        "methodology": {
            "cashDividendReturn": "(current_split_adjusted_price + dated_cash_dividend) / previous_split_adjusted_price - 1",
            "adjustedPrice": "Yahoo adjusted closes are an unofficial dividend-and-split-adjusted proxy; cash dividends never added again",
            "indices": "Price only unless separately verified total-return series supplied",
            "volatility": "Sample standard deviation of simple period returns, annualised by sqrt(observations_per_year)",
            "tradingDayAnnualisation": 252,
            "weeklyAnnualisation": 52,
            "calendarDailyAnnualisation": 365,
            "riskFreeRate": None,
            "riskFreeStatus": "Unavailable unless an actual dated currency-matched rate is verified; zero is not assumed",
            "sharpeIfRateMissing": None,
            "cagr": "Compound annualised price ratio over actual calendar days; not arithmetic mean",
            "currency": "Native quote currency unless the relevant dated FX series is verified",
        },
        "validationCounters": counters,
        "warningCount": len(payload.get("warnings") or []),
        "independentPriceRiskSamples": reference_checks(payload.get("history")),
        "privacy": "Public-market metadata only. No portfolios, holdings, account identifiers or personal weights.",
    }
    # Include section hashes rather than the underlying quotes/prices in this
    # externally accessible audit record.
    return record


def _load_existing(path):
    if not path.exists():
        return []
    records = []
    for line in path.read_text("utf-8").splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict) or len(value.get("recordSha256", "")) != 64:
            raise ValueError("Audit trail contains an invalid record")
        self_hash = value["recordSha256"]
        if digest({k: v for k, v in value.items() if k != "recordSha256"}) != self_hash:
            raise ValueError("Audit record hash mismatch; refusing to append")
        if records and value.get("previousRecordSha256") != records[-1]["recordSha256"]:
            raise ValueError("Audit hash chain broken; refusing to append")
        records.append(value)
    return records


def append_verified(record, *, local_path, published_path):
    """Append one verified run. Publishing is a bounded copy, not a full archive."""
    local = Path(local_path)
    existing = _load_existing(local)
    key = (record["runId"], record["runAttempt"])
    if any((v.get("runId"), v.get("runAttempt")) == key for v in existing):
        raise ValueError("Audit run/attempt already exists; duplicate append refused")
    to_store = dict(record)
    to_store["previousRecordSha256"] = (
        existing[-1]["recordSha256"] if existing else None
    )
    to_store["recordSha256"] = digest(to_store)
    encoded = canonical(to_store).decode("utf-8") + "\n"
    # First ensure the record can be encoded with strict JSON (NaN forbidden).
    local.parent.mkdir(parents=True, exist_ok=True)
    with local.open("a", encoding="utf-8") as out:
        out.write(encoded)
        out.flush()
        os.fsync(out.fileno())
    destination = Path(published_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    recent = (existing + [to_store])[-MAX_PUBLISHED_RECORDS:]
    partial = destination.with_suffix(destination.suffix + ".tmp")
    partial.write_text("".join(canonical(x).decode("utf-8") + "\n" for x in recent),
                       encoding="utf-8")
    partial.replace(destination)
    return to_store
