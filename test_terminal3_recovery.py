"""Terminal 3 recovery tests: real cache schemas, no invented market observations."""
import datetime as dt
import gzip
import io
import json
import os
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs

import company_profiles
import market_fundamentals
import market_price_history
import source_archive
import us_treasury_market


class RecoveryTests(unittest.TestCase):
    def test_fundamental_union_prefers_more_complete_evidence(self):
        old = {'records': {'A': {'symbol': 'A', 'asOf': '2026-11-15', 'pe': 12, 'cap': 10},
                           'B': {'symbol': 'B', 'asOf': '2026-11-15', 'pe': 15}},
               'attempts': {'A': '2026-11-15', 'B': '2026-11-15'}}
        new = {'records': {'A': {'symbol': 'A', 'asOf': '2026-11-16', 'pe': None},
                           'C': {'symbol': 'C', 'asOf': '2026-11-16', 'pe': 16}},
               'attempts': {'A': '2026-11-16', 'C': '2026-11-16'}}
        def get(request, timeout):
            return io.BytesIO(json.dumps(old if 'Market-terminal-2' in request.full_url else new).encode())
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/market-terminal-3'}), \
             patch.object(market_fundamentals.urllib.request, 'urlopen', side_effect=get):
            merged = market_fundamentals.previous_site_snapshot()
        self.assertEqual(set(merged['records']), {'A','B','C'})
        self.assertEqual(merged['records']['A']['pe'], 12)
        self.assertEqual(merged['attempts']['A'], '2026-11-16')

    def test_company_profiles_union_and_original_page_case(self):
        old = {'records': {'A': {'symbol':'A','annual':[{'fiscalEnd':'2025-12-31'}], 'asOf':'2026-11-15'},
                           'B': {'symbol':'B','annual':[], 'asOf':'2026-11-15'}}, 'attempts': {}}
        new = {'records': {'A': {'symbol':'A','annual':[], 'asOf':'2026-11-16'},
                           'C': {'symbol':'C','annual':[], 'asOf':'2026-11-16'}}, 'attempts': {}}
        visited=[]
        def get(request, timeout):
            visited.append(request.full_url)
            return io.BytesIO(json.dumps(old if 'Market-terminal-2' in request.full_url else new).encode())
        with patch.dict(os.environ, {'GITHUB_REPOSITORY':'owner/market-terminal-3'}), \
             patch.object(company_profiles.urllib.request, 'urlopen', side_effect=get):
            merged = company_profiles._restore_published()
        self.assertTrue(any('/Market-terminal-2/' in u for u in visited))
        self.assertEqual(set(merged['records']), {'A','B','C'})
        self.assertEqual(len(merged['records']['A']['annual']), 1)

    def test_prices_merge_and_retain_old_start_date(self):
        old={'records': {'A': {'symbol':'A','currency':'GBP','asOf':'2026-11-15',
                               'points':[['2020-01-01',10],['2026-11-14',15],['2026-11-15',16]]},
                         'B': {'symbol':'B','points':[['2020-01-01',20],['2026-11-15',30]]}},
             'attempts':{'A':'2026-11-15'}}
        new={'records': {'A': {'symbol':'A','currency':'GBP','asOf':'2026-11-16',
                               'points':[['2026-11-14',15],['2026-11-15',16],['2026-11-16',17]]},
                         'C': {'symbol':'C','points':[['2025-01-01',1],['2026-11-16',2]]}},
             'attempts':{'A':'2026-11-16'}}
        def get(request):
            data=old if '/Market-terminal-2/' in request.full_url else new
            return gzip.compress(json.dumps(data).encode())
        with patch.dict(os.environ, {'GITHUB_REPOSITORY':'owner/market-terminal-3'}):
            recovered=market_price_history.prior_cache(opener=get)
        self.assertEqual(set(recovered['records']), {'A','B','C'})
        self.assertEqual(recovered['records']['A']['points'][0][0], '2020-01-01')
        self.assertEqual(recovered['records']['A']['points'][-1], ['2026-11-16',17])

    def test_treasury_dated_post_uses_session_token_and_exact_date(self):
        requested=dt.date(2026,11,13)
        form=b'<form id="fromToDate"><input name="priceDate" value="2026-11-13" value="11/13/26"><input name="_csrf" value="test-token"></form>'
        opener=MagicMock()
        opener.open.return_value.__enter__.return_value.read.side_effect=[form,b'price table']
        with patch.object(us_treasury_market.urllib.request,'build_opener',return_value=opener), \
             patch.object(us_treasury_market,'parse_html',return_value=([{'cusip':'912797VX2'}],requested)):
            rows,date=us_treasury_market.fetch_dated(requested,dt.date(2026,11,16))
        post=opener.open.call_args_list[1].args[0]
        self.assertEqual(post.get_method(),'POST')
        self.assertEqual(parse_qs(post.data.decode())['priceDate'],['2026-11-13'])
        self.assertEqual(parse_qs(post.data.decode())['_csrf'],['test-token'])
        self.assertEqual(rows[0]['source'],us_treasury_market.DETAIL_URL)
        self.assertEqual(date,requested)

    def test_treasury_rejects_mismatched_source_date(self):
        form=b'<form id="fromToDate"><input name="_csrf" value="test-token"></form>'
        opener=MagicMock()
        opener.open.return_value.__enter__.return_value.read.side_effect=[form,b'price table']
        with patch.object(us_treasury_market.urllib.request,'build_opener',return_value=opener), \
             patch.object(us_treasury_market,'parse_html',return_value=([{'cusip':'912797VX2'}],dt.date(2026,11,12))):
            with self.assertRaisesRegex(ValueError,'differs'):
                us_treasury_market.fetch_dated(dt.date(2026,11,13),dt.date(2026,11,16))

    def test_verified_source_archive_retains_older_retrieval_over_stale_incoming(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            target=root/'.terminal_filings'/'verified.json'
            target.parent.mkdir(parents=True)
            existing={'retrievedAt':'2026-11-15T10:00:00+00:00','evidence':5}
            target.write_text(json.dumps(existing))
            import hashlib
            old=json.dumps({'retrievedAt':'2026-11-09T10:00:00+00:00','evidence':3})
            data={'schema':1,'entries':{'.terminal_filings/verified.json':{
                'sha256':hashlib.sha256(old.encode()).hexdigest(),'content':old}}}
            self.assertEqual(source_archive.restore_bytes(gzip.compress(json.dumps(data).encode()),root),0)
            self.assertEqual(json.loads(target.read_text())['evidence'],5)


if __name__=='__main__':
    unittest.main()
