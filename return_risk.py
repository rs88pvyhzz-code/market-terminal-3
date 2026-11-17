"""Source-aware returns, annualised risk and per-security ingestion checks.

Prices and dividends must refer to the SAME split-adjusted share units, the
same currency, and dated observations. Yahoo 'adjClose' is already an
unofficial dividend/split-adjusted price proxy: NEVER add cash dividends to it.

No market data is synthesised, forward-filled or silently imputed.
"""
from __future__ import annotations

import datetime as dt
import math
import statistics
from collections import defaultdict

PERIODS_PER_YEAR = {'daily': 252, 'weekly': 52, 'monthly': 12}


def _positive_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and 0 < number < 1e12 else None
    except (ValueError, TypeError, OverflowError):
        return None


def _date(value):
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        return value if dt.date.fromisoformat(value).isoformat() == value else None
    except ValueError:
        return None


def period_total_returns(prices, dividends=None, *, basis='adjusted'):
    """Return [(date, simple period return)] from dates and strictly positive prices.

    'adjusted' is a vendor total-return proxy (dividends ALREADY incorporated).
    'price' excludes income. 'cash_dividends' adds actual cash on exact ex-dates.
    Prices supplied with cash dividends must be split-adjusted to the same
    share unit; the caller is responsible for verifying that source convention.
    Dividend events on non-price dates are rejected rather than displaced.
    """
    if basis not in ('adjusted', 'price', 'cash_dividends'):
        raise ValueError('Unknown return basis')
    if basis != 'cash_dividends' and dividends is not None:
        raise ValueError('Cash dividends cannot be added to already adjusted or price-only series')
    if basis == 'cash_dividends' and dividends is None:
        raise ValueError('Cash dividend calculation requires a verified dividend series')
    rows = list(prices)
    if len(rows) < 2:
        return []
    dates = []
    for day, value in rows:
        if not _date(day) or _positive_number(value) is None:
            raise ValueError('Non-dated, zero or non-finite price observation')
        if dates and day <= dates[-1]:
            raise ValueError('Price dates must be strictly increasing and unique')
        dates.append(day)
    cash = dividends or {}
    if isinstance(cash, (list, tuple)):
        cash = dict(cash)
    if not isinstance(cash, dict) or any(d not in dates or not _date(d) for d in cash):
        raise ValueError('Cash dividends require exact matching dated price observations')
    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in cash.values()):
        raise ValueError('Negative, non-finite or missing cash dividends')
    output = []
    for (prev_day, prev), (day, current) in zip(rows, rows[1:]):
        payment = float(cash.get(day, 0.0)) if basis == 'cash_dividends' else 0.0
        value = (float(current) + payment) / float(prev) - 1.0
        if not math.isfinite(value):
            raise ValueError('Non-finite computed total return')
        output.append((day, value))
    return output


def annualized_metrics(returns, *, risk_free_annual=None, periods_per_year=252):
    """Arithmetic annualised mean, sample volatility, and ex-post Sharpe.

    The risk-free rate is an ANNUAL EFFECTIVE decimal rate matched in currency
    and observation period. None means NO VERIFIED risk-free series and the
    Sharpe ratio remains unavailable; zero volatility also yields None.
    252 is for daily exchange trading, 52 weekly, 12 monthly. Crypto is not
    a 252-session asset; explicitly pass 365 when using calendar-daily data.
    """
    xs = list(returns)
    if periods_per_year <= 0 or not math.isfinite(periods_per_year):
        raise ValueError('Invalid annualisation frequency')
    if not all(isinstance(x, (int, float)) and math.isfinite(x) and x > -1 for x in xs):
        raise ValueError('Returns must be finite simple returns greater than -100%')
    if risk_free_annual is not None and (
        not isinstance(risk_free_annual, (int, float))
        or not math.isfinite(risk_free_annual) or risk_free_annual <= -1
    ):
        raise ValueError('Invalid annual effective risk-free rate')
    if len(xs) < 2:
        return {'observations': len(xs), 'annualized_arithmetic': None,
                'volatility': None, 'sharpe': None}
    mean = statistics.mean(xs)
    sd = statistics.stdev(xs)
    volatility = sd * math.sqrt(periods_per_year)
    sharpe = None
    if risk_free_annual is not None and sd > 0:
        per_period_rf = (1.0 + risk_free_annual) ** (1.0 / periods_per_year) - 1.0
        sharpe = math.sqrt(periods_per_year) * (mean - per_period_rf) / sd
    return {'observations': len(xs), 'annualized_arithmetic': mean * periods_per_year,
            'volatility': volatility, 'sharpe': sharpe}


