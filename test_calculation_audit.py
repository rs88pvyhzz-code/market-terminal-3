"""Calculation audit: privacy, method provenance, linkage, UTC and gating."""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import calculation_audit as audit
import build_site


class CalculationAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in audit.METHOD_FILES:
            (self.root / name).write_text("versioned source: " + name, encoding="utf-8")
        self.payload = {
            "demo": False,
            "generatedAt": "2026-11-17 14:05 UTC",
            "quotes": [
                {"symbol": "^FTSE", "name": "FTSE 100", "price": 101,
                 "asOf": "2026-11-16 16:35 UTC"}
            ],
            "history": [
                {"symbol": "^FTSE", "date": "2026-11-13", "close": 100},
                {"symbol": "^FTSE", "date": "2026-11-16", "close": 102},
            ],
            "uk_rates": [{"date": "2026-11-13", "bankRate": 4.0}],
            "quality": {"returnValidation": {
                "inputPoints": 3, "validPoints": 2, "invalidPricePoints": 1,
                "suspiciousMoveSymbols": ["X"],
                "examples": [{"symbol": "X", "reason": "invalid close"}],
            }},
            "warnings": ["DO NOT LOG: account 123, holdings £500000"],
            "personalWatchlist": [{
                "symbol": "PRIVATE", "weights": [0.2, 0.8],
                "accountNumber": "DO NOT LOG",
            }],
            "watchlist_quotes": [{"symbol": "PRIVATE", "price": 999}],
            "secrets": {"API_TOKEN": "secret-value"},
        }

    def make_record(self, run="100", attempt="1"):
        return audit.create_record(
            self.payload, method_root=self.root, run_id=run,
            run_attempt=attempt, checked_at="2026-11-17T14:05:00+00:00",
        )

    def test_only_verified_real_snapshots(self):
        self.payload["demo"] = True
        with self.assertRaises(ValueError):
            self.make_record()
        self.payload["demo"] = None
        with self.assertRaises(ValueError):
            self.make_record()

    def test_source_dates_versions_and_private_exclusion(self):
        record = self.make_record()
        self.assertEqual(record["marketInputSections"]["quotes"]["latestSourceObservation"], "2026-11-16")
        self.assertEqual(record["marketInputSections"]["history"]["observations"], 2)
        self.assertEqual(len(record["methodFingerprint"]), len(audit.METHOD_FILES))
        self.assertIsNone(record["methodology"]["riskFreeRate"])
        self.assertIn("not assumed", record["methodology"]["riskFreeStatus"])
        self.assertEqual(record["validationCounters"]["invalidPricePoints"], 1)
        sample = record["independentPriceRiskSamples"][0]
        self.assertEqual(sample["symbol"], "^FTSE")
        self.assertAlmostEqual(sample["closeToClosePriceReturnPct"], 2.0)
        self.assertIsNone(sample["annualizedPriceVolatilityPct"])
        text = json.dumps(record)
        for forbidden in ["PRIVATE", "500000", "DO NOT LOG", '"accountNumber"', "secret-value", '"weights"']:
            self.assertNotIn(forbidden, text)

    def test_append_with_chain_duplicate_protection_and_bounded_public_copy(self):
        local = self.root / ".terminal_sources" / "audit.jsonl"
        published = self.root / "public" / "calculation_audit.jsonl"
        first = audit.append_verified(self.make_record(), local_path=local,
                                      published_path=published)
        second = audit.append_verified(self.make_record(run="101"), local_path=local,
                                       published_path=published)
        self.assertIsNone(first["previousRecordSha256"])
        self.assertEqual(second["previousRecordSha256"], first["recordSha256"])
        self.assertEqual(len(local.read_text().splitlines()), 2)
        self.assertEqual(len(published.read_text().splitlines()), 2)
        self.assertEqual([r["runId"] for r in audit._load_existing(local)], ["100", "101"])
        with self.assertRaises(ValueError):
            audit.append_verified(self.make_record(run="100"), local_path=local,
                                  published_path=published)

    def test_tampering_stops_further_audit_append(self):
        local = self.root / "calculation_audit.jsonl"
        pub = self.root / "public" / "calculation_audit.jsonl"
        audit.append_verified(self.make_record(), local_path=local,
                              published_path=pub)
        content = local.read_text().replace('"warningCount":1', '"warningCount":100')
        local.write_text(content, encoding="utf-8")
        with self.assertRaises(ValueError):
            audit.append_verified(self.make_record(run="101"), local_path=local,
                                  published_path=pub)

    def test_build_audit_only_called_on_verified_path(self):
        text = (Path(build_site.__file__)).read_text(encoding="utf-8")
        self.assertIn("if a.verify:\n        run('News provenance and coverage'", text)
        self.assertIn("        record_verified_calculation_audit(html)", text)
        self.assertIn("if a.demo and a.verify:", text)


if __name__ == "__main__":
    unittest.main()