def cagr(first_price, last_price, calendar_days):
    """Annual compound return. Separate from arithmetic annualised mean."""
    first, last = _positive_number(first_price), _positive_number(last_price)
    if first is None or last is None or not 0 < calendar_days:
        return None
    return (last / first) ** (365.25 / calendar_days) - 1


def validate_market_history(history):
    """Quarantine corrupt OBSERVATIONS, not unrelated securities or data feeds.

    Conflicting duplicate dates are all excluded for that security/date. A
    >55% adjacent price move is flagged for the risk calculator to withhold
    the affected return window, NOT silently rewritten as a corporate action.
    Missing adjClose is normal for indices; invalid supplied adjClose is dropped
    without replacing it with the unadjusted close.
    """
    by_symbol = defaultdict(list)
    invalid = 0
    invalid_adjusted = 0
    duplicates = 0
    conflicting = 0
    exceptions = []
    for row in history or []:
        sym = str(row.get('symbol', '')).strip() if isinstance(row, dict) else ''
        day = _date(row.get('date')) if isinstance(row, dict) else None
        close = _positive_number(row.get('close')) if isinstance(row, dict) else None
        if not sym or day is None or close is None:
            invalid += 1
            if len(exceptions) < 25:
                exceptions.append({'symbol': sym or '?', 'date': day or '', 'reason': 'invalid close or date'})
            continue
        clean = {'symbol': sym, 'date': day, 'close': float(close)}
        if row.get('adjClose') is not None:
            adj = _positive_number(row['adjClose'])
            if adj is None:
                invalid_adjusted += 1
                if len(exceptions) < 25:
                    exceptions.append({'symbol': sym, 'date': day, 'reason': 'invalid adjusted close'})
            else:
                clean['adjClose'] = float(adj)
        by_symbol[sym].append(clean)
    cleaned = []
    suspicious = set()
    for sym, rows in by_symbol.items():
        buckets = defaultdict(list)
        for row in rows:
            buckets[row['date']].append(row)
        points = []
        for day, group in sorted(buckets.items()):
            if len(group) > 1:
                duplicates += len(group) - 1
                if any(row != group[0] for row in group[1:]):
                    conflicting += 1
                    if len(exceptions) < 25:
                        exceptions.append({'symbol': sym, 'date': day, 'reason': 'conflicting duplicate date'})
                    continue
            points.append(group[0])
        for prev, cur in zip(points, points[1:]):
            gap = (dt.date.fromisoformat(cur['date']) - dt.date.fromisoformat(prev['date'])).days
            if 0 < gap <= 7 and abs(cur['close'] / prev['close'] - 1) > .55:
                suspicious.add(sym)
        cleaned.extend(points)
    report = {
        'inputPoints': len(history or []), 'validPoints': len(cleaned),
        'invalidPricePoints': invalid, 'invalidAdjustedPoints': invalid_adjusted,
        'duplicateDates': duplicates, 'conflictingDates': conflicting,
        'suspiciousMoveSymbols': sorted(suspicious),
        'affectedSymbols': sorted({x['symbol'] for x in exceptions if x['symbol'] != '?'} | suspicious),
        'examples': exceptions[:25],
        'policy': 'Invalid observations quarantined per symbol; potential splits/outliers flagged, never fabricated'
    }
    return cleaned, report
